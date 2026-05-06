function normalizeHash(hash) {
    const value = String(hash || "").trim().toLowerCase();
    return /^[a-f0-9]{40}$/.test(value) ? value : "";
}

const SOURCE_PRIORITIES = Object.freeze({
    nyaa: 300,
    animetosho: 200,
    tokyotosho: 100
});

function sourcePriority(source) {
    return SOURCE_PRIORITIES[String(source || "").trim().toLowerCase()] || 0;
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
    const stableProvider = String(input.stableProvider || input.stable_provider || "").trim().toLowerCase();
    const stableId = String(input.stableId || input.stable_id || "").trim();
    if (!stableProvider || !stableId) return null;

    return {
        info_hash: infoHash,
        source,
        source_item_id: sourceItemId,
        source_priority: normalizeNumber(input.sourcePriority ?? input.source_priority) ?? sourcePriority(source),
        title,
        stable_provider: stableProvider,
        stable_id: stableId,
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
        parsed_json: JSON.stringify(input.parsed || {}),
        raw_json: JSON.stringify(input.raw || {}),
        first_seen_at: now,
        last_seen_at: now
    };
}

function upsertSourceItems(db, items, now = Date.now()) {
    const rows = (items || []).map(item => normalizeSourceItem(item, now)).filter(Boolean);
    const statement = db.prepare(`
        INSERT INTO source_items (
            info_hash, source, source_item_id, source_priority, title, stable_provider, stable_id,
            source_url, torrent_url, magnet_url, category, size_bytes, size_text, seeders, leechers,
            completed, uploaded_at, parsed_json, raw_json, first_seen_at, last_seen_at
        ) VALUES (
            @info_hash, @source, @source_item_id, @source_priority, @title, @stable_provider, @stable_id,
            @source_url, @torrent_url, @magnet_url, @category, @size_bytes, @size_text, @seeders, @leechers,
            @completed, @uploaded_at, @parsed_json, @raw_json, @first_seen_at, @last_seen_at
        )
        ON CONFLICT(info_hash) DO UPDATE SET
            source = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.source ELSE source_items.source END,
            source_item_id = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.source_item_id ELSE source_items.source_item_id END,
            source_priority = MAX(source_items.source_priority, excluded.source_priority),
            title = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.title ELSE source_items.title END,
            stable_provider = excluded.stable_provider,
            stable_id = excluded.stable_id,
            source_url = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.source_url ELSE source_items.source_url END,
            torrent_url = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.torrent_url ELSE source_items.torrent_url END,
            magnet_url = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.magnet_url ELSE source_items.magnet_url END,
            category = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.category ELSE source_items.category END,
            size_bytes = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.size_bytes ELSE source_items.size_bytes END,
            size_text = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.size_text ELSE source_items.size_text END,
            seeders = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.seeders ELSE source_items.seeders END,
            leechers = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.leechers ELSE source_items.leechers END,
            completed = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.completed ELSE source_items.completed END,
            uploaded_at = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.uploaded_at ELSE source_items.uploaded_at END,
            parsed_json = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.parsed_json ELSE source_items.parsed_json END,
            raw_json = CASE WHEN excluded.source_priority >= source_items.source_priority THEN excluded.raw_json ELSE source_items.raw_json END,
            last_seen_at = excluded.last_seen_at
    `);
    db.transaction(batch => batch.forEach(row => statement.run(row)))(rows);
    return new Set(rows.map(row => row.info_hash)).size;
}

module.exports = {
    normalizeHash,
    normalizeSourceItem,
    sourcePriority,
    upsertSourceItems
};
