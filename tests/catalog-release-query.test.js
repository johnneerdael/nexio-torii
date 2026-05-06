const test = require("node:test");
const assert = require("node:assert/strict");

const {
    classifyReleaseTitle,
    extractParentheticalAliases,
    extractSeasonHints,
    generateQueryTitles,
    stripSupportSuffixes
} = require("../lib/catalog/release-query");

test("classifyReleaseTitle detects support archive uploads", () => {
    const result = classifyReleaseTitle("[KOTEX] Kanpekisugite Kawaige ga Nai Subs+Fonts for ReinForce [BD].zip");

    assert.equal(result.isSupportUpload, true);
    assert.equal(result.dropReason, "support_upload");
});

test("classifyReleaseTitle does not reject normal mkv releases", () => {
    const result = classifyReleaseTitle("[SubsPlease] Ganbare! Nakamura-kun!! - 07 (1080p) [7A297C20].mkv");

    assert.equal(result.isSupportUpload, false);
    assert.equal(result.dropReason, null);
});

test("stripSupportSuffixes removes trailing subs fonts packaging text", () => {
    assert.equal(
        stripSupportSuffixes("Kanpekisugite Kawaige ga Nai to Konyaku Haki Sareta Seijo wa Ringoku ni Urareru Subs+Fonts for ReinForce"),
        "Kanpekisugite Kawaige ga Nai to Konyaku Haki Sareta Seijo wa Ringoku ni Urareru"
    );
});

test("extractParentheticalAliases returns useful aliases only", () => {
    const aliases = extractParentheticalAliases("Classroom of the Elite S04E02 Contract 1080p (Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season, Multi-Audio, Multi-Subs)");

    assert.deepEqual(aliases, ["Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season"]);
});

test("extractSeasonHints preserves season context", () => {
    assert.deepEqual(extractSeasonHints("Classroom of the Elite S04E02 Contract and Payment"), ["4th Season"]);
    assert.deepEqual(extractSeasonHints("The Beginning After the End 2nd Season - 06"), ["2nd Season"]);
});

test("generateQueryTitles builds deduped title variants for Classroom season four", () => {
    const variants = generateQueryTitles({
        rawTitle: "[T3KASHi] Classroom of the Elite Second Year First Semester S04E01 MULTi 1080p",
        parsedTitle: "Classroom of the Elite Second Year First Semester",
        aliases: [],
        seasonHints: ["4th Season"]
    });

    assert.deepEqual(variants.slice(0, 3), [
        "Classroom of the Elite 4th Season Second Year First Semester",
        "Classroom of the Elite Second Year First Semester",
        "Classroom of the Elite 4th Season"
    ]);
});

test("generateQueryTitles prefers parenthetical English alias for mixed JP English title", () => {
    const variants = generateQueryTitles({
        rawTitle: "[Judas] Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End) - S02E06",
        parsedTitle: "Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End)",
        aliases: ["The Beginning After the End"],
        seasonHints: ["2nd Season"]
    });

    assert.equal(variants[0], "The Beginning After the End 2nd Season");
    assert.ok(variants.includes("The Beginning After the End"));
});
