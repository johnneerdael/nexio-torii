function normalizeHash(hash) {
    const value = String(hash || "").trim().toLowerCase();
    return /^[a-f0-9]{40}$/.test(value) ? value : "";
}

function normalizeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSourceItem(input, now = Date.now()) {
    const infoHash = normalizeHash(input.infoHash || input.info_hash);
    if (!infoHash) return null;
    const source = String(input.source || "").trim().toLowerCase();
    const sourceItemId = String(input.sourceItemId || input.source_item_id || infoHash).trim();
    const title = String(input.title || "").trim();
    if (!source || !sourceItemId || !title) return null;

    return {
        source,
        source_item_id: sourceItemId,
        info_hash: infoHash,
        title,
        source_url: input.sourceUrl || input.source_url || null,
        torrent_url: input.torrentUrl || input.torrent_url || null,
        magnet_url: input.magnetUrl || input.magnet_url || null,
        category: input.category || null,
        size_bytes: normalizeNumber(input.sizeBytes ?? input.size_bytes),
        size_text: input.sizeText || input.size_text || null,
        seeders: normalizeNumber(input.seeders),
        leechers: normalizeNumber(input.leechers),
        completed: normalizeNumber(input.completed),
        uploaded_at: normalizeNumber(input.uploadedAt ?? input.uploaded_at),
        raw_json: JSON.stringify(input.raw || {}),
        first_seen_at: now,
        last_seen_at: now
    };
}

function upsertSourceItems(db, items, now = Date.now()) {
    const rows = (items || []).map(item => normalizeSourceItem(item, now)).filter(Boolean);
    const statement = db.prepare(`
        INSERT INTO source_items (
            source, source_item_id, info_hash, title, source_url, torrent_url, magnet_url,
            category, size_bytes, size_text, seeders, leechers, completed, uploaded_at,
            raw_json, first_seen_at, last_seen_at
        ) VALUES (
            @source, @source_item_id, @info_hash, @title, @source_url, @torrent_url, @magnet_url,
            @category, @size_bytes, @size_text, @seeders, @leechers, @completed, @uploaded_at,
            @raw_json, @first_seen_at, @last_seen_at
        )
        ON CONFLICT(source, source_item_id) DO UPDATE SET
            info_hash = excluded.info_hash,
            title = excluded.title,
            source_url = excluded.source_url,
            torrent_url = excluded.torrent_url,
            magnet_url = excluded.magnet_url,
            category = excluded.category,
            size_bytes = excluded.size_bytes,
            size_text = excluded.size_text,
            seeders = excluded.seeders,
            leechers = excluded.leechers,
            completed = excluded.completed,
            uploaded_at = excluded.uploaded_at,
            raw_json = excluded.raw_json,
            last_seen_at = excluded.last_seen_at
    `);
    db.transaction(batch => batch.forEach(row => statement.run(row)))(rows);
    return rows.length;
}

module.exports = {
    normalizeHash,
    normalizeSourceItem,
    upsertSourceItems
};
