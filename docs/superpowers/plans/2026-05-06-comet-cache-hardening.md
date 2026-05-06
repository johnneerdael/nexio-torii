# Comet Cache Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the concrete gaps found in the Comet cache review so Nexio Torii applies cache headers to real configured routes, coordinates scrapes through SQLite, throttles empty-result misses, and supports ETag-based 304 responses.

**Architecture:** Keep the existing cache modules and extend them instead of replacing them. `http-cache.js` owns route matching, cache-control, ETag generation, and conditional response handling. `cache-state.js` gets a SQLite lock adapter while preserving the same `decide()` and `releaseLock()` interface used by `stream-cache.js`; `stream-cache.js` records empty scrape attempts so cold misses do not repeatedly hit trackers.

**Tech Stack:** Node.js CommonJS, `node:test`, `better-sqlite3`, Express middleware, existing Nexio Torii cache modules.

---

## Scope

In scope:

- Apply HTTP cache headers to configured Stremio routes such as `/<encoded-config>/stream/...` and `/<encoded-config>/manifest.json`.
- Add ETag generation and `If-None-Match` handling for cacheable JSON responses.
- Replace in-memory scrape locks with SQLite-backed locks using the existing `scrape_locks` table.
- Add persistent empty-result cache state so repeated no-result searches return quickly for a short TTL.
- Preserve the existing `getTorrentsForStream()` and `createCacheStateManager()` public interfaces.
- Add tests for the review findings.

Out of scope:

- New source integrations.
- A full distributed lock service outside SQLite.
- Rewriting the legacy scraper cascade or reducing TokyoTosho timeouts.
- Account-snapshot scraping from debrid services.

## File Structure

- Modify `lib/cache/http-cache.js`: recognize configured routes, build ETags, handle conditional GETs, and expose pure helpers for tests.
- Modify `tests/http-cache.test.js`: add tests for configured route matching and ETag/304 handling.
- Modify `lib/cache/database.js`: add `empty_searches` table.
- Modify `tests/cache-database.test.js`: assert the new table exists.
- Modify `lib/cache/cache-state.js`: add SQLite lock adapter and empty-search decision inputs.
- Modify `tests/cache-state.test.js`: test shared SQLite locks and empty-search throttling.
- Modify `lib/cache/stream-cache.js`: read/write empty-search rows and pass empty-search state to cache-state decisions.
- Modify `tests/stream-cache.test.js`: test empty result throttling and lock sharing across manager instances.
- Modify `readme.md`: document the empty-search TTL and SQLite lock behavior.

## Cache Defaults

Use this new default unless overridden:

```js
const EMPTY_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
```

---

### Task 1: Fix Cache Headers For Configured Routes And Add ETag Helpers

**Files:**
- Modify: `lib/cache/http-cache.js`
- Modify: `tests/http-cache.test.js`

- [ ] **Step 1: Write failing HTTP cache tests**

