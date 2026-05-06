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

test("parseReleaseTitle flags support uploads before metadata lookup", async () => {
    const parsed = await parseReleaseTitle("[KOTEX] Kanpekisugite Kawaige ga Nai Subs+Fonts for ReinForce [BD].zip");

    assert.equal(parsed.isSupportUpload, true);
    assert.equal(parsed.dropReason, "support_upload");
    assert.deepEqual(parsed.queryTitles, []);
});

test("parseReleaseTitle adds query variants from aliases and season hints", async () => {
    const parsed = await parseReleaseTitle("[Judas] Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End) - S02E06 [1080p]");

    assert.equal(parsed.isSupportUpload, false);
    assert.deepEqual(parsed.aliases, ["The Beginning After the End"]);
    assert.deepEqual(parsed.seasonHints, ["2nd Season"]);
    assert.equal(parsed.queryTitles[0], "The Beginning After the End 2nd Season");
    assert.ok(parsed.queryTitles.includes("The Beginning After the End"));
});

test("parseReleaseTitle rejects numeric-only parsed titles", async () => {
    const parsed = await parseReleaseTitle("1");

    assert.equal(parsed.dropReason, "invalid_parsed_title");
    assert.deepEqual(parsed.queryTitles, []);
});
