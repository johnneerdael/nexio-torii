//===============
// NEXIO TORII STREMIO ADDON - CORE LOGIC
// (Consistent UI + StremThru Cache + Strict Episode Enforcing + Dynamic Season & Episode Extraction)
// P2P Integration: Direct infoHash handover to Stremio including Tracker-Injection.
// Explicit Resolution Toggles & Fixed Movie Manifest.
//===============

const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const { searchAnime, getAnimeMeta, getTrendingAnime, getTopAnime, getAiringAnime, getSeasonalAnime, getJikanMeta, fetchEpisodeDetails, getCurrentSeasonInfo } = require("./lib/anilist");
const { searchNyaaForAnime } = require("./lib/nyaa");
const { encodeConfigPayload, fromBase64Safe, parseConfig, toBase64Safe } = require("./lib/config");
const { buildDebridStreams } = require("./lib/stream-builder");
const { extractEpisodeNumber, getBatchRange, isEpisodeMatch, selectBestVideoFile, isSeasonBatch, verifyTitleMatch } = require("./lib/parser");
const { getTorrentsForStream } = require("./lib/cache/stream-cache");
const { buildMediaKey } = require("./lib/cache/torrent-cache");
const { checkStoreTorzWithCache } = require("./lib/cache/debrid-cache");
const { filterByCanonical } = require("./lib/normalizer/match");

let BASE_URL = process.env.BASE_URL || "http://127.0.0.1:7002";
BASE_URL = BASE_URL.replace(/\/+$/, "");

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || null;

//===============
// GLOBAL CONCURRENCY LIMITER (Anti-Self-DDoS)
// Limits the amount of concurrent outgoing requests to external trackers.
// This prevents IP bans from services like Nyaa when Stremio fires multiple
// search requests simultaneously.
//===============
const MAX_CONCURRENT_SCRAPES = 5;
let activeScrapes = 0;
const scrapeQueue = [];

async function enqueueScrape(queryFn) {
    return new Promise((resolve, reject) => {
        const task = async () => {
            activeScrapes++;
            try {
                const result = await queryFn();
                resolve(result);
            } catch (e) {
                reject(e);
            } finally {
                activeScrapes--;
                if (scrapeQueue.length > 0) {
                    const nextTask = scrapeQueue.shift();
                    nextTask();
                }
            }
        };

        if (activeScrapes < MAX_CONCURRENT_SCRAPES) {
            task();
        } else {
            scrapeQueue.push(task);
        }
    });
}

//===============
// TITLE PREFERENCE APPLIER
// Swaps the default Romaji titles with English ones if the user has 
// configured "useEnglishTitles" in their addon settings.
//===============
function applyTitlePreference(metas, userConfig) {
    if (!userConfig.useEnglishTitles || !metas) return metas;
    return metas.map(m => ({ ...m, name: m.englishName || m.name }));
}

//===============
// SIZE PARSER
// Converts human-readable file sizes (e.g., "1.5 GB") into raw bytes
// to allow mathematically accurate sorting of streams later on.
//===============
function parseSizeToBytes(sizeStr) {
    if (!sizeStr || typeof sizeStr !== "string") return 0;
    const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB|GiB|MiB|KiB|B)/i);
    if (!match) return 0;
    const val = parseFloat(match[1]); 
    const unit = match[2].toUpperCase();
    if (unit.includes("G")) return val * 1024 * 1024 * 1024;
    if (unit.includes("M")) return val * 1024 * 1024;
    return val * 1024;
}

//===============
// RESOLUTION TAG EXTRACTOR
// Scans the torrent title for common resolution indicators and standardizes
// them into predefined tags for filtering and UI presentation.
//===============
function extractTags(title) {
    let res = "SD";
    if (/(4320p|8k|FUHD)/i.test(title)) res = "8K";
    else if (/(2160p|4k|UHD)/i.test(title)) res = "4K";
    else if (/(1440p|2k|QHD)/i.test(title)) res = "2K";
    else if (/(1080p|1080|FHD)/i.test(title)) res = "1080p";
    else if (/(720p|720|HD)/i.test(title)) res = "720p";
    else if (/(480p|480)/i.test(title)) res = "480p";
    return { res };
}

