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

test("resolver accepts a single season-backed Kitsu candidate at score 90", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const calls = [];
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async query => {
                calls.push(query);
                return query.includes("4th Season")
                    ? [{ id: "49194", attributes: { canonicalTitle: "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season: 2-nensei-hen 1 Gakki", titles: { en: "Classroom of the Elite 4th Season Second Year First" }, startDate: "2026-01-01" } }]
                    : [];
            },
            tmdbSearch: async () => []
        },
        now: () => 5000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef07",
        title: "Classroom of the Elite Second Year First Semester S04E01",
        raw: {}
    }, {
        title: "Classroom of the Elite Second Year First Semester",
        normalizedTitle: "classroomoftheelitesecondyearfirstsemester",
        year: null,
        episodes: [1],
        seasons: [4],
        aliases: [],
        seasonHints: ["4th Season"],
        queryTitles: [
            "Classroom of the Elite 4th Season Second Year First Semester",
            "Classroom of the Elite Second Year First Semester"
        ]
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.kitsu_id, "49194");
    assert.equal(result.identity.confidence, 86);
    assert.deepEqual(calls, ["Classroom of the Elite 4th Season Second Year First Semester"]);
});

test("resolver uses parenthetical alias variants before dropping mixed-title releases", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const calls = [];
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async query => {
                calls.push(query);
                return query === "The Beginning After the End 2nd Season"
                    ? [{ id: "49983", attributes: { canonicalTitle: "The Beginning After the End Season 2", titles: { en: "The Beginning After the End Season 2", en_jp: "Saikyou no Ousama, Nidome no Jinsei wa Nani wo Suru? 2nd Season" }, startDate: "2026-01-01" } }]
                    : [];
            },
            tmdbSearch: async () => []
        },
        now: () => 5000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef08",
        title: "Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End) - S02E06",
        raw: {}
    }, {
        title: "Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End)",
        normalizedTitle: "saikyounoousamanidomenojinseiwananiosuruthebeginningaftertheend",
        year: null,
        episodes: [6],
        seasons: [2],
        aliases: ["The Beginning After the End"],
        seasonHints: ["2nd Season"],
        queryTitles: ["The Beginning After the End 2nd Season", "The Beginning After the End"]
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.kitsu_id, "49983");
    assert.equal(calls[0], "The Beginning After the End 2nd Season");
});

test("resolver writes candidate diagnostics for dropped rows", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [
                { id: "100", attributes: { canonicalTitle: "Example Anime", titles: { en: "Example Anime" }, startDate: "1998-01-01" } },
                { id: "101", attributes: { canonicalTitle: "Example Anime", titles: { en: "Example Anime" }, startDate: "1998-04-03" } }
            ],
            tmdbSearch: async () => []
        },
        now: () => 5000
    });

    await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef09",
        title: "Example Anime - 01",
        raw: {}
    }, {
        title: "Example Anime",
        normalizedTitle: "exampleanime",
        year: "1998",
        episodes: [1],
        seasons: [],
        aliases: [],
        seasonHints: [],
        queryTitles: ["Example Anime"]
    });

    const cache = db.prepare("SELECT query_json, candidate_json FROM identity_resolution_cache").get();
    assert.deepEqual(JSON.parse(cache.query_json), ["Example Anime"]);
    assert.equal(JSON.parse(cache.candidate_json).kitsu.length, 2);
});
