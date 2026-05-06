# Comet-Style Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Comet-style persistent torrent caching, debrid availability caching, and cache-first stream responses to Nexio Torii.

**Architecture:** Keep the current Nyaa/AnimeTosho/TokyoTosho scraper set for this phase. Add a small SQLite-backed cache layer, a cache-state decision module, and a debrid cache wrapper that stores availability per service/hash/episode scope. The stream handler should read cached torrents first, scrape only when the cache is empty or refreshing in the background, and call StremThru only for debrid hashes missing from the persistent cache.

**Tech Stack:** Node.js CommonJS, `node:test`, `better-sqlite3`, Express, Stremio addon SDK, existing StremThru APIs.

---

## Scope

In scope:

- Persistent SQLite cache for normalized torrent candidates.
- Cache state decisions modeled after Comet: fresh, stale, empty, wait.
- In-process scrape locks to prevent duplicate cold scrapes within one Node process.
- Per-service/per-hash debrid availability cache.
- Stream handler integration that returns cached torrents immediately when possible.
- CDN-friendly cache header helper for stream responses.
- Docker changes needed for SQLite native dependency and persistent cache storage.
- README notes for cache environment variables and volume.

Out of scope:

- New source integrations for SubsPlease, TokyoTosho account login, or Beatrice-Raws.
- Replacing the current query generation strategy.
- Full distributed locks across multiple containers.
- Account-specific debrid snapshot scraping.

## File Structure

- Create `lib/cache/database.js`: opens SQLite, creates schema, configures WAL, exposes test reset helpers.
- Create `lib/cache/torrent-cache.js`: reads and writes normalized torrent candidates by media key.
- Create `lib/cache/cache-state.js`: implements Comet-style cache state and lock decision logic.
- Create `lib/cache/debrid-cache.js`: wraps `checkStoreTorz` and persists availability by service/hash/scope.
- Create `lib/cache/http-cache.js`: builds consistent `Cache-Control` header values.
- Create `lib/cache/stream-cache.js`: orchestrates torrent cache read, foreground scrape, and background refresh.
- Modify `addon.js`: route torrent discovery through `stream-cache` and debrid checks through `debrid-cache`.
- Modify `server.js`: apply cache headers to stream and manifest responses.
- Modify `package.json` and `package-lock.json`: add `better-sqlite3`.
- Modify `Dockerfile`: install build dependencies needed for native SQLite module.
- Modify `docker-compose.yml`: mount `/app/data` and document cache env vars.
- Modify `.gitignore`: ignore SQLite cache files.
- Modify `readme.md`: document cache behavior and phase 2 source deferral.
- Create tests:
  - `tests/cache-database.test.js`
  - `tests/torrent-cache.test.js`
  - `tests/cache-state.test.js`
  - `tests/debrid-cache.test.js`
  - `tests/stream-cache.test.js`
  - `tests/http-cache.test.js`

## Cache Defaults

Use these values unless an environment variable overrides them:

```js
const DEFAULTS = {
    TORRENT_CACHE_FRESH_MS: 6 * 60 * 60 * 1000,
    TORRENT_CACHE_STALE_MS: 7 * 24 * 60 * 60 * 1000,
    DEBRID_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
    STREAM_HTTP_MAX_AGE_SECONDS: 1800,
    STREAM_HTTP_S_MAXAGE_SECONDS: 3600,
    STREAM_HTTP_STALE_REVALIDATE_SECONDS: 21600,
    STREAM_HTTP_STALE_ERROR_SECONDS: 300
};
```

---

### Task 1: Add SQLite Dependency And Runtime Storage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Install dependency**

Run:

```bash
npm install better-sqlite3
```

Expected:

```text
added ... packages
```

- [ ] **Step 2: Verify `package.json` dependency**

`package.json` dependencies should include:

```json
"better-sqlite3": "^11.9.1"
```

If npm selects a newer compatible version, keep npm's selected version and do not manually edit `package-lock.json`.

- [ ] **Step 3: Ignore runtime cache files**

Append these lines to `.gitignore`:

```gitignore
data/
*.sqlite
*.sqlite-shm
*.sqlite-wal
```

- [ ] **Step 4: Update Docker native build support**

Modify the top of `Dockerfile` so native modules can compile on Alpine:

