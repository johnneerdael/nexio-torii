const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CacheDecision,
    CacheState,
    createCacheStateManager
} = require("../lib/cache/cache-state");

test("fresh cached torrents use cache only", () => {
    const manager = createCacheStateManager({ now: () => 10_000 });
    const result = manager.decide({
        mediaKey: "media",
        torrentCount: 3,
        newestUpdatedAt: 9_000,
        freshTtlMs: 5_000,
        staleTtlMs: 60_000
    });

    assert.equal(result.state, CacheState.FRESH);
    assert.equal(result.decision, CacheDecision.USE_CACHE);
    assert.equal(result.lockAcquired, false);
});

test("stale cached torrents return cache and refresh in background", () => {
    const manager = createCacheStateManager({ now: () => 20_000 });
    const result = manager.decide({
        mediaKey: "media",
        torrentCount: 2,
        newestUpdatedAt: 10_000,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });

    assert.equal(result.state, CacheState.STALE);
    assert.equal(result.decision, CacheDecision.SCRAPE_BACKGROUND);
    assert.equal(result.lockAcquired, true);
});

test("empty cache acquires foreground lock once", () => {
    const manager = createCacheStateManager({ now: () => 20_000, lockTtlMs: 10_000 });

    const first = manager.decide({
        mediaKey: "media",
        torrentCount: 0,
        newestUpdatedAt: 0,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });
    const second = manager.decide({
        mediaKey: "media",
        torrentCount: 0,
        newestUpdatedAt: 0,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });

    assert.equal(first.decision, CacheDecision.SCRAPE_FOREGROUND);
    assert.equal(second.decision, CacheDecision.WAIT_FOR_OTHER);
});

test("expired lock can be acquired again", () => {
    let currentTime = 20_000;
    const manager = createCacheStateManager({ now: () => currentTime, lockTtlMs: 10_000 });

    manager.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    currentTime = 31_000;

    const result = manager.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    assert.equal(result.decision, CacheDecision.SCRAPE_FOREGROUND);
});