Replace `tests/http-cache.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    applyHttpCacheHeaders,
    buildStreamCacheControl,
    checkEtagMatch,
    generateEtag,
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

test("shouldApplyStreamCache matches direct and configured addon paths", () => {
    assert.equal(shouldApplyStreamCache("/stream/anime/anilist:20-1.json"), true);
    assert.equal(shouldApplyStreamCache("/manifest.json"), true);
    assert.equal(shouldApplyStreamCache("/configure"), true);
    assert.equal(shouldApplyStreamCache("/%7B%22NexioTorii%22%3A%22abc%22%7D/stream/anime/anilist:20-1.json"), true);
    assert.equal(shouldApplyStreamCache("/%7B%22NexioTorii%22%3A%22abc%22%7D/manifest.json"), true);
    assert.equal(shouldApplyStreamCache("/resolve/payload/0/hash/1"), false);
    assert.equal(shouldApplyStreamCache("/sub/payload/0/hash/1"), false);
});

test("generateEtag is stable for equivalent JSON objects", () => {
    assert.equal(
        generateEtag({ streams: [{ name: "A", url: "https://example.test" }] }),
        generateEtag({ streams: [{ name: "A", url: "https://example.test" }] })
    );
    assert.notEqual(generateEtag({ streams: [] }), generateEtag({ streams: [{ name: "A" }] }));
});

test("checkEtagMatch accepts weak and strong matching etags", () => {
    const etag = generateEtag({ streams: [] });

    assert.equal(checkEtagMatch(etag, etag), true);
    assert.equal(checkEtagMatch(etag.replace("W/", ""), etag), true);
    assert.equal(checkEtagMatch("W/\"different\"", etag), false);
    assert.equal(checkEtagMatch("*", etag), true);
});

test("applyHttpCacheHeaders patches json to emit etag and 304", () => {
    const headers = {};
    let statusCode = 200;
    let ended = false;
    let sentBody = null;
    const body = { streams: [] };
    const etag = generateEtag(body);
    const req = {
        method: "GET",
        path: "/%7B%22NexioTorii%22%3A%22abc%22%7D/stream/anime/anilist:20-1.json",
        headers: { "if-none-match": etag }
    };
    const res = {
        setHeader: (name, value) => { headers[name] = value; },
        getHeader: name => headers[name],
        status: code => {
            statusCode = code;
            return res;
        },
        end: () => {
            ended = true;
            return res;
        },
        json: value => {
            sentBody = value;
            return res;
        }
    };

    applyHttpCacheHeaders(req, res, () => {});
    res.json(body);

    assert.equal(statusCode, 304);
    assert.equal(ended, true);
    assert.equal(sentBody, null);
    assert.equal(headers.ETag, etag);
    assert.equal(headers["Cache-Control"].includes("stale-while-revalidate"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/http-cache.test.js
```

Expected:

```text
not ok
```

Failures should include missing exports for `generateEtag` and `checkEtagMatch`, and configured route matching returning `false`.

- [ ] **Step 3: Implement configured route matching and ETags**

Replace `lib/cache/http-cache.js` with:

```js
const crypto = require("node:crypto");

function numberFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function stableJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function generateEtag(value) {
    const content = Buffer.isBuffer(value) ? value : Buffer.from(stableJson(value));
    const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
    return `W/"${hash}"`;
}

function normalizeEtag(value) {
    return String(value || "").trim().replace(/^W\//, "");
}

function checkEtagMatch(ifNoneMatch, etag) {
    if (!ifNoneMatch) return false;
    return String(ifNoneMatch).split(",").some(candidate => {
        const trimmed = candidate.trim();
        return trimmed === "*" || normalizeEtag(trimmed) === normalizeEtag(etag);
    });
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
    const path = String(pathname || "");
    return path === "/configure"
        || path === "/manifest.json"
        || path.endsWith("/manifest.json")
        || path.startsWith("/stream/")
        || path.includes("/stream/");
}

function patchJsonResponse(req, res, cacheControl) {
    if (res.__nexioCachePatched) return;
    res.__nexioCachePatched = true;

    const originalJson = res.json.bind(res);
    res.json = body => {
        const etag = generateEtag(body);
        res.setHeader("ETag", etag);
        res.setHeader("Vary", "Accept, Accept-Encoding");
        res.setHeader("Cache-Control", cacheControl);

        if (checkEtagMatch(req.headers && req.headers["if-none-match"], etag)) {
            return res.status(304).end();
        }

        return originalJson(body);
    };
}

function applyHttpCacheHeaders(req, res, next) {
    if (req.method === "GET" && shouldApplyStreamCache(req.path)) {
        const cacheControl = buildStreamCacheControl();
        res.setHeader("Cache-Control", cacheControl);
        patchJsonResponse(req, res, cacheControl);
    }
    next();
}

module.exports = {
    applyHttpCacheHeaders,
    buildStreamCacheControl,
    checkEtagMatch,
    generateEtag,
    shouldApplyStreamCache
};
```

- [ ] **Step 4: Run HTTP cache tests**

Run:

```bash
node --test tests/http-cache.test.js
```

Expected:

```text
# pass 5
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
git add lib/cache/http-cache.js tests/http-cache.test.js
git commit -m "fix: cache configured stremio routes"
```

