const { recordByAnidb } = require("./anime-map");
const { identityRowFromRecord } = require("./stable-id-resolver");

function matchSourceItem(item, animeMap, now = Date.now()) {
    const raw = item.raw || {};
    const aid = raw.aid || raw.anidb_aid || raw.anidbAid;
    if (aid) {
        const record = recordByAnidb(animeMap, aid);
        if (record) {
            return identityRowFromRecord(item.infoHash || item.info_hash, record, 100, [
                `${item.source}.aid=${aid}`,
                `anime-map.anidb=${aid}`,
                `kitsu=${record.kitsu}`
            ], now);
        }
    }
    return null;
}

function upsertIdentityMatches(db, matches) {
    const rows = (matches || []).filter(Boolean);
    const statement = db.prepare(`
        INSERT INTO torrent_identities (
            info_hash, stable_provider, stable_id, kitsu_id, anilist_id, anidb_id, mal_id,
            imdb_id, tmdb_id, tvdb_id, confidence, evidence_json, updated_at
        ) VALUES (
            @info_hash, @stable_provider, @stable_id, @kitsu_id, @anilist_id, @anidb_id, @mal_id,
            @imdb_id, @tmdb_id, @tvdb_id, @confidence, @evidence_json, @updated_at
        )
        ON CONFLICT(info_hash, stable_provider, stable_id) DO UPDATE SET
            kitsu_id = excluded.kitsu_id,
            anilist_id = excluded.anilist_id,
            anidb_id = excluded.anidb_id,
            mal_id = excluded.mal_id,
            imdb_id = excluded.imdb_id,
            tmdb_id = excluded.tmdb_id,
            tvdb_id = excluded.tvdb_id,
            confidence = excluded.confidence,
            evidence_json = excluded.evidence_json,
            updated_at = excluded.updated_at
    `);
    db.transaction(batch => batch.forEach(row => statement.run(row)))(rows);
    return rows.length;
}

module.exports = {
    matchSourceItem,
    upsertIdentityMatches
};