```dockerfile
FROM node:18-alpine

LABEL org.opencontainers.image.title="Nexio Torii" \
      org.opencontainers.image.description="Stremio anime streams addon backed by Nyaa and StremThru premium unlockers" \
      org.opencontainers.image.source="https://github.com/johnneerdael/nexio-torii"

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev
```

Keep the rest of the file unchanged.

- [ ] **Step 5: Add cache volume to compose**

Add this block under the existing `environment` block in `docker-compose.yml`:

```yaml
    volumes:
      - "nexio-torii-cache:/app/data"
```

Add this block at the bottom:

```yaml
volumes:
  nexio-torii-cache:
    name: "nexio-torii-cache"
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected:

```text
# pass
```

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json .gitignore Dockerfile docker-compose.yml
git commit -m "chore: add sqlite cache runtime support"
```

---

### Task 2: Create SQLite Database Module

**Files:**
- Create: `lib/cache/database.js`
- Create: `tests/cache-database.test.js`

- [ ] **Step 1: Write failing database tests**

Create `tests/cache-database.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const {
    getDatabase,
    initializeDatabase,
    closeDatabaseForTests
} = require("../lib/cache/database");

function tempDbPath(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-cache-"));
    return path.join(dir, name);
}

test("initializeDatabase creates torrent and debrid cache tables", () => {
    const db = getDatabase({ dbPath: tempDbPath("cache.sqlite") });
    initializeDatabase(db);

    const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
    `).all().map(row => row.name);

    assert.ok(tables.includes("torrent_candidates"));
    assert.ok(tables.includes("debrid_availability"));
    assert.ok(tables.includes("scrape_locks"));

    closeDatabaseForTests();
});

