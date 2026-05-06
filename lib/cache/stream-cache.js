const { CacheDecision, createCacheStateManager } = require("./cache-state");
const { getDatabase } = require("./database");
const { getCachedTorrents, upsertTorrentCandidates } = require("./torrent-cache");

const sharedCacheManager = createCacheStateManager();

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function persistScrape(db, mediaKey, scrape, now) {
    const result = await scrape();
    const torrents = Array.isArray(result) ? result : result.torrentsArr || [];
    upsertTorrentCandidates(db, mediaKey, torrents, now);
    return torrents;
}

async function getTorrentsForStream(options) {
    const db = options.db || getDatabase();
    const mediaKey = options.mediaKey;
    const scrape = options.scrape;
    const now = options.now || Date.now();
    const freshTtlMs = options.freshTtlMs || envNumber("TORRENT_CACHE_FRESH_MS", 6 * 60 * 60 * 1000);
    const staleTtlMs = options.staleTtlMs || envNumber("TORRENT_CACHE_STALE_MS", 7 * 24 * 60 * 60 * 1000);
    const cacheManager = options.cacheManager || sharedCacheManager;
    const runBackground = options.runBackground || (job => setImmediate(() => job().catch(error => {
        console.error("[CACHE] Background scrape failed:", error.message);
    })));

    const cached = getCachedTorrents(db, mediaKey, { now, freshTtlMs });
    const decision = cacheManager.decide({
        mediaKey,
        torrentCount: cached.torrents.length,
        newestUpdatedAt: cached.newestUpdatedAt,
        freshTtlMs,
        staleTtlMs
    });

    if (decision.decision === CacheDecision.USE_CACHE) {
        return { torrents: cached.torrents, source: cached.fresh ? "cache" : "stale_cache", decision };
    }

    if (decision.decision === CacheDecision.SCRAPE_BACKGROUND) {
        runBackground(async () => {
            try {
                await persistScrape(db, mediaKey, scrape, Date.now());
            } finally {
                cacheManager.releaseLock(mediaKey);
            }
        });
        return { torrents: cached.torrents, source: "stale_cache", decision };
    }

    if (decision.decision === CacheDecision.WAIT_FOR_OTHER) {
        return { torrents: cached.torrents, source: "wait", decision };
    }

    try {
        const torrents = await persistScrape(db, mediaKey, scrape, now);
        return { torrents, source: "foreground_scrape", decision };
    } finally {
        cacheManager.releaseLock(mediaKey);
    }
}

module.exports = {
    getTorrentsForStream,
    persistScrape
};
