const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");

function tempDbPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-catalog-"));
    return path.join(dir, "catalog.sqlite");
}

test("catalog database creates source, identity, episode, and checkpoint tables", () => {
    const db = getCatalogDatabase({ dbPath: tempDbPath() });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);

    assert.ok(tables.includes("source_items"));
    assert.ok(tables.includes("torrent_identities"));
    assert.ok(tables.includes("torrent_episode_matches"));
    assert.ok(tables.includes("ingestion_checkpoints"));
    assert.ok(tables.includes("ingestion_runs"));

    closeCatalogDatabaseForTests();
});

test("catalog database uses a separate path from runtime cache by default", () => {
    delete process.env.CATALOG_DB_PATH;
    const resolved = require("../lib/catalog/database").resolveCatalogDbPath();

    assert.equal(resolved.endsWith(path.join("data", "catalog.sqlite")), true);
});

test("catalog database stores one canonical source row per info hash", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const columns = db.prepare("PRAGMA table_info(source_items)").all();
    const infoHashColumn = columns.find(column => column.name === "info_hash");

    assert.equal(infoHashColumn.pk, 1);
    assert.ok(columns.some(column => column.name === "source_priority"));
    assert.ok(columns.some(column => column.name === "stable_provider"));
    assert.ok(columns.some(column => column.name === "stable_id"));
    assert.ok(columns.some(column => column.name === "parsed_json"));

    db.close();
    closeCatalogDatabaseForTests();
});

test("catalog database creates resolution cache and drop tables", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);

    assert.ok(tables.includes("identity_resolution_cache"));
    assert.ok(tables.includes("dropped_source_items"));

    db.close();
    closeCatalogDatabaseForTests();
});

test("catalog database creates backfill state table", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);

    assert.ok(tables.includes("catalog_backfill_state"));

    db.close();
    closeCatalogDatabaseForTests();
});

test("identity resolution cache stores query and candidate diagnostics", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const columns = db.prepare("PRAGMA table_info(identity_resolution_cache)").all().map(column => column.name);

    assert.ok(columns.includes("query_json"));
    assert.ok(columns.includes("candidate_json"));

    db.close();
    closeCatalogDatabaseForTests();
});
