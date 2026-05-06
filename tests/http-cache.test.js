const test = require("node:test");
const assert = require("node:assert/strict");

const {
    applyHttpCacheHeaders,
    buildStreamCacheControl,
    checkEtagMatch,
    generateEtag,
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

test("shouldApplyStreamCache matches direct and configured addon paths", () => {
    assert.equal(shouldApplyStreamCache("/stream/anime/anilist:20-1.json"), true);
    assert.equal(shouldApplyStreamCache("/manifest.json"), true);
    assert.equal(shouldApplyStreamCache("/configure"), true);
    assert.equal(shouldApplyStreamCache("/%7B%22NexioTorii%22%3A%22abc%22%7D/stream/anime/anilist:20-1.json"), true);
    assert.equal(shouldApplyStreamCache("/%7B%22NexioTorii%22%3A%22abc%22%7D/manifest.json"), true);
    assert.equal(shouldApplyStreamCache("/resolve/payload/0/hash/1"), false);
    assert.equal(shouldApplyStreamCache("/sub/payload/0/hash/1"), false);
});

test("generateEtag is stable for equivalent JSON objects", () => {
    assert.equal(
        generateEtag({ streams: [{ name: "A", url: "https://example.test" }] }),
        generateEtag({ streams: [{ name: "A", url: "https://example.test" }] })
    );
    assert.notEqual(generateEtag({ streams: [] }), generateEtag({ streams: [{ name: "A" }] }));
});

test("checkEtagMatch accepts weak and strong matching etags", () => {
    const etag = generateEtag({ streams: [] });

    assert.equal(checkEtagMatch(etag, etag), true);
    assert.equal(checkEtagMatch(etag.replace("W/", ""), etag), true);
    assert.equal(checkEtagMatch("W/\"different\"", etag), false);
    assert.equal(checkEtagMatch("*", etag), true);
});

test("applyHttpCacheHeaders patches json to emit etag and 304", () => {
    const headers = {};
    let statusCode = 200;
    let ended = false;
    let sentBody = null;
    const body = { streams: [] };
    const etag = generateEtag(body);
    const req = {
        method: "GET",
        path: "/%7B%22NexioTorii%22%3A%22abc%22%7D/stream/anime/anilist:20-1.json",
        headers: { "if-none-match": etag }
    };
    const res = {
        setHeader: (name, value) => { headers[name] = value; },
        getHeader: name => headers[name],
        status: code => {
            statusCode = code;
            return res;
        },
        end: () => {
            ended = true;
            return res;
        },
        json: value => {
            sentBody = value;
            return res;
        }
    };

    applyHttpCacheHeaders(req, res, () => {});
    res.json(body);

    assert.equal(statusCode, 304);
    assert.equal(ended, true);
    assert.equal(sentBody, null);
    assert.equal(headers.ETag, etag);
    assert.equal(headers["Cache-Control"].includes("stale-while-revalidate"), true);
});

test("applyHttpCacheHeaders patches send for sdk router responses", () => {
    const headers = {};
    let statusCode = 200;
    let ended = false;
    let sentBody = null;
    const body = JSON.stringify({ streams: [] });
    const etag = generateEtag(body);
    const req = {
        method: "GET",
        path: "/%7B%22NexioTorii%22%3A%22abc%22%7D/stream/anime/anilist:20-1.json",
        headers: { "if-none-match": etag }
    };
    const res = {
        setHeader: (name, value) => { headers[name] = value; },
        getHeader: name => headers[name],
        status: code => {
            statusCode = code;
            return res;
        },
        end: () => {
            ended = true;
            return res;
        },
        send: value => {
            sentBody = value;
            return res;
        },
        json: value => {
            sentBody = value;
            return res;
        }
    };

    applyHttpCacheHeaders(req, res, () => {});
    res.send(body);

    assert.equal(statusCode, 304);
    assert.equal(ended, true);
    assert.equal(sentBody, null);
    assert.equal(headers.ETag, etag);
    assert.equal(headers["Cache-Control"].includes("stale-while-revalidate"), true);
});
