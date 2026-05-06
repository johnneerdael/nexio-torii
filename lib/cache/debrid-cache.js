const { getDatabase } = require("./database");
const { checkStoreTorz } = require("../debrid");

function normalizeHash(hash) {
    return String(hash || "").trim().toLowerCase();
}

function normalizeScope(scope = {}) {
    return {
        season: parseInt(scope.season || 1, 10) || 1,
        episode: parseInt(scope.episode || 1, 10) || 1
    };
}

function getCachedAvailability(db, service, hashes, scope = {}, options = {}) {
    const normalized = normalizeScope(scope);
    const now = options.now || Date.now();
    const ttlMs = options.ttlMs || 24 * 60 * 60 * 1000;
    const cached = {};
    const missingHashes = [];

    const statement = db.prepare(`
        SELECT info_hash, status, is_cached, files_json
        FROM debrid_availability
        WHERE service = ?
        AND info_hash = ?
        AND season_norm = ?
        AND episode_norm = ?
        AND updated_at >= ?
    `);

    for (const hash of hashes.map(normalizeHash).filter(Boolean)) {
        const row = statement.get(service, hash, normalized.season, normalized.episode, now - ttlMs);
        if (!row) {
            missingHashes.push(hash);
            continue;
        }

        let files = [];
        try {
            files = JSON.parse(row.files_json || "[]");
        } catch (error) {
            files = [];
        }

        cached[hash] = {
            hash,
            status: row.status,
            isCached: Boolean(row.is_cached),
            files
        };
    }

    return { cached, missingHashes };
}

function upsertAvailability(db, service, availability, scope = {}, now = Date.now()) {
    const normalized = normalizeScope(scope);
    const rows = Object.entries(availability || {}).map(([hash, item]) => ({
        service,
        info_hash: normalizeHash(item.hash || hash),
        season_norm: normalized.season,
        episode_norm: normalized.episode,
        status: item.status || "unknown",
        is_cached: item.isCached ? 1 : 0,
        files_json: JSON.stringify(Array.isArray(item.files) ? item.files : []),
        updated_at: now
    })).filter(row => row.info_hash);

    const statement = db.prepare(`
        INSERT INTO debrid_availability (
            service, info_hash, season_norm, episode_norm, status, is_cached, files_json, updated_at
        )
        VALUES (
            @service, @info_hash, @season_norm, @episode_norm, @status, @is_cached, @files_json, @updated_at
        )
        ON CONFLICT(service, info_hash, season_norm, episode_norm) DO UPDATE SET
            status = excluded.status,
            is_cached = excluded.is_cached,
            files_json = excluded.files_json,
            updated_at = excluded.updated_at
    `);

    const write = db.transaction(items => {
        for (const row of items) statement.run(row);
    });

    write(rows);
    return rows.length;
}

async function checkStoreTorzWithCache(hashes, entry, options = {}) {
    const db = options.db || getDatabase();
    const service = entry.service;
    const scope = normalizeScope(options.scope);
    const ttlMs = options.ttlMs || Number(process.env.DEBRID_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
    const now = options.now || Date.now();
    const checker = options.checkStoreTorz || checkStoreTorz;
    const uniqueHashes = [...new Set((hashes || []).map(normalizeHash).filter(Boolean))];

    const { cached, missingHashes } = getCachedAvailability(db, service, uniqueHashes, scope, { now, ttlMs });
    if (missingHashes.length === 0) return cached;

    const fresh = await checker(missingHashes, entry, options.checkOptions || {});
    upsertAvailability(db, service, fresh, scope, now);

    return {
        ...cached,
        ...fresh
    };
}

module.exports = {
    checkStoreTorzWithCache,
    getCachedAvailability,
    normalizeScope,
    upsertAvailability
};
