const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const { defaultAnimeMapPath } = require("./anime-map");

const FRIBB_RAW_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/refs/heads/master/anime-list-full.json";
const FRIBB_COMMITS_URL = "https://api.github.com/repos/Fribb/anime-lists/commits/master";
const SCUDLEE_RAW_URL = "https://raw.githubusercontent.com/Anime-Lists/anime-lists/refs/heads/master/anime-list-full.xml";
const SCUDLEE_COMMITS_URL = "https://api.github.com/repos/Anime-Lists/anime-lists/commits/master";

function stringId(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
    return null;
}

function normalizeSeason(value) {
    const trimmed = String(value || "").trim().toLowerCase();
    if (!trimmed) return null;
    if (["a", "hentai", "unknown"].includes(trimmed)) return trimmed;
    const numeric = parseInt(trimmed, 10);
    return Number.isFinite(numeric) && /^-?\d+$/.test(trimmed) ? String(numeric) : null;
}

function arrayOf(value) {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

function parseFribbJson(json) {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
        const anidb = stringId(row.anidb_id);
        if (!anidb) return null;
        const season = row.season && typeof row.season === "object" ? row.season : {};
        return {
            anidb,
            kitsu: stringId(row.kitsu_id),
            mal: stringId(row.mal_id),
            anilist: stringId(row.anilist_id),
            tvdb: stringId(row.tvdb_id),
            tmdb: stringId(row.themoviedb_id),
            imdb: typeof row.imdb_id === "string" && row.imdb_id.trim() ? row.imdb_id.trim() : null,
            sourceType: typeof row.type === "string" && row.type.trim() ? row.type.trim() : null,
            tvdbSeasonHint: stringId(season.tvdb),
            tmdbSeasonHint: stringId(season.tmdb)
        };
    }).filter(Boolean);
}

function parseInlineMaps(text, sourceSeason, targetProvider, targetSeason) {
    return String(text || "").trim().split(";").map(token => {
        const [source, target] = token.split("-").map(part => parseInt(part.trim(), 10));
        if (!Number.isFinite(source) || !Number.isFinite(target)) return null;
        return {
            sourceSeason,
            sourceEpisode: source,
            targetProvider,
            targetSeason,
            targetEpisode: target
        };
    }).filter(Boolean);
}

function expandMappingList(mappingList) {
    const ranges = [];
    const explicitMaps = [];
    for (const mapping of arrayOf(mappingList?.mapping)) {
        const sourceSeason = parseInt(mapping.anidbseason, 10);
        if (!Number.isFinite(sourceSeason)) continue;

        const targetProvider = mapping.tvdbseason !== undefined ? "TVDB" : mapping.tmdbseason !== undefined ? "TMDB" : null;
        if (!targetProvider) continue;
        const targetSeason = parseInt(targetProvider === "TVDB" ? mapping.tvdbseason : mapping.tmdbseason, 10);
        if (!Number.isFinite(targetSeason)) continue;

        const startEpisode = parseInt(mapping.start, 10);
        const endEpisode = parseInt(mapping.end, 10);
        const offset = parseInt(mapping.offset, 10);
        if (Number.isFinite(startEpisode) && Number.isFinite(offset)) {
            const range = { sourceSeason, startEpisode, targetProvider, targetSeason, offset };
            if (Number.isFinite(endEpisode)) range.endEpisode = endEpisode;
            ranges.push(range);
        }

        explicitMaps.push(...parseInlineMaps(mapping["#text"], sourceSeason, targetProvider, targetSeason));
    }
    return { ranges, explicitMaps };
}

function parseScudleeXml(xml) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        trimValues: true,
        parseAttributeValue: false,
        parseTagValue: false
    });
    const doc = parser.parse(xml);
    const entries = arrayOf(doc?.["anime-list"]?.anime);
    return entries.map(row => {
        const anidb = String(row.anidbid || "").trim();
        if (!anidb) return null;
        const tvdbRaw = String(row.tvdbid || "").trim();
        const tvdbNumeric = /^\d+$/.test(tvdbRaw) ? tvdbRaw : null;
        const expanded = row["mapping-list"] ? expandMappingList(row["mapping-list"]) : null;

        return {
            anidb,
            tvdb: tvdbNumeric,
            tmdbTv: stringId(row.tmdbtv),
            tmdbMovie: stringId(row.tmdbid),
            imdb: typeof row.imdbid === "string" && row.imdbid.trim() ? row.imdbid.trim() : null,
            tvdbSeason: normalizeSeason(row.defaulttvdbseason) || (["hentai", "unknown"].includes(tvdbRaw) ? tvdbRaw : null),
            tmdbSeason: normalizeSeason(row.tmdbseason),
            tvdbEpisodeOffset: Number.isFinite(parseInt(row.episodeoffset, 10)) ? parseInt(row.episodeoffset, 10) : null,
            tmdbEpisodeOffset: Number.isFinite(parseInt(row.tmdboffset, 10)) ? parseInt(row.tmdboffset, 10) : null,
            name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
            expanded
        };
    }).filter(Boolean);
}

