const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const {
    CacheDecision,
    CacheState,
    createCacheStateManager
} = require("../lib/cache/cache-state");
const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");

function tempDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-cache-state-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

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

test("sqlite locks are shared across manager instances", () => {
    const database = tempDb();
    const first = createCacheStateManager({ db: database, now: () => 1000, lockTtlMs: 10_000 });
    const second = createCacheStateManager({ db: database, now: () => 1000, lockTtlMs: 10_000 });

    const firstResult = first.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    const secondResult = second.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });

    assert.equal(firstResult.decision, CacheDecision.SCRAPE_FOREGROUND);
    assert.equal(secondResult.decision, CacheDecision.WAIT_FOR_OTHER);

    first.releaseLock("media");
    const thirdResult = second.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    assert.equal(thirdResult.decision, CacheDecision.SCRAPE_FOREGROUND);

    closeDatabaseForTests();
});

test("sqlite locks expire across manager instances", () => {
    const database = tempDb();
    let currentTime = 1000;
    const first = createCacheStateManager({ db: database, now: () => currentTime, lockTtlMs: 10_000 });
    const second = createCacheStateManager({ db: database, now: () => currentTime, lockTtlMs: 10_000 });

    first.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    currentTime = 12_000;
    const result = second.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });

    assert.equal(result.decision, CacheDecision.SCRAPE_FOREGROUND);

    closeDatabaseForTests();
});
