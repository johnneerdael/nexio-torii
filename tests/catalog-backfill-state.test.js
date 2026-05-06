const test = require("node:test");
const assert = require("node:assert/strict");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");
const {
    isBackfillComplete,
    markBackfillComplete,
    markBackfillFailed,
    readBackfillState
} = require("../lib/catalog/backfill-state");

test("backfill state starts incomplete", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });

    assert.equal(isBackfillComplete(db), false);
    assert.equal(readBackfillState(db), null);

    db.close();
    closeCatalogDatabaseForTests();
});

test("markBackfillComplete persists completion details", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });

    markBackfillComplete(db, {
        startedAt: 1000,
        finishedAt: 2000,
        summary: { nyaa: { scanned: 10 }, animetosho: { scanned: 20 }, tokyotosho: { scanned: 5 } }
    });

    const state = readBackfillState(db);
    assert.equal(isBackfillComplete(db), true);
    assert.equal(state.status, "complete");
    assert.equal(state.started_at, 1000);
    assert.equal(state.finished_at, 2000);
    assert.deepEqual(JSON.parse(state.summary_json).animetosho, { scanned: 20 });

    db.close();
    closeCatalogDatabaseForTests();
});

test("markBackfillFailed records retryable failure", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });

    markBackfillFailed(db, {
        startedAt: 1000,
        finishedAt: 1500,
        error: "tokyotosho timeout",
        summary: { nyaa: { scanned: 10 } }
    });

    const state = readBackfillState(db);
    assert.equal(isBackfillComplete(db), false);
    assert.equal(state.status, "failed");
    assert.equal(state.error, "tokyotosho timeout");

    db.close();
    closeCatalogDatabaseForTests();
});
