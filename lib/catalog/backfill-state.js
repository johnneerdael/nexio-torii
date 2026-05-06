function readBackfillState(db) {
    return db.prepare("SELECT * FROM catalog_backfill_state WHERE id = 1").get() || null;
}

function isBackfillComplete(db) {
    return readBackfillState(db)?.status === "complete";
}

function upsertBackfillState(db, row) {
    db.prepare(`
        INSERT INTO catalog_backfill_state (
            id, status, started_at, finished_at, error, summary_json, updated_at
        ) VALUES (
            1, @status, @started_at, @finished_at, @error, @summary_json, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            error = excluded.error,
            summary_json = excluded.summary_json,
            updated_at = excluded.updated_at
    `).run(row);
}

function markBackfillComplete(db, options) {
    upsertBackfillState(db, {
        status: "complete",
        started_at: options.startedAt,
        finished_at: options.finishedAt,
        error: null,
        summary_json: JSON.stringify(options.summary || {}),
        updated_at: options.finishedAt
    });
}

function markBackfillFailed(db, options) {
    upsertBackfillState(db, {
        status: "failed",
        started_at: options.startedAt,
        finished_at: options.finishedAt,
        error: options.error || "unknown backfill failure",
        summary_json: JSON.stringify(options.summary || {}),
        updated_at: options.finishedAt
    });
}

module.exports = {
    isBackfillComplete,
    markBackfillComplete,
    markBackfillFailed,
    readBackfillState
};
