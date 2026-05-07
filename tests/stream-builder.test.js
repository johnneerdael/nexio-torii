const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDebridStreams, buildP2PStream } = require("../lib/stream-builder");
const { encodeConfigPayload } = require("../lib/config");

const baseTorrent = {
    hash: "ABCDEF",
    title: "[Group] Example Show - 01 [1080p][AAC].mkv",
    size: "1.2 GB",
    seeders: "42",
    pubDate: new Date(Date.now() - 6 * 3600 * 1000).toISOString()
};

const CANONICAL = {
    anilistId: "21", idMal: 21, anidb: "69", kitsu: "12", imdb: "tt0388629",
    name: "Example Show", englishName: "Example Show", year: 2020, format: "TV",
    episodes: 12
};

function baseInput(overrides = {}) {
    const userConfig = {
        debridServices: [
            { service: "realdebrid", apiKey: "rd-key" },
            { service: "premiumize", apiKey: "pm-key" }
        ],
        hideUncached: false,
        language: ["ENG"]
    };
    return {
        torrents: [baseTorrent],
        availabilityByEntry: [
            {
                abcdef: {
                    status: "cached",
                    isCached: true,
                    files: [
                        { id: 0, index: 0, link: "video-link", name: "Example Show - 01 [1080p].mkv", path: "Example Show - 01 [1080p].mkv", size: 1200 },
                        { id: 1, index: 1, link: "sub-link", name: "Example Show - 01.eng.srt", path: "Example Show - 01.eng.srt", size: 10 }
                    ]
                }
            },
            {}
        ],
        userConfig,
        nexioPayload: encodeConfigPayload(userConfig),
        baseUrl: "https://nexio-torii.example",
        requestedEp: 1,
        expectedSeason: 1,
        isMovie: false,
        isRawSearch: false,
        flags: { ENG: "EN" },
        extractTags: () => ({ res: "1080p" }),
        extractLanguage: () => "ENG",
        parseSizeToBytes: () => 1200,
        selectBestVideoFile: files => files.find(file => file.name.endsWith(".mkv")),
        isEpisodeMatch: () => true,
        isSeasonBatch: () => false,
        canonical: { ...CANONICAL, anilistId: "21" },
        ...overrides
    };
}

test("buildDebridStreams emits cached and uncached streams for multiple services", () => {
    const input = baseInput();
    const streams = buildDebridStreams(input);

    assert.equal(streams.length, 2);
    assert.match(streams[0].name, /^1080p/);
    assert.match(streams[0].name, /⚡ RD/);
    assert.match(streams[0].name, /⛩ Torii/);
    assert.equal(streams[0].url, "https://nexio-torii.example/resolve/" + input.nexioPayload + "/0/ABCDEF/1?title=%5BGroup%5D%20Example%20Show%20-%2001%20%5B1080p%5D%5BAAC%5D.mkv");
    assert.equal(streams[0].subtitles.length, 1);
    assert.match(streams[0].description, /📄 Example Show - 01 \[1080p\]\.mkv/);
    assert.match(streams[0].description, /🎬 Example Show · 2020 · TV · 12ep/);
    assert.match(streams[0].description, /🆔 anilist:21/);
    assert.match(streams[1].name, /☁️ PM/);
    assert.equal(streams[1]._isCached, false);
});

test("buildDebridStreams honors hideUncached", () => {
    const input = baseInput({
        userConfig: {
            debridServices: [
                { service: "realdebrid", apiKey: "rd-key" },
                { service: "premiumize", apiKey: "pm-key" }
            ],
            hideUncached: true,
            language: ["ENG"]
        }
    });
    input.nexioPayload = encodeConfigPayload(input.userConfig);

    const streams = buildDebridStreams(input);

    assert.equal(streams.length, 1);
    assert.match(streams[0].name, /⚡ RD/);
});

test("buildDebridStreams skips Offcloud series cache without files", () => {
    const userConfig = {
        debridServices: [{ service: "offcloud", apiKey: "oc-key" }],
        hideUncached: true,
        language: ["ENG"]
    };

    const streams = buildDebridStreams(baseInput({
        userConfig,
        nexioPayload: encodeConfigPayload(userConfig),
        availabilityByEntry: [{ abcdef: { status: "cached", isCached: true, files: [] } }]
    }));

    assert.equal(streams.length, 0);
});

test("buildP2PStream emits a Stremio-shape P2P stream with infoHash + sources", () => {
    const stream = buildP2PStream({
        torrent: baseTorrent,
        parsed: { resolution: "1080p", quality: null, encode: null, visualTags: [], audioTags: ["AAC"], audioChannels: [], languages: ["ENG"], subtitles: [], releaseGroup: "Group", network: null, isSeasonPack: false, episodeRange: null, episodes: [] },
        canonical: { ...CANONICAL, anilistId: "21" },
        requestedEp: 1,
        expectedSeason: 1,
        anilistId: "21",
        streamLang: "ENG",
        seeders: 42,
        bytes: 1200,
        isBatch: false,
        isMovie: false
    });
    assert.equal(stream.infoHash, "ABCDEF");
    assert.equal(stream.url, undefined);
    assert.ok(Array.isArray(stream.sources));
    assert.match(stream.name, /📡 P2P/);
    assert.match(stream.name, /⛩ Torii/);
});
