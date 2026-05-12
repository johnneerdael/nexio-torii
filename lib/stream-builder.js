//===============
// Stream-builder for Torii (debrid + P2P streams).
// Delegates name/description rendering to the lib/stream-formatter module
// (Nexio universal-formatter integration). Subtitle/proxy URL helpers stay
// here since they're stream-shape concerns, not format concerns.
//===============

const { getServiceCode, isOffcloud } = require("./services");
const { enrichTorrent, formatToriiStream } = require("./stream-formatter");

const SIZE_REGEX = /(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)/i;
const UNIT_BYTES = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
    KiB: 1024,
    MiB: 1024 * 1024,
    GiB: 1024 * 1024 * 1024,
    TiB: 1024 * 1024 * 1024 * 1024
};

function buildResolveUrl(baseUrl, nexioPayload, serviceIndex, hash, requestedEp, title) {
    return `${baseUrl}/resolve/${nexioPayload}/${serviceIndex}/${hash}/${requestedEp}?title=${encodeURIComponent(title || "")}`;
}

function buildSubtitleUrl(baseUrl, nexioPayload, serviceIndex, hash, file, userLangs, extractLanguage) {
    return {
        id: String(file.id),
        url: `${baseUrl}/sub/${nexioPayload}/${serviceIndex}/${hash}/${file.id}?filename=${encodeURIComponent(file.name || file.path || "sub.srt")}`,
        lang: extractLanguage(file.name || file.path || "", userLangs) || "ENG"
    };
}

function torrentSizeKey(torrent) {
    if (!torrent) return null;
    const explicit = Number(torrent.sizeBytes || torrent.size_bytes);
    if (Number.isFinite(explicit) && explicit > 0) return String(Math.round(explicit));

    const size = torrent.size;
    if (typeof size === "number" && Number.isFinite(size) && size > 0) return String(Math.round(size));

    const match = SIZE_REGEX.exec(String(size || ""));
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = UNIT_BYTES[match[2]] || UNIT_BYTES[match[2].toUpperCase()];
    if (!Number.isFinite(value) || !unit) return null;
    return String(Math.round(value * unit));
}

function torrentSeeders(torrent) {
    const seeders = parseInt(torrent && torrent.seeders, 10);
    return Number.isFinite(seeders) ? seeders : 0;
}

function dedupeTorrentsByExactSize(torrents) {
    if (!Array.isArray(torrents) || torrents.length === 0) return [];

    const out = [];
    const indexBySize = new Map();

    for (const torrent of torrents) {
        const key = torrentSizeKey(torrent);
        if (!key) {
            out.push(torrent);
            continue;
        }

        const existingIndex = indexBySize.get(key);
        if (existingIndex == null) {
            indexBySize.set(key, out.length);
            out.push(torrent);
            continue;
        }

        if (torrentSeeders(torrent) > torrentSeeders(out[existingIndex])) {
            out[existingIndex] = torrent;
        }
    }

    return out;
}

function parseTitleDetails(title) {
    const t = String(title || "");
    const lower = t.toLowerCase();

    const quality = /\bbluray\b/i.test(t) ? "BluRay"
        : /\bweb-?dl\b/i.test(t) ? "WEB-DL"
        : /\bweb-?rip\b/i.test(t) ? "WEBRip"
        : /\bhdtv\b/i.test(t) ? "HDTV"
        : /\bdvd\b/i.test(t) ? "DVD"
        : null;

    const encode = /\bx?265|hevc\b/i.test(t) ? "HEVC"
        : /\bx?264|h\.?264|avc\b/i.test(t) ? "AVC"
        : /\bav1\b/i.test(t) ? "AV1"
        : null;

    const visualTags = [];
    if (/\bdv\b|dolby ?vision/i.test(t)) visualTags.push("DV");
    if (/\bhdr10\+/i.test(t)) visualTags.push("HDR10+");
    else if (/\bhdr10\b|\bhdr\b/i.test(t)) visualTags.push("HDR10");
    if (/\b10[- ]?bit\b/i.test(t)) visualTags.push("10bit");

    const audioTags = [];
    if (/\bdts-?hd\b/i.test(t)) audioTags.push("DTS-HD");
    else if (/\bdts\b/i.test(t)) audioTags.push("DTS");
    if (/\btruehd\b/i.test(t)) audioTags.push("TrueHD");
    if (/\batmos\b/i.test(t)) audioTags.push("Atmos");
    if (/\bac3\b|\beac3\b|\bdd[+5]?\b/i.test(t)) audioTags.push("DD");
    if (/\bflac\b/i.test(t)) audioTags.push("FLAC");
    if (/\baac\b/i.test(t)) audioTags.push("AAC");
    if (/\bopus\b/i.test(t)) audioTags.push("Opus");

    const audioChannels = [];
    if (/\b7\.1\b/.test(t)) audioChannels.push("7.1");
    else if (/\b5\.1\b/.test(t)) audioChannels.push("5.1");
    else if (/\b2\.0\b/.test(t)) audioChannels.push("2.0");

    let releaseGroup = null;
    const groupBracket = t.match(/^\s*\[([^\]]+)\]/);
    if (groupBracket) {
        releaseGroup = groupBracket[1];
    } else {
        const groupSuffix = t.match(/-([A-Z][A-Za-z0-9]+)(?:\.[a-z0-9]{2,4})?$/);
        if (groupSuffix) releaseGroup = groupSuffix[1];
    }

    return { quality, encode, visualTags, audioTags, audioChannels, releaseGroup };
}

