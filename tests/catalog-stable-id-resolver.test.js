const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");
const { loadAnimeMap } = require("../lib/catalog/anime-map");
const { createStableIdResolver } = require("../lib/catalog/stable-id-resolver");

const fixturePath = path.join(__dirname, "fixtures", "catalog", "anime-map-mini.json");

test("resolver maps AnimeTosho AniDB aid directly", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [],
            tmdbSearch: async () => []
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "animetosho",
        infoHash: "abcdef0123456789abcdef0123456789abcdef02",
        title: "[Group] Example Anime - 01 [1080p]",
        raw: { aid: "1" }
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: null, episodes: [1], seasons: [] });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.kitsu_id, "265");
    assert.equal(result.identity.confidence, 100);
    db.close();
    closeCatalogDatabaseForTests();
});

test("resolver maps Nyaa independently through Kitsu exact title evidence", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [
                { id: "265", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-04-03", subtype: "TV" } }
            ],
            tmdbSearch: async () => []
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef04",
        title: "[SubsPlease] Example Anime - 01 [1080p]",
        raw: {}
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: "1998", episodes: [1], seasons: [] });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.stable_provider, "kitsu");
    assert.equal(result.identity.stable_id, "265");
    assert.equal(result.identity.confidence, 90);
});

test("resolver drops ambiguous Kitsu search results", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [
                { id: "100", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-01-01" } },
                { id: "101", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-04-03" } }
            ],
            tmdbSearch: async () => []
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "tokyotosho",
        infoHash: "abcdef0123456789abcdef0123456789abcdef05",
        title: "Example Anime - 01",
        raw: {}
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: "1998", episodes: [1], seasons: [] });

    assert.equal(result.status, "dropped");
    assert.equal(result.reason, "ambiguous_stable_id");
});

test("resolver accepts TMDB fallback when Kitsu has no result", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [],
            tmdbSearch: async () => [
                { id: 26209, media_type: "tv", name: "Example Anime", original_name: "Example Anime", first_air_date: "1998-04-03" }
            ]
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef06",
        title: "Example Anime - 01",
        raw: {}
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: "1998", episodes: [1], seasons: [] });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.stable_provider, "kitsu");
    assert.equal(result.identity.kitsu_id, "265");
    assert.equal(result.identity.tmdb_id, "26209");
    assert.equal(result.identity.confidence, 88);
});
