const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildMagnet,
    resolveStorePlayback,
    resolveStoreSubtitle
} = require("../lib/playback");

test("buildMagnet includes hash, title, and trackers", () => {
    const magnet = buildMagnet("ABC", "Example Title", [
        "udp://tracker.example:1337/announce"
    ]);

    assert.equal(
        magnet,
        "magnet:?xt=urn:btih:ABC&dn=Example%20Title&tr=udp%3A%2F%2Ftracker.example%3A1337%2Fannounce"
    );
});

test("resolveStorePlayback returns loading for pending status", async () => {
    const action = await resolveStorePlayback({
        entry: { service: "premiumize", apiKey: "pm-key" },
        hash: "ABC",
        episode: 1,
        title: "Example",
        addStoreTorz: async () => ({ status: "queued", files: [] }),
        generateStoreLink: async () => "not-called",
        selectBestVideoFile: () => null
    });

    assert.deepEqual(action, { type: "loading" });
});

test("resolveStorePlayback generates redirect for cached selected file", async () => {
    const action = await resolveStorePlayback({
        entry: { service: "realdebrid", apiKey: "rd-key" },
        hash: "ABC",
        episode: 1,
        title: "Example",
        addStoreTorz: async () => ({
            status: "cached",
            files: [{ id: 2, link: "locked-video", name: "Example - 01.mkv", size: 1 }]
        }),
        generateStoreLink: async link => {
            assert.equal(link, "locked-video");
            return "https://cdn.example/video.mkv";
        },
        selectBestVideoFile: files => files[0]
    });

    assert.deepEqual(action, { type: "redirect", url: "https://cdn.example/video.mkv" });
});

test("resolveStorePlayback returns archive when cached torrent has no matching file", async () => {
    const action = await resolveStorePlayback({
        entry: { service: "torbox", apiKey: "tb-key" },
        hash: "ABC",
        episode: 3,
        title: "Example",
        addStoreTorz: async () => ({
            status: "cached",
            files: [{ id: 2, link: "locked-video", name: "Example - 01.mkv", size: 1 }]
        }),
        generateStoreLink: async () => "not-called",
        selectBestVideoFile: () => null
    });

    assert.deepEqual(action, { type: "archive" });
});

test("resolveStoreSubtitle generates a direct subtitle link", async () => {
    const action = await resolveStoreSubtitle({
        entry: { service: "alldebrid", apiKey: "ad-key" },
        hash: "ABC",
        fileId: "4",
        title: "Example",
        addStoreTorz: async () => ({
            status: "cached",
            files: [
                { id: 4, link: "locked-sub", name: "Example.en.srt", size: 1 }
            ]
        }),
        generateStoreLink: async link => {
            assert.equal(link, "locked-sub");
            return "https://cdn.example/sub.srt";
        }
    });

    assert.deepEqual(action, {
        type: "redirect",
        url: "https://cdn.example/sub.srt",
        fileName: "Example.en.srt"
    });
});
