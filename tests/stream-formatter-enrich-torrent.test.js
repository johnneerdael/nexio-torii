const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichTorrent } = require("../lib/stream-formatter/enrich-torrent");

const TORRENT = {
    title: "[SubsPlease] One Piece - 1100 [1080p][AAC].mkv",
    hash: "ABCDEF1234", size: "1.45 GiB", seeders: 152,
    source: "Nyaa.si", pubDate: "2024-08-04T12:00:00Z"
};
const CANONICAL = {
    name: "ONE PIECE", englishName: "ONE PIECE", altName: "One Piece",
    synonyms: [], format: "TV", year: 1999, episodes: 1100,
    epMeta: { 1100: { title: "Romance Dawn" } }, idMal: 21
};
const PARSED = {
    title: "One Piece", year: null, seasons: [], episodes: [1100],
    resolution: "1080p", quality: null, encode: null,
    visualTags: [], audioTags: ["AAC"], audioChannels: [],
    languages: [], subtitles: [], releaseGroup: "SubsPlease"
};
const DEBRID = {
    serviceCode: "RD", isCached: true,
    selectedFile: { name: "One Piece - 1100.mkv", sizeBytes: 1500000000, index: 0 }
};
const MATCH = { score: 150, confidence: "HIGH", reasons: ["title=100 exact_title year_match"] };

test("enrichTorrent merges torrent + parsed + canonical + debrid + match", () => {
    const out = enrichTorrent({
        torrent: TORRENT, parsed: PARSED, canonical: CANONICAL,
        debrid: DEBRID, match: MATCH, requestedEp: 1100, expectedSeason: 1, anilistId: "21"
    });
    assert.equal(out.source.rawTitle, TORRENT.title);
    assert.equal(out.source.infoHash, "abcdef1234");
    assert.equal(out.source.indexer, "Nyaa.si");
    assert.equal(out.source.seeders, 152);
    assert.ok(out.source.sizeBytes > 1.4e9);
    assert.ok(Number.isFinite(out.source.ageHours));
    assert.equal(out.parsed.releaseGroup, "SubsPlease");
    assert.equal(out.parsed.resolution, "1080p");
    assert.equal(out.canonical.englishTitle, "ONE PIECE");
    assert.equal(out.canonical.episodeTitle, "Romance Dawn");
    assert.equal(out.canonical.anilistId, "21");
    assert.equal(out.canonical.malId, "21");
    assert.equal(out.debrid.serviceCode, "RD");
    assert.equal(out.debrid.isCached, true);
    assert.equal(out.debrid.selectedFile.name, "One Piece - 1100.mkv");
    assert.equal(out.match.confidence, "HIGH");
});

test("enrichTorrent handles batch torrent with episodeRange", () => {
    const batchTorrent = { ...TORRENT, title: "[SubsPlease] One Piece (1090-1100) [1080p Batch].mkv" };
    const batchParsed = { ...PARSED, episodes: Array.from({ length: 11 }, (_, i) => 1090 + i), seasons: [], releaseGroup: "SubsPlease" };
    const out = enrichTorrent({
        torrent: batchTorrent, parsed: batchParsed, canonical: CANONICAL,
        debrid: { ...DEBRID, archiveLayout: { totalFiles: 11, mediaFiles: 11, isCompletePack: false } },
        match: MATCH, requestedEp: 1095, expectedSeason: 1, anilistId: "21"
    });
    assert.equal(out.parsed.isSeasonPack, true);
    assert.deepEqual(out.parsed.episodeRange, { first: 1090, last: 1100, total: 1100 });
});

test("enrichTorrent computes sizeBytes from human-readable sizes when present", () => {
    const out = enrichTorrent({
        torrent: { ...TORRENT, size: "750 MiB" }, parsed: PARSED, canonical: CANONICAL,
        debrid: DEBRID, match: MATCH, requestedEp: 1100, expectedSeason: 1, anilistId: "21"
    });
    assert.ok(out.source.sizeBytes > 700_000_000 && out.source.sizeBytes < 800_000_000);
});
