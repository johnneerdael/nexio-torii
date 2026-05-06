const { ratio } = require("fuzzball");
const { normalizeHash } = require("./source-item");
const { normalizeTitle } = require("./title-normalizer");
const { recordByAnidb, recordByKitsu, recordByTmdb } = require("./anime-map");

function identityRowFromRecord(infoHash, record, confidence, evidence, now = Date.now()) {
    if (!record || !record.kitsu) return null;
    return {
        info_hash: normalizeHash(infoHash),
        stable_provider: "kitsu",
        stable_id: String(record.kitsu),
        kitsu_id: record.kitsu || null,
        anilist_id: record.anilist || null,
        anidb_id: record.anidb || null,
        mal_id: record.mal || null,
        imdb_id: record.imdb || null,
        tmdb_id: record.tmdb || null,
        tvdb_id: record.tvdb || null,
        confidence,
        evidence_json: JSON.stringify(evidence),
        updated_at: now
    };
}

function identityRowFromTmdb(infoHash, result, confidence, evidence, now = Date.now()) {
    const tmdbId = String(result.id);
    return {
        info_hash: normalizeHash(infoHash),
        stable_provider: "tmdb",
        stable_id: tmdbId,
        kitsu_id: null,
        anilist_id: null,
        anidb_id: null,
        mal_id: null,
        imdb_id: null,
        tmdb_id: tmdbId,
        tvdb_id: null,
        confidence,
        evidence_json: JSON.stringify(evidence),
        updated_at: now
    };
}

function candidateTitlesFromKitsu(row) {
    const attrs = row.attributes || {};
    return [attrs.canonicalTitle, attrs.titles?.en, attrs.titles?.en_jp, attrs.titles?.ja_jp]
        .filter(Boolean)
        .map(String);
}

function candidateTitlesFromTmdb(row) {
    return [row.name, row.original_name, row.title, row.original_title].filter(Boolean).map(String);
}

function candidateYear(row) {
    const date = row.attributes?.startDate || row.first_air_date || row.release_date || "";
    return String(date).slice(0, 4) || null;
}

function titleScore(parsedTitle, candidateTitles) {
    const normalizedParsed = normalizeTitle(parsedTitle);
    return Math.max(0, ...candidateTitles.map(title => {
        const normalized = normalizeTitle(title);
        if (normalized === normalizedParsed) return 100;
        return ratio(normalizedParsed, normalized);
    }));
}

function yearCompatible(parsedYear, row) {
    if (!parsedYear) return true;
    const year = Number(candidateYear(row));
    const parsed = Number(parsedYear);
    if (!Number.isFinite(year) || !Number.isFinite(parsed)) return true;
    return Math.abs(year - parsed) <= 1;
}

function cacheKey(parsed) {
    return [
        parsed.normalizedTitle || "unknown",
        parsed.year || "any",
        parsed.seasons?.[0] || "s",
        parsed.episodes?.[0] || "e"
    ].join(":");
}

function readCache(db, key) {
    return db.prepare("SELECT * FROM identity_resolution_cache WHERE cache_key = ?").get(key) || null;
}

