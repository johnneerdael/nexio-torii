const SIZE_REGEX = /(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)/i;
const UNIT_BYTES = {
    B: 1, KB: 1000, MB: 1_000_000, GB: 1_000_000_000, TB: 1_000_000_000_000,
    KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776
};

function parseSizeToBytes(s) {
    if (typeof s === "number") return s;
    if (!s) return null;
    const m = SIZE_REGEX.exec(String(s));
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * (UNIT_BYTES[m[2]] || UNIT_BYTES[m[2].toUpperCase()] || 0));
}

function ageHoursSince(pubDate) {
    if (!pubDate) return null;
    const t = Date.parse(pubDate);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 3_600_000));
}

function buildEpisodeRange(parsed, episodeCount) {
    if (!Array.isArray(parsed.episodes) || parsed.episodes.length === 0) return null;
    const sorted = [...parsed.episodes].sort((a, b) => a - b);
    return {
        first: sorted[0],
        last: sorted[sorted.length - 1],
        total: episodeCount || null
    };
}

function enrichTorrent({ torrent, parsed, canonical, debrid, match, requestedEp, expectedSeason, anilistId }) {
    const sizeBytes = parseSizeToBytes(torrent.size) || debrid?.selectedFile?.sizeBytes || null;
    const ageHours = ageHoursSince(torrent.pubDate);
    const isSeasonPack = Array.isArray(parsed.episodes) && parsed.episodes.length > 1;
    const episodeRange = buildEpisodeRange(parsed, canonical.episodes);
    const episodeTitle = canonical.epMeta?.[requestedEp]?.title || null;

    return {
        source: {
            rawTitle: torrent.title,
            infoHash: (torrent.hash || "").toLowerCase(),
            sizeBytes,
            seeders: Number.isFinite(torrent.seeders) ? torrent.seeders : (parseInt(torrent.seeders, 10) || 0),
            leechers: Number.isFinite(torrent.leechers) ? torrent.leechers : null,
            indexer: torrent.source || "Nyaa",
            pubDate: torrent.pubDate || null,
            ageHours,
            fileExtension: torrent.title?.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase() || null,
            container: torrent.title?.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase() || null
        },
        parsed: {
            title: parsed.title || null,
            year: parsed.year || null,
            seasons: parsed.seasons || [],
            episodes: parsed.episodes || [],
            isSeasonPack,
            episodeRange,
            resolution: parsed.resolution || null,
            quality: parsed.quality || null,
            encode: parsed.encode || null,
            visualTags: parsed.visualTags || [],
            audioTags: parsed.audioTags || [],
            audioChannels: parsed.audioChannels || [],
            languages: parsed.languages || [],
            subtitles: parsed.subtitles || [],
            releaseGroup: parsed.releaseGroup || null,
            network: parsed.network || null,
            edition: Array.isArray(parsed.editions) ? parsed.editions[0] || null : null,
            dubbed: parsed.dubbed === true,
            subbed: parsed.subbed === true,
            repack: parsed.repack === true,
            regraded: parsed.regraded === true,
            uncensored: parsed.uncensored === true,
            unrated: parsed.unrated === true,
            upscaled: parsed.upscaled === true
        },
        canonical: {
            anilistId: anilistId || null,
            malId: canonical.idMal ? String(canonical.idMal) : null,
            anidbId: canonical.anidb || null,
            kitsuId: canonical.kitsu || null,
            imdbId: canonical.imdb || null,
            mainTitle: canonical.name || null,
            englishTitle: canonical.englishName || canonical.name || null,
            year: canonical.year || (canonical.releaseInfo ? parseInt(canonical.releaseInfo, 10) : null),
            format: canonical.format || null,
            episodeCount: canonical.episodes || null,
            episodeTitle,
            episodeAirDate: canonical.epMeta?.[requestedEp]?.airDate || null,
            season: expectedSeason || 1,
            episode: requestedEp,
            runtimeMinutes: canonical.duration || null
        },
        debrid: {
            serviceCode: debrid?.serviceCode || null,
            isCached: debrid?.isCached === true,
            selectedFile: debrid?.selectedFile || null,
            archiveLayout: debrid?.archiveLayout || null
        },
        match: {
            score: match?.score ?? null,
            confidence: match?.confidence || "UNKNOWN",
            reasons: Array.isArray(match?.reasons) ? match.reasons : []
        }
    };
}

module.exports = { enrichTorrent, parseSizeToBytes };
