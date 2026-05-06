const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildStreamCacheControl,
    shouldApplyStreamCache
} = require("../lib/cache/http-cache");

test("buildStreamCacheControl includes CDN stale directives", () => {
    assert.equal(
        buildStreamCacheControl({
            maxAge: 10,
            sMaxAge: 20,
            staleWhileRevalidate: 30,
            staleIfError: 40
        }),
        "public, max-age=10, s-maxage=20, stale-while-revalidate=30, stale-if-error=40"
    );
});

test("shouldApplyStreamCache matches addon stream and manifest paths", () => {
    assert.equal(shouldApplyStreamCache("/stream/anime/anilist:20-1.json"), true);
    assert.equal(shouldApplyStreamCache("/manifest.json"), true);
    assert.equal(shouldApplyStreamCache("/configure"), true);
    assert.equal(shouldApplyStreamCache("/resolve/payload/0/hash/1"), false);
    assert.equal(shouldApplyStreamCache("/sub/payload/0/hash/1"), false);
});