function mediaTypeOf(sourceType) {
    if (!sourceType) return null;
    return sourceType.toUpperCase() === "MOVIE" ? "movie" : "series";
}

function buildIndexes(identity) {
    const byKitsu = {};
    const byMal = {};
    const byAnilist = {};
    const byAnidb = {};
    const byTvdb = {};
    const byTmdbTv = {};
    const byTmdbMovie = {};
    const byImdb = {};

    for (const [kitsu, record] of Object.entries(identity)) {
        byKitsu[kitsu] = kitsu;
        if (record.mal && !byMal[record.mal]) byMal[record.mal] = kitsu;
        if (record.anilist && !byAnilist[record.anilist]) byAnilist[record.anilist] = kitsu;
        if (record.anidb && !byAnidb[record.anidb]) byAnidb[record.anidb] = kitsu;
        if (record.tvdb) (byTvdb[record.tvdb] ||= []).push(kitsu);
        if (record.imdb) (byImdb[record.imdb] ||= []).push(kitsu);
        if (record.tmdb) {
            if (record.mediaType === "movie") {
                if (!byTmdbMovie[record.tmdb]) byTmdbMovie[record.tmdb] = kitsu;
            } else {
                (byTmdbTv[record.tmdb] ||= []).push(kitsu);
            }
        }
    }

    return { byKitsu, byMal, byAnilist, byAnidb, byTvdb, byTmdbTv, byTmdbMovie, byImdb };
}

function buildAnimeMap({ fribbJson, scudleeXml, generatedAt = new Date().toISOString() }) {
    const fribb = parseFribbJson(fribbJson);
    const scudleeByAnidb = new Map(parseScudleeXml(scudleeXml).map(entry => [entry.anidb, entry]));
    const identityRecordsByKitsu = {};
    const episodeMappingsByAnidb = {};

    for (const fragment of fribb) {
        if (!fragment.kitsu) continue;
        const scudlee = scudleeByAnidb.get(fragment.anidb);
        const mappingPresent = Boolean(scudlee?.expanded && (scudlee.expanded.ranges.length || scudlee.expanded.explicitMaps.length));
        const evidence = [`fribb.kitsu=${fragment.kitsu}`];
        if (fragment.tvdb) evidence.push(`fribb.tvdb=${fragment.tvdb}`);
        if (scudlee?.tvdb) evidence.push(`scudlee.tvdb=${scudlee.tvdb}`);
        if (scudlee?.tvdbSeason) evidence.push(`scudlee.defaulttvdbseason=${scudlee.tvdbSeason}`);
        if (scudlee?.tmdbSeason) evidence.push(`scudlee.tmdbseason=${scudlee.tmdbSeason}`);
        if (mappingPresent) evidence.push("scudlee.mapping-list");

        const record = {
            kitsu: fragment.kitsu,
            mediaType: mediaTypeOf(fragment.sourceType),
            hasMappingRules: mappingPresent,
            evidence
        };
        for (const [key, value] of Object.entries({
            mal: fragment.mal,
            anilist: fragment.anilist,
            anidb: fragment.anidb,
            tmdb: fragment.tmdb || scudlee?.tmdbTv || scudlee?.tmdbMovie,
            tvdb: fragment.tvdb || scudlee?.tvdb,
            imdb: fragment.imdb || scudlee?.imdb,
            sourceType: fragment.sourceType,
            tvdbSeason: scudlee?.tvdbSeason || fragment.tvdbSeasonHint,
            tmdbSeason: scudlee?.tmdbSeason || fragment.tmdbSeasonHint,
            tvdbEpisodeOffset: scudlee?.tvdbEpisodeOffset,
            tmdbEpisodeOffset: scudlee?.tmdbEpisodeOffset
        })) {
            if (value !== null && value !== undefined) record[key] = value;
        }
        identityRecordsByKitsu[fragment.kitsu] = record;
    }

    for (const [anidb, scudlee] of scudleeByAnidb.entries()) {
        if (!scudlee.expanded || (!scudlee.expanded.ranges.length && !scudlee.expanded.explicitMaps.length)) continue;
        const mapping = {
            anidb,
            ranges: scudlee.expanded.ranges,
            explicitMaps: scudlee.expanded.explicitMaps,
            evidence: ["scudlee.mapping-list"]
        };
        if (scudlee.name) mapping.name = scudlee.name;
        if (scudlee.tvdb) mapping.tvdbSeriesId = scudlee.tvdb;
        if (scudlee.tmdbTv) mapping.tmdbTvId = scudlee.tmdbTv;
        episodeMappingsByAnidb[anidb] = mapping;
    }

    return {
        schemaVersion: 2,
        mappingPolicyVersion: 1,
        generatedAt,
        counts: {
            identityRecords: Object.keys(identityRecordsByKitsu).length,
            episodeMappingRecords: Object.keys(episodeMappingsByAnidb).length,
            skippedCount: 0
        },
        identityRecordsByKitsu,
        episodeMappingsByAnidb,
        indexes: buildIndexes(identityRecordsByKitsu)
    };
}

