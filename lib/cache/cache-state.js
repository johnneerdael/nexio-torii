const CacheState = Object.freeze({
    FRESH: "fresh",
    STALE: "stale",
    EMPTY: "empty",
    EXPIRED: "expired"
});

const CacheDecision = Object.freeze({
    USE_CACHE: "use_cache",
    SCRAPE_BACKGROUND: "scrape_background",
    SCRAPE_FOREGROUND: "scrape_foreground",
    WAIT_FOR_OTHER: "wait_for_other"
});

function createCacheStateManager(options = {}) {
    const locks = new Map();
    const now = options.now || Date.now;
    const lockTtlMs = options.lockTtlMs || 30_000;

    function cleanup(currentTime) {
        for (const [key, expiresAt] of locks.entries()) {
            if (expiresAt <= currentTime) locks.delete(key);
        }
    }

    function tryAcquireLock(mediaKey) {
        const currentTime = now();
        cleanup(currentTime);
        if (locks.has(mediaKey)) return false;
        locks.set(mediaKey, currentTime + lockTtlMs);
        return true;
    }

    function releaseLock(mediaKey) {
        locks.delete(mediaKey);
    }

    function determineState({ torrentCount, newestUpdatedAt, freshTtlMs, staleTtlMs }) {
        if (torrentCount <= 0) return CacheState.EMPTY;
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
    createCacheStateManager
};
