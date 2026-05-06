//===============
// Filter Nyaa torrent candidates against a canonical anime identity.
//
//   filterByCanonical({ canonical, torrents, opts? }) →
//     { kept: [<torrent>...], dropped: [{ torrent, gateFailures, reasons }] }
//
// `torrents` are the deduplicated objects returned by lib/nyaa's
// searchNyaaForAnime — { title, hash, size, seeders, source }. We parse each
// title once with @viren070/parse-torrent-title (via lib/normalizer/parse) and
// score against canonical via lib/normalizer/score.
//
// Gate-failed torrents are dropped from `kept` and surfaced in `dropped` for
// optional debug logging (controlled by env DEBUG_MATCH=1).
//===============

const { parseTorrentTitle } = require("./parse");
const { scoreCandidate } = require("./score");

async function filterByCanonical({ canonical, torrents, opts = {} }) {
    if (!canonical || !Array.isArray(torrents) || torrents.length === 0) {
        return { kept: torrents || [], dropped: [] };
    }

    const parsed = await Promise.all(torrents.map(async t => ({
        torrent: t,
        candidate: await parseTorrentTitle(t.title)
    })));

    const kept = [];
    const dropped = [];
    for (const { torrent, candidate } of parsed) {
        const result = scoreCandidate({ canonical, candidate, opts });
        if (result.gateFailures.length > 0) {
            dropped.push({ torrent, gateFailures: result.gateFailures, reasons: result.reasons });
            continue;
        }
        // Stash the score on the torrent so downstream stream-builder can
        // tier ranking later if it wants.
        torrent._matchScore = result.score;
        torrent._matchReasons = result.reasons;
        kept.push(torrent);
    }

    return { kept, dropped };
}

module.exports = { filterByCanonical };
