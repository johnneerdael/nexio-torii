# Initial Full Catalog Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ingest container perform an uncapped initial backfill across Nyaa, AnimeTosho, and TokyoTosho, then switch to bounded daily incremental updates.

**Architecture:** Add explicit ingestion phases: `backfill` runs once per persistent SQLite database and records a checkpoint; `daily` runs every interval afterward. Backfill uses source-specific crawlers: Nyaa and TokyoTosho paginate listing pages until an empty page or configured max page; AnimeTosho uses a TSV/export path when configured and falls back to JSON feed. Daily mode remains bounded and opportunistic to avoid hammering fragile upstreams.

**Tech Stack:** Node.js CommonJS, `better-sqlite3`, `axios`, `cheerio`, existing catalog ingestion/resolver pipeline, Docker Compose.

---

## File Structure

- Modify `lib/catalog/database.js`: add `catalog_backfill_state` table for persistent backfill completion.
- Create `lib/catalog/backfill-state.js`: read/write first-run backfill state.
- Create `lib/catalog/source/backfill.js`: shared async page collector and source-specific backfill fetchers.
- Modify `lib/catalog/source/animetosho.js`: add `fetchTorrentsTsv` for full AnimeTosho export ingestion.
- Modify `scripts/catalog-ingest.js`: support `--mode backfill`, `--max-pages`, `--page-delay-ms`, `--animetosho-tsv-url`, and source-specific backfill fetchers.
- Modify `lib/catalog/daily-runner.js`: add `runStartupBackfillIfNeeded` before normal daily cycles.
- Modify `scripts/catalog-daily-runner.js`: parse backfill options separately from daily options and call startup backfill.
- Modify `docker-compose.yml`: remove `--limit 25`, set explicit daily limit via env/default args, and enable uncapped startup backfill.
- Update tests:
  - `tests/catalog-database.test.js`
  - `tests/catalog-backfill-state.test.js`
  - `tests/catalog-source-backfill.test.js`
  - `tests/catalog-source-parsers.test.js`
  - `tests/catalog-cli.test.js`
  - `tests/catalog-daily-runner.test.js`

---

### Task 1: Backfill State Table

**Files:**
- Modify: `lib/catalog/database.js`
- Create: `lib/catalog/backfill-state.js`
- Test: `tests/catalog-database.test.js`
- Test: `tests/catalog-backfill-state.test.js`

- [ ] **Step 1: Add database table test**

Append to `tests/catalog-database.test.js`:

```js
test("catalog database creates backfill state table", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);

    assert.ok(tables.includes("catalog_backfill_state"));

    db.close();
    closeCatalogDatabaseForTests();
});
```

- [ ] **Step 2: Add backfill state tests**

Create `tests/catalog-backfill-state.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");
const {
    isBackfillComplete,
    markBackfillComplete,
    markBackfillFailed,
    readBackfillState
} = require("../lib/catalog/backfill-state");

test("backfill state starts incomplete", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });

    assert.equal(isBackfillComplete(db), false);
    assert.equal(readBackfillState(db), null);

    db.close();
    closeCatalogDatabaseForTests();
});

test("markBackfillComplete persists completion details", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });

    markBackfillComplete(db, {
        startedAt: 1000,
        finishedAt: 2000,
        summary: { nyaa: { scanned: 10 }, animetosho: { scanned: 20 }, tokyotosho: { scanned: 5 } }
    });

    const state = readBackfillState(db);
    assert.equal(isBackfillComplete(db), true);
    assert.equal(state.status, "complete");
    assert.equal(state.started_at, 1000);
    assert.equal(state.finished_at, 2000);
    assert.deepEqual(JSON.parse(state.summary_json).animetosho, { scanned: 20 });

    db.close();
    closeCatalogDatabaseForTests();
});

test("markBackfillFailed records retryable failure", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });

    markBackfillFailed(db, {
        startedAt: 1000,
        finishedAt: 1500,
        error: "tokyotosho timeout",
        summary: { nyaa: { scanned: 10 } }
    });

    const state = readBackfillState(db);
    assert.equal(isBackfillComplete(db), false);
    assert.equal(state.status, "failed");
    assert.equal(state.error, "tokyotosho timeout");

    db.close();
    closeCatalogDatabaseForTests();
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
node --test tests/catalog-database.test.js tests/catalog-backfill-state.test.js
```

