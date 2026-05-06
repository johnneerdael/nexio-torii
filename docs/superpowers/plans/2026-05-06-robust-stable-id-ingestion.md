# Robust Stable ID Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an ingestion pipeline that only stores torrents with reliable stable ID mappings, maps Nyaa/AnimeTosho/TokyoTosho independently through parser plus Kitsu/TMDB evidence, and deduplicates duplicate hashes into one canonical source row.

**Architecture:** Ingestion resolves each scraped torrent before persistence. A release parser extracts title/year/episode evidence, a stable ID resolver combines AnimeTosho AniDB IDs, Kitsu search, TMDB search, and local anime map indexes, then storage accepts only resolved rows and collapses duplicate hashes by source priority. Hash matches are never used to propagate identity between providers.

**Tech Stack:** Node.js CommonJS, `better-sqlite3`, `axios`, `@viren070/parse-torrent-title`, `fuzzball`, Node test runner, Docker Compose with `.env`-provided `TMDB_API_KEY`.

---

## File Structure

- Modify `package.json` and `package-lock.json`: add parser and fuzzy matching dependencies.
- Create `lib/catalog/title-normalizer.js`: canonical title normalization shared by parser, resolver, and tests.
- Create `lib/catalog/release-parser.js`: AIOStreams-style async wrapper around `@viren070/parse-torrent-title`.
- Create `lib/catalog/metadata-clients.js`: Kitsu and TMDB search clients with timeout, `.env` credentials, and injectable HTTP client for tests.
- Create `lib/catalog/stable-id-resolver.js`: resolver that returns accepted identity rows or explicit drop reasons without hash propagation.
- Modify `lib/catalog/database.js`: add resolver cache tables, source priority schema, dropped counters, and migrate `source_items` to one canonical row per `info_hash`.
- Modify `lib/catalog/source-item.js`: replace duplicate-per-source upsert with resolved-only canonical hash upsert.
- Modify `lib/catalog/matcher.js`: keep AnimeTosho AniDB mapping helper, remove public hash-propagation assumptions, and delegate title/API mapping to the resolver.
- Modify `lib/catalog/ingest.js`: parse and resolve before storing; drop unmapped items; dedupe duplicate hashes by source priority.
- Modify `scripts/catalog-validate.js`: report mapped, dropped, cache hit, and duplicate collapse counts.
- Add tests:
  - `tests/catalog-title-normalizer.test.js`
  - `tests/catalog-release-parser.test.js`
  - `tests/catalog-metadata-clients.test.js`
  - `tests/catalog-stable-id-resolver.test.js`
  - update `tests/catalog-database.test.js`
  - update `tests/catalog-source-item.test.js`
  - update `tests/catalog-ingest.test.js`
  - update `tests/catalog-matcher.test.js`

---

### Task 1: Add Parser Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install @viren070/parse-torrent-title@^0.7.1 fuzzball@^2.2.3
```

Expected: `package.json` contains both dependencies and `package-lock.json` records their exact resolved versions.

- [ ] **Step 2: Verify install**

Run:

```bash
node -e "import('@viren070/parse-torrent-title').then(m => console.log(Boolean(m.Parser), Boolean(m.handlers)))"
```

Expected:

```text
true true
```

- [ ] **Step 3: Commit dependency change**

Run:

```bash
git add package.json package-lock.json
git commit -m "chore(catalog): add release parsing dependencies"
```

Expected: commit succeeds with only dependency files staged.

---

### Task 2: Title Normalizer

**Files:**
- Create: `lib/catalog/title-normalizer.js`
- Test: `tests/catalog-title-normalizer.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/catalog-title-normalizer.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { cleanTitle, normalizeTitle, titleTokens } = require("../lib/catalog/title-normalizer");

test("normalizeTitle removes punctuation, diacritics, case, and ampersand drift", () => {
    assert.equal(normalizeTitle("Frieren: Beyond Journey's End"), "frierenbeyondjourneysend");
    assert.equal(normalizeTitle("Bocchi & The Rock!"), "bocchiandtherock");
    assert.equal(normalizeTitle("Pokémon Horizons"), "pokemonhorizons");
});

test("cleanTitle keeps searchable spaces", () => {
    assert.equal(cleanTitle("[SubsPlease] One Piece - 1100 (1080p)"), "subsplease one piece 1100 1080p");
});