//===============
// LANGUAGE MATRIX
// Contains robust Regular Expressions to detect audio and subtitle 
// languages from standard anime fan-sub naming conventions.
//===============
const LANG_REGEX = {
    "GER": /\b(ger|deu|german|deutsch|de-de)\b|(?:^|[\[\(\-_ ])(de)(?:[\]\)\-_ ]|$)/i,
    "FRE": /\b(fre|fra|french|vostfr|vf|fr-fr)\b|(?:^|[\[\(\-_ ])(fr)(?:[\]\)\-_ ]|$)/i,
    "ITA": /\b(ita|italian|it-it)\b|(?:^|[\[\(\-_ ])(it)(?:[\]\)\-_ ]|$)/i,
    "SPA": /\b(spa|esp|spanish|es-es|castellano)\b|(?:^|[\[\(\-_ ])(es)(?:[\]\)\-_ ]|$)/i,
    "LAT": /\b(lat|latino|es-mx|es-419)\b|(?:^|[\[\(\-_ ])(lat)(?:[\]\)\-_ ]|$)/i,
    "RUS": /\b(rus|russian|ru-ru)\b|(?:^|[\[\(\-_ ])(ru)(?:[\]\)\-_ ]|$)/i,
    "POR": /\b(por|pt-br|portuguese|pt-pt)\b|(?:^|[\[\(\-_ ])(pt)(?:[\]\)\-_ ]|$)/i,
    "ARA": /\b(ara|arabic|ar-sa)\b|(?:^|[\[\(\-_ ])(ar)(?:[\]\)\-_ ]|$)/i,
    "CHI": /\b(chi|chinese|chs|cht|mandarin|zh-cn|zh-tw)\b|(?:^|[\[\(\-_ ])(zh)(?:[\]\)\-_ ]|$)|(简|繁|中文字幕)/i,
    "KOR": /\b(kor|korean|ko-kr)\b|(?:^|[\[\(\-_ ])(ko)(?:[\]\)\-_ ]|$)/i,
    "HIN": /\b(hin|hindi|hi-in)\b|(?:^|[\[\(\-_ ])(hi)(?:[\]\)\-_ ]|$)/i,
    "POL": /\b(pol|polish|pl-pl)\b|(?:^|[\[\(\-_ ])(pl)(?:[\]\)\-_ ]|$)/i,
    "NLD": /\b(nld|dut|dutch|nl-nl)\b|(?:^|[\[\(\-_ ])(nl)(?:[\]\)\-_ ]|$)/i,
    "TUR": /\b(tur|turkish|tr-tr)\b|(?:^|[\[\(\-_ ])(tr)(?:[\]\)\-_ ]|$)/i,
    "VIE": /\b(vie|vietnamese|vi-vn)\b|(?:^|[\[\(\-_ ])(vi)(?:[\]\)\-_ ]|$)/i,
    "IND": /\b(ind|indonesian|id-id)\b|(?:^|[\[\(\-_ ])(id)(?:[\]\)\-_ ]|$)/i,
    "ENG": /\b(eng|english|dubbed|subbed|en-us|en-gb)\b|(?:^|[\[\(\-_ ])(en)(?:[\]\)\-_ ]|$)/i,
    "JPN": /\b(jpn|japanese|raw|jp-jp)\b|(?:^|[\[\(\-_ ])(jp)(?:[\]\)\-_ ]|$)/i,
    "MULTI": /(multi|dual|multi-audio|multi-sub)/i
};

//===============
// LANGUAGE EXTRACTOR
// Checks the title against the user's preferred languages first,
// falling back to multi-audio, English, or Japanese raw status.
//===============
function extractLanguage(title, userLangs = []) {
    const lower = title.toLowerCase();
    for (let lang of userLangs) {
        if (LANG_REGEX[lang] && LANG_REGEX[lang].test(lower)) return lang;
    }
    if (LANG_REGEX["MULTI"].test(lower)) return "MULTI";
    if (LANG_REGEX["ENG"].test(lower)) return "ENG";
    if (LANG_REGEX["JPN"].test(lower)) return "JPN";
    return "ENG"; 
}

//===============
// SEARCH QUERY SANITIZER
// Removes special characters, brackets, and excessive whitespace from
// raw titles to formulate a clean query string for external trackers.
//===============
function sanitizeSearchQuery(title) { 
    if (!title) return "";
    return title.replace(/\(.*?\)/g, "")
                .replace(/\[.*?\]/g, "")
                .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\[\]"'<>?+|\\・、。「」『』【】［］（）〈〉≪≫《》〔〕…—～〜♥♡★☆♪]/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim(); 
}

