const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeSourceItem, upsertSourceItems } = require("../lib/catalog/source-item");
const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");

test("normalizeSourceItem lowercases hash and keeps source evidence", () => {
    const item = normalizeSourceItem({
        source: "nyaa",
        sourceItemId: "123",
        infoHash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        title: "Example - 01 [1080p]",
        magnetUrl: "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        raw: { trusted: true }
    }, 1000);

    assert.equal(item.info_hash, "abcdef0123456789abcdef0123456789abcdef01");
    assert.equal(item.source_item_id, "123");
    assert.equal(JSON.parse(item.raw_json).trusted, true);
});

test("upsertSourceItems writes rows idempotently", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const rows = upsertSourceItems(db, [
        {
            source: "animetosho",
            sourceItemId: "42",
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            title: "Example - 01",
            raw: {}
        }
    ], 2000);

    assert.equal(rows, 1);
    const stored = db.prepare("SELECT source, source_item_id, info_hash, title FROM source_items").get();
    assert.deepEqual(stored, {
        source: "animetosho",
        source_item_id: "42",
        info_hash: "abcdef0123456789abcdef0123456789abcdef01",
        title: "Example - 01"
    });
    db.close();
    closeCatalogDatabaseForTests();
});