test("titleTokens drops empty tokens", () => {
    assert.deepEqual(titleTokens("One Piece: Egghead Arc"), ["one", "piece", "egghead", "arc"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/catalog-title-normalizer.test.js
```

Expected: FAIL with `Cannot find module '../lib/catalog/title-normalizer'`.

- [ ] **Step 3: Implement normalizer**

Create `lib/catalog/title-normalizer.js`:

```js
const umlautMap = new Map([
    ["Ä", "Ae"], ["ä", "ae"],
    ["Ö", "Oe"], ["ö", "oe"],
    ["Ü", "Ue"], ["ü", "ue"],
    ["ß", "ss"]
]);

function foldTitle(value) {
    return String(value || "")
        .split("")
        .map(char => umlautMap.get(char) || char)
        .join("")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "and");
}

function cleanTitle(value) {
    return foldTitle(value)
        .replace(/[♪♫★☆♡♥]/g, " ")
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function normalizeTitle(value) {
    return foldTitle(value)
        .replace(/[^\p{L}\p{N}+]+/gu, "")
        .toLowerCase();
}

function titleTokens(value) {
    return cleanTitle(value).split(" ").filter(Boolean);
}

module.exports = {
    cleanTitle,
    normalizeTitle,
    titleTokens
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/catalog-title-normalizer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/title-normalizer.js tests/catalog-title-normalizer.test.js
git commit -m "feat(catalog): add title normalization helpers"
```

---

### Task 3: Release Parser

**Files:**
- Create: `lib/catalog/release-parser.js`
- Test: `tests/catalog-release-parser.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/catalog-release-parser.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseReleaseTitle } = require("../lib/catalog/release-parser");

test("parseReleaseTitle extracts anime title and episode", async () => {
    const parsed = await parseReleaseTitle("[SubsPlease] One Piece - 1100 (1080p) [ABCDEF12].mkv");

    assert.equal(parsed.normalizedTitle, "onepiece");
    assert.equal(parsed.title, "One Piece");
    assert.deepEqual(parsed.episodes, [1100]);
    assert.equal(parsed.resolution, "1080p");
    assert.equal(parsed.releaseGroup, "SubsPlease");
});

test("parseReleaseTitle handles season episode releases", async () => {
    const parsed = await parseReleaseTitle("[Erai-raws] Frieren - Beyond Journey's End - S01E28 [1080p].mkv");

    assert.equal(parsed.normalizedTitle, "frierenbeyondjourneysend");
    assert.deepEqual(parsed.seasons, [1]);
    assert.deepEqual(parsed.episodes, [28]);
});

test("parseReleaseTitle returns null title for blank input", async () => {
    const parsed = await parseReleaseTitle("");

    assert.equal(parsed.title, null);
    assert.deepEqual(parsed.episodes, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/catalog-release-parser.test.js
```

Expected: FAIL with `Cannot find module '../lib/catalog/release-parser'`.

- [ ] **Step 3: Implement parser wrapper**

Create `lib/catalog/release-parser.js`:

```js
const { normalizeTitle } = require("./title-normalizer");

let parserPromise = null;

async function getParser() {
    if (!parserPromise) {
        parserPromise = import("@viren070/parse-torrent-title").then(({ Parser, handlers }) => {
            return new Parser().addHandlers(handlers.filter(handler => handler.field !== "country"));
        });
    }
    return parserPromise;
}

function listOfNumbers(value) {
    if (value === null || value === undefined) return [];
    const values = Array.isArray(value) ? value : [value];
    return values.map(Number).filter(Number.isFinite).map(value => Math.trunc(value));
}

function firstString(...values) {
    return values.map(value => String(value || "").trim()).find(Boolean) || null;
}

async function parseReleaseTitle(title) {
    const rawTitle = String(title || "").trim();
    if (!rawTitle) {
        return {
            rawTitle,
            title: null,
            normalizedTitle: null,
            year: null,
            seasons: [],
            episodes: [],
            volumes: [],
            resolution: null,
            quality: null,
            releaseGroup: null,
            confidence: 0
        };
    }

    const parser = await getParser();
    const parsed = parser.parse(rawTitle);
    const parsedTitle = firstString(parsed.title);

    return {
        rawTitle,
        title: parsedTitle,
        normalizedTitle: parsedTitle ? normalizeTitle(parsedTitle) : null,
        year: parsed.year ? String(parsed.year) : null,
        seasons: listOfNumbers(parsed.seasons ?? parsed.season),
        episodes: listOfNumbers(parsed.episodes ?? parsed.episode),
        volumes: listOfNumbers(parsed.volumes ?? parsed.volume),
        resolution: firstString(parsed.resolution),
        quality: firstString(parsed.quality),
        releaseGroup: firstString(parsed.releaseGroup, parsed.group),
        confidence: parsedTitle ? 80 : 0
    };
}

module.exports = {
    parseReleaseTitle
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/catalog-release-parser.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/release-parser.js tests/catalog-release-parser.test.js
git commit -m "feat(catalog): parse anime release titles during ingestion"
```

---

### Task 4: Database Schema For Canonical Hash Storage And Resolver Cache

**Files:**
- Modify: `lib/catalog/database.js`
- Test: `tests/catalog-database.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/catalog-database.test.js`:

```js
test("catalog database stores one canonical source row per info hash", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const columns = db.prepare("PRAGMA table_info(source_items)").all();
    const infoHashColumn = columns.find(column => column.name === "info_hash");

    assert.equal(infoHashColumn.pk, 1);
    assert.ok(columns.some(column => column.name === "source_priority"));
    assert.ok(columns.some(column => column.name === "stable_provider"));
    assert.ok(columns.some(column => column.name === "stable_id"));
    assert.ok(columns.some(column => column.name === "parsed_json"));

    db.close();
    closeCatalogDatabaseForTests();
});

test("catalog database creates resolution cache and drop tables", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);

    assert.ok(tables.includes("identity_resolution_cache"));
    assert.ok(tables.includes("dropped_source_items"));

    db.close();
    closeCatalogDatabaseForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/catalog-database.test.js
```

Expected: FAIL because `source_items.info_hash` is not the primary key and the cache/drop tables do not exist.

- [ ] **Step 3: Replace source item schema and add cache tables**

In `lib/catalog/database.js`, replace the `source_items` table DDL with:

```js
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
        CREATE INDEX IF NOT EXISTS idx_source_items_source ON source_items (source);
        CREATE INDEX IF NOT EXISTS idx_source_items_stable
        ON source_items (stable_provider, stable_id, source_priority DESC);
```

After the `torrent_episode_matches` DDL, add:

```js
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
```

Add this migration helper above `initializeCatalogDatabase`:

```js
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
        GROUP BY info_hash
        HAVING MAX(CASE source WHEN 'nyaa' THEN 300 WHEN 'animetosho' THEN 200 WHEN 'tokyotosho' THEN 100 ELSE 0 END);
        DROP TABLE source_items_legacy;
    `);
}
```

Call it as the first line inside `initializeCatalogDatabase(db)` after pragmas:

```js
    migrateSourceItemsToInfoHashPrimaryKey(db);
```

Extend `ingestion_runs` with counters:

```js
          dropped_unmapped INTEGER NOT NULL DEFAULT 0,
          duplicate_skipped INTEGER NOT NULL DEFAULT 0,
```

and add this after the main `db.exec` so existing databases receive the columns:

```js
    for (const column of [
        ["dropped_unmapped", "INTEGER NOT NULL DEFAULT 0"],
        ["duplicate_skipped", "INTEGER NOT NULL DEFAULT 0"]
    ]) {
        const exists = db.prepare("PRAGMA table_info(ingestion_runs)").all().some(row => row.name === column[0]);
        if (!exists) db.exec(`ALTER TABLE ingestion_runs ADD COLUMN ${column[0]} ${column[1]}`);
    }
```

- [ ] **Step 4: Run database tests**

Run:

```bash
npm test -- tests/catalog-database.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/database.js tests/catalog-database.test.js
git commit -m "feat(catalog): store canonical resolved source rows by hash"
```

---

### Task 5: Source Priority And Resolved-Only Storage

**Files:**
- Modify: `lib/catalog/source-item.js`
- Test: `tests/catalog-source-item.test.js`

- [ ] **Step 1: Replace duplicate-hash test**

Replace the test named `upsertSourceItems allows multiple source rows with the same hash` in `tests/catalog-source-item.test.js` with:

```js
test("upsertSourceItems keeps one row per hash using source priority", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const rows = upsertSourceItems(db, [
        {
            source: "tokyotosho",
            sourceItemId: "tt-42",
            sourcePriority: 100,
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            title: "Example - 01 TokyoTosho",
            stableProvider: "kitsu",
            stableId: "265",
            parsed: { title: "Example", episodes: [1] },
            raw: {}
        },
        {
            source: "nyaa",
            sourceItemId: "nyaa-42",
            sourcePriority: 300,
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            title: "Example - 01 Nyaa",
            stableProvider: "kitsu",
            stableId: "265",
            parsed: { title: "Example", episodes: [1] },
            raw: {}
        }
    ], 2000);

    assert.equal(rows, 1);
    const stored = db.prepare("SELECT source, source_item_id, title, source_priority FROM source_items").get();
    assert.deepEqual(stored, {
        source: "nyaa",
        source_item_id: "nyaa-42",
        title: "Example - 01 Nyaa",
        source_priority: 300
    });
    db.close();
    closeCatalogDatabaseForTests();
});

test("normalizeSourceItem drops unresolved items", () => {
    const row = normalizeSourceItem({
        source: "nyaa",
        sourceItemId: "123",
        infoHash: "abcdef0123456789abcdef0123456789abcdef01",
        title: "Unresolved - 01",
        raw: {}
    }, 1000);

    assert.equal(row, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/catalog-source-item.test.js
```

Expected: FAIL because `stableProvider`/`stableId` are not required and duplicate hashes still store multiple rows.

- [ ] **Step 3: Implement source priority storage**

In `lib/catalog/source-item.js`, add:

```js
const SOURCE_PRIORITIES = Object.freeze({
    nyaa: 300,
    animetosho: 200,
    tokyotosho: 100
});

function sourcePriority(source) {
    return SOURCE_PRIORITIES[String(source || "").trim().toLowerCase()] || 0;
}
```

Update `normalizeSourceItem` so it requires stable IDs:

```js
    const stableProvider = String(input.stableProvider || input.stable_provider || "").trim().toLowerCase();
    const stableId = String(input.stableId || input.stable_id || "").trim();
    if (!stableProvider || !stableId) return null;
```

Add these fields to the returned row:

```js
        source_priority: normalizeNumber(input.sourcePriority ?? input.source_priority) ?? sourcePriority(source),
        stable_provider: stableProvider,
        stable_id: stableId,
        parsed_json: JSON.stringify(input.parsed || {}),
```

Replace the insert statement with:

```js
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
```

Export `sourcePriority`:

```js
module.exports = {
    normalizeHash,
    normalizeSourceItem,
    sourcePriority,
    upsertSourceItems
};
```

- [ ] **Step 4: Run source item tests**

Run:

```bash
npm test -- tests/catalog-source-item.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/source-item.js tests/catalog-source-item.test.js
git commit -m "feat(catalog): dedupe source rows by canonical hash"
```

---

### Task 6: Metadata Clients For Kitsu And TMDB

**Files:**
- Create: `lib/catalog/metadata-clients.js`
- Test: `tests/catalog-metadata-clients.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/catalog-metadata-clients.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createMetadataClients } = require("../lib/catalog/metadata-clients");

test("kitsuSearchAnime uses filter text and JSON API headers", async () => {
    const calls = [];
    const clients = createMetadataClients({
        http: {
            get: async (url, options) => {
                calls.push({ url, options });
                return { data: { data: [{ id: "265", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" } } }] } };
            }
        }
    });

    const results = await clients.kitsuSearchAnime("Example Anime");

    assert.equal(results[0].id, "265");
    assert.equal(calls[0].url, "https://kitsu.io/api/edge/anime");
    assert.equal(calls[0].options.params["filter[text]"], "Example Anime");
    assert.equal(calls[0].options.params["page[limit]"], 5);
    assert.equal(calls[0].options.headers.Accept, "application/vnd.api+json");
});

test("tmdbSearch uses TMDB_API_KEY and searches tv plus movie", async () => {
    const calls = [];
    const clients = createMetadataClients({
        tmdbApiKey: "test-key",
        http: {
            get: async (url, options) => {
                calls.push({ url, options });
                return { data: { results: [{ id: 123, name: "Example Anime", first_air_date: "1998-04-03" }] } };
            }
        }
    });

    const results = await clients.tmdbSearch("Example Anime");

    assert.equal(results.length, 2);
    assert.equal(calls[0].url, "https://api.themoviedb.org/3/search/tv");
    assert.equal(calls[1].url, "https://api.themoviedb.org/3/search/movie");
    assert.equal(calls[0].options.params.api_key, "test-key");
});

test("tmdbSearch returns empty results when no API key exists", async () => {
    const clients = createMetadataClients({
        tmdbApiKey: "",
        http: {
            get: async () => {
                throw new Error("network should not be called");
            }
        }
    });

    assert.deepEqual(await clients.tmdbSearch("Example Anime"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/catalog-metadata-clients.test.js
```

Expected: FAIL with `Cannot find module '../lib/catalog/metadata-clients'`.

- [ ] **Step 3: Implement clients**

Create `lib/catalog/metadata-clients.js`:

```js
const axios = require("axios");

const KITSU_BASE_URL = "https://kitsu.io/api/edge";
const TMDB_BASE_URL = process.env.TMDB_API_URL || "https://api.themoviedb.org/3";

function createMetadataClients(options = {}) {
    const http = options.http || axios;
    const timeoutMs = options.timeoutMs || 8000;
    const tmdbApiKey = options.tmdbApiKey ?? process.env.TMDB_API_KEY ?? "";

    async function kitsuSearchAnime(query) {
        const response = await http.get(`${KITSU_BASE_URL}/anime`, {
            timeout: timeoutMs,
            headers: {
                Accept: "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json"
            },
            params: {
                "filter[text]": query,
                "page[limit]": 5,
                "page[offset]": 0
            }
        });
        return Array.isArray(response.data?.data) ? response.data.data : [];
    }

    async function tmdbSearch(query) {
        if (!String(tmdbApiKey || "").trim()) return [];
        const common = {
            timeout: timeoutMs,
            params: {
                api_key: tmdbApiKey,
                query,
                include_adult: false,
                page: 1,
                language: "en-US"
            }
        };
        const [tv, movie] = await Promise.all([
            http.get(`${TMDB_BASE_URL}/search/tv`, common).catch(() => ({ data: { results: [] } })),
            http.get(`${TMDB_BASE_URL}/search/movie`, common).catch(() => ({ data: { results: [] } }))
        ]);
        return [
            ...(tv.data?.results || []).map(result => ({ ...result, media_type: "tv" })),
            ...(movie.data?.results || []).map(result => ({ ...result, media_type: "movie" }))
        ];
    }

    return {
        kitsuSearchAnime,
        tmdbSearch
    };
}

module.exports = {
    createMetadataClients
};
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/catalog-metadata-clients.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/metadata-clients.js tests/catalog-metadata-clients.test.js
git commit -m "feat(catalog): add Kitsu and TMDB metadata clients"
```

---

### Task 7: Stable ID Resolver Without Hash Propagation

**Files:**
- Create: `lib/catalog/stable-id-resolver.js`
- Modify: `lib/catalog/anime-map.js`
- Modify: `lib/catalog/matcher.js`
- Test: `tests/catalog-stable-id-resolver.test.js`
- Test: `tests/catalog-matcher.test.js`

- [ ] **Step 1: Add anime map lookup tests**

Append to `tests/catalog-matcher.test.js`:

```js
test("matchSourceItem does not map Nyaa by hash when AnimeTosho has a matching hash", () => {
    const animeMap = loadAnimeMap(fixturePath);
    const nyaaMatch = matchSourceItem({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef02",
        title: "[SubsPlease] Example Anime - 01 [1080p]",
        raw: {}
    }, animeMap);

    assert.equal(nyaaMatch, null);
});
```

- [ ] **Step 2: Write resolver tests**

Create `tests/catalog-stable-id-resolver.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");
const { loadAnimeMap } = require("../lib/catalog/anime-map");
const { createStableIdResolver } = require("../lib/catalog/stable-id-resolver");

const fixturePath = path.join(__dirname, "fixtures", "catalog", "anime-map-mini.json");

test("resolver maps AnimeTosho AniDB aid directly", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [],
            tmdbSearch: async () => []
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "animetosho",
        infoHash: "abcdef0123456789abcdef0123456789abcdef02",
        title: "[Group] Example Anime - 01 [1080p]",
        raw: { aid: "1" }
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: null, episodes: [1], seasons: [] });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.kitsu_id, "265");
    assert.equal(result.identity.confidence, 100);
    db.close();
    closeCatalogDatabaseForTests();
});

test("resolver maps Nyaa independently through Kitsu exact title evidence", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [
                { id: "265", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-04-03", subtype: "TV" } }
            ],
            tmdbSearch: async () => []
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef04",
        title: "[SubsPlease] Example Anime - 01 [1080p]",
        raw: {}
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: "1998", episodes: [1], seasons: [] });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.stable_provider, "kitsu");
    assert.equal(result.identity.stable_id, "265");
    assert.equal(result.identity.confidence, 90);
});

test("resolver drops ambiguous Kitsu search results", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [
                { id: "100", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-01-01" } },
                { id: "101", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-04-03" } }
            ],
            tmdbSearch: async () => []
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "tokyotosho",
        infoHash: "abcdef0123456789abcdef0123456789abcdef05",
        title: "Example Anime - 01",
        raw: {}
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: "1998", episodes: [1], seasons: [] });

    assert.equal(result.status, "dropped");
    assert.equal(result.reason, "ambiguous_stable_id");
});

test("resolver accepts TMDB fallback when Kitsu has no result", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [],
            tmdbSearch: async () => [
                { id: 26209, media_type: "tv", name: "Example Anime", original_name: "Example Anime", first_air_date: "1998-04-03" }
            ]
        },
        now: () => 4000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef06",
        title: "Example Anime - 01",
        raw: {}
    }, { title: "Example Anime", normalizedTitle: "exampleanime", year: "1998", episodes: [1], seasons: [] });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.stable_provider, "kitsu");
    assert.equal(result.identity.kitsu_id, "265");
    assert.equal(result.identity.tmdb_id, "26209");
    assert.equal(result.identity.confidence, 88);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/catalog-matcher.test.js tests/catalog-stable-id-resolver.test.js
```

Expected: resolver module missing; matcher test passes if no hash propagation exists.

- [ ] **Step 4: Add lookup helpers to anime map**

In `lib/catalog/anime-map.js`, add:

```js
function recordByKitsu(animeMap, kitsuId) {
    const kitsu = animeMap.indexes.byKitsu?.[String(kitsuId)];
    return kitsu ? animeMap.records[kitsu] || null : null;
}

function recordByTmdb(animeMap, tmdbId, mediaType) {
    const id = String(tmdbId);
    if (mediaType === "movie") {
        const kitsu = animeMap.indexes.byTmdbMovie?.[id];
        return kitsu ? animeMap.records[kitsu] || null : null;
    }
    const kitsu = animeMap.indexes.byTmdbTv?.[id]?.[0];
    return kitsu ? animeMap.records[kitsu] || null : null;
}
```

Export them:

```js
    recordByKitsu,
    recordByTmdb
```

- [ ] **Step 5: Implement resolver**

Create `lib/catalog/stable-id-resolver.js`:

```js
const { ratio } = require("fuzzball");
const { normalizeHash } = require("./source-item");
const { normalizeTitle } = require("./title-normalizer");
const { recordByAnidb, recordByKitsu, recordByTmdb } = require("./anime-map");

function identityRowFromRecord(infoHash, record, confidence, evidence, now = Date.now()) {
    if (!record || !record.kitsu) return null;
    return {
        info_hash: normalizeHash(infoHash),
        stable_provider: "kitsu",
        stable_id: String(record.kitsu),
        kitsu_id: record.kitsu || null,
        anilist_id: record.anilist || null,
        anidb_id: record.anidb || null,
        mal_id: record.mal || null,
        imdb_id: record.imdb || null,
        tmdb_id: record.tmdb || null,
        tvdb_id: record.tvdb || null,
        confidence,
        evidence_json: JSON.stringify(evidence),
        updated_at: now
    };
}

function identityRowFromTmdb(infoHash, result, confidence, evidence, now = Date.now()) {
    const tmdbId = String(result.id);
    return {
        info_hash: normalizeHash(infoHash),
        stable_provider: "tmdb",
        stable_id: tmdbId,
        kitsu_id: null,
        anilist_id: null,
        anidb_id: null,
        mal_id: null,
        imdb_id: null,
        tmdb_id: tmdbId,
        tvdb_id: null,
        confidence,
        evidence_json: JSON.stringify(evidence),
        updated_at: now
    };
}

function candidateTitlesFromKitsu(row) {
    const attrs = row.attributes || {};
    return [attrs.canonicalTitle, attrs.titles?.en, attrs.titles?.en_jp, attrs.titles?.ja_jp]
        .filter(Boolean)
        .map(String);
}

function candidateTitlesFromTmdb(row) {
    return [row.name, row.original_name, row.title, row.original_title].filter(Boolean).map(String);
}

function candidateYear(row) {
    const date = row.attributes?.startDate || row.first_air_date || row.release_date || "";
    return String(date).slice(0, 4) || null;
}

function titleScore(parsedTitle, candidateTitles) {
    const normalizedParsed = normalizeTitle(parsedTitle);
    return Math.max(0, ...candidateTitles.map(title => {
        const normalized = normalizeTitle(title);
        if (normalized === normalizedParsed) return 100;
        return ratio(normalizedParsed, normalized);
    }));
}

function yearCompatible(parsedYear, row) {
    if (!parsedYear) return true;
    const year = Number(candidateYear(row));
    const parsed = Number(parsedYear);
    if (!Number.isFinite(year) || !Number.isFinite(parsed)) return true;
    return Math.abs(year - parsed) <= 1;
}

function cacheKey(parsed) {
    return [
        parsed.normalizedTitle || "unknown",
        parsed.year || "any",
        parsed.seasons?.[0] || "s",
        parsed.episodes?.[0] || "e"
    ].join(":");
}

function readCache(db, key) {
    return db.prepare("SELECT * FROM identity_resolution_cache WHERE cache_key = ?").get(key) || null;
}

function writeCache(db, key, parsed, result, now) {
    db.prepare(`
        INSERT INTO identity_resolution_cache (
            cache_key, normalized_title, year, media_type, stable_provider, stable_id, kitsu_id,
            anilist_id, anidb_id, mal_id, imdb_id, tmdb_id, tvdb_id, confidence, status,
            evidence_json, created_at, updated_at
        ) VALUES (
            @cache_key, @normalized_title, @year, @media_type, @stable_provider, @stable_id, @kitsu_id,
            @anilist_id, @anidb_id, @mal_id, @imdb_id, @tmdb_id, @tvdb_id, @confidence, @status,
            @evidence_json, @created_at, @updated_at
        )
        ON CONFLICT(cache_key) DO UPDATE SET
            stable_provider = excluded.stable_provider,
            stable_id = excluded.stable_id,
            kitsu_id = excluded.kitsu_id,
            anilist_id = excluded.anilist_id,
            anidb_id = excluded.anidb_id,
            mal_id = excluded.mal_id,
            imdb_id = excluded.imdb_id,
            tmdb_id = excluded.tmdb_id,
            tvdb_id = excluded.tvdb_id,
            confidence = excluded.confidence,
            status = excluded.status,
            evidence_json = excluded.evidence_json,
            updated_at = excluded.updated_at
    `).run({
        cache_key: key,
        normalized_title: parsed.normalizedTitle || "",
        year: parsed.year || null,
        media_type: null,
        stable_provider: result.identity?.stable_provider || null,
        stable_id: result.identity?.stable_id || null,
        kitsu_id: result.identity?.kitsu_id || null,
        anilist_id: result.identity?.anilist_id || null,
        anidb_id: result.identity?.anidb_id || null,
        mal_id: result.identity?.mal_id || null,
        imdb_id: result.identity?.imdb_id || null,
        tmdb_id: result.identity?.tmdb_id || null,
        tvdb_id: result.identity?.tvdb_id || null,
        confidence: result.identity?.confidence || 0,
        status: result.status,
        evidence_json: result.identity?.evidence_json || JSON.stringify([result.reason]),
        created_at: now,
        updated_at: now
    });
}

function fromCache(cache, infoHash, now) {
    if (cache.status !== "accepted") return { status: "dropped", reason: "cached_unmapped" };
    return {
        status: "accepted",
        identity: {
            info_hash: normalizeHash(infoHash),
            stable_provider: cache.stable_provider,
            stable_id: cache.stable_id,
            kitsu_id: cache.kitsu_id,
            anilist_id: cache.anilist_id,
            anidb_id: cache.anidb_id,
            mal_id: cache.mal_id,
            imdb_id: cache.imdb_id,
            tmdb_id: cache.tmdb_id,
            tvdb_id: cache.tvdb_id,
            confidence: cache.confidence,
            evidence_json: cache.evidence_json,
            updated_at: now
        }
    };
}

function createStableIdResolver(options) {
    const db = options.db;
    const animeMap = options.animeMap;
    const metadataClients = options.metadataClients;
    const now = options.now || Date.now;

    async function resolve(item, parsed) {
        const raw = item.raw || {};
        const aid = raw.aid || raw.anidb_aid || raw.anidbAid;
        if (aid) {
            const record = recordByAnidb(animeMap, aid);
            const identity = identityRowFromRecord(item.infoHash || item.info_hash, record, 100, [
                `${item.source}.aid=${aid}`,
                `anime-map.anidb=${aid}`,
                `kitsu=${record?.kitsu || ""}`
            ], now());
            if (identity) return { status: "accepted", identity };
        }

        if (!parsed?.title || !parsed.normalizedTitle) return { status: "dropped", reason: "unparsed_title" };

        const key = cacheKey(parsed);
        const cached = readCache(db, key);
        if (cached) return fromCache(cached, item.infoHash || item.info_hash, now());

        const kitsuRows = await metadataClients.kitsuSearchAnime(parsed.title).catch(() => []);
        const kitsuMatches = kitsuRows
            .map(row => ({ row, score: titleScore(parsed.title, candidateTitlesFromKitsu(row)) }))
            .filter(match => match.score >= 92 && yearCompatible(parsed.year, match.row));

        if (kitsuMatches.length === 1) {
            const kitsuId = kitsuMatches[0].row.id;
            const record = recordByKitsu(animeMap, kitsuId) || { kitsu: kitsuId };
            const identity = identityRowFromRecord(item.infoHash || item.info_hash, record, 90, [
                `parser.title=${parsed.title}`,
                `kitsu.search=${kitsuId}`,
                `title_score=${kitsuMatches[0].score}`
            ], now());
            const result = { status: "accepted", identity };
            writeCache(db, key, parsed, result, now());
            return result;
        }

        if (kitsuMatches.length > 1) {
            const result = { status: "dropped", reason: "ambiguous_stable_id" };
            writeCache(db, key, parsed, result, now());
            return result;
        }

        const tmdbRows = await metadataClients.tmdbSearch(parsed.title).catch(() => []);
        const tmdbMatches = tmdbRows
            .map(row => ({ row, score: titleScore(parsed.title, candidateTitlesFromTmdb(row)) }))
            .filter(match => match.score >= 92 && yearCompatible(parsed.year, match.row));

        if (tmdbMatches.length === 1) {
            const tmdb = tmdbMatches[0].row;
            const record = recordByTmdb(animeMap, tmdb.id, tmdb.media_type);
            const identity = record
                ? identityRowFromRecord(item.infoHash || item.info_hash, { ...record, tmdb: String(tmdb.id) }, 88, [
                    `parser.title=${parsed.title}`,
                    `tmdb.search=${tmdb.id}`,
                    `title_score=${tmdbMatches[0].score}`
                ], now())
                : identityRowFromTmdb(item.infoHash || item.info_hash, tmdb, 82, [
                    `parser.title=${parsed.title}`,
                    `tmdb.search=${tmdb.id}`,
                    `title_score=${tmdbMatches[0].score}`
                ], now());
            const result = { status: "accepted", identity };
            writeCache(db, key, parsed, result, now());
            return result;
        }

        const result = { status: "dropped", reason: tmdbMatches.length > 1 ? "ambiguous_stable_id" : "no_stable_id" };
        writeCache(db, key, parsed, result, now());
        return result;
    }

    return { resolve };
}

module.exports = {
    createStableIdResolver,
    identityRowFromRecord
};
```

- [ ] **Step 6: Keep matcher narrow**

Update `lib/catalog/matcher.js` to import `identityRowFromRecord` from `stable-id-resolver` and keep `matchSourceItem` as only the AnimeTosho AniDB helper:

```js
const { recordByAnidb } = require("./anime-map");
const { identityRowFromRecord } = require("./stable-id-resolver");
```

Keep `matchSourceItem` returning `null` for all rows without direct AniDB evidence.

- [ ] **Step 7: Run resolver and matcher tests**

Run:

```bash
npm test -- tests/catalog-matcher.test.js tests/catalog-stable-id-resolver.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add lib/catalog/anime-map.js lib/catalog/matcher.js lib/catalog/stable-id-resolver.js tests/catalog-matcher.test.js tests/catalog-stable-id-resolver.test.js
git commit -m "feat(catalog): resolve stable ids without hash propagation"
```

---

### Task 8: Resolve Before Persisting During Ingestion

**Files:**
- Modify: `lib/catalog/ingest.js`
- Test: `tests/catalog-ingest.test.js`

- [ ] **Step 1: Replace ingestion test**

Replace the existing test in `tests/catalog-ingest.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { getCatalogDatabase, closeCatalogDatabaseForTests } = require("../lib/catalog/database");
const { runIngestion } = require("../lib/catalog/ingest");
const { loadAnimeMap } = require("../lib/catalog/anime-map");

test("runIngestion stores only resolved rows and drops unmapped rows", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const animeMap = loadAnimeMap(path.join(__dirname, "fixtures", "catalog", "anime-map-mini.json"));

    const result = await runIngestion({
        db,
        animeMap,
        source: "all",
        mode: "test",
        metadataClients: {
            kitsuSearchAnime: async query => query === "Example Anime"
                ? [{ id: "265", attributes: { canonicalTitle: "Example Anime", titles: { en_jp: "Example Anime" }, startDate: "1998-04-03" } }]
                : [],
            tmdbSearch: async () => []
        },
        fetchItems: async () => [
            {
                source: "nyaa",
                sourceItemId: "nyaa-1",
                infoHash: "abcdef0123456789abcdef0123456789abcdef01",
                title: "[SubsPlease] Example Anime - 01 [1080p]",
                raw: {}
            },
            {
                source: "tokyotosho",
                sourceItemId: "tt-1",
                infoHash: "abcdef0123456789abcdef0123456789abcdef01",
                title: "Example Anime - 01",
                raw: {}
            },
            {
                source: "nyaa",
                sourceItemId: "nyaa-2",
                infoHash: "abcdef0123456789abcdef0123456789abcdef02",
                title: "Unknown Upload - 01",
                raw: {}
            }
        ],
        now: () => 3000
    });

    assert.equal(result.scanned, 3);
    assert.equal(result.upserted, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.droppedUnmapped, 1);
    assert.equal(result.duplicateSkipped, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM source_items").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM torrent_identities").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM dropped_source_items").get().count, 1);
    assert.equal(db.prepare("SELECT source FROM source_items").get().source, "nyaa");
    db.close();
    closeCatalogDatabaseForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/catalog-ingest.test.js
```

Expected: FAIL because ingestion still stores rows before resolving and does not track drops/duplicates.

- [ ] **Step 3: Implement resolve-first ingestion**

In `lib/catalog/ingest.js`, import:

```js
const { createMetadataClients } = require("./metadata-clients");
const { parseReleaseTitle } = require("./release-parser");
const { createStableIdResolver } = require("./stable-id-resolver");
const { sourcePriority } = require("./source-item");
```

Add helpers:

```js
function pickCanonicalByHash(resolvedItems) {
    const byHash = new Map();
    let duplicateSkipped = 0;
    for (const item of resolvedItems) {
        const current = byHash.get(item.infoHash);
        if (!current || item.sourcePriority >= current.sourcePriority) {
            if (current) duplicateSkipped += 1;
            byHash.set(item.infoHash, item);
        } else {
            duplicateSkipped += 1;
        }
    }
    return { items: [...byHash.values()], duplicateSkipped };
}

function upsertDroppedItems(db, dropped, now) {
    const rows = dropped.map(entry => ({
        source: entry.item.source,
        source_item_id: entry.item.sourceItemId || entry.item.source_item_id || entry.item.infoHash || entry.item.info_hash,
        info_hash: entry.item.infoHash || entry.item.info_hash,
        title: entry.item.title || "",
        reason: entry.reason,
        parsed_json: JSON.stringify(entry.parsed || {}),
        raw_json: JSON.stringify(entry.item.raw || {}),
        first_seen_at: now,
        last_seen_at: now
    })).filter(row => row.info_hash && row.title);
    const statement = db.prepare(`
        INSERT INTO dropped_source_items (
            source, source_item_id, info_hash, title, reason, parsed_json, raw_json, first_seen_at, last_seen_at
        ) VALUES (
            @source, @source_item_id, @info_hash, @title, @reason, @parsed_json, @raw_json, @first_seen_at, @last_seen_at
        )
        ON CONFLICT(source, source_item_id) DO UPDATE SET
            info_hash = excluded.info_hash,
            title = excluded.title,
            reason = excluded.reason,
            parsed_json = excluded.parsed_json,
            raw_json = excluded.raw_json,
            last_seen_at = excluded.last_seen_at
    `);
    db.transaction(batch => batch.forEach(row => statement.run(row)))(rows);
    return rows.length;
}
```

Update `finishRun` to include:

```js
            dropped_unmapped = @dropped_unmapped,
            duplicate_skipped = @duplicate_skipped,
```

Inside `runIngestion`, replace the current fetch/upsert/match block with:

```js
        const items = await options.fetchItems();
        const resolver = createStableIdResolver({
            db,
            animeMap,
            metadataClients: options.metadataClients || createMetadataClients(),
            now
        });
        const resolved = [];
        const dropped = [];

        for (const item of items) {
            const parsed = await parseReleaseTitle(item.title);
            const result = await resolver.resolve(item, parsed);
            if (result.status === "accepted") {
                resolved.push({
                    ...item,
                    stableProvider: result.identity.stable_provider,
                    stableId: result.identity.stable_id,
                    sourcePriority: sourcePriority(item.source),
                    parsed,
                    identity: result.identity
                });
            } else {
                dropped.push({ item, parsed, reason: result.reason });
            }
        }

        const canonical = pickCanonicalByHash(resolved);
        const upserted = upsertSourceItems(db, canonical.items, startedAt);
        const matched = upsertIdentityMatches(db, canonical.items.map(item => item.identity));
        const droppedUnmapped = upsertDroppedItems(db, dropped, startedAt);
```

Return and persist the new counters:

```js
            dropped_unmapped: droppedUnmapped,
            duplicate_skipped: canonical.duplicateSkipped,
```

and:

```js
        return { source, mode, scanned: items.length, upserted, matched, failed: 0, droppedUnmapped, duplicateSkipped: canonical.duplicateSkipped };
```

In the `catch` finish payload, set:

```js
            dropped_unmapped: 0,
            duplicate_skipped: 0,
```

- [ ] **Step 4: Run ingestion test**

Run:

```bash
npm test -- tests/catalog-ingest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/ingest.js tests/catalog-ingest.test.js
git commit -m "feat(catalog): resolve stable ids before ingestion storage"
```

---

### Task 9: CLI Validation And Local Live Checks

**Files:**
- Modify: `scripts/catalog-validate.js`
- Modify: `scripts/catalog-ingest.js`
- Test: `tests/catalog-cli.test.js`

- [ ] **Step 1: Add CLI expectations**

In `tests/catalog-cli.test.js`, update validation assertions to include:

```js
    assert.match(result.stdout, /dropped_source_items=0/);
    assert.match(result.stdout, /identity_resolution_cache=0/);
```

- [ ] **Step 2: Update validation output**

In `scripts/catalog-validate.js`, add counts:

```js
    const dropped = count(db, "SELECT COUNT(*) AS count FROM dropped_source_items");
    const resolutionCache = count(db, "SELECT COUNT(*) AS count FROM identity_resolution_cache");
    console.log(`[CATALOG_VALIDATE] source_items=${sourceItems} torrent_identities=${identities} episode_matches=${episodes} dropped_source_items=${dropped} identity_resolution_cache=${resolutionCache}`);
```

Update per-source output to show canonical rows:

```js
        console.log(`[CATALOG_VALIDATE] source=${source} source_items=${rows} mapped=${mapped}`);
```

- [ ] **Step 3: Update ingest CLI log**

In `scripts/catalog-ingest.js`, replace the log line with:

```js
        console.log(`[CATALOG] source=${source} mode=${args.mode} scanned=${result.scanned} upserted=${result.upserted} matched=${result.matched} dropped_unmapped=${result.droppedUnmapped} duplicate_skipped=${result.duplicateSkipped} failed=${result.failed}`);
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
npm test -- tests/catalog-cli.test.js
```

Expected: PASS.

- [ ] **Step 5: Run local live validation with TMDB from `.env`**

Run:

```bash
set -a
. ./.env
set +a
tmpdb="$(mktemp -t nexio-catalog.XXXXXX.sqlite)"
node scripts/catalog-ingest.js --live --source nyaa --limit 5 --db "$tmpdb"
node scripts/catalog-ingest.js --live --source animetosho --limit 5 --db "$tmpdb"
node scripts/catalog-ingest.js --live --source tokyotosho --limit 5 --db "$tmpdb"
node scripts/catalog-validate.js --db "$tmpdb"
```

Expected:

```text
[CATALOG] source=nyaa ... dropped_unmapped=...
[CATALOG] source=animetosho ... dropped_unmapped=...
[CATALOG] source=tokyotosho ... dropped_unmapped=...
[CATALOG_VALIDATE] source_items=...
```

The validation is acceptable when `source_items` is greater than zero and every `source_items` row has a non-empty `stable_provider` and `stable_id`.

- [ ] **Step 6: Commit**

Run:

```bash
git add scripts/catalog-validate.js scripts/catalog-ingest.js tests/catalog-cli.test.js
git commit -m "chore(catalog): expose resolver ingestion diagnostics"
```

---

### Task 10: Full Verification

**Files:**
- No file edits.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass. Existing live tests may skip if their required environment is absent.

- [ ] **Step 2: Build Docker image**

Run:

```bash
docker build -t nexio-torii:stable-id-ingestion .
```

Expected: image builds successfully.

- [ ] **Step 3: Run Docker ingestion smoke test**

Run:

```bash
docker compose run --rm catalog-ingest node scripts/catalog-ingest.js --source none --mode init
```

Expected:

```text
[CATALOG] source=none mode=init scanned=0 upserted=0 matched=0 failed=0
```

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: only intended files are modified, with local `.env`, `.DS_Store`, and untracked API docs left unstaged.

---

## Self-Review

**Spec coverage:**
- Robust matcher using parser plus Kitsu/TMDB API: Tasks 3, 6, 7, 8.
- `.env` TMDB credentials: Task 6 reads `TMDB_API_KEY` and `TMDB_API_URL`; Task 9 live validation loads `.env`.
- No reliance on AnimeTosho hash matches: Task 7 explicitly tests no Nyaa mapping by shared hash and resolver never queries identities by hash.
- No duplicate hashes in source storage: Tasks 4 and 5 make `source_items.info_hash` the primary key and preserve one canonical source row.
- Prioritize Nyaa/AnimeTosho over TokyoTosho duplicates: Task 5 sets priority `nyaa=300`, `animetosho=200`, `tokyotosho=100`.
- Drop unmapped ingestion rows: Tasks 5 and 8 require stable IDs before storage and record dropped rows separately.
- API calls only during ingestion: Task 8 puts resolver calls inside `runIngestion`; addon serving remains untouched.

**Placeholder scan:** No placeholder markers or deferred implementation slots remain in this plan.

**Type consistency:** The plan consistently uses `stableProvider`/`stableId` at the item boundary, `stable_provider`/`stable_id` in database rows, `parsed.normalizedTitle` from the parser, and `identity` rows compatible with `upsertIdentityMatches`.