test("getDatabase creates parent directory for CACHE_DB_PATH", () => {
    const dbPath = tempDbPath("nested/cache.sqlite");
    const db = getDatabase({ dbPath });

    assert.equal(fs.existsSync(path.dirname(dbPath)), true);
    assert.equal(db.open, true);

    closeDatabaseForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/cache-database.test.js
```

Expected:

```text
Error: Cannot find module '../lib/cache/database'
```

- [ ] **Step 3: Implement database module**

Create `lib/cache/database.js`:

```js
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
```

- [ ] **Step 4: Run database tests**

Run:

```bash
node --test tests/cache-database.test.js
```

Expected:

```text
# pass 2
```

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cache/database.js tests/cache-database.test.js
git commit -m "feat: add sqlite cache database"
```

---

### Task 3: Add Torrent Candidate Cache

**Files:**
- Create: `lib/cache/torrent-cache.js`
- Create: `tests/torrent-cache.test.js`

- [ ] **Step 1: Write failing torrent cache tests**

Create `tests/torrent-cache.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");
const {
    buildMediaKey,
    getCachedTorrents,
    upsertTorrentCandidates
} = require("../lib/cache/torrent-cache");

function db() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-torrent-cache-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

test("buildMediaKey is stable for one episode request", () => {
    assert.equal(
        buildMediaKey({ type: "anime", id: "anilist:20-1", expectedSeason: 1, requestedEp: 1, isMovie: false, isRawSearch: false }),
        "anime:anilist:20:season:1:episode:1:movie:0:raw:0"
    );
});

test("upsertTorrentCandidates stores latest metadata by media key and hash", () => {
    const database = db();
    const now = 1000;
    const mediaKey = "anime:anilist:20:season:1:episode:1:movie:0:raw:0";

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "ABCDEF", title: "Show - 01 [1080p]", size: "1.2 GB", seeders: 4, source: "nyaa" }
    ], now);
    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abcdef", title: "Show - 01 [1080p]", size: "1.3 GB", seeders: 9, source: "animetosho" }
    ], now + 10);

    const cached = getCachedTorrents(database, mediaKey, { now: now + 20, freshTtlMs: 1000 });

    assert.equal(cached.torrents.length, 1);
    assert.equal(cached.torrents[0].hash, "abcdef");
    assert.equal(cached.torrents[0].size, "1.3 GB");
    assert.equal(cached.torrents[0].seeders, 9);
    assert.equal(cached.fresh, true);
    assert.equal(cached.newestUpdatedAt, now + 10);

    closeDatabaseForTests();
});

test("getCachedTorrents marks old rows stale", () => {
    const database = db();
    const mediaKey = "anime:anilist:20:season:1:episode:1:movie:0:raw:0";

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abc", title: "Show - 01", size: "1 GB", seeders: 1 }
    ], 1000);

    const cached = getCachedTorrents(database, mediaKey, { now: 5000, freshTtlMs: 1000 });

    assert.equal(cached.torrents.length, 1);
    assert.equal(cached.fresh, false);

    closeDatabaseForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/torrent-cache.test.js
```

Expected:

```text
Error: Cannot find module '../lib/cache/torrent-cache'
```

- [ ] **Step 3: Implement torrent cache**

Create `lib/cache/torrent-cache.js`:

```js
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
```

- [ ] **Step 4: Run torrent cache tests**

Run:

```bash
node --test tests/torrent-cache.test.js
```

Expected:

```text
# pass 3
```

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cache/torrent-cache.js tests/torrent-cache.test.js
git commit -m "feat: cache torrent candidates"
```

---

### Task 4: Add Comet-Style Cache State Decisions

**Files:**
- Create: `lib/cache/cache-state.js`
- Create: `tests/cache-state.test.js`

- [ ] **Step 1: Write failing cache-state tests**

Create `tests/cache-state.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CacheDecision,
    CacheState,
    createCacheStateManager
} = require("../lib/cache/cache-state");

test("fresh cached torrents use cache only", () => {
    const manager = createCacheStateManager({ now: () => 10_000 });
    const result = manager.decide({
        mediaKey: "media",
        torrentCount: 3,
        newestUpdatedAt: 9_000,
        freshTtlMs: 5_000,
        staleTtlMs: 60_000
    });

    assert.equal(result.state, CacheState.FRESH);
    assert.equal(result.decision, CacheDecision.USE_CACHE);
    assert.equal(result.lockAcquired, false);
});

test("stale cached torrents return cache and refresh in background", () => {
    const manager = createCacheStateManager({ now: () => 20_000 });
    const result = manager.decide({
        mediaKey: "media",
        torrentCount: 2,
        newestUpdatedAt: 10_000,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });

    assert.equal(result.state, CacheState.STALE);
    assert.equal(result.decision, CacheDecision.SCRAPE_BACKGROUND);
    assert.equal(result.lockAcquired, true);
});

test("empty cache acquires foreground lock once", () => {
    const manager = createCacheStateManager({ now: () => 20_000, lockTtlMs: 10_000 });

    const first = manager.decide({
        mediaKey: "media",
        torrentCount: 0,
        newestUpdatedAt: 0,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });
    const second = manager.decide({
        mediaKey: "media",
        torrentCount: 0,
        newestUpdatedAt: 0,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });

    assert.equal(first.decision, CacheDecision.SCRAPE_FOREGROUND);
    assert.equal(second.decision, CacheDecision.WAIT_FOR_OTHER);
});

test("expired lock can be acquired again", () => {
    let currentTime = 20_000;
    const manager = createCacheStateManager({ now: () => currentTime, lockTtlMs: 10_000 });

    manager.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    currentTime = 31_000;

    const result = manager.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    assert.equal(result.decision, CacheDecision.SCRAPE_FOREGROUND);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/cache-state.test.js
```

Expected:

```text
Error: Cannot find module '../lib/cache/cache-state'
```

- [ ] **Step 3: Implement cache-state module**

Create `lib/cache/cache-state.js`:

```js
const CacheState = Object.freeze({
    FRESH: "fresh",
    STALE: "stale",
    EMPTY: "empty",
    EXPIRED: "expired"
});

const CacheDecision = Object.freeze({
    USE_CACHE: "use_cache",
    SCRAPE_BACKGROUND: "scrape_background",
    SCRAPE_FOREGROUND: "scrape_foreground",
    WAIT_FOR_OTHER: "wait_for_other"
});

function createCacheStateManager(options = {}) {
    const locks = new Map();
    const now = options.now || Date.now;
    const lockTtlMs = options.lockTtlMs || 30_000;

    function cleanup(currentTime) {
        for (const [key, expiresAt] of locks.entries()) {
            if (expiresAt <= currentTime) locks.delete(key);
        }
    }

    function tryAcquireLock(mediaKey) {
        const currentTime = now();
        cleanup(currentTime);
        if (locks.has(mediaKey)) return false;
        locks.set(mediaKey, currentTime + lockTtlMs);
        return true;
    }

    function releaseLock(mediaKey) {
        locks.delete(mediaKey);
    }

    function determineState({ torrentCount, newestUpdatedAt, freshTtlMs, staleTtlMs }) {
        if (torrentCount <= 0) return CacheState.EMPTY;
        const age = now() - newestUpdatedAt;
        if (age <= freshTtlMs) return CacheState.FRESH;
        if (age <= staleTtlMs) return CacheState.STALE;
        return CacheState.EXPIRED;
    }

    function decide(input) {
        const state = determineState(input);

        if (state === CacheState.FRESH) {
            return { state, decision: CacheDecision.USE_CACHE, lockAcquired: false };
        }

        if (state === CacheState.STALE) {
            const lockAcquired = tryAcquireLock(input.mediaKey);
            return {
                state,
                decision: lockAcquired ? CacheDecision.SCRAPE_BACKGROUND : CacheDecision.USE_CACHE,
                lockAcquired
            };
        }

        const lockAcquired = tryAcquireLock(input.mediaKey);
        return {
            state,
            decision: lockAcquired ? CacheDecision.SCRAPE_FOREGROUND : CacheDecision.WAIT_FOR_OTHER,
            lockAcquired
        };
    }

    return {
        decide,
        releaseLock,
        tryAcquireLock
    };
}

module.exports = {
    CacheDecision,
    CacheState,
    createCacheStateManager
};
```

- [ ] **Step 4: Run cache-state tests**

Run:

```bash
node --test tests/cache-state.test.js
```

Expected:

```text
# pass 4
```

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cache/cache-state.js tests/cache-state.test.js
git commit -m "feat: add cache state decisions"
```

---

### Task 5: Add Debrid Availability Cache

**Files:**
- Create: `lib/cache/debrid-cache.js`
- Create: `tests/debrid-cache.test.js`

- [ ] **Step 1: Write failing debrid cache tests**

Create `tests/debrid-cache.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");
const {
    checkStoreTorzWithCache,
    getCachedAvailability,
    upsertAvailability
} = require("../lib/cache/debrid-cache");

function db() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-debrid-cache-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

test("upsertAvailability stores availability by service hash and episode scope", () => {
    const database = db();

    upsertAvailability(database, "realdebrid", {
        abc: { hash: "abc", status: "cached", isCached: true, files: [{ index: 0, name: "Episode 01.mkv" }] }
    }, { season: 1, episode: 1 }, 1000);

    const result = getCachedAvailability(database, "realdebrid", ["abc", "def"], { season: 1, episode: 1 }, {
        now: 2000,
        ttlMs: 10_000
    });

    assert.equal(result.cached.abc.isCached, true);
    assert.equal(result.cached.abc.files[0].name, "Episode 01.mkv");
    assert.deepEqual(result.missingHashes, ["def"]);

    closeDatabaseForTests();
});

test("getCachedAvailability treats stale rows as missing", () => {
    const database = db();

    upsertAvailability(database, "realdebrid", {
        abc: { hash: "abc", status: "cached", isCached: true, files: [] }
    }, { season: 1, episode: 1 }, 1000);

    const result = getCachedAvailability(database, "realdebrid", ["abc"], { season: 1, episode: 1 }, {
        now: 20_000,
        ttlMs: 1_000
    });

    assert.deepEqual(result.cached, {});
    assert.deepEqual(result.missingHashes, ["abc"]);

    closeDatabaseForTests();
});

test("checkStoreTorzWithCache only calls StremThru for missing hashes", async () => {
    const database = db();
    const calls = [];
    const checkStoreTorz = async hashes => {
        calls.push(hashes);
        return {
            def: { hash: "def", status: "cached", isCached: true, files: [] }
        };
    };

    upsertAvailability(database, "realdebrid", {
        abc: { hash: "abc", status: "cached", isCached: true, files: [] }
    }, { season: 1, episode: 1 }, 1000);

    const result = await checkStoreTorzWithCache(["abc", "def"], { service: "realdebrid", apiKey: "secret" }, {
        db: database,
        scope: { season: 1, episode: 1 },
        now: 2000,
        ttlMs: 10_000,
        checkStoreTorz
    });

    assert.deepEqual(calls, [["def"]]);
    assert.equal(result.abc.isCached, true);
    assert.equal(result.def.isCached, true);

    closeDatabaseForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/debrid-cache.test.js
```

Expected:

```text
Error: Cannot find module '../lib/cache/debrid-cache'
```

- [ ] **Step 3: Implement debrid cache**

Create `lib/cache/debrid-cache.js`:

```js
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
```

- [ ] **Step 4: Run debrid cache tests**

Run:

```bash
node --test tests/debrid-cache.test.js
```

Expected:

```text
# pass 3
```

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cache/debrid-cache.js tests/debrid-cache.test.js
git commit -m "feat: cache debrid availability by service hash"
```

---

### Task 6: Add Stream Cache Orchestrator

**Files:**
- Create: `lib/cache/stream-cache.js`
- Create: `tests/stream-cache.test.js`

- [ ] **Step 1: Write failing stream cache tests**

Create `tests/stream-cache.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");
const { createCacheStateManager } = require("../lib/cache/cache-state");
const { upsertTorrentCandidates } = require("../lib/cache/torrent-cache");
const { getTorrentsForStream } = require("../lib/cache/stream-cache");

function db() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-stream-cache-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

test("fresh cache returns torrents without scraping", async () => {
    const database = db();
    const mediaKey = "media";
    let scrapeCalls = 0;

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abc", title: "Show - 01", size: "1 GB", seeders: 5 }
    ], 10_000);

    const result = await getTorrentsForStream({
        db: database,
        mediaKey,
        scrape: async () => {
            scrapeCalls++;
            return [{ hash: "def", title: "Fresh", size: "2 GB", seeders: 10 }];
        },
        cacheManager: createCacheStateManager({ now: () => 11_000 }),
        now: 11_000,
        freshTtlMs: 60_000,
        staleTtlMs: 600_000
    });

    assert.equal(scrapeCalls, 0);
    assert.equal(result.torrents[0].hash, "abc");
    assert.equal(result.source, "cache");

    closeDatabaseForTests();
});

test("empty cache scrapes foreground and persists results", async () => {
    const database = db();

    const result = await getTorrentsForStream({
        db: database,
        mediaKey: "media",
        scrape: async () => [{ hash: "abc", title: "Show - 01", size: "1 GB", seeders: 5 }],
        cacheManager: createCacheStateManager({ now: () => 20_000 }),
        now: 20_000,
        freshTtlMs: 60_000,
        staleTtlMs: 600_000
    });

    assert.equal(result.torrents.length, 1);
    assert.equal(result.source, "foreground_scrape");

    const second = await getTorrentsForStream({
        db: database,
        mediaKey: "media",
        scrape: async () => [],
        cacheManager: createCacheStateManager({ now: () => 21_000 }),
        now: 21_000,
        freshTtlMs: 60_000,
        staleTtlMs: 600_000
    });

    assert.equal(second.torrents[0].hash, "abc");

    closeDatabaseForTests();
});

test("stale cache returns cache and schedules background refresh", async () => {
    const database = db();
    const mediaKey = "media";
    const backgroundJobs = [];

    upsertTorrentCandidates(database, mediaKey, [
        { hash: "abc", title: "Old", size: "1 GB", seeders: 1 }
    ], 1_000);

    const result = await getTorrentsForStream({
        db: database,
        mediaKey,
        scrape: async () => [{ hash: "def", title: "New", size: "2 GB", seeders: 9 }],
        cacheManager: createCacheStateManager({ now: () => 20_000 }),
        runBackground: job => backgroundJobs.push(job),
        now: 20_000,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000
    });

    assert.equal(result.torrents[0].hash, "abc");
    assert.equal(result.source, "stale_cache");
    assert.equal(backgroundJobs.length, 1);

    await backgroundJobs[0]();

    const refreshed = await getTorrentsForStream({
        db: database,
        mediaKey,
        scrape: async () => [],
        cacheManager: createCacheStateManager({ now: () => 21_000 }),
        now: 21_000,
        freshTtlMs: 60_000,
        staleTtlMs: 60_000
    });

    assert.equal(refreshed.torrents.some(torrent => torrent.hash === "def"), true);

    closeDatabaseForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/stream-cache.test.js
```

Expected:

```text
Error: Cannot find module '../lib/cache/stream-cache'
```

- [ ] **Step 3: Implement stream cache orchestrator**

Create `lib/cache/stream-cache.js`:

```js
const { CacheDecision, createCacheStateManager } = require("./cache-state");
const { getDatabase } = require("./database");
const { getCachedTorrents, upsertTorrentCandidates } = require("./torrent-cache");

const sharedCacheManager = createCacheStateManager();

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function persistScrape(db, mediaKey, scrape, now) {
    const result = await scrape();
    const torrents = Array.isArray(result) ? result : result.torrentsArr || [];
    upsertTorrentCandidates(db, mediaKey, torrents, now);
    return torrents;
}

async function getTorrentsForStream(options) {
    const db = options.db || getDatabase();
    const mediaKey = options.mediaKey;
    const scrape = options.scrape;
    const now = options.now || Date.now();
    const freshTtlMs = options.freshTtlMs || envNumber("TORRENT_CACHE_FRESH_MS", 6 * 60 * 60 * 1000);
    const staleTtlMs = options.staleTtlMs || envNumber("TORRENT_CACHE_STALE_MS", 7 * 24 * 60 * 60 * 1000);
    const cacheManager = options.cacheManager || sharedCacheManager;
    const runBackground = options.runBackground || (job => setImmediate(() => job().catch(error => {
        console.error("[CACHE] Background scrape failed:", error.message);
    })));

    const cached = getCachedTorrents(db, mediaKey, { now, freshTtlMs });
    const decision = cacheManager.decide({
        mediaKey,
        torrentCount: cached.torrents.length,
        newestUpdatedAt: cached.newestUpdatedAt,
        freshTtlMs,
        staleTtlMs
    });

    if (decision.decision === CacheDecision.USE_CACHE) {
        return { torrents: cached.torrents, source: cached.fresh ? "cache" : "stale_cache", decision };
    }

    if (decision.decision === CacheDecision.SCRAPE_BACKGROUND) {
        runBackground(async () => {
            try {
                await persistScrape(db, mediaKey, scrape, Date.now());
            } finally {
                cacheManager.releaseLock(mediaKey);
            }
        });
        return { torrents: cached.torrents, source: "stale_cache", decision };
    }

    if (decision.decision === CacheDecision.WAIT_FOR_OTHER) {
        return { torrents: cached.torrents, source: "wait", decision };
    }

    try {
        const torrents = await persistScrape(db, mediaKey, scrape, now);
        return { torrents, source: "foreground_scrape", decision };
    } finally {
        cacheManager.releaseLock(mediaKey);
    }
}

module.exports = {
    getTorrentsForStream,
    persistScrape
};
```

- [ ] **Step 4: Run stream cache tests**

Run:

```bash
node --test tests/stream-cache.test.js
```

Expected:

```text
# pass 3
```

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cache/stream-cache.js tests/stream-cache.test.js
git commit -m "feat: orchestrate stream torrent cache"
```

---

### Task 7: Integrate Cache Into Stream Handler

**Files:**
- Modify: `addon.js`

- [ ] **Step 1: Add imports**

Modify the import block in `addon.js`:

```js
const { getTorrentsForStream } = require("./lib/cache/stream-cache");
const { buildMediaKey } = require("./lib/cache/torrent-cache");
const { checkStoreTorzWithCache } = require("./lib/cache/debrid-cache");
```

- [ ] **Step 2: Replace direct scrape execution**

Replace this block:

```js
const searchResult = await fetchAllPossibleTorrents();
let torrents = searchResult.torrentsArr;
```

With:

```js
const mediaKey = buildMediaKey({
    type,
    id,
    expectedSeason,
    requestedEp,
    isMovie,
    isRawSearch
});

const torrentResult = await getTorrentsForStream({
    mediaKey,
    scrape: fetchAllPossibleTorrents
});
let torrents = torrentResult.torrents;

if (torrentResult.source === "wait" && !torrents.length) {
    return {
        streams: [
            {
                name: "NEXIO TORII [INFO]\nCache warming",
                description: "First scrape is already running. Try this episode again in a few seconds.",
                url: BASE_URL + "/waiting.mp4"
            }
        ],
        cacheMaxAge: 15
    };
}
```

- [ ] **Step 3: Replace debrid availability checks**

Replace this block:

```js
const availabilityByEntry = await Promise.all(
    userConfig.debridServices.map(entry =>
        checkStoreTorz(hashes, entry).catch(error => {
            console.error(`[PIPELINE] ${entry.service} availability failed: ${error.message}`);
            return {};
        })
    )
);
```

With:

```js
const availabilityByEntry = await Promise.all(
    userConfig.debridServices.map(entry =>
        checkStoreTorzWithCache(hashes, entry, {
            scope: { season: expectedSeason, episode: requestedEp }
        }).catch(error => {
            console.error(`[PIPELINE] ${entry.service} availability failed: ${error.message}`);
            return {};
        })
    )
);
```

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Manual smoke test cold and warm stream**

Start the addon:

```bash
PORT=7020 BASE_URL=http://127.0.0.1:7020 npm start
```

In another terminal, request a stream twice:

```bash
curl -o /tmp/nexio-cold.json -s -w 'cold=%{time_total}\n' 'http://127.0.0.1:7020/stream/anime/anilist:20-1.json'
curl -o /tmp/nexio-warm.json -s -w 'warm=%{time_total}\n' 'http://127.0.0.1:7020/stream/anime/anilist:20-1.json'
```

Expected:

```text
cold=<any successful response time>
warm=<lower than cold after cache is populated>
```

Stop the server with `Ctrl-C`.

- [ ] **Step 6: Commit**

Run:

```bash
git add addon.js
git commit -m "feat: use cache-first stream lookup"
```

---

### Task 8: Add HTTP Cache Header Helper

**Files:**
- Create: `lib/cache/http-cache.js`
- Create: `tests/http-cache.test.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing HTTP cache tests**

Create `tests/http-cache.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildStreamCacheControl,
    shouldApplyStreamCache
} = require("../lib/cache/http-cache");

test("buildStreamCacheControl includes CDN stale directives", () => {
    assert.equal(
        buildStreamCacheControl({
            maxAge: 10,
            sMaxAge: 20,
            staleWhileRevalidate: 30,
            staleIfError: 40
        }),
        "public, max-age=10, s-maxage=20, stale-while-revalidate=30, stale-if-error=40"
    );
});

test("shouldApplyStreamCache matches addon stream and manifest paths", () => {
    assert.equal(shouldApplyStreamCache("/stream/anime/anilist:20-1.json"), true);
    assert.equal(shouldApplyStreamCache("/manifest.json"), true);
    assert.equal(shouldApplyStreamCache("/configure"), true);
    assert.equal(shouldApplyStreamCache("/resolve/payload/0/hash/1"), false);
    assert.equal(shouldApplyStreamCache("/sub/payload/0/hash/1"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/http-cache.test.js
```

Expected:

```text
Error: Cannot find module '../lib/cache/http-cache'
```

- [ ] **Step 3: Implement HTTP cache helper**

Create `lib/cache/http-cache.js`:

```js
function numberFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function buildStreamCacheControl(options = {}) {
    const maxAge = options.maxAge ?? numberFromEnv("STREAM_HTTP_MAX_AGE_SECONDS", 1800);
    const sMaxAge = options.sMaxAge ?? numberFromEnv("STREAM_HTTP_S_MAXAGE_SECONDS", 3600);
    const staleWhileRevalidate = options.staleWhileRevalidate ?? numberFromEnv("STREAM_HTTP_STALE_REVALIDATE_SECONDS", 21600);
    const staleIfError = options.staleIfError ?? numberFromEnv("STREAM_HTTP_STALE_ERROR_SECONDS", 300);

    return [
        "public",
        `max-age=${maxAge}`,
        `s-maxage=${sMaxAge}`,
        `stale-while-revalidate=${staleWhileRevalidate}`,
        `stale-if-error=${staleIfError}`
    ].join(", ");
}

function shouldApplyStreamCache(pathname) {
    return pathname.startsWith("/stream/")
        || pathname === "/manifest.json"
        || pathname === "/configure";
}

function applyHttpCacheHeaders(req, res, next) {
    if (req.method === "GET" && shouldApplyStreamCache(req.path)) {
        res.setHeader("Cache-Control", buildStreamCacheControl());
    }
    next();
}

module.exports = {
    applyHttpCacheHeaders,
    buildStreamCacheControl,
    shouldApplyStreamCache
};
```

- [ ] **Step 4: Wire middleware into server**

In `server.js`, add:

```js
const { applyHttpCacheHeaders } = require("./lib/cache/http-cache");
```

Then add this after the CORS middleware and before static routes:

```js
app.use(applyHttpCacheHeaders);
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cache/http-cache.js tests/http-cache.test.js server.js
git commit -m "feat: add stream cache headers"
```

---

### Task 9: Document Cache Behavior And Phase 2 Source Deferral

**Files:**
- Modify: `readme.md`

- [ ] **Step 1: Add README cache section**

Add this section to `readme.md` near the deployment/configuration area:

```markdown
## Cache Behavior

Nexio Torii uses a SQLite cache at `data/nexio-cache.sqlite` by default. The cache is designed to make stream requests return from local data whenever possible, then refresh tracker results in the background when cached data becomes stale.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CACHE_DB_PATH` | `data/nexio-cache.sqlite` | SQLite database path |
| `TORRENT_CACHE_FRESH_MS` | `21600000` | Time torrent results are considered fresh |
| `TORRENT_CACHE_STALE_MS` | `604800000` | Time stale torrent results can still be returned while refreshing |
| `DEBRID_CACHE_TTL_MS` | `86400000` | Time StremThru availability is cached per service/hash/episode |
| `STREAM_HTTP_MAX_AGE_SECONDS` | `1800` | Browser stream response cache TTL |
| `STREAM_HTTP_S_MAXAGE_SECONDS` | `3600` | CDN stream response cache TTL |
| `STREAM_HTTP_STALE_REVALIDATE_SECONDS` | `21600` | CDN stale-while-revalidate window |
| `STREAM_HTTP_STALE_ERROR_SECONDS` | `300` | CDN stale-if-error window |

The current source set remains Nyaa, AnimeTosho, and TokyoTosho. SubsPlease, TokyoTosho account-specific behavior, and Beatrice-Raws are intentionally deferred until the cache layer is stable.
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 3: Commit**

Run:

```bash
git add readme.md
git commit -m "docs: document cache behavior"
```

---

### Task 10: Verify Docker Build And Runtime Cache

**Files:**
- No new files

- [ ] **Step 1: Build Docker image**

Run:

```bash
docker build -t nexio-torii-cache-test .
```

Expected:

```text
Successfully tagged nexio-torii-cache-test:latest
```

- [ ] **Step 2: Run container with cache volume**

Run:

```bash
docker run --rm -p 7021:7002 -e PORT=7002 -e BASE_URL=http://127.0.0.1:7021 -v nexio-torii-cache-test:/app/data nexio-torii-cache-test
```

Expected:

```text
NEXIO TORII ONLINE | PORT 7002
```

- [ ] **Step 3: Smoke test stream endpoint**

In another terminal:

```bash
curl -o /tmp/nexio-docker-stream.json -s -w 'docker_stream=%{http_code} %{time_total}\n' 'http://127.0.0.1:7021/stream/anime/anilist:20-1.json'
```

Expected:

```text
docker_stream=200 <response time>
```

- [ ] **Step 4: Verify SQLite file exists in volume**

Stop the container with `Ctrl-C`, then run:

```bash
docker run --rm -v nexio-torii-cache-test:/cache alpine ls -la /cache
```

Expected output includes:

```text
nexio-cache.sqlite
```

- [ ] **Step 5: Run full tests one final time**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit verification fixes if needed**

If Docker build or runtime verification required changes, commit them:

```bash
git add Dockerfile docker-compose.yml package.json package-lock.json readme.md lib tests addon.js server.js .gitignore
git commit -m "fix: complete cache runtime verification"
```

Skip this commit if no files changed during verification.

---

## Self-Review

Spec coverage:

- Comet-style torrent cache: Tasks 2, 3, 4, 6, and 7.
- Debrid cache per service/hash/scope: Task 5 and Task 7.
- Avoid immediate new sources: Scope section and Task 9 document this as a phase 2 deferral.
- Docker image continues to build: Task 1 and Task 10.
- Tests: Every code module has a focused `node:test` file.

Placeholder scan:

- The plan contains no unresolved placeholder markers.
- The plan contains no open-ended implementation steps without code.
- Phase 2 source work is declared out of scope rather than left as an unfinished step.

Type consistency:

- `mediaKey`, `requestedEp`, `expectedSeason`, `isMovie`, and `isRawSearch` names match the existing `addon.js` variables.
- Debrid availability keeps the existing `checkStoreTorz` result shape: `{ [hash]: { hash, status, isCached, files } }`.
- Cached torrents keep the existing stream builder shape: `{ hash, title, size, seeders }`.