//===============
// STREMIO ADDON MANIFEST
// Defines the capabilities, catalogs, and ID prefixes the addon supports.
//===============
const manifest = {
    "id": "org.community.nexiotorii", "version": "9.6.1", "name": "Nexio Torii", "logo": BASE_URL + "/favicon.png",
    "description": "Anime streams from Nyaa through StremThru-backed premium unlockers and optional P2P.",
    "stremioAddonsConfig": {
        "issuer": "https://stremio-addons.net",
        "signature": "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..V414tKUupDmAK_As1LDd7A.1CKaSXDyaR_i0nVYBh-EYL9J_nuHCwiPCKoR_ALYEN7nqd0SLP3HLkuSKVqsBNYBqjzqfGYpRpAmlCntou1u6G2u1tPD3jVv6EMmGFqEG-HZVbdvjsP-OGt57e8Ar8Qm.X3iPFlRXb8scSMprT-fFrg"
    },
    "types": ["anime", "movie", "series"],
    "resources": [
        "catalog",
        {
            "name": "meta",
            "types": ["anime", "movie", "series"],
            "idPrefixes": ["anilist:", "nexio_raw:"]
        },
        {
            "name": "stream",
            "types": ["anime", "movie", "series"],
            "idPrefixes": ["anilist:", "nyaa:", "kitsu:", "tt", "nexio_raw:"]
        }
    ],
    "catalogs": [
        { "id": "nexio_seasonal_series", "type": "anime", "name": "Nexio Torii Current Season" },
        { "id": "nexio_airing_series", "type": "anime", "name": "Nexio Torii Currently Airing" },
        { "id": "nexio_trending_series", "type": "anime", "name": "Nexio Torii Trending Series" },
        { "id": "nexio_top_series", "type": "anime", "name": "Nexio Torii Top Rated Series" },
        { "id": "nexio_trending_movie", "type": "movie", "name": "Nexio Torii Trending Movies" },
        { "id": "nexio_top_movie", "type": "movie", "name": "Nexio Torii Top Rated Movies" },
        { "id": "nexio_search", "type": "anime", "name": "Nexio Torii Search", "extra": [{ "name": "search", "isRequired": true }] },
        { "id": "nexio_search", "type": "movie", "name": "Nexio Torii Search", "extra": [{ "name": "search", "isRequired": true }] },
        { "id": "nexio_search", "type": "series", "name": "Nexio Torii Series", "extra": [{ "name": "search", "isRequired": true }] }
    ],
    "config": [{ "key": "NexioTorii", "type": "text", "title": "Nexio Torii Internal Payload" }],
    "behaviorHints": { "configurable": true, "configurationRequired": true }
};

const builder = new addonBuilder(manifest);

//===============
// CATALOG HANDLER
// Processes requests for the Stremio discover board (Trending, Top, Airing).
// Also manages the search functionality, querying multiple sources and generating
// a fallback "RAW SEARCH" card if standard metadata APIs fail to find a match.
//===============
builder.defineCatalogHandler(async ({ type, id, extra, config }) => {
    try {
        const userConfig = parseConfig(config);

        if (id === "nexio_seasonal_series" && userConfig.showSeasonalSeries !== false) {
            const results = await getSeasonalAnime("anime");
            return { "metas": applyTitlePreference(results.filter(m => m.type === type), userConfig), "cacheMaxAge": 14400 };
        }
        if (id === "nexio_airing_series" && userConfig.showAiringSeries !== false) {
            const results = await getAiringAnime("anime");
            return { "metas": applyTitlePreference(results.filter(m => m.type === type), userConfig), "cacheMaxAge": 14400 };
        }
        if (id === "nexio_trending_series" && userConfig.showTrendingSeries !== false) {
            const results = await getTrendingAnime("anime");
            return { "metas": applyTitlePreference(results.filter(m => m.type === type), userConfig), "cacheMaxAge": 21600 };
        }
        if (id === "nexio_top_series" && userConfig.showTopSeries !== false) {
            const results = await getTopAnime("anime");
            return { "metas": applyTitlePreference(results.filter(m => m.type === type), userConfig), "cacheMaxAge": 86400 };
        }
        if (id === "nexio_trending_movie" && userConfig.showTrendingMovies !== false) {
            const results = await getTrendingAnime("movie");
            return { "metas": applyTitlePreference(results.filter(m => m.type === type), userConfig), "cacheMaxAge": 21600 };
        }
        if (id === "nexio_top_movie" && userConfig.showTopMovies !== false) {
            const results = await getTopAnime("movie");
            return { "metas": applyTitlePreference(results.filter(m => m.type === type), userConfig), "cacheMaxAge": 86400 };
        }

        if (id === "nexio_search" && extra.search) {
            const nyaaPromise = searchNyaaForAnime(extra.search).catch(() => []);
            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve([]), 3500));

            const [anilistRes, cinemetaRes, nyaaRes] = await Promise.all([
                searchAnime(extra.search).catch(() => []),
                axios.get(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(extra.search)}.json`, { timeout: 4000 }).then(res => res.data.metas || []).catch(() => []),
                Promise.race([nyaaPromise, timeoutPromise])
            ]);

            const results = [];
            const seenIds = new Set();

            const mappedAnilist = applyTitlePreference(anilistRes.filter(m => m.type === type), userConfig);
            mappedAnilist.forEach(m => {
                results.push(m);
                seenIds.add(m.id);
            });

            cinemetaRes.forEach(m => {
                if (!seenIds.has(m.id)) {
                    results.push(m);
                    seenIds.add(m.id);
                }
            });

            // Fallback generation for obscure searches
            if (results.length < 2 && nyaaRes.length > 0) {
                results.push({
                    "id": `nexio_raw:${type}:${toBase64Safe(extra.search)}`,
                    "type": type,
                    "name": extra.search + " (RAW SEARCH)",
                    "poster": `https://dummyimage.com/600x900/1a1a1a/42a5f5.png?text=${encodeURIComponent(extra.search)}\nRaw+Search`,
                    "background": `https://dummyimage.com/1920x1080/1a1a1a/42a5f5.png?text=${encodeURIComponent(extra.search)}`,
                    "description": `Found ${nyaaRes.length} raw torrents. Use this if no official metadata matches.`
                });
            }

            return { "metas": results, "cacheMaxAge": 86400 };
        }
        
        return { "metas": [] };
    } catch (e) { return { "metas": [] }; }
});