---

### Task 2: Add SQLite-Backed Scrape Locks

**Files:**
- Modify: `lib/cache/cache-state.js`
- Modify: `tests/cache-state.test.js`

- [ ] **Step 1: Add failing SQLite lock tests**

Append these tests to `tests/cache-state.test.js`:

```js
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { getDatabase, closeDatabaseForTests } = require("../lib/cache/database");

function tempDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-cache-state-"));
    return getDatabase({ dbPath: path.join(dir, "cache.sqlite") });
}

test("sqlite locks are shared across manager instances", () => {
    const database = tempDb();
    const first = createCacheStateManager({ db: database, now: () => 1000, lockTtlMs: 10_000 });
    const second = createCacheStateManager({ db: database, now: () => 1000, lockTtlMs: 10_000 });

    const firstResult = first.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    const secondResult = second.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });

    assert.equal(firstResult.decision, CacheDecision.SCRAPE_FOREGROUND);
    assert.equal(secondResult.decision, CacheDecision.WAIT_FOR_OTHER);

    first.releaseLock("media");
    const thirdResult = second.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    assert.equal(thirdResult.decision, CacheDecision.SCRAPE_FOREGROUND);

    closeDatabaseForTests();
});

test("sqlite locks expire across manager instances", () => {
    const database = tempDb();
    let currentTime = 1000;
    const first = createCacheStateManager({ db: database, now: () => currentTime, lockTtlMs: 10_000 });
    const second = createCacheStateManager({ db: database, now: () => currentTime, lockTtlMs: 10_000 });

    first.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });
    currentTime = 12_000;
    const result = second.decide({ mediaKey: "media", torrentCount: 0, newestUpdatedAt: 0, freshTtlMs: 1, staleTtlMs: 60_000 });

    assert.equal(result.decision, CacheDecision.SCRAPE_FOREGROUND);

    closeDatabaseForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/cache-state.test.js
```

Expected:

```text
not ok
```

The new tests should fail because `createCacheStateManager({ db })` still uses a per-instance `Map`.

- [ ] **Step 3: Implement SQLite lock adapter**

Replace `lib/cache/cache-state.js` with:

```js
const CacheState = Object.freeze({
    FRESH: "fresh",
    STALE: "stale",
    EMPTY: "empty",
    EXPIRED: "expired",
    EMPTY_RECENT: "empty_recent"
});

const CacheDecision = Object.freeze({
    USE_CACHE: "use_cache",
    SCRAPE_BACKGROUND: "scrape_background",
    SCRAPE_FOREGROUND: "scrape_foreground",
    WAIT_FOR_OTHER: "wait_for_other",
    USE_EMPTY_CACHE: "use_empty_cache"
});

function createMemoryLockStore(now, lockTtlMs) {
    const locks = new Map();

    function cleanup(currentTime) {
        for (const [key, expiresAt] of locks.entries()) {
            if (expiresAt <= currentTime) locks.delete(key);
        }
    }

    return {
        acquire(mediaKey) {
            const currentTime = now();
            cleanup(currentTime);
            if (locks.has(mediaKey)) return false;
            locks.set(mediaKey, currentTime + lockTtlMs);
            return true;
        },
        release(mediaKey) {
            locks.delete(mediaKey);
        }
    };
}

function createSqliteLockStore(db, now, lockTtlMs) {
    const deleteExpired = db.prepare("DELETE FROM scrape_locks WHERE locked_until <= ?");
    const insertLock = db.prepare("INSERT OR IGNORE INTO scrape_locks (media_key, locked_until) VALUES (?, ?)");
    const deleteLock = db.prepare("DELETE FROM scrape_locks WHERE media_key = ?");

    return {
        acquire(mediaKey) {
            const currentTime = now();
            deleteExpired.run(currentTime);
            const result = insertLock.run(mediaKey, currentTime + lockTtlMs);
            return result.changes === 1;
        },
        release(mediaKey) {
            deleteLock.run(mediaKey);
        }
    };
}

function createCacheStateManager(options = {}) {
    const now = options.now || Date.now;
    const lockTtlMs = options.lockTtlMs || 30_000;
    const lockStore = options.lockStore || (options.db
        ? createSqliteLockStore(options.db, now, lockTtlMs)
        : createMemoryLockStore(now, lockTtlMs));

    function tryAcquireLock(mediaKey) {
        return lockStore.acquire(mediaKey);
    }

    function releaseLock(mediaKey) {
        lockStore.release(mediaKey);
    }

    function determineState({ torrentCount, newestUpdatedAt, freshTtlMs, staleTtlMs, emptyFresh }) {
        if (torrentCount <= 0) return emptyFresh ? CacheState.EMPTY_RECENT : CacheState.EMPTY;
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

        if (state === CacheState.EMPTY_RECENT) {
            return { state, decision: CacheDecision.USE_EMPTY_CACHE, lockAcquired: false };
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
    createCacheStateManager,
    createMemoryLockStore,
    createSqliteLockStore
};
```

