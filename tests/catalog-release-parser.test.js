const test = require("node:test");
const assert = require("node:assert/strict");

const { parseReleaseTitle } = require("../lib/catalog/release-parser");

test("parseReleaseTitle extracts anime title and episode", async () => {
    const parsed = await parseReleaseTitle("[SubsPlease] One Piece - 1100 (1080p) [ABCDEF12].mkv");

    assert.equal(parsed.normalizedTitle, "onepiece");
    assert.equal(parsed.title, "One Piece");
    assert.deepEqual(parsed.episodes, [1100]);
    assert.equal(parsed.resolution, "1080p");
    assert.equal(parsed.releaseGroup, "SubsPlease");
});

test("parseReleaseTitle handles season episode releases", async () => {
    const parsed = await parseReleaseTitle("[Erai-raws] Frieren - Beyond Journey's End - S01E28 [1080p].mkv");

    assert.equal(parsed.normalizedTitle, "frierenbeyondjourneysend");
    assert.deepEqual(parsed.seasons, [1]);
    assert.deepEqual(parsed.episodes, [28]);
});

test("parseReleaseTitle returns null title for blank input", async () => {
    const parsed = await parseReleaseTitle("");

    assert.equal(parsed.title, null);
    assert.deepEqual(parsed.episodes, []);
});
