const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");
const {
    checkStoreTorzWithCache,
    getCachedAvailability,
    upsertAvailability
} = require("../lib/cache/debrid-cache");

function db() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-debrid-cache-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

test("upsertAvailability stores availability by service hash and episode scope", () => {
    const database = db();

    upsertAvailability(database, "realdebrid", {
        abc: { hash: "abc", status: "cached", isCached: true, files: [{ index: 0, name: "Episode 01.mkv" }] }
    }, { season: 1, episode: 1 }, 1000);

    const result = getCachedAvailability(database, "realdebrid", ["abc", "def"], { season: 1, episode: 1 }, {
        now: 2000,
        ttlMs: 10_000
    });

    assert.equal(result.cached.abc.isCached, true);
    assert.equal(result.cached.abc.files[0].name, "Episode 01.mkv");
    assert.deepEqual(result.missingHashes, ["def"]);

    closeDatabaseForTests();
});

test("getCachedAvailability treats stale rows as missing", () => {
    const database = db();

    upsertAvailability(database, "realdebrid", {
        abc: { hash: "abc", status: "cached", isCached: true, files: [] }
    }, { season: 1, episode: 1 }, 1000);

    const result = getCachedAvailability(database, "realdebrid", ["abc"], { season: 1, episode: 1 }, {
        now: 20_000,
        ttlMs: 1_000
    });

    assert.deepEqual(result.cached, {});
    assert.deepEqual(result.missingHashes, ["abc"]);

    closeDatabaseForTests();
});

test("checkStoreTorzWithCache only calls StremThru for missing hashes", async () => {
    const database = db();
    const calls = [];
    const checkStoreTorz = async hashes => {
        calls.push(hashes);
        return {
            def: { hash: "def", status: "cached", isCached: true, files: [] }
        };
    };

    upsertAvailability(database, "realdebrid", {
        abc: { hash: "abc", status: "cached", isCached: true, files: [] }
    }, { season: 1, episode: 1 }, 1000);

    const result = await checkStoreTorzWithCache(["abc", "def"], { service: "realdebrid", apiKey: "secret" }, {
        db: database,
        scope: { season: 1, episode: 1 },
        now: 2000,
        ttlMs: 10_000,
        checkStoreTorz
    });

    assert.deepEqual(calls, [["def"]]);
    assert.equal(result.abc.isCached, true);
    assert.equal(result.def.isCached, true);

    closeDatabaseForTests();
});
