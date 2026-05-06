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

function writeCache(db, key, parsed, result, now) {
    db.prepare(`
        INSERT INTO identity_resolution_cache (
            cache_key, normalized_title, year, media_type, stable_provider, stable_id, kitsu_id,
            anilist_id, anidb_id, mal_id, imdb_id, tmdb_id, tvdb_id, confidence, status,
            evidence_json, created_at, updated_at
        ) VALUES (
            @cache_key, @normalized_title, @year, @media_type, @stable_provider, @stable_id, @kitsu_id,
            @anilist_id, @anidb_id, @mal_id, @imdb_id, @tmdb_id, @tvdb_id, @confidence, @status,
            @evidence_json, @created_at, @updated_at
        )
        ON CONFLICT(cache_key) DO UPDATE SET
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

        const key = cacheKey(parsed);
        const cached = readCache(db, key);
        if (cached) return fromCache(cached, item.infoHash || item.info_hash, now());

        const kitsuRows = await metadataClients.kitsuSearchAnime(parsed.title).catch(() => []);
        const kitsuMatches = kitsuRows
            .map(row => ({ row, score: titleScore(parsed.title, candidateTitlesFromKitsu(row)) }))
            .filter(match => match.score >= 92 && yearCompatible(parsed.year, match.row));

        if (kitsuMatches.length === 1) {
            const kitsuId = kitsuMatches[0].row.id;
            const record = recordByKitsu(animeMap, kitsuId) || { kitsu: kitsuId };
            const identity = identityRowFromRecord(item.infoHash || item.info_hash, record, 90, [
                `parser.title=${parsed.title}`,
                `kitsu.search=${kitsuId}`,
                `title_score=${kitsuMatches[0].score}`
            ], now());
            const result = { status: "accepted", identity };
            writeCache(db, key, parsed, result, now());
            return result;
        }

        if (kitsuMatches.length > 1) {
            const result = { status: "dropped", reason: "ambiguous_stable_id" };
            writeCache(db, key, parsed, result, now());
            return result;
        }

        const tmdbRows = await metadataClients.tmdbSearch(parsed.title).catch(() => []);
        const tmdbMatches = tmdbRows
            .map(row => ({ row, score: titleScore(parsed.title, candidateTitlesFromTmdb(row)) }))
            .filter(match => match.score >= 92 && yearCompatible(parsed.year, match.row));

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
            writeCache(db, key, parsed, result, now());
            return result;
        }

        const result = { status: "dropped", reason: tmdbMatches.length > 1 ? "ambiguous_stable_id" : "no_stable_id" };
        writeCache(db, key, parsed, result, now());
        return result;
    }

    return { resolve };
}

module.exports = {
    createStableIdResolver,
    identityRowFromRecord
};
