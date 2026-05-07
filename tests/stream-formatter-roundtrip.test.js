const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { enrichTorrent, formatToriiStream } = require("../lib/stream-formatter");

const FIXTURE_PATH = "/Users/jneerdael/Scripts/nexio/docs/superpowers/specs/2026-05-07-fixtures/torii-cached-realdebrid.json";

test("torii emission matches fixture (structural assertions)", () => {
    if (!fs.existsSync(FIXTURE_PATH)) {
        console.warn("torii fixture not found, skipping cross-repo round-trip");
        return;
    }
    const f = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
    const torrent = { ...f.input.torrent, pubDate: new Date(Date.now() - 6 * 3600 * 1000).toISOString() };
    const enriched = enrichTorrent({
        torrent,
        parsed: f.input.parsed,
        canonical: f.input.canonical,
        debrid: f.input.debrid,
        match: f.input.match,
        requestedEp: f.input.requestedEp,
        expectedSeason: f.input.expectedSeason,
        anilistId: f.input.anilistId
    });
    const out = formatToriiStream(enriched, { url: "https://example/resolve", behaviorHints: {} });
    assert.ok(out.name.startsWith(f.emittedPatterns.nameStarts), `name should start with ${f.emittedPatterns.nameStarts}, got: ${out.name}`);
    for (const fragment of f.emittedPatterns.nameContains) {
        assert.ok(out.name.includes(fragment), `name missing fragment: ${fragment}`);
    }
    for (const fragment of f.emittedPatterns.descriptionContains) {
        assert.ok(out.description.includes(fragment), `description missing fragment: ${fragment}`);
    }
});
