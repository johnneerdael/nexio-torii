const test = require("node:test");
const assert = require("node:assert/strict");

const {
    addStoreTorz,
    checkStoreTorz,
    checkStoreUser,
    generateStoreLink,
    mapTorzItem,
    normalizeStoreFile
} = require("../lib/debrid");

test("normalizeStoreFile maps StremThru file shape for Amatsu parser", () => {
    assert.deepEqual(normalizeStoreFile({
        index: 4,
        link: "stremthru://file",
        name: "Episode 01.mkv",
        path: "/Show/Episode 01.mkv",
        size: 123
    }), {
        id: 4,
        index: 4,
        link: "stremthru://file",
        name: "Episode 01.mkv",
        path: "/Show/Episode 01.mkv",
        size: 123
    });
});

test("mapTorzItem preserves cached status and empty Offcloud files", () => {
    assert.deepEqual(mapTorzItem({
        hash: "ABC",
        status: "cached",
        files: []
    }), {
        hash: "abc",
        status: "cached",
        isCached: true,
        files: []
    });
});

test("checkStoreTorz chunks hashes and sends StremThru store headers", async () => {
    const calls = [];
    const http = {
        get: async (url, options) => {
            calls.push({ url, options });
            return {
                data: {
                    data: {
                        items: [
                            {
                                hash: "ABC",
                                status: "cached",
                                files: [{ index: 1, link: "locked-link", name: "Video.mkv", size: 10 }]
                            }
                        ]
                    }
                }
            };
        }
    };

    const result = await checkStoreTorz(["ABC"], { service: "premiumize", apiKey: "pm-key" }, { http, cache: false });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://stremthru.13377001.xyz/v0/store/torz/check?hash=ABC");
    assert.equal(calls[0].options.headers["X-StremThru-Store-Name"], "premiumize");
    assert.equal(calls[0].options.headers["X-StremThru-Store-Authorization"], "Bearer pm-key");
    assert.equal(result.abc.files[0].link, "locked-link");
});

test("addStoreTorz posts magnet through StremThru", async () => {
    const calls = [];
    const http = {
        post: async (url, body, options) => {
            calls.push({ url, body, options });
            return { data: { data: { hash: "abc", status: "queued", files: [] } } };
        }
    };

    const result = await addStoreTorz("magnet:?xt=urn:btih:abc", { service: "alldebrid", apiKey: "ad-key" }, { http });

    assert.equal(calls[0].url, "https://stremthru.13377001.xyz/v0/store/torz");
    assert.deepEqual(calls[0].body, { link: "magnet:?xt=urn:btih:abc" });
    assert.equal(result.status, "queued");
});

test("generateStoreLink returns direct link from StremThru", async () => {
    const http = {
        post: async () => ({ data: { data: { link: "https://cdn.example/video.mkv" } } })
    };

    const link = await generateStoreLink("locked-link", { service: "debridlink", apiKey: "dl-key" }, { http });

    assert.equal(link, "https://cdn.example/video.mkv");
});

test("checkStoreUser returns user data", async () => {
    const http = {
        get: async () => ({ data: { data: { subscription_status: "premium" } } })
    };

    const user = await checkStoreUser({ service: "torbox", apiKey: "tb-key" }, { http });

    assert.deepEqual(user, { subscription_status: "premium" });
});
