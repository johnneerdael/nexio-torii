const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

let sharedCatalogDatabase = null;

function resolveCatalogDbPath(options = {}) {
    return options.dbPath || process.env.CATALOG_DB_PATH || path.join(process.cwd(), "data", "catalog.sqlite");
}

function ensureParentDirectory(filePath) {
    if (filePath === ":memory:") return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function initializeCatalogDatabase(db) {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(`
        CREATE TABLE IF NOT EXISTS source_items (
          source TEXT NOT NULL,
          source_item_id TEXT NOT NULL,
          info_hash TEXT NOT NULL,
          title TEXT NOT NULL,
          source_url TEXT,
          torrent_url TEXT,
          magnet_url TEXT,
          category TEXT,
          size_bytes INTEGER,
          size_text TEXT,
          seeders INTEGER,
          leechers INTEGER,
          completed INTEGER,
          uploaded_at INTEGER,
          raw_json TEXT NOT NULL DEFAULT '{}',
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          PRIMARY KEY (source, source_item_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_source_items_source_hash ON source_items (source, info_hash);
        CREATE INDEX IF NOT EXISTS idx_source_items_hash ON source_items (info_hash);

        CREATE TABLE IF NOT EXISTS torrent_identities (
          info_hash TEXT NOT NULL,
          stable_provider TEXT NOT NULL,
          stable_id TEXT NOT NULL,
          kitsu_id TEXT,
          anilist_id TEXT,
          anidb_id TEXT,
          mal_id TEXT,
          imdb_id TEXT,
          tmdb_id TEXT,
          tvdb_id TEXT,
          confidence INTEGER NOT NULL,
          evidence_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (info_hash, stable_provider, stable_id)
        );
        CREATE INDEX IF NOT EXISTS idx_torrent_identities_lookup
        ON torrent_identities (kitsu_id, anilist_id, anidb_id, confidence DESC);

        CREATE TABLE IF NOT EXISTS torrent_episode_matches (
          info_hash TEXT NOT NULL,
          file_index INTEGER NOT NULL DEFAULT -1,
          kitsu_id TEXT,
          anilist_id TEXT,
          anidb_id TEXT,
          season INTEGER NOT NULL DEFAULT 1,
          episode INTEGER NOT NULL DEFAULT 1,
          episode_end INTEGER,
          match_type TEXT NOT NULL,
          confidence INTEGER NOT NULL,
          evidence_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (info_hash, file_index, season, episode)
        );
        CREATE INDEX IF NOT EXISTS idx_torrent_episode_matches_lookup
        ON torrent_episode_matches (kitsu_id, anilist_id, season, episode, confidence DESC);

        CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
          source TEXT PRIMARY KEY,
          cursor TEXT,
          last_success_at INTEGER,
          last_error TEXT,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ingestion_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          mode TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          scanned INTEGER NOT NULL DEFAULT 0,
          upserted INTEGER NOT NULL DEFAULT 0,
          matched INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'running',
          error TEXT
        );
    `);
}

function getCatalogDatabase(options = {}) {
    if (!options.dbPath && sharedCatalogDatabase && sharedCatalogDatabase.open) return sharedCatalogDatabase;

    const dbPath = resolveCatalogDbPath(options);
    ensureParentDirectory(dbPath);
    const db = new Database(dbPath);
    initializeCatalogDatabase(db);
    if (!options.dbPath) sharedCatalogDatabase = db;
    return db;
}

function closeCatalogDatabaseForTests() {
    if (sharedCatalogDatabase && sharedCatalogDatabase.open) sharedCatalogDatabase.close();
    sharedCatalogDatabase = null;
}

module.exports = {
    closeCatalogDatabaseForTests,
    getCatalogDatabase,
    initializeCatalogDatabase,
    resolveCatalogDbPath
};