function writeCache(db, key, parsed, result, now, diagnostics = {}) {
    db.prepare(`
        INSERT INTO identity_resolution_cache (
            cache_key, normalized_title, year, media_type, query_json, candidate_json, stable_provider, stable_id, kitsu_id,
            anilist_id, anidb_id, mal_id, imdb_id, tmdb_id, tvdb_id, confidence, status,
            evidence_json, created_at, updated_at
        ) VALUES (
            @cache_key, @normalized_title, @year, @media_type, @query_json, @candidate_json, @stable_provider, @stable_id, @kitsu_id,
            @anilist_id, @anidb_id, @mal_id, @imdb_id, @tmdb_id, @tvdb_id, @confidence, @status,
            @evidence_json, @created_at, @updated_at
        )
        ON CONFLICT(cache_key) DO UPDATE SET
            query_json = excluded.query_json,
            candidate_json = excluded.candidate_json,
            stable_provider = excluded.stable_provider,
            stable_id = excluded.stable_id,
            kitsu_id = excluded.kitsu_id,
            anilist_id = excluded.anilist_id,
            anidb_id = excluded.anidb_id,
            mal_id = excluded.mal_id,
            imdb_id = excluded.imdb_id,
            tmdb_id = excluded.tmdb_id,
            tvdb_id = excluded.tvdb_id,
            confidence = excluded.confidence,
            status = excluded.status,
            evidence_json = excluded.evidence_json,
            updated_at = excluded.updated_at
    `).run({
        cache_key: key,
        normalized_title: parsed.normalizedTitle || "",
        year: parsed.year || null,
        media_type: null,
        query_json: JSON.stringify(diagnostics.queries || parsed.queryTitles || [parsed.title].filter(Boolean)),
        candidate_json: JSON.stringify(diagnostics.candidates || {}),
        stable_provider: result.identity?.stable_provider || null,
        stable_id: result.identity?.stable_id || null,
        kitsu_id: result.identity?.kitsu_id || null,
        anilist_id: result.identity?.anilist_id || null,
        anidb_id: result.identity?.anidb_id || null,
        mal_id: result.identity?.mal_id || null,
        imdb_id: result.identity?.imdb_id || null,
        tmdb_id: result.identity?.tmdb_id || null,
        tvdb_id: result.identity?.tvdb_id || null,
        confidence: result.identity?.confidence || 0,
        status: result.status,
        evidence_json: result.identity?.evidence_json || JSON.stringify([result.reason]),
        created_at: now,
        updated_at: now
    });
}

function fromCache(cache, infoHash, now) {
    if (cache.status !== "accepted") return { status: "dropped", reason: "cached_unmapped" };
    return {
        status: "accepted",
        identity: {
            info_hash: normalizeHash(infoHash),
            stable_provider: cache.stable_provider,
            stable_id: cache.stable_id,
            kitsu_id: cache.kitsu_id,
            anilist_id: cache.anilist_id,
            anidb_id: cache.anidb_id,
            mal_id: cache.mal_id,
            imdb_id: cache.imdb_id,
            tmdb_id: cache.tmdb_id,
            tvdb_id: cache.tvdb_id,
            confidence: cache.confidence,
            evidence_json: cache.evidence_json,
            updated_at: now
        }
    };
}

function queryTitlesFor(parsed) {
    const titles = Array.isArray(parsed.queryTitles) && parsed.queryTitles.length ? parsed.queryTitles : [parsed.title].filter(Boolean);
    return titles.filter((title, index, list) => list.findIndex(other => normalizeTitle(other) === normalizeTitle(title)) === index);
}

function hasSeasonEvidence(parsed, query) {
    return Boolean(
        parsed.seasonHints?.some(hint => normalizeTitle(query).includes(normalizeTitle(hint))) ||
        parsed.seasons?.length
    );
}

function diagnosticCandidate(provider, query, match) {
    return {
        provider,
        query,
        id: String(match.row.id),
        score: match.score,
        titles: provider === "kitsu" ? candidateTitlesFromKitsu(match.row) : candidateTitlesFromTmdb(match.row),
        year: candidateYear(match.row),
        mediaType: match.row.media_type || null
    };
}

async function collectKitsuMatches(metadataClients, parsed, queries) {
    const candidates = [];
    for (const query of queries) {
        const rows = await metadataClients.kitsuSearchAnime(query).catch(() => []);
        const matches = rows
            .map(row => ({ row, query, score: titleScore(query, candidateTitlesFromKitsu(row)) }))
            .filter(match => match.score >= 86 && yearCompatible(parsed.year, match.row));
        candidates.push(...matches.map(match => diagnosticCandidate("kitsu", query, match)));
        const strict = matches.filter(match => match.score >= 92);
        if (strict.length === 1) return { matches: strict, candidates };
        if (strict.length > 1) return { matches: strict, candidates };
        const seasonBacked = matches.filter(match => match.score >= 86 && hasSeasonEvidence(parsed, query));
        if (seasonBacked.length === 1) return { matches: seasonBacked, candidates, seasonBacked: true };
        if (seasonBacked.length > 1) return { matches: seasonBacked, candidates, seasonBacked: true };
    }
    return { matches: [], candidates };
}