- [ ] **Step 4: Run cache-state tests**

Run:

```bash
node --test tests/cache-state.test.js
```

Expected:

```text
# pass 6
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
git commit -m "fix: coordinate scrapes with sqlite locks"
```

---

### Task 3: Add Empty-Result Cache State

**Files:**
- Modify: `lib/cache/database.js`
- Modify: `tests/cache-database.test.js`
- Modify: `lib/cache/stream-cache.js`
- Modify: `tests/stream-cache.test.js`

- [ ] **Step 1: Extend database test for empty searches**

Modify the table assertions in `tests/cache-database.test.js` so the first test includes:

```js
assert.ok(tables.includes("empty_searches"));
```

- [ ] **Step 2: Run database test to verify it fails**

Run:

```bash
node --test tests/cache-database.test.js
```

Expected:

```text
not ok
```

The failure should show `tables.includes("empty_searches")` is false.

- [ ] **Step 3: Add empty_searches schema**

In `lib/cache/database.js`, add this table after `scrape_locks`:

```js
        CREATE TABLE IF NOT EXISTS empty_searches (
            media_key TEXT PRIMARY KEY,
            updated_at INTEGER NOT NULL
        );
```

- [ ] **Step 4: Add failing stream-cache empty result test**

Append this test to `tests/stream-cache.test.js`:

```js
test("empty scrape result is throttled for empty search ttl", async () => {
    const database = db();
    let scrapeCalls = 0;

    const first = await getTorrentsForStream({
        db: database,
        mediaKey: "missing-media",
        scrape: async () => {
            scrapeCalls++;
            return [];
        },
        cacheManager: createCacheStateManager({ db: database, now: () => 10_000 }),
        now: 10_000,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000,
        emptyTtlMs: 60_000
    });

    const second = await getTorrentsForStream({
        db: database,
        mediaKey: "missing-media",
        scrape: async () => {
            scrapeCalls++;
            return [];
        },
        cacheManager: createCacheStateManager({ db: database, now: () => 20_000 }),
        now: 20_000,
        freshTtlMs: 1_000,
        staleTtlMs: 60_000,
        emptyTtlMs: 60_000
    });

    assert.equal(first.source, "foreground_scrape");
    assert.equal(second.source, "empty_cache");
    assert.equal(scrapeCalls, 1);

    closeDatabaseForTests();
});
```

- [ ] **Step 5: Run stream-cache test to verify it fails**

Run:

```bash
node --test tests/stream-cache.test.js
```

Expected:

```text
not ok
```

The failure should show the second request scraped again or returned the wrong source.

- [ ] **Step 6: Implement empty search helpers and integration**

Replace `lib/cache/stream-cache.js` with:

