const test = require("node:test");
const assert = require("node:assert/strict");

const { cleanTitle, normalizeTitle, titleTokens } = require("../lib/catalog/title-normalizer");

test("normalizeTitle removes punctuation, diacritics, case, and ampersand drift", () => {
    assert.equal(normalizeTitle("Frieren: Beyond Journey's End"), "frierenbeyondjourneysend");
    assert.equal(normalizeTitle("Bocchi & The Rock!"), "bocchiandtherock");
    assert.equal(normalizeTitle("Pokémon Horizons"), "pokemonhorizons");
});

test("cleanTitle keeps searchable spaces", () => {
    assert.equal(cleanTitle("[SubsPlease] One Piece - 1100 (1080p)"), "subsplease one piece 1100 1080p");
});

test("titleTokens drops empty tokens", () => {
    assert.deepEqual(titleTokens("One Piece: Egghead Arc"), ["one", "piece", "egghead", "arc"]);
});