//===============
// META HANDLER
// Provides the detailed view for a single item (description, episodes, poster).
// Capable of dynamically generating fake metadata for "RAW SEARCH" items so
// the user can still select an episode and trigger the stream handler.
//===============
builder.defineMetaHandler(async ({ type, id, config }) => {
    try {
        const userConfig = parseConfig(config);

        if (id.startsWith("nexio_raw:")) {
            const parts = id.split(":");
            const mType = parts[1];
            const query = fromBase64Safe(parts[2]);
            const rawMeta = {
                "id": id, "type": mType, "name": query + " (Raw Search)",
                "poster": `https://dummyimage.com/600x900/1a1a1a/42a5f5.png?text=${encodeURIComponent(query)}\nRaw+Search`,
                "background": `https://dummyimage.com/1920x1080/1a1a1a/42a5f5.png?text=${encodeURIComponent(query)}`,
                "description": `Dynamically generated metadata for "${query}".`,
            };
            if (mType === "series" || mType === "anime") {
                rawMeta.videos = [];
                for (let s = 1; s <= 10; s++) {
                    for (let e = 1; e <= 100; e++) {
                        rawMeta.videos.push({
                            "id": `${id}-${e}`,
                            "title": `Episode ${e}`,
                            "season": s,
                            "episode": e
                        });
                    }
                }
            } else if (mType === "movie") {
                rawMeta.videos = [{
                    "id": id,
                    "title": query || "Movie",
                    "released": new Date().toISOString()
                }];
                rawMeta.behaviorHints = { "defaultVideoId": id };
            }
            return { "meta": rawMeta, "cacheMaxAge": 86400 };
        }

        if (!id.startsWith("anilist:")) return { "meta": null };
        const aniListId = id.split(":")[1];
        if (!aniListId || isNaN(aniListId)) return { "meta": null };
        
        const rawMeta = await getAnimeMeta(aniListId);
        if (!rawMeta) return { "meta": null };
        
        const meta = { ...rawMeta };
        
        if (userConfig.useEnglishTitles && meta.englishName) {
            meta.name = meta.englishName;
        }
        
        meta.id = id;

        if (meta.type === "anime" || meta.type === "series") {
            meta.type = "anime";
            const jikanEps = meta.idMal ? await fetchEpisodeDetails(meta.idMal).catch(() => ({})) : {};
            const epMeta = meta.epMeta || {};
            const defaultThumb = meta.background || meta.poster || "https://dummyimage.com/600x337/1a1a1a/42a5f5.png?text=NEXIO+TORII+EPISODE";
            meta.videos = Array.from({ "length": meta.episodes || 12 }, (_, i) => {
                const epNum = i + 1;
                const jData = jikanEps[epNum] || {};
                const epData = epMeta[epNum] || {};
                return { "id": `${id}-${epNum}`, "title": jData.title || epData.title || `Episode ${epNum}`, "season": 1, "episode": epNum, "thumbnail": epData.thumbnail || defaultThumb };
            });
        } else if (meta.type === "movie") {
            meta.videos = [{
                "id": id,
                "title": meta.name || "Movie",
                "released": meta.released || new Date().toISOString(),
                "thumbnail": meta.poster
            }];
            meta.behaviorHints = { "defaultVideoId": id };
        }
        
        return { "meta": meta, "cacheMaxAge": 604800 };
    } catch (e) { return { "meta": null }; }
});

