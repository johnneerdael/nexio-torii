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

function migrateSourceItemsToInfoHashPrimaryKey(db) {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_items'").get();
    if (!table) return;

    const columns = db.prepare("PRAGMA table_info(source_items)").all();
    const infoHash = columns.find(column => column.name === "info_hash");
    if (infoHash && infoHash.pk === 1) return;

    db.exec(`
        ALTER TABLE source_items RENAME TO source_items_legacy;
        CREATE TABLE source_items (
          info_hash TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_item_id TEXT NOT NULL,
          source_priority INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          stable_provider TEXT NOT NULL DEFAULT 'unknown',
          stable_id TEXT NOT NULL DEFAULT 'unknown',
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
          parsed_json TEXT NOT NULL DEFAULT '{}',
          raw_json TEXT NOT NULL DEFAULT '{}',
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        INSERT INTO source_items (
          info_hash, source, source_item_id, source_priority, title, stable_provider, stable_id,
          source_url, torrent_url, magnet_url, category, size_bytes, size_text, seeders, leechers,
          completed, uploaded_at, raw_json, first_seen_at, last_seen_at
        )
        SELECT info_hash, source, source_item_id,
          CASE source WHEN 'nyaa' THEN 300 WHEN 'animetosho' THEN 200 WHEN 'tokyotosho' THEN 100 ELSE 0 END,
          title, 'unknown', 'unknown', source_url, torrent_url, magnet_url, category, size_bytes, size_text,
          seeders, leechers, completed, uploaded_at, raw_json, MIN(first_seen_at), MAX(last_seen_at)
        FROM source_items_legacy
        WHERE info_hash IS NOT NULL AND info_hash != ''
        GROUP BY info_hash;
        DROP TABLE source_items_legacy;
    `);
}

function ensureIngestionRunColumns(db) {
    const existing = db.prepare("PRAGMA table_info(ingestion_runs)").all().map(row => row.name);
    for (const [column, definition] of [
        ["dropped_unmapped", "INTEGER NOT NULL DEFAULT 0"],
        ["duplicate_skipped", "INTEGER NOT NULL DEFAULT 0"]
    ]) {
        if (!existing.includes(column)) {
            db.exec(`ALTER TABLE ingestion_runs ADD COLUMN ${column} ${definition}`);
        }
    }
}

function initializeCatalogDatabase(db) {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    migrateSourceItemsToInfoHashPrimaryKey(db);
    db.exec(`
        CREATE TABLE IF NOT EXISTS source_items (
          info_hash TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_item_id TEXT NOT NULL,
          source_priority INTEGER NOT NULL,
          title TEXT NOT NULL,
          stable_provider TEXT NOT NULL,
          stable_id TEXT NOT NULL,
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
          parsed_json TEXT NOT NULL DEFAULT '{}',
          raw_json TEXT NOT NULL DEFAULT '{}',
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        DROP INDEX IF EXISTS idx_source_items_source_hash;
        CREATE INDEX IF NOT EXISTS idx_source_items_source ON source_items (source);
        CREATE INDEX IF NOT EXISTS idx_source_items_stable
        ON source_items (stable_provider, stable_id, source_priority DESC);

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

        CREATE TABLE IF NOT EXISTS identity_resolution_cache (
          cache_key TEXT PRIMARY KEY,
          normalized_title TEXT NOT NULL,
          year TEXT,
          media_type TEXT,
          stable_provider TEXT,
          stable_id TEXT,
          kitsu_id TEXT,
          anilist_id TEXT,
          anidb_id TEXT,
          mal_id TEXT,
          imdb_id TEXT,
          tmdb_id TEXT,
          tvdb_id TEXT,
          confidence INTEGER NOT NULL,
          status TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_identity_resolution_cache_title
        ON identity_resolution_cache (normalized_title, year, media_type, status);

        CREATE TABLE IF NOT EXISTS dropped_source_items (
          source TEXT NOT NULL,
          source_item_id TEXT NOT NULL,
          info_hash TEXT NOT NULL,
          title TEXT NOT NULL,
          reason TEXT NOT NULL,
          parsed_json TEXT NOT NULL DEFAULT '{}',
          raw_json TEXT NOT NULL DEFAULT '{}',
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          PRIMARY KEY (source, source_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_dropped_source_items_hash ON dropped_source_items (info_hash);

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
          dropped_unmapped INTEGER NOT NULL DEFAULT 0,
          duplicate_skipped INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'running',
          error TEXT
        );
    `);
    ensureIngestionRunColumns(db);
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
