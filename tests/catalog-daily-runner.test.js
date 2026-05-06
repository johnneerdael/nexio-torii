const test = require("node:test");
const assert = require("node:assert/strict");

const { runCycle, resolveIntervalMs } = require("../lib/catalog/daily-runner");

test("runCycle refreshes the anime map before ingesting the catalog", async () => {
    const events = [];

    const result = await runCycle({
        refreshAnimeMap: async () => {
            events.push("refresh");
            return { refreshed: true, identityRecords: 2 };
        },
        ingestCatalog: async () => {
            events.push("ingest");
            return [{ source: "animetosho", matched: 2 }];
        },
        log: message => events.push(message)
    });

    assert.deepEqual(events.filter(event => event === "refresh" || event === "ingest"), ["refresh", "ingest"]);
    assert.equal(result.map.refreshed, true);
    assert.equal(result.ingestion[0].matched, 2);
});

test("runCycle fails before ingestion when no anime map can be generated or reused", async () => {
    const events = [];

    await assert.rejects(
        runCycle({
            refreshAnimeMap: async () => {
                throw new Error("no map");
            },
            ingestCatalog: async () => {
                events.push("ingest");
            },
            log: () => {}
        }),
        /no map/
    );

    assert.deepEqual(events, []);
});

test("resolveIntervalMs defaults to one day and accepts env override", () => {
    assert.equal(resolveIntervalMs({}), 24 * 60 * 60 * 1000);
    assert.equal(resolveIntervalMs({ CATALOG_DAILY_INTERVAL_MS: "1500" }), 1500);
    assert.equal(resolveIntervalMs({ CATALOG_DAILY_INTERVAL_MS: "0" }), 24 * 60 * 60 * 1000);
});
