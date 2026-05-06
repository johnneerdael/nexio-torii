const { CacheDecision, createCacheStateManager } = require("./cache-state");
const { getDatabase } = require("./database");
const { getCachedTorrents, upsertTorrentCandidates } = require("./torrent-cache");

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createSharedCacheManager() {
    return createCacheStateManager({ db: getDatabase() });
}

let sharedCacheManager = null;

function getSharedCacheManager() {
    if (!sharedCacheManager) sharedCacheManager = createSharedCacheManager();
    return sharedCacheManager;
}

function getEmptySearch(db, mediaKey, options = {}) {
    const now = options.now || Date.now();
    const ttlMs = options.ttlMs || envNumber("EMPTY_SEARCH_CACHE_TTL_MS", 5 * 60 * 1000);
    const row = db.prepare(`
        SELECT updated_at
        FROM empty_searches
        WHERE media_key = ?
        AND updated_at >= ?
    `).get(mediaKey, now - ttlMs);

    return {
        fresh: Boolean(row),
        updatedAt: row ? row.updated_at : 0
    };
}

function markEmptySearch(db, mediaKey, now = Date.now()) {
    db.prepare(`
        INSERT INTO empty_searches (media_key, updated_at)
        VALUES (?, ?)
        ON CONFLICT(media_key) DO UPDATE SET updated_at = excluded.updated_at
    `).run(mediaKey, now);
}

function clearEmptySearch(db, mediaKey) {
    db.prepare("DELETE FROM empty_searches WHERE media_key = ?").run(mediaKey);
}

async function persistScrape(db, mediaKey, scrape, now) {
    const result = await scrape();
    const torrents = Array.isArray(result) ? result : result.torrentsArr || [];
    if (torrents.length > 0) {
        upsertTorrentCandidates(db, mediaKey, torrents, now);
        clearEmptySearch(db, mediaKey);
    } else {
        markEmptySearch(db, mediaKey, now);
    }
    return torrents;
}

async function getTorrentsForStream(options) {
    const db = options.db || getDatabase();
    const mediaKey = options.mediaKey;
    const scrape = options.scrape;
    const now = options.now || Date.now();
    const freshTtlMs = options.freshTtlMs || envNumber("TORRENT_CACHE_FRESH_MS", 6 * 60 * 60 * 1000);
    const staleTtlMs = options.staleTtlMs || envNumber("TORRENT_CACHE_STALE_MS", 7 * 24 * 60 * 60 * 1000);
    const emptyTtlMs = options.emptyTtlMs || envNumber("EMPTY_SEARCH_CACHE_TTL_MS", 5 * 60 * 1000);
    const cacheManager = options.cacheManager || getSharedCacheManager();
    const runBackground = options.runBackground || (job => setImmediate(() => job().catch(error => {
        console.error("[CACHE] Background scrape failed:", error.message);
    })));

    const cached = getCachedTorrents(db, mediaKey, { now, freshTtlMs });
    const emptySearch = getEmptySearch(db, mediaKey, { now, ttlMs: emptyTtlMs });
    const decision = cacheManager.decide({
        mediaKey,
        torrentCount: cached.torrents.length,
        newestUpdatedAt: cached.newestUpdatedAt,
        freshTtlMs,
        staleTtlMs,
        emptyFresh: emptySearch.fresh
    });

    if (decision.decision === CacheDecision.USE_EMPTY_CACHE) {
        return { torrents: [], source: "empty_cache", decision };
    }

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
    clearEmptySearch,
    getEmptySearch,
    getTorrentsForStream,
    markEmptySearch,
    persistScrape
};