function buildParsedFromTitle(title, res, streamLang, isBatch, batchRange) {
    const details = parseTitleDetails(title);
    return {
        title: null,
        year: null,
        seasons: [],
        episodes: isBatch && batchRange ? batchRange : [],
        resolution: res,
        quality: details.quality,
        encode: details.encode,
        visualTags: details.visualTags,
        audioTags: details.audioTags,
        audioChannels: details.audioChannels,
        languages: streamLang && streamLang !== "UND" ? [streamLang] : [],
        subtitles: [],
        releaseGroup: details.releaseGroup,
        network: null
    };
}

function buildDebridStreams(input) {
    const {
        torrents,
        availabilityByEntry,
        userConfig,
        nexioPayload,
        baseUrl,
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
        isSeasonBatch,
        canonical
    } = input;

    const userLangs = Array.isArray(userConfig.language) ? userConfig.language : [userConfig.language || "ENG"];
    const streams = [];
    let epDropCount = 0;
    const canonicalForFormatter = canonical || {};

    torrents.forEach(t => {
        const hashLow = t.hash.toLowerCase();
        const { res } = extractTags(t.title);
        const bytes = parseSizeToBytes(t.size);
        const streamLang = extractLanguage(t.title, userLangs);
        const seeders = parseInt(t.seeders, 10) || 0;
        let isBatch = false;
        let isValidMatch = false;

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

        const parsed = buildParsedFromTitle(t.title, res, streamLang, isBatch, null);

        userConfig.debridServices.forEach((entry, serviceIndex) => {
            const availability = availabilityByEntry[serviceIndex] || {};
            const cached = availability[hashLow];
            const files = cached && Array.isArray(cached.files) ? cached.files : [];
            const isCached = Boolean(cached && cached.isCached);
            const serviceCode = getServiceCode(entry.service);

            if (isOffcloud(entry.service) && isCached && files.length === 0 && !isMovie && !isRawSearch) {
                return;
            }

            const matchedFile = files.length > 0 ? selectBestVideoFile(files, requestedEp, expectedSeason, isMovie) : null;
            if (isCached && files.length > 0 && !matchedFile && !isMovie) {
                epDropCount++;
                return;
            }

            if (!isCached && userConfig.hideUncached) return;

            const enriched = enrichTorrent({
                torrent: { ...t, source: t.source || "Nyaa.si" },
                parsed,
                canonical: canonicalForFormatter,
                debrid: {
                    serviceCode,
                    isCached,
                    selectedFile: matchedFile ? {
                        name: matchedFile.name || matchedFile.path,
                        sizeBytes: matchedFile.size || null,
                        index: matchedFile.index ?? matchedFile.id ?? null
                    } : null,
                    archiveLayout: null
                },
                match: {
                    score: t._matchScore ?? null,
                    confidence: t._matchConfidence || "MEDIUM",
                    reasons: t._matchReasons || []
                },
                requestedEp,
                expectedSeason,
                anilistId: canonicalForFormatter?.anilistId || null
            });

            const stream = formatToriiStream(enriched, {
                url: buildResolveUrl(baseUrl, nexioPayload, serviceIndex, t.hash, requestedEp, t.title),
                behaviorHints: {
                    bingeGroup: `nexio_torii_${entry.service}_${serviceIndex}_${t.hash}`,
                    filename: matchedFile ? matchedFile.name : undefined
                }
            });

            stream._bytes = bytes;
            stream._lang = streamLang;
            stream._isCached = isCached;
            stream._res = res;
            stream._prog = 0;
            stream._seeders = seeders;
            stream._isBatch = isBatch;

            const subtitles = files
                .filter(file => /\.(srt|vtt|ass|ssa)$/i.test(file.name || file.path || ""))
                .map(file => buildSubtitleUrl(baseUrl, nexioPayload, serviceIndex, t.hash, file, userLangs, extractLanguage));

            if (subtitles.length > 0) stream.subtitles = subtitles;
            streams.push(stream);
        });
    });

    return streams;
}

function buildP2PStream({ torrent, parsed, canonical, requestedEp, expectedSeason, anilistId, streamLang, seeders, bytes, isBatch, isMovie }) {
    const enriched = enrichTorrent({
        torrent: { ...torrent, source: torrent.source || "Nyaa.si" },
        parsed,
        canonical: canonical || {},
        debrid: { serviceCode: null, isCached: null, selectedFile: null, archiveLayout: null },
        match: {
            score: torrent._matchScore ?? null,
            confidence: torrent._matchConfidence || "MEDIUM",
            reasons: torrent._matchReasons || []
        },
        requestedEp,
        expectedSeason,
        anilistId: anilistId || null
    });

    const stream = formatToriiStream(enriched, {
        url: undefined,
        behaviorHints: { bingeGroup: `nexio_torii_p2p_${torrent.hash}` }
    });
    delete stream.url;
    stream.infoHash = torrent.hash;
    stream.sources = [
        "tracker:http://nyaa.tracker.wf:7777/announce",
        "tracker:udp://open.stealth.si:80/announce",
        "tracker:udp://tracker.opentrackr.org:1337/announce",
        "tracker:udp://exodus.desync.com:6969/announce",
        "dht:" + torrent.hash
    ];
    stream._bytes = bytes;
    stream._lang = streamLang;
    stream._isCached = false;
    stream._res = parsed.resolution || "SD";
    stream._prog = 0;
    stream._seeders = seeders;
    stream._isBatch = isBatch;
    return stream;
}

module.exports = {
    buildDebridStreams,
    buildP2PStream,
    buildResolveUrl,
    buildSubtitleUrl,
    dedupeTorrentsByExactSize,
    parseTitleDetails,
    buildParsedFromTitle
};
