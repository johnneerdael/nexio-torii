const test = require("node:test");
const assert = require("node:assert/strict");

const nyaa = require("../lib/catalog/source/nyaa");
const animetosho = require("../lib/catalog/source/animetosho");
const tokyotosho = require("../lib/catalog/source/tokyotosho");

const live = process.env.LIVE_CATALOG_TESTS === "1";

test("LIVE nyaa returns at least one anime source item", { skip: live ? false : "set LIVE_CATALOG_TESTS=1" }, async () => {
    const rows = await nyaa.fetchListingPage(1, "1_0", { timeoutMs: 10000 });
    assert.ok(rows.length > 0);
    assert.equal(rows.every(row => row.source === "nyaa"), true);
    assert.equal(rows.some(row => /^[a-f0-9]{40}$/.test(row.infoHash)), true);
});

test("LIVE animetosho json feed returns at least one source item", { skip: live ? false : "set LIVE_CATALOG_TESTS=1" }, async () => {
    const rows = await animetosho.fetchJsonFeed({ timeoutMs: 10000 });
    assert.ok(rows.length > 0);
    assert.equal(rows.every(row => row.source === "animetosho"), true);
    assert.equal(rows.some(row => /^[a-f0-9]{40}$/.test(row.infoHash)), true);
});

test("LIVE tokyotosho rss returns at least one source item", { skip: live ? false : "set LIVE_CATALOG_TESTS=1" }, async () => {
    const rows = await tokyotosho.fetchRss({ timeoutMs: 20000 });
    assert.ok(rows.length > 0);
    assert.equal(rows.every(row => row.source === "tokyotosho"), true);
    assert.equal(rows.some(row => /^[a-f0-9]{40}$/.test(row.infoHash)), true);
});
