const test = require("node:test");
const assert = require("node:assert/strict");
const { formatToriiStream } = require("../lib/stream-formatter/format-torrent");

const ENRICHED = {
    source: {
        rawTitle: "[SubsPlease] One Piece - 1100 [1080p][AAC].mkv",
        infoHash: "abcdef", sizeBytes: 1500000000, seeders: 152, leechers: null,
        indexer: "Nyaa.si", pubDate: "2024-08-04T12:00:00Z", ageHours: 6,
        fileExtension: "mkv", container: "mkv"
    },
    parsed: {
        title: "One Piece", year: null, seasons: [], episodes: [1100],
        isSeasonPack: false, episodeRange: null,
        resolution: "1080p", quality: "BluRay", encode: "HEVC",
        visualTags: ["DV", "HDR10"], audioTags: ["DTS"], audioChannels: ["5.1"],
        languages: ["JPN", "ENG"], subtitles: ["ENG"],
        releaseGroup: "SubsPlease", network: "Crunchyroll", edition: null
    },
    canonical: {
        anilistId: "21", malId: "21", anidbId: "69", kitsuId: "12", imdbId: "tt0388629",
        mainTitle: "ONE PIECE", englishTitle: "ONE PIECE", year: 1999, format: "TV",
        episodeCount: 1100, episodeTitle: "Romance Dawn", episodeAirDate: null,
        season: 1, episode: 1100, runtimeMinutes: 24
    },
    debrid: {
        serviceCode: "RD", isCached: true,
        selectedFile: { name: "One Piece - 1100.mkv", sizeBytes: 1500000000, index: 0 },
        archiveLayout: null
    },
    match: { score: 150, confidence: "HIGH", reasons: ["title=100", "year_match"] }
};

test("formatToriiStream emits Nexio-friendly name + description for cached debrid", () => {
    const out = formatToriiStream(ENRICHED, { url: "https://example/resolve", behaviorHints: {} });
    const nameLines = out.name.split("\n");
    assert.equal(nameLines.length, 3);
    assert.match(nameLines[0], /1080p · BluRay · HEVC/);
    assert.match(nameLines[1], /⚡ RD/);
    assert.match(nameLines[1], /🎙 JPN\+ENG/);
    assert.match(nameLines[1], /5\.1/);
    assert.match(nameLines[1], /📝 ENG/);
    assert.equal(nameLines[2], "⛩ Torii");

    const desc = out.description;
    assert.match(desc, /📄 .*One Piece.*1100/);
    assert.match(desc, /💾 1\.4 GiB · 👥 152 · 📅 \d+/);
    assert.match(desc, /📡 Nyaa\.si · SubsPlease · Crunchyroll/);
    assert.match(desc, /🎬 ONE PIECE · 1999 · TV · 1100ep/);
    assert.match(desc, /📺 S1E1100 · "Romance Dawn"/);
    assert.match(desc, /🎯 HIGH \(150\) · title=100 · year_match/);
    assert.match(desc, /🆔 anilist:21 · mal:21 · kitsu:12 · anidb:69 · imdb:tt0388629/);
});

test("formatToriiStream emits 📦 line for season pack", () => {
    const pack = {
        ...ENRICHED,
        parsed: { ...ENRICHED.parsed, isSeasonPack: true, episodeRange: { first: 1090, last: 1100, total: 1100 } },
        debrid: { ...ENRICHED.debrid, selectedFile: { name: "One Piece - 1095.mkv", sizeBytes: 800_000_000, index: 5 } },
        source: { ...ENRICHED.source, sizeBytes: 14_200_000_000 }
    };
    const out = formatToriiStream(pack, { url: "x", behaviorHints: {} });
    assert.match(out.description, /📦 13\.\d GiB/);
    assert.match(out.description, /1090-1100\/1100/);
});

test("formatToriiStream uses ☁️ for uncached and 📡 P2P for missing service", () => {
    const uncached = { ...ENRICHED, debrid: { ...ENRICHED.debrid, isCached: false } };
    const o1 = formatToriiStream(uncached, { url: "x", behaviorHints: {} });
    assert.match(o1.name, /☁️ RD/);

    const p2p = { ...ENRICHED, debrid: { serviceCode: null, isCached: null, selectedFile: null } };
    const o2 = formatToriiStream(p2p, { url: "magnet:?xt=...", behaviorHints: {} });
    assert.match(o2.name, /📡 P2P/);
});
