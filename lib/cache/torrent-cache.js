function normalizeHash(hash) {
    return String(hash || "").trim().toLowerCase();
}

function normalizeEpisode(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function stripEpisodeFromAnilistId(id) {
    const raw = String(id || "");
    if (!raw.startsWith("anilist:")) return raw;
    return raw.replace(/-\d+$/, "");
}

function buildMediaKey(context) {
    const type = String(context.type || "anime");
    const baseId = stripEpisodeFromAnilistId(context.id);
    const season = normalizeEpisode(context.expectedSeason);
    const episode = context.isMovie ? 1 : normalizeEpisode(context.requestedEp);
    const movie = context.isMovie ? 1 : 0;
    const raw = context.isRawSearch ? 1 : 0;
    return `${type}:${baseId}:season:${season}:episode:${episode}:movie:${movie}:raw:${raw}`;
}

function toTorrentRow(mediaKey, torrent, now) {
    const hash = normalizeHash(torrent.hash);
    if (!hash) return null;

    return {
        media_key: mediaKey,
        info_hash: hash,
        title: String(torrent.title || "Unknown"),
        size: torrent.size || "Unknown",
        seeders: parseInt(torrent.seeders, 10) || 0,
        source: torrent.source || "unknown",
        raw_json: JSON.stringify(torrent),
        now
    };
}

function upsertTorrentCandidates(db, mediaKey, torrents, now = Date.now()) {
    const rows = (Array.isArray(torrents) ? torrents : [])
        .map(torrent => toTorrentRow(mediaKey, torrent, now))
        .filter(Boolean);

    const statement = db.prepare(`
        INSERT INTO torrent_candidates (
            media_key, info_hash, title, size, seeders, source, raw_json, first_seen_at, updated_at
        )
        VALUES (
            @media_key, @info_hash, @title, @size, @seeders, @source, @raw_json, @now, @now
        )
        ON CONFLICT(media_key, info_hash) DO UPDATE SET
            title = excluded.title,
            size = excluded.size,
            seeders = CASE
                WHEN excluded.seeders > torrent_candidates.seeders THEN excluded.seeders
                ELSE torrent_candidates.seeders
            END,
            source = excluded.source,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
    `);

    const write = db.transaction(items => {
        for (const row of items) statement.run(row);
    });

    write(rows);
    return rows.length;
}

function getCachedTorrents(db, mediaKey, options = {}) {
    const now = options.now || Date.now();
    const freshTtlMs = options.freshTtlMs || 6 * 60 * 60 * 1000;
    const rows = db.prepare(`
        SELECT info_hash, title, size, seeders, source, raw_json, updated_at
        FROM torrent_candidates
        WHERE media_key = ?
        ORDER BY seeders DESC, updated_at DESC
    `).all(mediaKey);

    const torrents = rows.map(row => {
        let raw = {};
        try {
            raw = JSON.parse(row.raw_json || "{}");
        } catch (error) {
            raw = {};
        }
        return {
            ...raw,
            hash: row.info_hash,
            title: row.title,
            size: row.size,
            seeders: row.seeders,
            source: row.source
        };
    });

    const newestUpdatedAt = rows.reduce((max, row) => Math.max(max, row.updated_at), 0);
    return {
        torrents,
        fresh: torrents.length > 0 && now - newestUpdatedAt <= freshTtlMs,
        newestUpdatedAt
    };
}

module.exports = {
    buildMediaKey,
    getCachedTorrents,
    normalizeHash,
    upsertTorrentCandidates
};
