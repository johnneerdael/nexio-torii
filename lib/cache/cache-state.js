const CacheState = Object.freeze({
    FRESH: "fresh",
    STALE: "stale",
    EMPTY: "empty",
    EXPIRED: "expired",
    EMPTY_RECENT: "empty_recent"
});

const CacheDecision = Object.freeze({
    USE_CACHE: "use_cache",
    SCRAPE_BACKGROUND: "scrape_background",
    SCRAPE_FOREGROUND: "scrape_foreground",
    WAIT_FOR_OTHER: "wait_for_other",
    USE_EMPTY_CACHE: "use_empty_cache"
});

function createMemoryLockStore(now, lockTtlMs) {
    const locks = new Map();

    function cleanup(currentTime) {
        for (const [key, expiresAt] of locks.entries()) {
            if (expiresAt <= currentTime) locks.delete(key);
        }
    }

    return {
        acquire(mediaKey) {
            const currentTime = now();
            cleanup(currentTime);
            if (locks.has(mediaKey)) return false;
            locks.set(mediaKey, currentTime + lockTtlMs);
            return true;
        },
        release(mediaKey) {
            locks.delete(mediaKey);
        }
    };
}

function createSqliteLockStore(db, now, lockTtlMs) {
    const deleteExpired = db.prepare("DELETE FROM scrape_locks WHERE locked_until <= ?");
    const insertLock = db.prepare("INSERT OR IGNORE INTO scrape_locks (media_key, locked_until) VALUES (?, ?)");
    const deleteLock = db.prepare("DELETE FROM scrape_locks WHERE media_key = ?");

    return {
        acquire(mediaKey) {
            const currentTime = now();
            deleteExpired.run(currentTime);
            const result = insertLock.run(mediaKey, currentTime + lockTtlMs);
            return result.changes === 1;
        },
        release(mediaKey) {
            deleteLock.run(mediaKey);
        }
    };
}

function createCacheStateManager(options = {}) {
    const now = options.now || Date.now;
    const lockTtlMs = options.lockTtlMs || 30_000;
    const lockStore = options.lockStore || (options.db
        ? createSqliteLockStore(options.db, now, lockTtlMs)
        : createMemoryLockStore(now, lockTtlMs));

    function tryAcquireLock(mediaKey) {
        return lockStore.acquire(mediaKey);
    }

    function releaseLock(mediaKey) {
        lockStore.release(mediaKey);
    }

    function determineState({ torrentCount, newestUpdatedAt, freshTtlMs, staleTtlMs, emptyFresh }) {
        if (torrentCount <= 0) return emptyFresh ? CacheState.EMPTY_RECENT : CacheState.EMPTY;
        const age = now() - newestUpdatedAt;
        if (age <= freshTtlMs) return CacheState.FRESH;
        if (age <= staleTtlMs) return CacheState.STALE;
        return CacheState.EXPIRED;
    }

    function decide(input) {
        const state = determineState(input);

        if (state === CacheState.FRESH) {
            return { state, decision: CacheDecision.USE_CACHE, lockAcquired: false };
        }

        if (state === CacheState.EMPTY_RECENT) {
            return { state, decision: CacheDecision.USE_EMPTY_CACHE, lockAcquired: false };
        }

        if (state === CacheState.STALE) {
            const lockAcquired = tryAcquireLock(input.mediaKey);
            return {
                state,
                decision: lockAcquired ? CacheDecision.SCRAPE_BACKGROUND : CacheDecision.USE_CACHE,
                lockAcquired
            };
        }

        const lockAcquired = tryAcquireLock(input.mediaKey);
        return {
            state,
            decision: lockAcquired ? CacheDecision.SCRAPE_FOREGROUND : CacheDecision.WAIT_FOR_OTHER,
            lockAcquired
        };
    }

    return {
        decide,
        releaseLock,
        tryAcquireLock
    };
}

module.exports = {
    CacheDecision,
    CacheState,
    createCacheStateManager,
    createMemoryLockStore,
    createSqliteLockStore
};
