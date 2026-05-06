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
        stableProvider: "kitsu",
        stableId: "265",
        parsed: { title: "Example", episodes: [1] },
        magnetUrl: "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        raw: { trusted: true }
    }, 1000);

    assert.equal(item.info_hash, "abcdef0123456789abcdef0123456789abcdef01");
    assert.equal(item.source_item_id, "123");
    assert.equal(item.stable_provider, "kitsu");
    assert.equal(item.stable_id, "265");
    assert.equal(JSON.parse(item.parsed_json).title, "Example");
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
            stableProvider: "kitsu",
            stableId: "265",
            raw: {}
        }
    ], 2000);

    assert.equal(rows, 1);
    const stored = db.prepare("SELECT source, source_item_id, info_hash, title, stable_provider, stable_id FROM source_items").get();
    assert.deepEqual(stored, {
        source: "animetosho",
        source_item_id: "42",
        info_hash: "abcdef0123456789abcdef0123456789abcdef01",
        title: "Example - 01",
        stable_provider: "kitsu",
        stable_id: "265"
    });
    db.close();
    closeCatalogDatabaseForTests();
});

test("upsertSourceItems keeps one row per hash using source priority", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const rows = upsertSourceItems(db, [
        {
            source: "tokyotosho",
            sourceItemId: "tt-42",
            sourcePriority: 100,
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            title: "Example - 01 TokyoTosho",
            stableProvider: "kitsu",
            stableId: "265",
            parsed: { title: "Example", episodes: [1] },
            raw: {}
        },
        {
            source: "nyaa",
            sourceItemId: "nyaa-42",
            sourcePriority: 300,
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            title: "Example - 01 Nyaa",
            stableProvider: "kitsu",
            stableId: "265",
            parsed: { title: "Example", episodes: [1] },
            raw: {}
        }
    ], 2000);

    assert.equal(rows, 1);
    const stored = db.prepare("SELECT source, source_item_id, title, source_priority FROM source_items").get();
    assert.deepEqual(stored, {
        source: "nyaa",
        source_item_id: "nyaa-42",
        title: "Example - 01 Nyaa",
        source_priority: 300
    });
    db.close();
    closeCatalogDatabaseForTests();
});

test("normalizeSourceItem drops unresolved items", () => {
    const row = normalizeSourceItem({
        source: "nyaa",
        sourceItemId: "123",
        infoHash: "abcdef0123456789abcdef0123456789abcdef01",
        title: "Unresolved - 01",
        raw: {}
    }, 1000);

    assert.equal(row, null);
});
