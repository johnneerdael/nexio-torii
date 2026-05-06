#!/usr/bin/env node
const { getCatalogDatabase } = require("../lib/catalog/database");

function parseArgs(argv) {
    const args = { requireSource: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--db") args.db = argv[++i];
        else if (arg === "--require-source") args.requireSource.push(argv[++i]);
        else if (arg === "--require-mapped") args.requireMapped = true;
    }
    return args;
}

function count(db, sql, params = []) {
    return db.prepare(sql).get(...params).count;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const db = getCatalogDatabase({ dbPath: args.db });
    const sourceItems = count(db, "SELECT COUNT(*) AS count FROM source_items");
    const identities = count(db, "SELECT COUNT(*) AS count FROM torrent_identities");
    const episodes = count(db, "SELECT COUNT(*) AS count FROM torrent_episode_matches");
    const dropped = count(db, "SELECT COUNT(*) AS count FROM dropped_source_items");
    const resolutionCache = count(db, "SELECT COUNT(*) AS count FROM identity_resolution_cache");
    console.log(`[CATALOG_VALIDATE] source_items=${sourceItems} torrent_identities=${identities} episode_matches=${episodes} dropped_source_items=${dropped} identity_resolution_cache=${resolutionCache}`);

    let missingSource = false;
    for (const source of ["nyaa", "animetosho", "tokyotosho"]) {
        const rows = count(db, "SELECT COUNT(*) AS count FROM source_items WHERE source = ?", [source]);
        const mapped = count(db, `
            SELECT COUNT(DISTINCT si.info_hash) AS count
            FROM source_items si
            JOIN torrent_identities ti ON ti.info_hash = si.info_hash
            WHERE si.source = ?
        `, [source]);
        console.log(`[CATALOG_VALIDATE] source=${source} source_items=${rows} mapped=${mapped}`);
        if (args.requireSource.includes(source) && rows === 0) missingSource = true;
    }

    if (missingSource) process.exit(2);
    if (args.requireMapped && identities === 0) process.exit(3);
}

try {
    main();
} catch (error) {
    console.error(`[CATALOG_VALIDATE] failed error=${JSON.stringify(error.message)}`);
    process.exit(1);
}
