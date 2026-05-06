const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const {
    getDatabase,
    initializeDatabase,
    closeDatabaseForTests
} = require("../lib/cache/database");

function tempDbPath(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-cache-"));
    return path.join(dir, name);
}

test("initializeDatabase creates torrent and debrid cache tables", () => {
    const db = getDatabase({ dbPath: tempDbPath("cache.sqlite") });
    initializeDatabase(db);

    const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
    `).all().map(row => row.name);

    assert.ok(tables.includes("torrent_candidates"));
    assert.ok(tables.includes("debrid_availability"));
    assert.ok(tables.includes("scrape_locks"));

    closeDatabaseForTests();
});

test("getDatabase creates parent directory for CACHE_DB_PATH", () => {
    const dbPath = tempDbPath("nested/cache.sqlite");
    const db = getDatabase({ dbPath });

    assert.equal(fs.existsSync(path.dirname(dbPath)), true);
    assert.equal(db.open, true);

    closeDatabaseForTests();
});
