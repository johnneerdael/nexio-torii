const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");
const { createCacheStateManager } = require("../lib/cache/cache-state");
const { upsertTorrentCandidates } = require("../lib/cache/torrent-cache");
const { getTorrentsForStream } = require("../lib/cache/stream-cache");

function db() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-stream-cache-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

test("fresh cache returns torrents without scraping", async () => {
    const database = db();
    const mediaKey = "media";
    let scrapeCalls = 0;

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abc", title: "Show - 01", size: "1 GB", seeders: 5 }
    ], 10_000);

    const result = await getTorrentsForStream({
        db: database,
        mediaKey,
        scrape: async () => {
            scrapeCalls++;
            return [{ hash: "def", title: "Fresh", size: "2 GB", seeders: 10 }];
        },
        cacheManager: createCacheStateManager({ now: () => 11_000 }),
        now: 11_000,
        freshTtlMs: 60_000,
        staleTtlMs: 600_000
    });

    assert.equal(scrapeCalls, 0);
    assert.equal(result.torrents[0].hash, "abc");
    assert.equal(result.source, "cache");

    closeDatabaseForTests();
});

test("empty cache scrapes foreground and persists results", async () => {
    const database = db();

    const result = await getTorrentsForStream({
        db: database,
        mediaKey: "media",
        scrape: async () => [{ hash: "abc", title: "Show - 01", size: "1 GB", seeders: 5 }],
        cacheManager: createCacheStateManager({ now: () => 20_000 }),
        now: 20_000,
        freshTtlMs: 60_000,
        staleTtlMs: 600_000
    });

    assert.equal(result.torrents.length, 1);
    assert.equal(result.source, "foreground_scrape");

    const second = await getTorrentsForStream({
        db: database,
        mediaKey: "media",
        scrape: async () => [],
        cacheManager: createCacheStateManager({ now: () => 21_000 }),
        now: 21_000,
        freshTtlMs: 60_000,
        staleTtlMs: 600_000
    });

    assert.equal(second.torrents[0].hash, "abc");

    closeDatabaseForTests();
});

test("stale cache returns cache and schedules background refresh", async () => {
    const database = db();
    const mediaKey = "media";
    const backgroundJobs = [];

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abc", title: "Old", size: "1 GB", seeders: 1 }
    ], 1_000);

    const result = await getTorrentsForStream({
        db: database,
        mediaKey,
        scrape: async () => [{ hash: "def", title: "New", size: "2 GB", seeders: 9 }],
        cacheManager: createCacheStateManager({ now: () => 20_000 }),
        runBackground: job => backgroundJobs.push(job),
        now: 20_000,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });

    assert.equal(result.torrents[0].hash, "abc");
    assert.equal(result.source, "stale_cache");
    assert.equal(backgroundJobs.length, 1);

    await backgroundJobs[0]();

    const refreshed = await getTorrentsForStream({
        db: database,
        mediaKey,
        scrape: async () => [],
        cacheManager: createCacheStateManager({ now: () => 21_000 }),
        now: 21_000,
        freshTtlMs: 60_000,
        staleTtlMs: 60_000
    });

    assert.equal(refreshed.torrents.some(torrent => torrent.hash === "def"), true);

    closeDatabaseForTests();
});
