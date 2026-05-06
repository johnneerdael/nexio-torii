const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");
const {
    buildMediaKey,
    getCachedTorrents,
    upsertTorrentCandidates
} = require("../lib/cache/torrent-cache");

function db() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-torrent-cache-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

test("buildMediaKey is stable for one episode request", () => {
    assert.equal(
        buildMediaKey({ type: "anime", id: "anilist:20-1", expectedSeason: 1, requestedEp: 1, isMovie: false, isRawSearch: false }),
        "anime:anilist:20:season:1:episode:1:movie:0:raw:0"
    );
});

test("upsertTorrentCandidates stores latest metadata by media key and hash", () => {
    const database = db();
    const now = 1000;
    const mediaKey = "anime:anilist:20:season:1:episode:1:movie:0:raw:0";

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "ABCDEF", title: "Show - 01 [1080p]", size: "1.2 GB", seeders: 4, source: "nyaa" }
    ], now);
    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abcdef", title: "Show - 01 [1080p]", size: "1.3 GB", seeders: 9, source: "animetosho" }
    ], now + 10);

    const cached = getCachedTorrents(database, mediaKey, { now: now + 20, freshTtlMs: 1000 });

    assert.equal(cached.torrents.length, 1);
    assert.equal(cached.torrents[0].hash, "abcdef");
    assert.equal(cached.torrents[0].size, "1.3 GB");
    assert.equal(cached.torrents[0].seeders, 9);
    assert.equal(cached.fresh, true);
    assert.equal(cached.newestUpdatedAt, now + 10);

    closeDatabaseForTests();
});

test("getCachedTorrents marks old rows stale", () => {
    const database = db();
    const mediaKey = "anime:anilist:20:season:1:episode:1:movie:0:raw:0";

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abc", title: "Show - 01", size: "1 GB", seeders: 1 }
    ], 1000);

    const cached = getCachedTorrents(database, mediaKey, { now: 5000, freshTtlMs: 1000 });

    assert.equal(cached.torrents.length, 1);
    assert.equal(cached.fresh, false);

    closeDatabaseForTests();
});
