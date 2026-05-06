const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreCandidate } = require("../lib/normalizer/score");

//===============
// Synthetic canonical fixtures matching the canonical Wave-2-class false
// positives for torrent-side gating. Same anti-FP cases used in nagare.
//===============
const CANONICAL = {
    naruto:      { mainTitle: "NARUTO",                              englishTitle: "Naruto",                              synonyms: [], format: "TV",    year: 2002, episodeCount: 220 },
    aot:         { mainTitle: "Shingeki no Kyojin",                  englishTitle: "Attack on Titan",                     synonyms: [], format: "TV",    year: 2013, episodeCount: 25  },
    demonSlayer: { mainTitle: "Kimetsu no Yaiba",                    englishTitle: "Demon Slayer: Kimetsu no Yaiba",      synonyms: [], format: "TV",    year: 2019, episodeCount: 26  },
    fmaBhood:    { mainTitle: "Fullmetal Alchemist: Brotherhood",    englishTitle: "Fullmetal Alchemist: Brotherhood",    synonyms: ["Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST"], format: "TV", year: 2009, episodeCount: 64 },
    onePiece:    { mainTitle: "ONE PIECE",                           englishTitle: "ONE PIECE",                           synonyms: ["One Piece"], format: "TV", year: 1999, episodeCount: 1100 }
};

function fakeCandidate({ parsedTitle, year, formatHint = null, dub = null, episodes = [] }) {
    return { parsedTitle, year, episodes, seasons: [], formatHint, dub };
}

test("REJECTS FMA Brotherhood ↔ FMA 2003 release (year gate)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.fmaBhood,
        candidate: fakeCandidate({ parsedTitle: "Fullmetal Alchemist", year: 2003 })
    });
    assert.ok(result.gateFailures.length > 0, "should fail at least one gate");
    assert.ok(result.gateFailures.some(r => r.startsWith("year")), `expected year gate failure, got ${JSON.stringify(result.gateFailures)}`);
});

test("REJECTS One Piece TV ↔ One Piece Movie 14 (recap_tag + format gate)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.onePiece,
        candidate: fakeCandidate({ parsedTitle: "One Piece", year: 2017, formatHint: "MOVIE" })
    });
    assert.ok(result.gateFailures.length > 0);
    assert.ok(result.gateFailures.some(r => r.startsWith("format") || r.startsWith("short_release")));
});

test("REJECTS Demon Slayer ↔ Demon Slayer Recap Movie (recap_tag)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.demonSlayer,
        candidate: fakeCandidate({ parsedTitle: "Demon Slayer", year: 2024, formatHint: "RECAP" })
    });
    assert.ok(result.gateFailures.length > 0);
    assert.ok(result.gateFailures.some(r => r.startsWith("recap_tag") || r.startsWith("short_release")));
});

test("REJECTS Naruto ↔ catastrophic title drift (Spy x Family)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.naruto,
        candidate: fakeCandidate({ parsedTitle: "Spy x Family", year: 2022 })
    });
    assert.ok(result.gateFailures.some(r => r.startsWith("title_distance") || r.startsWith("year")));
});

test("REJECTS AOT ↔ Bleach: Sennen Kessen-hen (different show, no year info)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.aot,
        candidate: fakeCandidate({ parsedTitle: "Bleach Sennen Kessen-hen", year: null })
    });
    assert.ok(result.gateFailures.some(r => r.startsWith("title_distance")));
});

test("ACCEPTS proper Naruto release (year + title match)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.naruto,
        candidate: fakeCandidate({ parsedTitle: "Naruto", year: 2002, episodes: [1] })
    });
    assert.equal(result.gateFailures.length, 0, `unexpected gate failures: ${JSON.stringify(result.gateFailures)}`);
    assert.ok(result.score >= 100);
});

test("ACCEPTS proper AOT release (no year on torrent — passes year gate as inconclusive)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.aot,
        candidate: fakeCandidate({ parsedTitle: "Shingeki no Kyojin", year: null, episodes: [1] })
    });
    assert.equal(result.gateFailures.length, 0);
});

test("ACCEPTS One Piece TV release with no year and no format hint", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.onePiece,
        candidate: fakeCandidate({ parsedTitle: "One Piece", year: null, episodes: [377] })
    });
    assert.equal(result.gateFailures.length, 0);
});

test("ACCEPTS FMA Brotherhood proper release (year exact match)", () => {
    const result = scoreCandidate({
        canonical: CANONICAL.fmaBhood,
        candidate: fakeCandidate({ parsedTitle: "Fullmetal Alchemist Brotherhood", year: 2009, episodes: [1] })
    });
    assert.equal(result.gateFailures.length, 0);
    assert.ok(result.score >= 100);
});
