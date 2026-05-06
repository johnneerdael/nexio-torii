const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDebridStreams } = require("../lib/stream-builder");
const { encodeConfigPayload } = require("../lib/config");

const baseTorrent = {
    hash: "ABCDEF",
    title: "Example Show - 01 [1080p].mkv",
    size: "1.2 GB",
    seeders: "42"
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
        ...overrides
    };
}

test("buildDebridStreams emits cached and uncached streams for multiple services", () => {
    const input = baseInput();
    const streams = buildDebridStreams(input);

    assert.equal(streams.length, 2);
    assert.equal(streams[0].name, "TORII [⚡ RD]\n🎥 1080p");
    assert.equal(streams[0].url, "https://nexio-torii.example/resolve/" + input.nexioPayload + "/0/ABCDEF/1?title=Example%20Show%20-%2001%20%5B1080p%5D.mkv");
    assert.equal(streams[0].subtitles.length, 1);
    assert.equal(streams[1].name, "TORII [☁️ PM]\n🎥 1080p");
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
    assert.equal(streams[0].name, "TORII [⚡ RD]\n🎥 1080p");
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
