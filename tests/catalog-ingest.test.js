const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");
const { runIngestion } = require("../lib/catalog/ingest");
const { loadAnimeMap } = require("../lib/catalog/anime-map");

test("runIngestion stores source rows and stable identity matches", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const animeMap = loadAnimeMap(path.join(__dirname, "fixtures", "catalog", "anime-map-mini.json"));

    const result = await runIngestion({
        db,
        animeMap,
        source: "animetosho",
        mode: "test",
        fetchItems: async () => [
            {
                source: "animetosho",
                sourceItemId: "77",
                infoHash: "abcdef0123456789abcdef0123456789abcdef02",
                title: "[Group] Example Anime - 01 [1080p]",
                raw: { aid: "1", eid: "100" }
            }
        ],
        now: () => 3000
    });

    assert.equal(result.scanned, 1);
    assert.equal(result.upserted, 1);
    assert.equal(result.matched, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM source_items").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM torrent_identities").get().count, 1);
    db.close();
    closeCatalogDatabaseForTests();
});
