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

test("runStartupBackfillIfNeeded skips when complete", async () => {
    const events = [];
    const { runStartupBackfillIfNeeded } = require("../lib/catalog/daily-runner");

    const result = await runStartupBackfillIfNeeded({
        isBackfillComplete: () => true,
        ingestBackfill: async () => events.push("backfill"),
        markBackfillComplete: () => events.push("complete"),
        markBackfillFailed: () => events.push("failed"),
        now: () => 1000,
        log: message => events.push(message)
    });

    assert.equal(result.skipped, true);
    assert.deepEqual(events, ["[CATALOG_RUNNER] startup_backfill skipped=true reason=complete"]);
});

test("runStartupBackfillIfNeeded runs and marks complete", async () => {
    const events = [];
    const { runStartupBackfillIfNeeded } = require("../lib/catalog/daily-runner");

    const result = await runStartupBackfillIfNeeded({
        isBackfillComplete: () => false,
        ingestBackfill: async () => {
            events.push("backfill");
            return { nyaa: { scanned: 2 } };
        },
        markBackfillComplete: payload => events.push(["complete", payload]),
        markBackfillFailed: payload => events.push(["failed", payload]),
        now: (() => {
            const values = [1000, 2000];
            return () => values.shift();
        })(),
        log: message => events.push(message)
    });

    assert.equal(result.skipped, false);
    assert.deepEqual(events[0], "[CATALOG_RUNNER] startup_backfill starting=true");
    assert.equal(events[1], "backfill");
    assert.equal(events[2][0], "complete");
    assert.deepEqual(events[2][1].summary, { nyaa: { scanned: 2 } });
});

test("runStartupBackfillIfNeeded marks failed and rethrows", async () => {
    const events = [];
    const { runStartupBackfillIfNeeded } = require("../lib/catalog/daily-runner");

    await assert.rejects(
        runStartupBackfillIfNeeded({
            isBackfillComplete: () => false,
            ingestBackfill: async () => {
                throw new Error("backfill failed");
            },
            markBackfillComplete: payload => events.push(["complete", payload]),
            markBackfillFailed: payload => events.push(["failed", payload]),
            now: (() => {
                const values = [1000, 2000];
                return () => values.shift();
            })(),
            log: message => events.push(message)
        }),
        /backfill failed/
    );

    assert.equal(events[0], "[CATALOG_RUNNER] startup_backfill starting=true");
    assert.equal(events[1][0], "failed");
    assert.equal(events[1][1].error, "backfill failed");
});
