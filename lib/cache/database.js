const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

let sharedDatabase = null;

function resolveDbPath(options = {}) {
    return options.dbPath || process.env.CACHE_DB_PATH || path.join(process.cwd(), "data", "nexio-cache.sqlite");
}

function ensureParentDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function initializeDatabase(db) {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(`
        CREATE TABLE IF NOT EXISTS torrent_candidates (
            media_key TEXT NOT NULL,
            info_hash TEXT NOT NULL,
            title TEXT NOT NULL,
            size TEXT,
            seeders INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'unknown',
            raw_json TEXT,
            first_seen_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (media_key, info_hash)
        );

        CREATE INDEX IF NOT EXISTS idx_torrent_candidates_media_updated
        ON torrent_candidates (media_key, updated_at DESC);

        CREATE TABLE IF NOT EXISTS debrid_availability (
            service TEXT NOT NULL,
            info_hash TEXT NOT NULL,
            season_norm INTEGER NOT NULL,
            episode_norm INTEGER NOT NULL,
            status TEXT NOT NULL,
            is_cached INTEGER NOT NULL DEFAULT 0,
            files_json TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (service, info_hash, season_norm, episode_norm)
        );

        CREATE INDEX IF NOT EXISTS idx_debrid_availability_lookup
        ON debrid_availability (service, info_hash, season_norm, episode_norm, updated_at DESC);

        CREATE TABLE IF NOT EXISTS scrape_locks (
            media_key TEXT PRIMARY KEY,
            locked_until INTEGER NOT NULL
        );
    `);
}

function getDatabase(options = {}) {
    if (sharedDatabase && sharedDatabase.open) return sharedDatabase;

    const dbPath = resolveDbPath(options);
    ensureParentDirectory(dbPath);
    sharedDatabase = new Database(dbPath);
    initializeDatabase(sharedDatabase);
    return sharedDatabase;
}

function closeDatabaseForTests() {
    if (sharedDatabase && sharedDatabase.open) {
        sharedDatabase.close();
    }
    sharedDatabase = null;
}

module.exports = {
    closeDatabaseForTests,
    getDatabase,
    initializeDatabase,
    resolveDbPath
};