//===============
// STREAM HANDLER (CORE ENGINE)
// Responsible for calculating search strings, querying trackers,
// filtering out wrong seasons/episodes, cross-checking cache status with Debrid,
// and formatting the final JSON returned to Stremio.
//===============
builder.defineStreamHandler(async ({ type, id, config }) => {
    try {
        console.log(`\n[NEXIO TORII FORENSICS] ===== NEUE SUCHE =====`);
        console.log(`[NEXIO TORII FORENSICS] ID: ${id} | Type: ${type}`);

        if (!id.startsWith("anilist:") && !id.startsWith("nyaa:") && !id.startsWith("kitsu:") && !id.startsWith("tt") && !id.startsWith("nexio_raw:")) return { "streams": [] };

        const userConfig = parseConfig(config);
        
        //===============
        // VALIDATION: Check if a valid playback method is available
        //===============
        if (userConfig.debridServices.length === 0 && !userConfig.enableP2P) {
            console.log("[PIPELINE] Stop: no debrid services configured and P2P disabled.");
            return { "streams": [] };
        }

        let aniListId = null;
        let requestedEp = 1;
        let expectedSeason = 1;
        let searchTitleFallback = null;
        let isRawSearch = false;

        const parts = id.split(":");

        // ID Unpacking to discover the requested episode and expected season.
        if (id.startsWith("kitsu:")) {
            try {
                const kitsuId = parts[1];
                const kRes = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, { timeout: 4000 });
                searchTitleFallback = kRes.data?.data?.attributes?.canonicalTitle || kRes.data?.data?.attributes?.titles?.en_jp;
                requestedEp = parseInt(parts[2], 10) || 1;
                console.log(`[NEXIO TORII FORENSICS] Kitsu Match erfolgreich: ${searchTitleFallback}`);
            } catch (e) { }
        } else if (id.startsWith("nexio_raw:")) {
            const mType = parts[1];
            let rawPayload = parts[2];
            if (rawPayload && rawPayload.includes("-")) {
                let subParts = rawPayload.split("-");
                searchTitleFallback = fromBase64Safe(subParts[0]);
                requestedEp = parseInt(subParts[1], 10) || 1;
            } else {
                searchTitleFallback = fromBase64Safe(rawPayload);
                requestedEp = 1;
            }
            expectedSeason = 1;
            isRawSearch = true;
        } else if (id.startsWith("anilist:")) {
            let payload = parts[1];
            if (payload.includes("-")) {
                let subParts = payload.split("-");
                aniListId = subParts[0];
                requestedEp = parseInt(subParts[1], 10) || 1;
            } else {
                aniListId = payload;
                requestedEp = parts.length > 2 ? parseInt(parts[parts.length - 1], 10) : 1;
            }
        } else if (id.startsWith("tt")) {
            if (parts.length > 2) {
                expectedSeason = parseInt(parts[1], 10) || 1;
                requestedEp = parseInt(parts[2], 10) || 1;
            } else { requestedEp = 1; }
        }

        const metaTasks = [];
        if (id.startsWith("tt")) {
            metaTasks.push((async () => {
                const imdbId = parts[0];
                let name = "";
                try {
                    let res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, { timeout: 4000 });
                    name = res.data?.meta?.name;
                } catch(e) {}
                if (!name) {
                    const otherType = type === "movie" ? "series" : "movie";
                    try {
                        let res2 = await axios.get(`https://v3-cinemeta.strem.io/meta/${otherType}/${imdbId}.json`, { timeout: 4000 });
                        name = res2.data?.meta?.name;
                    } catch(e) {}
                }
                return { source: "cinemeta", name: name || "" };
            })());
        }
        if (aniListId) {
            metaTasks.push(getAnimeMeta(aniListId).then(meta => ({ "source": "anilist", "meta": meta })).catch(() => null));
        }

        const metaResults = await Promise.all(metaTasks);
        let freshMeta = null;
        metaResults.forEach(r => {
            if (!r) return;
            if (r.source === "cinemeta") searchTitleFallback = r.name;
            if (r.source === "anilist") freshMeta = r.meta;
        });

        // Intercepting requests coming from Cinemeta (like IMDB tt tags) and translating them to Anilist
        if (id.startsWith("tt") && searchTitleFallback) {
             try {
                const searchResults = await searchAnime(searchTitleFallback);
                if (searchResults && searchResults.length > 0) {
                    const matchedId = searchResults[0].id.split(":")[1];
                    const extraMeta = await getAnimeMeta(matchedId);
                    if (extraMeta) {
                        const anilistName = extraMeta.name.toLowerCase();
                        const cinemetaName = searchTitleFallback.toLowerCase();
                        if (anilistName.includes(cinemetaName) || cinemetaName.includes(anilistName)) {
                            freshMeta = extraMeta;
                        }
                    }
                }
            } catch (e) {}
        } else if (!freshMeta && searchTitleFallback && !isRawSearch) {
             try {
                const searchResults = await searchAnime(searchTitleFallback);
                if (searchResults && searchResults.length > 0) {
                    const matchedId = searchResults[0].id.split(":")[1];
                    freshMeta = await getAnimeMeta(matchedId);
                }
            } catch (e) {}
        }

        if (!freshMeta && !searchTitleFallback) {
            console.log(`[NEXIO TORII FORENSICS] Abbruch: Keine Metadaten oder Fallback-Titel gefunden.`);
            return { "streams": [] };
        }

        // Contextual season extraction from standard title conventions.
        const extractSeason = (t) => {
            const nthMatch = t.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:Season|Part|Cour)\b/i);
            if (nthMatch) return parseInt(nthMatch[1], 10);
            const m = t.match(/\b(?:S|Season|Part|Cour|Dai|Di)\s*0*(\d+)\b/i);
            if (m) return parseInt(m[1], 10);
            const wordMatch = t.match(/\b(second|third|fourth|fifth|sixth|ii|iii|iv|v|vi)\s+(season|part|cour)\b/i);
            if (wordMatch) {
                const val = wordMatch[1].toLowerCase();
                if (val === "second" || val === "ii") return 2;
                if (val === "third" || val === "iii") return 3;
                if (val === "fourth" || val === "iv") return 4;
                if (val === "fifth" || val === "v") return 5;
                if (val === "sixth" || val === "vi") return 6;
            }
            return null;
        };

        if (!id.startsWith("tt") && !isRawSearch) {
            let detected = null;
            const sources = [searchTitleFallback, freshMeta ? freshMeta.name : "", freshMeta ? freshMeta.altName : ""];
            for (let s of sources) {
                if (s) {
                    let d = extractSeason(s);
                    if (d && d > 1) {
                        detected = d;
                        break;
                    }
                }
            }
            if (detected) expectedSeason = detected;
        }

        const isMovie = type === "movie" || (freshMeta && freshMeta.format === "MOVIE");

        const titleList = [];
        if (searchTitleFallback) titleList.push(sanitizeSearchQuery(searchTitleFallback));
        if (freshMeta) {
            if (freshMeta.name) titleList.push(sanitizeSearchQuery(freshMeta.name));
            if (freshMeta.altName) titleList.push(sanitizeSearchQuery(freshMeta.altName));
        }

        const uniqueTitles = [...new Set(titleList.filter(Boolean))];
        const searchQueries = new Set();
        
        const baseTitles = new Set();
        uniqueTitles.forEach(t => {
            const stripped = t.replace(/\b(?:\d+(?:st|nd|rd|th)\s+(?:Season|Part|Cour)|Season\s*\d+|S\d+|Part\s*\d+|Cour\s*\d+|Episode\s*\d+|Ep\s*\d+)\b/ig, "")
                              .replace(/第\s*\d+\s*(?:季|期|기|話|话|集)/g, "")
                              .replace(/\s{2,}/g, " ").trim();
            if (stripped.length > 4) baseTitles.add(stripped);
        });
        const validSearchTitles = Array.from(baseTitles);

        const primaryTitleToSplit = searchTitleFallback || (freshMeta ? freshMeta.name : null);
        if (primaryTitleToSplit) {
             const words = sanitizeSearchQuery(primaryTitleToSplit).split(/\s+/);
             const w2 = words.slice(0, 2).join(" ");
             const w3 = words.slice(0, 3).join(" ");
             const w4 = words.slice(0, 4).join(" ");
             if (words.length >= 2 && w2.length > 5) searchQueries.add(w2);
             if (words.length >= 3 && w3.length > 5) searchQueries.add(w3);
             if (words.length >= 4 && w4.length > 5) searchQueries.add(w4);
        }
        
        validSearchTitles.forEach(t => searchQueries.add(t));
        const sortedQueries = Array.from(searchQueries).sort((a, b) => b.length - a.length);

        //===============
        // CASCADE SEARCH & FAST FAIL LOGIC
        // If an ISP block or Tracker block is detected (taking > 11s), the loop 
        // aborts immediately to avoid triggering Stremio's hard 15-second timeout, 
        // ensuring any results gathered up to that point are delivered.
        //===============
        const fetchAllPossibleTorrents = async () => {
            const epStr = requestedEp < 10 ? `0${requestedEp}` : `${requestedEp}`;
            const sStr = expectedSeason < 10 ? `0${expectedSeason}` : `${expectedSeason}`;
            const deduplicated = new Map();
            let isTrackerBlocked = false; 
            
            const runTask = async (queryFn) => {
                const startTime = Date.now();
                try {
                    const res = await queryFn();
                    if (res && res.length > 0) {
                        res.forEach(t => deduplicated.set(t.hash.toLowerCase(), t));
                    }
                } catch (e) {}
                
                const duration = Date.now() - startTime;
                
                // Fast-Fail Detection
                if (duration > 11000 && deduplicated.size === 0) {
                    isTrackerBlocked = true;
                    console.log(`[NEXIO TORII FAST FAIL] Tracker-Block detektiert. Dauer: ${duration}ms. Breche Kaskade ab.`);
                }
            };

            let isFirstTitle = true;
            for (const title of sortedQueries) {
                // Respecting the isTrackerBlocked flag
                if (deduplicated.size >= 30 || isTrackerBlocked) break;

                if (isMovie) {
                    await runTask(() => enqueueScrape(() => searchNyaaForAnime(`${title}`)));
                } else {
                    await runTask(() => enqueueScrape(() => searchNyaaForAnime(`${title} ${epStr}`)));
                    if (isTrackerBlocked) break; 
                    
                    if (deduplicated.size < 10) {
                        await runTask(() => enqueueScrape(() => searchNyaaForAnime(`${title} S${sStr}E${epStr}`)));
                    }
                    if (isTrackerBlocked) break;
                    
                    if (isFirstTitle) {
                        await runTask(() => enqueueScrape(() => searchNyaaForAnime(`${title} Batch`)));
                        if (isTrackerBlocked) break;
                        
                        if (expectedSeason > 1) {
                            await runTask(() => enqueueScrape(() => searchNyaaForAnime(`${title} S${sStr}`)));
                        }
                    }
                    if (isTrackerBlocked) break;
                    
                    if (deduplicated.size === 0) {
                        await runTask(() => enqueueScrape(() => searchNyaaForAnime(`${title}`)));
                    }
                }
                isFirstTitle = false;
            }
            return { torrentsArr: Array.from(deduplicated.values()) };
        };

        const mediaKey = buildMediaKey({
            type,
            id,
            expectedSeason,
            requestedEp,
            isMovie,
            isRawSearch
        });

        const torrentResult = await getTorrentsForStream({
            mediaKey,
            scrape: fetchAllPossibleTorrents
        });
        let torrents = torrentResult.torrents;

        if (torrentResult.source === "wait" && !torrents.length) {
            return {
                streams: [
                    {
                        name: "TORII [INFO]\nCache warming",
                        description: "First scrape is already running. Try this episode again in a few seconds.",
                        url: BASE_URL + "/waiting.mp4"
                    }
                ],
                cacheMaxAge: 15
            };
        }
        
        //===============
        // CANONICAL-GATE FILTER (multi-axis hard gates ported from nexio-nagare).
        // Applies BEFORE the existing resolution/title-substring filters to drop
        // wrong-show / wrong-year / recap-movie / catastrophic-drift candidates
        // that the legacy substring-based verifyTitleMatch wouldn't catch.
        //
        // Gates (any failure → drop):
        //   - format mismatch:   TV canonical vs MOVIE/RECAP torrent
        //   - year mismatch:     diff ≥ 5 (catches FMA 2003 vs Brotherhood 2009)
        //   - title distance:    normalised Levenshtein > 0.4
        //   - recap_tag:         RECAP hint when canonical is TV
        //   - short_release:     Movie/Recap/Special hint when TV canonical has ≥5 episodes
        //
        // Skipped on raw searches (user explicitly bypassed metadata) and when
        // freshMeta is unavailable (no canonical to gate against).
        //===============
        let canonGateDropCount = 0;
        if (!isRawSearch && freshMeta && torrents.length > 0) {
            const canonical = {
                format: freshMeta.format || (isMovie ? "MOVIE" : null),
                year: Number.isFinite(freshMeta.year) ? freshMeta.year : null,
                episodeCount: Number.isFinite(freshMeta.episodes) ? freshMeta.episodes : null,
                mainTitle: freshMeta.name || null,
                englishTitle: freshMeta.englishName || null,
                altName: freshMeta.altName || null,
                synonyms: Array.isArray(freshMeta.synonyms) ? freshMeta.synonyms : []
            };
            const { kept, dropped } = await filterByCanonical({
                canonical,
                torrents,
                opts: { preferDub: false, requestedEpisode: requestedEp, expectedSeason }
            });
            canonGateDropCount = dropped.length;
            if (process.env.DEBUG_MATCH === "1" && dropped.length > 0) {
                for (const d of dropped.slice(0, 8)) {
                    console.log(`[canon-gate] drop "${d.torrent.title}" → ${d.gateFailures.join(" | ")}`);
                }
            }
            torrents = kept;
            if (!torrents.length) return { "streams": [], "cacheMaxAge": 60 };
        }

        //===============
        // EXPLICIT RESOLUTION & CLEANUP FILTER
        // Discards OSTs, manga, irrelevant filetypes, and non-matching resolutions.
        // Also drops oversized batches that likely represent multi-season bundles.
        //===============
        let filterDropCount = 0;
        
        const allowedResolutions = Array.isArray(userConfig.resolutions) && userConfig.resolutions.length > 0 
            ? userConfig.resolutions 
            : ["8K", "4K", "2K", "1080p", "720p", "480p", "SD"];

        torrents = torrents.filter(t => {
            if (!isRawSearch && /\b(?:Soundtrack|OST|MP3|CD|Manga|Light Novel|LN|Artbook|Doujinshi|同人誌|同人CG集|Pictures|Images|Novel|Cosplay)\b/i.test(t.title)) {
                filterDropCount++; return false;
            }
            
            const { res } = extractTags(t.title);
            if (!allowedResolutions.includes(res)) {
                filterDropCount++; return false;
            }

            if (isRawSearch) return true;
            
            const isValid = verifyTitleMatch(t.title, validSearchTitles);
            if (!isValid) { filterDropCount++; return false; }

            const bytes = parseSizeToBytes(t.size);
            const isBatch = isSeasonBatch(t.title, expectedSeason);
            
            if (!isMovie && !isBatch && bytes > 20.0 * 1024 * 1024 * 1024) {
                filterDropCount++; return false;
            }

            return true;
        });

        if (!torrents.length) return { "streams": [], "cacheMaxAge": 60 };

        const hashes = torrents.map(t => t.hash.toLowerCase());
        const availabilityByEntry = await Promise.all(
            userConfig.debridServices.map(entry =>
                checkStoreTorzWithCache(hashes, entry, {
                    scope: { season: expectedSeason, episode: requestedEp }
                }).catch(error => {
                    console.error(`[PIPELINE] ${entry.service} availability failed: ${error.message}`);
                    return {};
                })
            )
        );
        const nexioPayload = encodeConfigPayload(userConfig);

        const flags = { "GER": "🇩🇪", "ITA": "🇮🇹", "FRE": "🇫🇷", "SPA": "🇪🇸", "LAT": "💃🏻", "RUS": "🇷🇺", "POR": "🇵🇹", "ARA": "🇸🇦", "CHI": "🇨🇳", "KOR": "🇰🇷", "HIN": "🇮🇳", "POL": "🇵🇱", "NLD": "🇳🇱", "TUR": "🇹🇷", "VIE": "🇻🇳", "IND": "🇮🇩", "JPN": "🇯🇵", "ENG": "🇬🇧", "MULTI": "🌍" };
        const userLangs = Array.isArray(userConfig.language) ? userConfig.language : [userConfig.language || "ENG"];

        const streams = [];
        let epDropCount = 0;

        // Iterates through valid torrents to format final stream objects
        torrents.forEach(t => {
            const { res } = extractTags(t.title);
            const bytes = parseSizeToBytes(t.size);
            const streamLang = extractLanguage(t.title, userLangs);
            const flag = flags[streamLang] || "🇬🇧";
            const seeders = parseInt(t.seeders, 10) || 0;
            
            let isValidMatch = false;
            let isBatch = false;

            if (isMovie || isRawSearch) {
                isValidMatch = true;
            } else {
                 isBatch = isSeasonBatch(t.title, expectedSeason);
                 isValidMatch = isBatch || isEpisodeMatch(t.title, requestedEp, expectedSeason);
            }

            if (!isValidMatch) {
                epDropCount++;
                return; 
            }

            const batchStr = isBatch ? " | 📦 Batch" : "";

            //===============
            // P2P STREAM GENERATION
            // Attaches active trackers enabling direct torrent streaming via Stremio.
            //===============
            if (userConfig.enableP2P) {
                const p2pName = `TORII [📡 P2P]\n🎥 ${res}`;
                const p2pDesc = `${flag} Nyaa | 📡 P2P${batchStr}\n📄 ${t.title}\n💾 ${t.size} | 👥 ${seeders} Seeds`;
                
                streams.push({
                    "name": p2pName,
                    "description": p2pDesc,
                    "infoHash": t.hash, 
                    "sources": [
                        "tracker:http://nyaa.tracker.wf:7777/announce",
                        "tracker:udp://open.stealth.si:80/announce",
                        "tracker:udp://tracker.opentrackr.org:1337/announce",
                        "tracker:udp://exodus.desync.com:6969/announce",
                        "dht:" + t.hash
                    ],
                    "behaviorHints": { "bingeGroup": "nexio_torii_p2p_" + t.hash },
                    "_bytes": bytes, "_lang": streamLang, "_isCached": false, "_res": res, "_prog": 0, "_seeders": seeders, "_isBatch": isBatch
                });
            }

        });

        const debridStreams = buildDebridStreams({
            torrents,
            availabilityByEntry,
            userConfig,
            nexioPayload,
            baseUrl: BASE_URL,
            requestedEp,
            expectedSeason,
            isMovie,
            isRawSearch,
            flags,
            extractTags,
            extractLanguage,
            parseSizeToBytes,
            selectBestVideoFile,
            isEpisodeMatch,
            isSeasonBatch
        });
        streams.push(...debridStreams);

        console.log(`[NEXIO TORII FORENSICS] Canon-Gate ${canonGateDropCount}, Resolution-Filter ${filterDropCount}, Episoden-Filter ${epDropCount} nicht-passende Einträge gelöscht.`);
        console.log(`[NEXIO TORII FORENSICS] Finale Streams an Stremio gesendet: ${streams.length}\n`);

        //===============
        // 3-PHASE SORTER (SCORING)
        // Re-orders the final stream list logically based on:
        // Language Priority -> Resolution Preference -> Batch Quality -> Seeders/Size
        //===============
        return { 
            "streams": streams.sort((a, b) => {
                if (a._prog > 0 && b._prog === 0) return -1;
                if (b._prog > 0 && a._prog === 0) return 1;
                if (a._isCached !== b._isCached) return b._isCached ? 1 : -1;

                const getLangScore = (l) => {
                    if (userLangs.includes(l)) return 200 - userLangs.indexOf(l);
                    if (l === "MULTI") return 150;
                    return 0;
                };
                const langScoreA = getLangScore(a._lang);
                const langScoreB = getLangScore(b._lang);
                if (langScoreA !== langScoreB) return langScoreB - langScoreA;

                const resMap = { "8K": 8, "4K": 4, "2K": 2, "1080p": 1, "720p": 0.5, "480p": 0.25, "SD": 0 };
                const resScoreA = resMap[a._res] || 0;
                const resScoreB = resMap[b._res] || 0;
                if (resScoreA !== resScoreB) return resScoreB - resScoreA;

                const aBatch = a._isBatch && (a._seeders > 0 || a._isCached) ? 1 : 0;
                const bBatch = b._isBatch && (b._seeders > 0 || b._isCached) ? 1 : 0;
                if (aBatch !== bBatch) return bBatch - aBatch;

                if (!a._isCached && !b._isCached) {
                    if (a._seeders !== b._seeders) return b._seeders - a._seeders;
                }

                return b._bytes - a._bytes;
            }), 
            "cacheMaxAge": 3600 
        };
    } catch (err) { return { "streams": [] }; }
});

module.exports = { "addonInterface": builder.getInterface(), manifest, parseConfig };
