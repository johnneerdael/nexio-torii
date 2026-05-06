const test = require("node:test");
const assert = require("node:assert/strict");

const {
    collectPagedBackfill,
    fetchAnimeToshoBackfill,
    fetchNyaaBackfill,
    fetchTokyoToshoBackfill
} = require("../lib/catalog/source/backfill");

test("collectPagedBackfill stops at empty page", async () => {
    const calls = [];
    const items = await collectPagedBackfill({
        maxPages: 5,
        fetchPage: async page => {
            calls.push(page);
            if (page === 1) return [{ id: 1 }];
            if (page === 2) return [{ id: 2 }];
            return [];
        },
        sleep: async () => {}
    });

    assert.deepEqual(calls, [1, 2, 3]);
    assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
});

test("collectPagedBackfill honors maxPages", async () => {
    const items = await collectPagedBackfill({
        maxPages: 2,
        fetchPage: async page => [{ id: page }],
        sleep: async () => {}
    });

    assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
});

test("fetchNyaaBackfill paginates Nyaa listing pages", async () => {
    const pages = [];
    const source = {
        fetchListingPage: async page => {
            pages.push(page);
            return page < 3 ? [{ sourceItemId: `nyaa-${page}` }] : [];
        }
    };

    const items = await fetchNyaaBackfill({ source, maxPages: 10, pageDelayMs: 0 });

    assert.deepEqual(pages, [1, 2, 3]);
    assert.deepEqual(items.map(item => item.sourceItemId), ["nyaa-1", "nyaa-2"]);
});

test("fetchTokyoToshoBackfill keeps failures opportunistic after first successful page", async () => {
    const pages = [];
    const source = {
        fetchListingPage: async page => {
            pages.push(page);
            if (page === 1) return [{ sourceItemId: "tokyo-1" }];
            throw new Error("522");
        }
    };

    const items = await fetchTokyoToshoBackfill({ source, maxPages: 10, pageDelayMs: 0 });

    assert.deepEqual(pages, [1, 2]);
    assert.deepEqual(items.map(item => item.sourceItemId), ["tokyo-1"]);
});

test("fetchAnimeToshoBackfill prefers TSV export when configured", async () => {
    const source = {
        fetchTorrentsTsv: async options => [{ sourceItemId: options.url }],
        fetchJsonFeed: async () => {
            throw new Error("json feed should not be used");
        }
    };

    const items = await fetchAnimeToshoBackfill({ source, animeToshoTsvUrl: "https://example.test/export.tsv" });

    assert.deepEqual(items, [{ sourceItemId: "https://example.test/export.tsv" }]);
});

test("fetchAnimeToshoBackfill falls back to JSON feed without TSV URL", async () => {
    const source = {
        fetchTorrentsTsv: async () => {
            throw new Error("tsv should not be used");
        },
        fetchJsonFeed: async () => [{ sourceItemId: "json-1" }]
    };

    const items = await fetchAnimeToshoBackfill({ source });

    assert.deepEqual(items, [{ sourceItemId: "json-1" }]);
});