async function collectTmdbMatches(metadataClients, parsed, queries) {
    const candidates = [];
    for (const query of queries) {
        const rows = await metadataClients.tmdbSearch(query).catch(() => []);
        const matches = rows
            .map(row => ({ row, query, score: titleScore(query, candidateTitlesFromTmdb(row)) }))
            .filter(match => match.score >= 90 && yearCompatible(parsed.year, match.row));
        candidates.push(...matches.map(match => diagnosticCandidate("tmdb", query, match)));
        if (matches.length) return { matches, candidates };
    }
    return { matches: [], candidates };
}

function createStableIdResolver(options) {
    const db = options.db;
    const animeMap = options.animeMap;
    const metadataClients = options.metadataClients;
    const now = options.now || Date.now;

    async function resolve(item, parsed) {
        const raw = item.raw || {};
        const aid = raw.aid || raw.anidb_aid || raw.anidbAid;
        if (aid) {
            const record = recordByAnidb(animeMap, aid);
            const identity = identityRowFromRecord(item.infoHash || item.info_hash, record, 100, [
                `${item.source}.aid=${aid}`,
                `anime-map.anidb=${aid}`,
                `kitsu=${record?.kitsu || ""}`
            ], now());
            if (identity) return { status: "accepted", identity };
        }

        if (!parsed?.title || !parsed.normalizedTitle) return { status: "dropped", reason: "unparsed_title" };
        if (parsed.dropReason) return { status: "dropped", reason: parsed.dropReason };
        const queries = queryTitlesFor(parsed);

        const key = cacheKey(parsed);
        const cached = readCache(db, key);
        if (cached) return fromCache(cached, item.infoHash || item.info_hash, now());

        const kitsuResult = await collectKitsuMatches(metadataClients, parsed, queries);
        const kitsuMatches = kitsuResult.matches;

        if (kitsuMatches.length === 1) {
            const kitsuId = kitsuMatches[0].row.id;
            const record = recordByKitsu(animeMap, kitsuId) || { kitsu: kitsuId };
            const confidence = kitsuResult.seasonBacked ? 86 : 90;
            const identity = identityRowFromRecord(item.infoHash || item.info_hash, record, confidence, [
                `parser.title=${parsed.title}`,
                `resolver.query=${kitsuMatches[0].query}`,
                `kitsu.search=${kitsuId}`,
                `title_score=${kitsuMatches[0].score}`
            ], now());
            const result = { status: "accepted", identity };
            writeCache(db, key, parsed, result, now(), { queries, candidates: { kitsu: kitsuResult.candidates } });
            return result;
        }

        if (kitsuMatches.length > 1) {
            const result = { status: "dropped", reason: "ambiguous_stable_id" };
            writeCache(db, key, parsed, result, now(), { queries, candidates: { kitsu: kitsuResult.candidates } });
            return result;
        }

        const tmdbResult = await collectTmdbMatches(metadataClients, parsed, queries);
        const tmdbMatches = tmdbResult.matches;

        if (tmdbMatches.length === 1) {
            const tmdb = tmdbMatches[0].row;
            const record = recordByTmdb(animeMap, tmdb.id, tmdb.media_type);
            const identity = record
                ? identityRowFromRecord(item.infoHash || item.info_hash, { ...record, tmdb: String(tmdb.id) }, 88, [
                    `parser.title=${parsed.title}`,
                    `tmdb.search=${tmdb.id}`,
                    `title_score=${tmdbMatches[0].score}`
                ], now())
                : identityRowFromTmdb(item.infoHash || item.info_hash, tmdb, 82, [
                    `parser.title=${parsed.title}`,
                    `tmdb.search=${tmdb.id}`,
                    `title_score=${tmdbMatches[0].score}`
                ], now());
            const result = { status: "accepted", identity };
            writeCache(db, key, parsed, result, now(), { queries, candidates: { kitsu: kitsuResult.candidates, tmdb: tmdbResult.candidates } });
            return result;
        }

        const result = { status: "dropped", reason: tmdbMatches.length > 1 ? "ambiguous_stable_id" : "no_stable_id" };
        writeCache(db, key, parsed, result, now(), { queries, candidates: { kitsu: kitsuResult.candidates, tmdb: tmdbResult.candidates } });
        return result;
    }

    return { resolve };
}

module.exports = {
    createStableIdResolver,
    identityRowFromRecord
};