Expected: FAIL because `catalog_backfill_state` and `lib/catalog/backfill-state.js` do not exist.

- [ ] **Step 4: Add database table**

In `lib/catalog/database.js`, add this DDL before `ingestion_checkpoints`:

```sql
        CREATE TABLE IF NOT EXISTS catalog_backfill_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          status TEXT NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          error TEXT,
          summary_json TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL
        );
```

- [ ] **Step 5: Implement state helper**

Create `lib/catalog/backfill-state.js`:

```js
function readBackfillState(db) {
    return db.prepare("SELECT * FROM catalog_backfill_state WHERE id = 1").get() || null;
}

function isBackfillComplete(db) {
    return readBackfillState(db)?.status === "complete";
}

function upsertBackfillState(db, row) {
    db.prepare(`
        INSERT INTO catalog_backfill_state (
            id, status, started_at, finished_at, error, summary_json, updated_at
        ) VALUES (
            1, @status, @started_at, @finished_at, @error, @summary_json, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            error = excluded.error,
            summary_json = excluded.summary_json,
            updated_at = excluded.updated_at
    `).run(row);
}

function markBackfillComplete(db, options) {
    upsertBackfillState(db, {
        status: "complete",
        started_at: options.startedAt,
        finished_at: options.finishedAt,
        error: null,
        summary_json: JSON.stringify(options.summary || {}),
        updated_at: options.finishedAt
    });
}

function markBackfillFailed(db, options) {
    upsertBackfillState(db, {
        status: "failed",
        started_at: options.startedAt,
        finished_at: options.finishedAt,
        error: options.error || "unknown backfill failure",
        summary_json: JSON.stringify(options.summary || {}),
        updated_at: options.finishedAt
    });
}

module.exports = {
    isBackfillComplete,
    markBackfillComplete,
    markBackfillFailed,
    readBackfillState
};
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/catalog-database.test.js tests/catalog-backfill-state.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/catalog/database.js lib/catalog/backfill-state.js tests/catalog-database.test.js tests/catalog-backfill-state.test.js
git commit -m "feat(catalog): track initial backfill state"
```

---

### Task 2: Source Backfill Fetchers

**Files:**
- Create: `lib/catalog/source/backfill.js`
- Modify: `lib/catalog/source/animetosho.js`
- Test: `tests/catalog-source-backfill.test.js`
- Test: `tests/catalog-source-parsers.test.js`

- [ ] **Step 1: Add source backfill tests**

Create `tests/catalog-source-backfill.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    collectPagedBackfill,
    fetchAnimeToshoBackfill,
    fetchNyaaBackfill,
    fetchTokyoToshoBackfill
} = require("../lib/catalog/source/backfill");

test("collectPagedBackfill stops at empty page", async () => {
    const calls = [];
    const items = await collectPagedBackfill({
        maxPages: 5,
        fetchPage: async page => {
            calls.push(page);
            if (page === 1) return [{ id: 1 }];
            if (page === 2) return [{ id: 2 }];
            return [];
        },
        sleep: async () => {}
    });

    assert.deepEqual(calls, [1, 2, 3]);
    assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
});

test("collectPagedBackfill honors maxPages", async () => {
    const items = await collectPagedBackfill({
        maxPages: 2,
        fetchPage: async page => [{ id: page }],
        sleep: async () => {}
    });

    assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
});

test("fetchNyaaBackfill paginates Nyaa listing pages", async () => {
    const pages = [];
    const source = {
        fetchListingPage: async page => {
            pages.push(page);
            return page < 3 ? [{ sourceItemId: `nyaa-${page}` }] : [];
        }
    };

    const items = await fetchNyaaBackfill({ source, maxPages: 10, pageDelayMs: 0 });

    assert.deepEqual(pages, [1, 2, 3]);
    assert.deepEqual(items.map(item => item.sourceItemId), ["nyaa-1", "nyaa-2"]);
});

test("fetchTokyoToshoBackfill keeps failures opportunistic after first successful page", async () => {
    const pages = [];
    const source = {
        fetchListingPage: async page => {
            pages.push(page);
            if (page === 1) return [{ sourceItemId: "tokyo-1" }];
            throw new Error("522");
        }
    };

    const items = await fetchTokyoToshoBackfill({ source, maxPages: 10, pageDelayMs: 0 });

    assert.deepEqual(pages, [1, 2]);
    assert.deepEqual(items.map(item => item.sourceItemId), ["tokyo-1"]);
});

test("fetchAnimeToshoBackfill prefers TSV export when configured", async () => {
    const source = {
        fetchTorrentsTsv: async options => [{ sourceItemId: options.url }],
        fetchJsonFeed: async () => {
            throw new Error("json feed should not be used");
        }
    };

    const items = await fetchAnimeToshoBackfill({ source, animeToshoTsvUrl: "https://example.test/export.tsv" });

    assert.deepEqual(items, [{ sourceItemId: "https://example.test/export.tsv" }]);
});

test("fetchAnimeToshoBackfill falls back to JSON feed without TSV URL", async () => {
    const source = {
        fetchTorrentsTsv: async () => {
            throw new Error("tsv should not be used");
        },
        fetchJsonFeed: async () => [{ sourceItemId: "json-1" }]
    };

    const items = await fetchAnimeToshoBackfill({ source });

    assert.deepEqual(items, [{ sourceItemId: "json-1" }]);
});
```

- [ ] **Step 2: Add AnimeTosho TSV fetch test**

Append to `tests/catalog-source-parsers.test.js`:

```js
test("AnimeTosho fetchTorrentsTsv downloads and parses TSV export", async () => {
    const calls = [];
    const rows = await animetosho.fetchTorrentsTsv({
        url: "https://example.test/torrents.tsv",
        http: {
            get: async (url, options) => {
                calls.push({ url, options });
                return {
                    data: "id\tname\tbtih\tstored_torrent\tdate_posted\n1\tExample Anime - 01\tabcdef0123456789abcdef0123456789abcdef01\t1\t1700000000\n"
                };
            }
        },
        timeoutMs: 1234
    });

    assert.equal(calls[0].url, "https://example.test/torrents.tsv");
    assert.equal(calls[0].options.timeout, 1234);
    assert.equal(rows[0].source, "animetosho");
    assert.equal(rows[0].sourceItemId, "1");
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
node --test tests/catalog-source-backfill.test.js tests/catalog-source-parsers.test.js
```

Expected: FAIL because `source/backfill.js` and `fetchTorrentsTsv` do not exist.

- [ ] **Step 4: Implement AnimeTosho TSV fetcher**

In `lib/catalog/source/animetosho.js`, add:

```js
async function fetchTorrentsTsv(options = {}) {
    const http = options.http || axios;
    const url = options.url || process.env.ANIMETOSHO_TSV_URL;
    if (!url) throw new Error("ANIMETOSHO_TSV_URL is required for AnimeTosho TSV backfill");
    const res = await http.get(url, {
        timeout: options.timeoutMs || 60000,
        transformResponse: value => value
    });
    return parseTorrentsTsv(res.data);
}
```

Export it:

```js
    fetchTorrentsTsv,
```

- [ ] **Step 5: Implement source backfill helpers**

Create `lib/catalog/source/backfill.js`:

```js
const nyaa = require("./nyaa");
const animetosho = require("./animetosho");
const tokyotosho = require("./tokyotosho");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectPagedBackfill(options) {
    const maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0 ? options.maxPages : 1000;
    const pageDelayMs = Number.isFinite(options.pageDelayMs) && options.pageDelayMs > 0 ? options.pageDelayMs : 0;
    const fetchPage = options.fetchPage;
    const sleeper = options.sleep || sleep;
    const opportunistic = options.opportunistic === true;
    const items = [];

    for (let page = 1; page <= maxPages; page++) {
        let pageItems;
        try {
            pageItems = await fetchPage(page);
        } catch (error) {
            if (opportunistic && items.length > 0) break;
            throw error;
        }
        if (!pageItems.length) break;
        items.push(...pageItems);
        if (pageDelayMs > 0 && page < maxPages) await sleeper(pageDelayMs);
    }

    return items;
}

async function fetchNyaaBackfill(options = {}) {
    const source = options.source || nyaa;
    return collectPagedBackfill({
        maxPages: options.maxPages,
        pageDelayMs: options.pageDelayMs,
        fetchPage: page => source.fetchListingPage(page, "1_0", { timeoutMs: options.timeoutMs || 10000 })
    });
}

async function fetchTokyoToshoBackfill(options = {}) {
    const source = options.source || tokyotosho;
    return collectPagedBackfill({
        maxPages: options.maxPages,
        pageDelayMs: options.pageDelayMs,
        opportunistic: true,
        fetchPage: page => source.fetchListingPage(page, { timeoutMs: options.timeoutMs || 20000 })
    });
}

async function fetchAnimeToshoBackfill(options = {}) {
    const source = options.source || animetosho;
    if (options.animeToshoTsvUrl || process.env.ANIMETOSHO_TSV_URL) {
        return source.fetchTorrentsTsv({
            url: options.animeToshoTsvUrl || process.env.ANIMETOSHO_TSV_URL,
            timeoutMs: options.timeoutMs || 60000
        });
    }
    return source.fetchJsonFeed({ timeoutMs: options.timeoutMs || 10000 });
}

module.exports = {
    collectPagedBackfill,
    fetchAnimeToshoBackfill,
    fetchNyaaBackfill,
    fetchTokyoToshoBackfill
};
```

- [ ] **Step 6: Run source tests**

Run:

```bash
node --test tests/catalog-source-backfill.test.js tests/catalog-source-parsers.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/catalog/source/backfill.js lib/catalog/source/animetosho.js tests/catalog-source-backfill.test.js tests/catalog-source-parsers.test.js
git commit -m "feat(catalog): add source backfill fetchers"
```

---

### Task 3: Backfill-Aware Ingest CLI

**Files:**
- Modify: `scripts/catalog-ingest.js`
- Test: `tests/catalog-cli.test.js`

- [ ] **Step 1: Add CLI backfill tests**

Append to `tests/catalog-cli.test.js`:

```js
test("catalog ingest backfill mode runs without the daily limit argument", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-catalog-backfill-cli-"));
    const dbPath = path.join(dir, "catalog.sqlite");

    const result = spawnSync(process.execPath, [
        "scripts/catalog-ingest.js",
        "--source", "none",
        "--mode", "backfill",
        "--db", dbPath,
        "--max-pages", "2",
        "--page-delay-ms", "0"
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /source=none mode=backfill scanned=0/);
});
```

- [ ] **Step 2: Run CLI test**

Run:

```bash
node --test tests/catalog-cli.test.js
```

Expected: PASS for `source=none`; this confirms current parser accepts unknown args only if implemented later, so if it fails on output mismatch, continue to Step 3.

- [ ] **Step 3: Wire backfill fetchers into ingest CLI**

In `scripts/catalog-ingest.js`, import:

```js
const {
    fetchAnimeToshoBackfill,
    fetchNyaaBackfill,
    fetchTokyoToshoBackfill
} = require("../lib/catalog/source/backfill");
```

In `parseArgs`, add:

```js
        else if (arg === "--max-pages") args.maxPages = parseInt(argv[++i], 10);
        else if (arg === "--page-delay-ms") args.pageDelayMs = parseInt(argv[++i], 10);
        else if (arg === "--animetosho-tsv-url") args.animeToshoTsvUrl = argv[++i];
```

Add helper:

```js
function backfillOptions(args) {
    return {
        maxPages: Number.isFinite(args.maxPages) ? args.maxPages : undefined,
        pageDelayMs: Number.isFinite(args.pageDelayMs) ? args.pageDelayMs : undefined,
        animeToshoTsvUrl: args.animeToshoTsvUrl
    };
}
```

Update `fetcherFor` so each source checks backfill mode before daily mode:

```js
    if (args.mode === "backfill") {
        if (source === "nyaa") return async () => fetchNyaaBackfill(backfillOptions(args));
        if (source === "animetosho") return async () => fetchAnimeToshoBackfill(backfillOptions(args));
        if (source === "tokyotosho") return async () => fetchTokyoToshoBackfill(backfillOptions(args));
    }
```

Keep existing daily fetchers unchanged for non-backfill modes.

- [ ] **Step 4: Run CLI tests**

Run:

```bash
node --test tests/catalog-cli.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/catalog-ingest.js tests/catalog-cli.test.js
git commit -m "feat(catalog): support backfill ingest mode"
```

---

### Task 4: Startup Backfill Runner

**Files:**
- Modify: `lib/catalog/daily-runner.js`
- Modify: `scripts/catalog-daily-runner.js`
- Test: `tests/catalog-daily-runner.test.js`

- [ ] **Step 1: Add runner tests**

Append to `tests/catalog-daily-runner.test.js`:

```js
test("runStartupBackfillIfNeeded skips when complete", async () => {
    const events = [];
    const { runStartupBackfillIfNeeded } = require("../lib/catalog/daily-runner");

    const result = await runStartupBackfillIfNeeded({
        isBackfillComplete: () => true,
        ingestBackfill: async () => events.push("backfill"),
        markBackfillComplete: () => events.push("complete"),
        markBackfillFailed: () => events.push("failed"),
        now: () => 1000,
        log: message => events.push(message)
    });

    assert.equal(result.skipped, true);
    assert.deepEqual(events, ["[CATALOG_RUNNER] startup_backfill skipped=true reason=complete"]);
});

test("runStartupBackfillIfNeeded runs and marks complete", async () => {
    const events = [];
    const { runStartupBackfillIfNeeded } = require("../lib/catalog/daily-runner");

    const result = await runStartupBackfillIfNeeded({
        isBackfillComplete: () => false,
        ingestBackfill: async () => {
            events.push("backfill");
            return { nyaa: { scanned: 2 } };
        },
        markBackfillComplete: payload => events.push(["complete", payload]),
        markBackfillFailed: payload => events.push(["failed", payload]),
        now: (() => {
            const values = [1000, 2000];
            return () => values.shift();
        })(),
        log: message => events.push(message)
    });

    assert.equal(result.skipped, false);
    assert.deepEqual(events[0], "[CATALOG_RUNNER] startup_backfill starting=true");
    assert.equal(events[1], "backfill");
    assert.equal(events[2][0], "complete");
    assert.deepEqual(events[2][1].summary, { nyaa: { scanned: 2 } });
});

test("runStartupBackfillIfNeeded marks failed and rethrows", async () => {
    const events = [];
    const { runStartupBackfillIfNeeded } = require("../lib/catalog/daily-runner");

    await assert.rejects(
        runStartupBackfillIfNeeded({
            isBackfillComplete: () => false,
            ingestBackfill: async () => {
                throw new Error("backfill failed");
            },
            markBackfillComplete: payload => events.push(["complete", payload]),
            markBackfillFailed: payload => events.push(["failed", payload]),
            now: (() => {
                const values = [1000, 2000];
                return () => values.shift();
            })(),
            log: message => events.push(message)
        }),
        /backfill failed/
    );

    assert.equal(events[0], "[CATALOG_RUNNER] startup_backfill starting=true");
    assert.equal(events[1][0], "failed");
    assert.equal(events[1][1].error, "backfill failed");
});
```

- [ ] **Step 2: Run runner tests to verify failure**

Run:

```bash
node --test tests/catalog-daily-runner.test.js
```

Expected: FAIL because `runStartupBackfillIfNeeded` is not exported.

- [ ] **Step 3: Implement startup backfill helper**

In `lib/catalog/daily-runner.js`, add:

```js
async function runStartupBackfillIfNeeded(options) {
    const log = options.log || console.log;
    if (options.isBackfillComplete()) {
        log("[CATALOG_RUNNER] startup_backfill skipped=true reason=complete");
        return { skipped: true };
    }

    const startedAt = options.now ? options.now() : Date.now();
    log("[CATALOG_RUNNER] startup_backfill starting=true");
    try {
        const summary = await options.ingestBackfill();
        const finishedAt = options.now ? options.now() : Date.now();
        options.markBackfillComplete({ startedAt, finishedAt, summary });
        log(`[CATALOG_RUNNER] startup_backfill complete=true summary=${JSON.stringify(summary)}`);
        return { skipped: false, summary };
    } catch (error) {
        const finishedAt = options.now ? options.now() : Date.now();
        options.markBackfillFailed({
            startedAt,
            finishedAt,
            error: error.message,
            summary: {}
        });
        throw error;
    }
}
```

Export it:

```js
    runStartupBackfillIfNeeded,
```

- [ ] **Step 4: Update daily runner script**

In `scripts/catalog-daily-runner.js`, import state helpers and database:

```js
const { getCatalogDatabase } = require("../lib/catalog/database");
const {
    isBackfillComplete,
    markBackfillComplete,
    markBackfillFailed
} = require("../lib/catalog/backfill-state");
const { runDaily, runStartupBackfillIfNeeded, resolveIntervalMs } = require("../lib/catalog/daily-runner");
```

Change `parseArgs` to keep `dailyArgs` and `backfillArgs`:

```js
function parseArgs(argv) {
    const runner = { once: false, startupBackfill: true };
    const dailyArgs = [];
    const backfillArgs = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--once") runner.once = true;
        else if (arg === "--interval-ms") runner.intervalMs = parseInt(argv[++i], 10);
        else if (arg === "--no-startup-backfill") runner.startupBackfill = false;
        else if (arg === "--backfill-max-pages") backfillArgs.push("--max-pages", argv[++i]);
        else if (arg === "--backfill-page-delay-ms") backfillArgs.push("--page-delay-ms", argv[++i]);
        else if (arg === "--animetosho-tsv-url") backfillArgs.push("--animetosho-tsv-url", argv[++i]);
        else dailyArgs.push(arg);
    }
    return { runner, dailyArgs, backfillArgs };
}
```

Add helper:

```js
async function ingestBackfill(args) {
    await runChild(["scripts/catalog-ingest.js", "--source", "all", "--mode", "backfill", "--live", ...args]);
    return { mode: "backfill" };
}
```

In `main`, replace `ingestArgs` references:

```js
    const { runner, dailyArgs, backfillArgs } = parseArgs(process.argv.slice(2));
    const db = getCatalogDatabase();
```

Before `runDaily`, add:

```js
    if (runner.startupBackfill) {
        await runStartupBackfillIfNeeded({
            isBackfillComplete: () => isBackfillComplete(db),
            ingestBackfill: () => ingestBackfill(backfillArgs),
            markBackfillComplete: payload => markBackfillComplete(db, payload),
            markBackfillFailed: payload => markBackfillFailed(db, payload),
            log: message => console.log(message)
        });
    }
```

Use `dailyArgs`:

```js
        ingestCatalog: () => ingestCatalog(dailyArgs),
```

- [ ] **Step 5: Run runner tests**

Run:

```bash
node --test tests/catalog-daily-runner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/catalog/daily-runner.js scripts/catalog-daily-runner.js tests/catalog-daily-runner.test.js
git commit -m "feat(catalog): run startup backfill before daily ingest"
```

---

### Task 5: Docker Compose Production Defaults

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update ingest command**

In `docker-compose.yml`, replace:

```yaml
    command: ["npm", "run", "catalog:daily", "--", "--limit", "25"]
```

with:

```yaml
    command:
      [
        "npm", "run", "catalog:daily", "--",
        "--source", "all",
        "--mode", "daily",
        "--live",
        "--limit", "${CATALOG_DAILY_LIMIT:-100}",
        "--backfill-max-pages", "${CATALOG_BACKFILL_MAX_PAGES:-1000}",
        "--backfill-page-delay-ms", "${CATALOG_BACKFILL_PAGE_DELAY_MS:-250}"
      ]
```

Add environment entries:

```yaml
      - "CATALOG_DAILY_LIMIT=${CATALOG_DAILY_LIMIT:-100}"
      - "CATALOG_BACKFILL_MAX_PAGES=${CATALOG_BACKFILL_MAX_PAGES:-1000}"
      - "CATALOG_BACKFILL_PAGE_DELAY_MS=${CATALOG_BACKFILL_PAGE_DELAY_MS:-250}"
      - "ANIMETOSHO_TSV_URL=${ANIMETOSHO_TSV_URL:-}"
```

- [ ] **Step 2: Validate compose config**

Run:

```bash
docker compose config
```

Expected: command succeeds and `nexio-torii-ingest` command no longer contains `--limit 25`.

- [ ] **Step 3: Commit**

Run:

```bash
git add docker-compose.yml
git commit -m "chore(catalog): enable uncapped startup backfill in docker"
```

---

### Task 6: Full Verification And Local Smoke

**Files:**
- No edits.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass; live catalog tests skip unless `LIVE_CATALOG_TESTS=1`.

- [ ] **Step 2: Run bounded local backfill smoke**

Run:

```bash
set -a
. ./.env
set +a
tmpdb="$(mktemp -t nexio-backfill-smoke.XXXXXX.sqlite)"
node scripts/catalog-ingest.js --live --source all --mode backfill --max-pages 2 --page-delay-ms 0 --db "$tmpdb"
node scripts/catalog-validate.js --db "$tmpdb"
```

Expected: Nyaa scans more than 25 rows when both pages return data. TokyoTosho may scan zero if upstream fails, but the command should fail only if the first TokyoTosho page fails before any page succeeds. If TokyoTosho fails with 522 in this smoke, rerun with `--source nyaa` and `--source animetosho` separately to verify the non-fragile sources.

- [ ] **Step 3: Run daily runner startup smoke without full backfill**

Run:

```bash
tmpdb="$(mktemp -t nexio-runner-smoke.XXXXXX.sqlite)"
CATALOG_DB_PATH="$tmpdb" node scripts/catalog-daily-runner.js --once --no-startup-backfill --source none
```

Expected:

```text
[CATALOG_RUNNER] starting interval_ms=86400000 once=true
[CATALOG_RUNNER] anime_map ...
[CATALOG] source=none mode=init scanned=0 upserted=0 matched=0 failed=0
```

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short --branch
```

Expected: branch ahead of origin with only intentional commits; local `.env`, `.DS_Store`, and `api/` remain untracked.

---

## Self-Review

**Spec coverage:**
- Full ingestion on initial start: Tasks 1 and 4 add persistent startup backfill state and run backfill before daily cycles.
- All three sites: Task 2 defines Nyaa, AnimeTosho, and TokyoTosho backfill fetchers; Task 3 wires them to `--source all --mode backfill`.
- No initial limit: Task 5 removes hardcoded `--limit 25`; backfill uses `--backfill-max-pages` instead of daily `--limit`.
- Daily updates after initial build: Task 4 runs startup backfill only when incomplete, then daily runner continues with bounded daily args.
- Fragile TokyoTosho: Task 2 makes TokyoTosho paginated backfill opportunistic after at least one successful page.
- Local validation: Task 6 includes full tests, bounded backfill smoke, and runner smoke.

**Placeholder scan:** No placeholder markers or deferred implementation slots remain in this plan.

**Type consistency:** The plan consistently uses `mode=backfill`, `catalog_backfill_state`, `runStartupBackfillIfNeeded`, `fetchNyaaBackfill`, `fetchAnimeToshoBackfill`, and `fetchTokyoToshoBackfill`.