```js
const { CacheDecision, createCacheStateManager } = require("./cache-state");
const { getDatabase } = require("./database");
const { getCachedTorrents, upsertTorrentCandidates } = require("./torrent-cache");

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createSharedCacheManager() {
    return createCacheStateManager({ db: getDatabase() });
}

let sharedCacheManager = null;

function getSharedCacheManager() {
    if (!sharedCacheManager) sharedCacheManager = createSharedCacheManager();
    return sharedCacheManager;
}

function getEmptySearch(db, mediaKey, options = {}) {
    const now = options.now || Date.now();
    const ttlMs = options.ttlMs || envNumber("EMPTY_SEARCH_CACHE_TTL_MS", 5 * 60 * 1000);
    const row = db.prepare(`
        SELECT updated_at
        FROM empty_searches
        WHERE media_key = ?
        AND updated_at >= ?
    `).get(mediaKey, now - ttlMs);

    return {
        fresh: Boolean(row),
        updatedAt: row ? row.updated_at : 0
    };
}

function markEmptySearch(db, mediaKey, now = Date.now()) {
    db.prepare(`
        INSERT INTO empty_searches (media_key, updated_at)
        VALUES (?, ?)
        ON CONFLICT(media_key) DO UPDATE SET updated_at = excluded.updated_at
    `).run(mediaKey, now);
}

function clearEmptySearch(db, mediaKey) {
    db.prepare("DELETE FROM empty_searches WHERE media_key = ?").run(mediaKey);
}

async function persistScrape(db, mediaKey, scrape, now) {
    const result = await scrape();
    const torrents = Array.isArray(result) ? result : result.torrentsArr || [];
    if (torrents.length > 0) {
        upsertTorrentCandidates(db, mediaKey, torrents, now);
        clearEmptySearch(db, mediaKey);
    } else {
        markEmptySearch(db, mediaKey, now);
    }
    return torrents;
}

async function getTorrentsForStream(options) {
    const db = options.db || getDatabase();
    const mediaKey = options.mediaKey;
    const scrape = options.scrape;
    const now = options.now || Date.now();
    const freshTtlMs = options.freshTtlMs || envNumber("TORRENT_CACHE_FRESH_MS", 6 * 60 * 60 * 1000);
    const staleTtlMs = options.staleTtlMs || envNumber("TORRENT_CACHE_STALE_MS", 7 * 24 * 60 * 60 * 1000);
    const emptyTtlMs = options.emptyTtlMs || envNumber("EMPTY_SEARCH_CACHE_TTL_MS", 5 * 60 * 1000);
    const cacheManager = options.cacheManager || getSharedCacheManager();
    const runBackground = options.runBackground || (job => setImmediate(() => job().catch(error => {
        console.error("[CACHE] Background scrape failed:", error.message);
    })));

    const cached = getCachedTorrents(db, mediaKey, { now, freshTtlMs });
    const emptySearch = getEmptySearch(db, mediaKey, { now, ttlMs: emptyTtlMs });
    const decision = cacheManager.decide({
        mediaKey,
        torrentCount: cached.torrents.length,
        newestUpdatedAt: cached.newestUpdatedAt,
        freshTtlMs,
        staleTtlMs,
        emptyFresh: emptySearch.fresh
    });

    if (decision.decision === CacheDecision.USE_EMPTY_CACHE) {
        return { torrents: [], source: "empty_cache", decision };
    }

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
    clearEmptySearch,
    getEmptySearch,
    getTorrentsForStream,
    markEmptySearch,
    persistScrape
};
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
node --test tests/cache-database.test.js tests/cache-state.test.js tests/stream-cache.test.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 9: Commit**

Run:

```bash
git add lib/cache/database.js lib/cache/stream-cache.js tests/cache-database.test.js tests/stream-cache.test.js
git commit -m "feat: throttle empty stream searches"
```

---

### Task 4: Document Hardening Behavior

**Files:**
- Modify: `readme.md`

- [ ] **Step 1: Update cache documentation**

In the Cache Behavior environment variable table in `readme.md`, add:

```markdown
| `EMPTY_SEARCH_CACHE_TTL_MS` | `300000` | Time no-result searches are remembered to avoid repeated tracker misses |
```

After the table, add:

```markdown
Scrape coordination uses SQLite-backed locks in the same cache database, so multiple containers sharing the same `/app/data` volume avoid duplicate foreground scrapes for the same media key.