function validateAnimeMap(asset) {
    if (!asset || asset.schemaVersion !== 2) throw new Error("anime map schemaVersion must be 2");
    const identityRecords = Object.keys(asset.identityRecordsByKitsu || {}).length;
    if (identityRecords === 0) throw new Error("anime map has zero identity records");
    return {
        identityRecords,
        episodeMappingRecords: Object.keys(asset.episodeMappingsByAnidb || {}).length
    };
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, filePath);
}

async function fetchSource(rawUrl, commitsUrl, timeoutMs) {
    const [raw, commit] = await Promise.all([
        axios.get(rawUrl, { timeout: timeoutMs, transformResponse: value => value }),
        axios.get(commitsUrl, { timeout: timeoutMs }).catch(() => null)
    ]);
    return {
        url: rawUrl,
        commit: commit?.data?.sha || null,
        text: raw.data
    };
}

async function fetchDefaultSources(options = {}) {
    const timeoutMs = options.timeoutMs || 30000;
    const [fribb, scudlee] = await Promise.all([
        fetchSource(options.fribbRawUrl || FRIBB_RAW_URL, options.fribbCommitsUrl || FRIBB_COMMITS_URL, timeoutMs),
        fetchSource(options.scudleeRawUrl || SCUDLEE_RAW_URL, options.scudleeCommitsUrl || SCUDLEE_COMMITS_URL, timeoutMs)
    ]);
    return { fribb, scudlee };
}

function defaultProvenancePath(mapPath = defaultAnimeMapPath()) {
    return path.join(path.dirname(mapPath), "nexio-anime-map-provenance.json");
}

async function refreshAnimeMap(options = {}) {
    const mapPath = options.mapPath || defaultAnimeMapPath();
    const provenancePath = options.provenancePath || process.env.ANIME_MAP_PROVENANCE_PATH || defaultProvenancePath(mapPath);
    const now = options.now || (() => new Date());

    try {
        const sources = await (options.fetchSources || fetchDefaultSources)(options);
        const generatedAt = now().toISOString();
        const asset = buildAnimeMap({
            fribbJson: sources.fribb.text,
            scudleeXml: sources.scudlee.text,
            generatedAt
        });
        const counts = validateAnimeMap(asset);
        const provenance = {
            generatedAt,
            sources: {
                fribb: { url: sources.fribb.url, commit: sources.fribb.commit || null, fetchedAt: generatedAt },
                scudlee: { url: sources.scudlee.url, commit: sources.scudlee.commit || null, fetchedAt: generatedAt }
            },
            overlay: { version: 1, entryCount: 0 },
            counts
        };
        writeJsonAtomic(mapPath, asset);
        writeJsonAtomic(provenancePath, provenance);
        return { refreshed: true, usedExisting: false, ...counts, mapPath, provenancePath };
    } catch (error) {
        if (fs.existsSync(mapPath)) {
            const counts = validateAnimeMap(JSON.parse(fs.readFileSync(mapPath, "utf8")));
            return { refreshed: false, usedExisting: true, error: error.message, ...counts, mapPath, provenancePath };
        }
        throw error;
    }
}

module.exports = {
    buildAnimeMap,
    fetchDefaultSources,
    refreshAnimeMap,
    validateAnimeMap,
    defaultProvenancePath,
    constants: {
        FRIBB_RAW_URL,
        FRIBB_COMMITS_URL,
        SCUDLEE_RAW_URL,
        SCUDLEE_COMMITS_URL
    }
};
