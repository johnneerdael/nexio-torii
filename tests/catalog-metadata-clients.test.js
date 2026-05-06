const test = require("node:test");
const assert = require("node:assert/strict");

const { createMetadataClients } = require("../lib/catalog/metadata-clients");

test("kitsuSearchAnime uses filter text and JSON API headers", async () => {
    const calls = [];
    const clients = createMetadataClients({
        http: {
            get: async (url, options) => {
                calls.push({ url, options });
                return { data: { data: [{ id: "265", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" } } }] } };
            }
        }
    });

    const results = await clients.kitsuSearchAnime("Example Anime");

    assert.equal(results[0].id, "265");
    assert.equal(calls[0].url, "https://kitsu.io/api/edge/anime");
    assert.equal(calls[0].options.params["filter[text]"], "Example Anime");
    assert.equal(calls[0].options.params["page[limit]"], 5);
    assert.equal(calls[0].options.headers.Accept, "application/vnd.api+json");
});

test("tmdbSearch uses TMDB_API_KEY and searches tv plus movie", async () => {
    const calls = [];
    const clients = createMetadataClients({
        tmdbApiKey: "test-key",
        http: {
            get: async (url, options) => {
                calls.push({ url, options });
                return { data: { results: [{ id: 123, name: "Example Anime", first_air_date: "1998-04-03" }] } };
            }
        }
    });

    const results = await clients.tmdbSearch("Example Anime");

    assert.equal(results.length, 2);
    assert.equal(calls[0].url, "https://api.themoviedb.org/3/search/tv");
    assert.equal(calls[1].url, "https://api.themoviedb.org/3/search/movie");
    assert.equal(calls[0].options.params.api_key, "test-key");
});

test("tmdbSearch returns empty results when no API key exists", async () => {
    const clients = createMetadataClients({
        tmdbApiKey: "",
        http: {
            get: async () => {
                throw new Error("network should not be called");
            }
        }
    });

    assert.deepEqual(await clients.tmdbSearch("Example Anime"), []);
});
