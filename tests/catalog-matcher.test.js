const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadAnimeMap } = require("../lib/catalog/anime-map");
const { matchSourceItem } = require("../lib/catalog/matcher");

const fixturePath = path.join(__dirname, "fixtures", "catalog", "anime-map-mini.json");

test("matchSourceItem maps AnimeTosho AniDB aid to full stable provider bundle", () => {
    const animeMap = loadAnimeMap(fixturePath);
    const match = matchSourceItem({
        source: "animetosho",
        infoHash: "abcdef0123456789abcdef0123456789abcdef02",
        title: "[Group] Example Anime - 01 [1080p]",
        raw: { aid: "1", eid: "100" }
    }, animeMap);

    assert.equal(match.info_hash, "abcdef0123456789abcdef0123456789abcdef02");
    assert.equal(match.kitsu_id, "265");
    assert.equal(match.anilist_id, "290");
    assert.equal(match.anidb_id, "1");
    assert.equal(match.imdb_id, "tt0286390");
    assert.equal(match.confidence, 100);
    assert.equal(JSON.parse(match.evidence_json).includes("animetosho.aid=1"), true);
});

test("matchSourceItem returns null when no stable evidence exists", () => {
    const animeMap = loadAnimeMap(fixturePath);
    const match = matchSourceItem({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef04",
        title: "Unmapped Upload",
        raw: {}
    }, animeMap);

    assert.equal(match, null);
});

test("matchSourceItem does not map Nyaa by hash when AnimeTosho has a matching hash", () => {
    const animeMap = loadAnimeMap(fixturePath);
    const nyaaMatch = matchSourceItem({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef02",
        title: "[SubsPlease] Example Anime - 01 [1080p]",
        raw: {}
    }, animeMap);

    assert.equal(nyaaMatch, null);
});