Stream and manifest responses include CDN-friendly `Cache-Control` headers and ETags for both direct and configured Stremio routes.
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
git commit -m "docs: document cache hardening behavior"
```

---

### Task 5: Verify Runtime Behavior

**Files:**
- No planned code files.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: Verify configured-route cache headers**

Run:

```bash
PORT=7020 BASE_URL=http://127.0.0.1:7020 CACHE_DB_PATH=/tmp/nexio-cache-hardening.sqlite npm start
```

In a second terminal, run:

```bash
CONFIG='%7B%22NexioTorii%22%3A%22eyJ1c2VFbmdsaXNoVGl0bGVzIjpmYWxzZSwic2hvd1NlYXNvbmFsU2VyaWVzIjp0cnVlLCJzaG93QWlyaW5nU2VyaWVzIjp0cnVlLCJzaG93VHJlbmRpbmdTZXJpZXMiOnRydWUsInNob3dUb3BTZXJpZXMiOnRydWUsInNob3dUcmVuZGluZ01vdmllcyI6dHJ1ZSwic2hvd1RvcE1vdmllcyI6dHJ1ZSwiaGlkZVVuY2FjaGVkIjpmYWxzZSwiZW5hYmxlUDJQIjp0cnVlLCJkZWJyaWRTZXJ2aWNlcyI6W10sImxhbmd1YWdlIjpbIkVORyJdLCJyZXNvbHV0aW9ucyI6WyIxMDgwcCIsIjcyMHAiLCI0ODBwIiwiU0QiXX0%22%7D'
curl -s -D /tmp/nexio-hardening-headers.txt -o /tmp/nexio-hardening-body.json "http://127.0.0.1:7020/$CONFIG/stream/anime/anilist:20-1.json"
grep -Ei 'cache-control|etag|vary' /tmp/nexio-hardening-headers.txt
```

Expected output includes:

```text
Cache-Control: public, max-age=1800, s-maxage=3600, stale-while-revalidate=21600, stale-if-error=300
ETag: W/"
Vary: Accept, Accept-Encoding
```

- [ ] **Step 3: Verify 304 response**

Run:

```bash
ETAG=$(grep -i '^ETag:' /tmp/nexio-hardening-headers.txt | sed 's/^[Ee][Tt][Aa][Gg]: //' | tr -d '\r')
curl -s -D /tmp/nexio-hardening-304.txt -o /tmp/nexio-hardening-304-body.txt -H "If-None-Match: $ETAG" "http://127.0.0.1:7020/$CONFIG/stream/anime/anilist:20-1.json"
head -n 1 /tmp/nexio-hardening-304.txt
wc -c /tmp/nexio-hardening-304-body.txt
```

Expected:

```text
HTTP/1.1 304 Not Modified
0 /tmp/nexio-hardening-304-body.txt
```

- [ ] **Step 4: Stop server**

Stop the running server with `Ctrl-C`.

- [ ] **Step 5: Build Docker image**

Run:

```bash
docker build -t nexio-torii-cache-hardening-test .
```

Expected:

```text
Successfully tagged nexio-torii-cache-hardening-test:latest
```

- [ ] **Step 6: Commit verification fixes if needed**

If verification required code changes, commit them:

```bash
git add lib/cache tests readme.md server.js
git commit -m "fix: complete cache hardening verification"
```

Skip this commit if no files changed during verification.

---

## Self-Review

Spec coverage:

- Configured route cache headers: Task 1.
- ETag and 304 behavior: Task 1 and Task 5.
- SQLite-backed scrape locks: Task 2.
- Empty/no-result search throttling: Task 3.
- Documentation: Task 4.
- Runtime verification: Task 5.

Placeholder scan:

- The plan contains no unresolved placeholder markers.
- All code-changing steps include concrete code.
- No task uses broad instructions without exact file paths and commands.

Type consistency:

- `createCacheStateManager()` still returns `decide()`, `releaseLock()`, and `tryAcquireLock()`, matching `stream-cache.js`.
- `CacheDecision.USE_EMPTY_CACHE` is introduced before `stream-cache.js` uses it.
- `EMPTY_SEARCH_CACHE_TTL_MS` is used consistently in code and README.
