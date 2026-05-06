const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");
const { runIngestion } = require("../lib/catalog/ingest");
const { loadAnimeMap } = require("../lib/catalog/anime-map");

test("runIngestion stores only resolved rows and drops unmapped rows", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const animeMap = loadAnimeMap(path.join(__dirname, "fixtures", "catalog", "anime-map-mini.json"));

    const result = await runIngestion({
        db,
        animeMap,
        source: "all",
        mode: "test",
        metadataClients: {
            kitsuSearchAnime: async query => query === "Example Anime"
                ? [{ id: "265", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-04-03" } }]
                : [],
            tmdbSearch: async () => []
        },
        fetchItems: async () => [
            {
                source: "nyaa",
                sourceItemId: "nyaa-1",
                infoHash: "abcdef0123456789abcdef0123456789abcdef01",
                title: "[SubsPlease] Example Anime - 01 [1080p]",
                raw: {}
            },
            {
                source: "tokyotosho",
                sourceItemId: "tt-1",
                infoHash: "abcdef0123456789abcdef0123456789abcdef01",
                title: "Example Anime - 01",
                raw: {}
            },
            {
                source: "nyaa",
                sourceItemId: "nyaa-2",
                infoHash: "abcdef0123456789abcdef0123456789abcdef02",
                title: "Unknown Upload - 01",
                raw: {}
            }
        ],
        now: () => 3000
    });

    assert.equal(result.scanned, 3);
    assert.equal(result.upserted, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.droppedUnmapped, 1);
    assert.equal(result.duplicateSkipped, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM source_items").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM torrent_identities").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM dropped_source_items").get().count, 1);
    assert.equal(db.prepare("SELECT source FROM source_items").get().source, "nyaa");
    db.close();
    closeCatalogDatabaseForTests();
});
