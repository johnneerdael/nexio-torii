const test = require("node:test");
const assert = require("node:assert/strict");
const { humanSize, humanAge, languageFlag, cacheGlyph, packEpisodes } = require("../lib/stream-formatter/human-format");

test("humanSize formats bytes", () => {
    assert.equal(humanSize(0), "0 B");
    assert.equal(humanSize(1024), "1 KiB");
    assert.equal(humanSize(1536), "1.5 KiB");
    assert.equal(humanSize(1024 * 1024 * 1024), "1 GiB");
    assert.equal(humanSize(1024 * 1024 * 1024 * 1.45), "1.45 GiB");
    assert.equal(humanSize(null), null);
});

test("humanAge formats hours", () => {
    assert.equal(humanAge(1), "1h");
    assert.equal(humanAge(6), "6h");
    assert.equal(humanAge(48), "2d");
    assert.equal(humanAge(24 * 7), "7d");
    assert.equal(humanAge(24 * 30), "30d");
    assert.equal(humanAge(24 * 365), "1y");
    assert.equal(humanAge(null), null);
});

test("languageFlag maps", () => {
    assert.equal(languageFlag("ENG"), "🇬🇧");
    assert.equal(languageFlag("JPN"), "🇯🇵");
    assert.equal(languageFlag("MULTI"), "🌍");
    assert.equal(languageFlag(null), "🌐");
});

test("cacheGlyph picks correct icon", () => {
    assert.equal(cacheGlyph(true), "⚡");
    assert.equal(cacheGlyph(false), "☁️");
    assert.equal(cacheGlyph(null), "📡");
});

test("packEpisodes formats range", () => {
    assert.equal(packEpisodes({ first: 1, last: 1100, total: 1100 }), "1-1100/1100");
    assert.equal(packEpisodes({ first: 1, last: 12 }), "1-12");
    assert.equal(packEpisodes(null), null);
});
