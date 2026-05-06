const { upsertSourceItems } = require("./source-item");
const { upsertIdentityMatches } = require("./matcher");
const { createMetadataClients } = require("./metadata-clients");
const { parseReleaseTitle } = require("./release-parser");
const { createStableIdResolver } = require("./stable-id-resolver");
const { sourcePriority } = require("./source-item");

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
            dropped_unmapped = @dropped_unmapped,
            duplicate_skipped = @duplicate_skipped,
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

function pickCanonicalByHash(resolvedItems) {
    const byHash = new Map();
    let duplicateSkipped = 0;
    for (const item of resolvedItems) {
        const current = byHash.get(item.infoHash || item.info_hash);
        if (!current || item.sourcePriority >= current.sourcePriority) {
            if (current) duplicateSkipped += 1;
            byHash.set(item.infoHash || item.info_hash, item);
        } else {
            duplicateSkipped += 1;
        }
    }
    return { items: [...byHash.values()], duplicateSkipped };
}

function upsertDroppedItems(db, dropped, now) {
    const rows = dropped.map(entry => ({
        source: entry.item.source,
        source_item_id: entry.item.sourceItemId || entry.item.source_item_id || entry.item.infoHash || entry.item.info_hash,
        info_hash: entry.item.infoHash || entry.item.info_hash,
        title: entry.item.title || "",
        reason: entry.reason,
        parsed_json: JSON.stringify(entry.parsed || {}),
        raw_json: JSON.stringify(entry.item.raw || {}),
        first_seen_at: now,
        last_seen_at: now
    })).filter(row => row.info_hash && row.title);
    const statement = db.prepare(`
        INSERT INTO dropped_source_items (
            source, source_item_id, info_hash, title, reason, parsed_json, raw_json, first_seen_at, last_seen_at
        ) VALUES (
            @source, @source_item_id, @info_hash, @title, @reason, @parsed_json, @raw_json, @first_seen_at, @last_seen_at
        )
        ON CONFLICT(source, source_item_id) DO UPDATE SET
            info_hash = excluded.info_hash,
            title = excluded.title,
            reason = excluded.reason,
            parsed_json = excluded.parsed_json,
            raw_json = excluded.raw_json,
            last_seen_at = excluded.last_seen_at
    `);
    db.transaction(batch => batch.forEach(row => statement.run(row)))(rows);
    return rows.length;
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
        const resolver = createStableIdResolver({
            db,
            animeMap,
            metadataClients: options.metadataClients || createMetadataClients(),
            now
        });
        const resolved = [];
        const dropped = [];

        for (const item of items) {
            const parsed = await parseReleaseTitle(item.title);
            const result = await resolver.resolve(item, parsed);
            if (result.status === "accepted") {
                resolved.push({
                    ...item,
                    stableProvider: result.identity.stable_provider,
                    stableId: result.identity.stable_id,
                    sourcePriority: sourcePriority(item.source),
                    parsed,
                    identity: result.identity
                });
            } else {
                dropped.push({ item, parsed, reason: result.reason });
            }
        }

        const canonical = pickCanonicalByHash(resolved);
        const upserted = upsertSourceItems(db, canonical.items, startedAt);
        const matched = upsertIdentityMatches(db, canonical.items.map(item => item.identity));
        const droppedUnmapped = upsertDroppedItems(db, dropped, startedAt);
        const finishedAt = now();
        finishRun(db, runId, {
            finished_at: finishedAt,
            scanned: items.length,
            upserted,
            matched,
            dropped_unmapped: droppedUnmapped,
            duplicate_skipped: canonical.duplicateSkipped,
            failed: 0,
            status: "ok",
            error: null
        });
        updateCheckpoint(db, source, options.cursor || null, null, finishedAt);
        return { source, mode, scanned: items.length, upserted, matched, failed: 0, droppedUnmapped, duplicateSkipped: canonical.duplicateSkipped };
    } catch (error) {
        const finishedAt = now();
        finishRun(db, runId, {
            finished_at: finishedAt,
            scanned: 0,
            upserted: 0,
            matched: 0,
            dropped_unmapped: 0,
            duplicate_skipped: 0,
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
