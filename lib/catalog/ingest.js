const { upsertSourceItems } = require("./source-item");
const { matchSourceItem, upsertIdentityMatches } = require("./matcher");

function startRun(db, source, mode, now) {
    const result = db.prepare(`
        INSERT INTO ingestion_runs (source, mode, started_at)
        VALUES (?, ?, ?)
    `).run(source, mode, now);
    return result.lastInsertRowid;
}

function finishRun(db, id, patch) {
    db.prepare(`
        UPDATE ingestion_runs
        SET finished_at = @finished_at,
            scanned = @scanned,
            upserted = @upserted,
            matched = @matched,
            failed = @failed,
            status = @status,
            error = @error
        WHERE id = @id
    `).run({ id, ...patch });
}

function updateCheckpoint(db, source, cursor, error, now) {
    db.prepare(`
        INSERT INTO ingestion_checkpoints (source, cursor, last_success_at, last_error, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
            cursor = excluded.cursor,
            last_success_at = excluded.last_success_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
    `).run(source, cursor || null, error ? null : now, error || null, now);
}

async function runIngestion(options) {
    const db = options.db;
    const animeMap = options.animeMap;
    const source = options.source;
    const mode = options.mode || "daily";
    const now = options.now || Date.now;
    const startedAt = now();
    const runId = startRun(db, source, mode, startedAt);

    try {
        const items = await options.fetchItems();
        const upserted = upsertSourceItems(db, items, startedAt);
        const matches = items.map(item => matchSourceItem(item, animeMap, startedAt)).filter(Boolean);
        const matched = upsertIdentityMatches(db, matches);
        const finishedAt = now();
        finishRun(db, runId, {
            finished_at: finishedAt,
            scanned: items.length,
            upserted,
            matched,
            failed: 0,
            status: "ok",
            error: null
        });
        updateCheckpoint(db, source, options.cursor || null, null, finishedAt);
        return { source, mode, scanned: items.length, upserted, matched, failed: 0 };
    } catch (error) {
        const finishedAt = now();
        finishRun(db, runId, {
            finished_at: finishedAt,
            scanned: 0,
            upserted: 0,
            matched: 0,
            failed: 1,
            status: "failed",
            error: error.message
        });
        updateCheckpoint(db, source, options.cursor || null, error.message, finishedAt);
        throw error;
    }
}

module.exports = {
    runIngestion
};
