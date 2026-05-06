const { getServiceCode, isOffcloud } = require("./services");

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
        isSeasonBatch
    } = input;

    const userLangs = Array.isArray(userConfig.language) ? userConfig.language : [userConfig.language || "ENG"];
    const streams = [];
    let epDropCount = 0;

    torrents.forEach(t => {
        const hashLow = t.hash.toLowerCase();
        const { res } = extractTags(t.title);
        const bytes = parseSizeToBytes(t.size);
        const streamLang = extractLanguage(t.title, userLangs);
        const flag = flags[streamLang] || "ENG";
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

        const batchStr = isBatch ? " | 📦 Batch" : "";

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

            const uiName = isCached ? `TORII [⚡ ${serviceCode}]` : `TORII [☁️ ${serviceCode}]`;
            const streamStatus = isCached ? "⚡ Cached" : "☁️ Download";
            const streamPayload = {
                name: `${uiName}\n🎥 ${res}`,
                description: `${flag} Nyaa | ${streamStatus}${batchStr}\n📄 ${t.title}\n💾 ${t.size} | 👥 ${seeders} Seeds`,
                url: buildResolveUrl(baseUrl, nexioPayload, serviceIndex, t.hash, requestedEp, t.title),
                behaviorHints: {
                    bingeGroup: `nexio_torii_${entry.service}_${serviceIndex}_${t.hash}`,
                    filename: matchedFile ? matchedFile.name : undefined
                },
                _bytes: bytes,
                _lang: streamLang,
                _isCached: isCached,
                _res: res,
                _prog: 0,
                _seeders: seeders,
                _isBatch: isBatch
            };

            const subtitles = files
                .filter(file => /\.(srt|vtt|ass|ssa)$/i.test(file.name || file.path || ""))
                .map(file => buildSubtitleUrl(baseUrl, nexioPayload, serviceIndex, t.hash, file, userLangs, extractLanguage));

            if (subtitles.length > 0) streamPayload.subtitles = subtitles;
            streams.push(streamPayload);
        });
    });

    return streams;
}

module.exports = {
    buildDebridStreams,
    buildResolveUrl,
    buildSubtitleUrl
};
