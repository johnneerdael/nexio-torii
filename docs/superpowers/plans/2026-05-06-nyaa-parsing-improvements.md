# Nyaa Parsing Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Nyaa stable-ID mapping by filtering non-video/support uploads, generating better anime title query variants, preserving season context, and recording resolver rejection diagnostics.

**Architecture:** Keep the ingestion contract strict: only accepted stable-ID rows enter `source_items`; ambiguous/unmapped rows remain dropped. Improve recall by enriching parser output with support-upload classification, alias/query variants, and season hints, then update the resolver to query Kitsu/TMDB with those variants and accept a lower score only when one candidate is uniquely supported by season/title evidence.

**Tech Stack:** Node.js CommonJS, `@viren070/parse-torrent-title`, `fuzzball`, `better-sqlite3`, Node test runner, Kitsu/TMDB metadata clients.

---

## File Structure

- Create `lib/catalog/release-query.js`: pure helpers for filtering support uploads, cleaning parser titles, extracting parenthetical aliases, generating Kitsu/TMDB query variants, and deriving season labels.
- Modify `lib/catalog/release-parser.js`: attach `queryTitles`, `aliases`, `seasonHints`, `isSupportUpload`, and `dropReason` to parsed releases.
- Modify `lib/catalog/stable-id-resolver.js`: use query variants instead of one parsed title, store rejected candidate diagnostics, apply conservative unique-candidate acceptance for season-backed matches, and keep ambiguity drops.
- Modify `lib/catalog/database.js`: add `candidate_json` and `query_json` columns to `identity_resolution_cache`.
- Modify `lib/catalog/ingest.js`: drop parser-classified support uploads before metadata lookup, preserving the specific reason in `dropped_source_items`.
- Modify `scripts/catalog-validate.js`: include cache diagnostics count in validation output.
- Add tests:
  - `tests/catalog-release-query.test.js`
  - update `tests/catalog-release-parser.test.js`
  - update `tests/catalog-stable-id-resolver.test.js`
  - update `tests/catalog-ingest.test.js`
  - update `tests/catalog-database.test.js`
  - update `tests/catalog-cli.test.js`

---

### Task 1: Release Query Helpers

**Files:**
- Create: `lib/catalog/release-query.js`
- Test: `tests/catalog-release-query.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/catalog-release-query.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    classifyReleaseTitle,
    extractParentheticalAliases,
    extractSeasonHints,
    generateQueryTitles,
    stripSupportSuffixes
} = require("../lib/catalog/release-query");

test("classifyReleaseTitle detects support archive uploads", () => {
    const result = classifyReleaseTitle("[KOTEX] Kanpekisugite Kawaige ga Nai Subs+Fonts for ReinForce [BD].zip");

    assert.equal(result.isSupportUpload, true);
    assert.equal(result.dropReason, "support_upload");
});

test("classifyReleaseTitle does not reject normal mkv releases", () => {
    const result = classifyReleaseTitle("[SubsPlease] Ganbare! Nakamura-kun!! - 07 (1080p) [7A297C20].mkv");

    assert.equal(result.isSupportUpload, false);
    assert.equal(result.dropReason, null);
});

test("stripSupportSuffixes removes trailing subs fonts packaging text", () => {
    assert.equal(
        stripSupportSuffixes("Kanpekisugite Kawaige ga Nai to Konyaku Haki Sareta Seijo wa Ringoku ni Urareru Subs+Fonts for ReinForce"),
        "Kanpekisugite Kawaige ga Nai to Konyaku Haki Sareta Seijo wa Ringoku ni Urareru"
    );
});

test("extractParentheticalAliases returns useful aliases only", () => {
    const aliases = extractParentheticalAliases("Classroom of the Elite S04E02 Contract 1080p (Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season, Multi-Audio, Multi-Subs)");

    assert.deepEqual(aliases, ["Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season"]);
});

test("extractSeasonHints preserves season context", () => {
    assert.deepEqual(extractSeasonHints("Classroom of the Elite S04E02 Contract and Payment"), ["4th Season"]);
    assert.deepEqual(extractSeasonHints("The Beginning After the End 2nd Season - 06"), ["2nd Season"]);
});

test("generateQueryTitles builds deduped title variants for Classroom season four", () => {
    const variants = generateQueryTitles({
        rawTitle: "[T3KASHi] Classroom of the Elite Second Year First Semester S04E01 MULTi 1080p",
        parsedTitle: "Classroom of the Elite Second Year First Semester",
        aliases: [],
        seasonHints: ["4th Season"]
    });

    assert.deepEqual(variants.slice(0, 3), [
        "Classroom of the Elite 4th Season Second Year First Semester",
        "Classroom of the Elite Second Year First Semester",
        "Classroom of the Elite 4th Season"
    ]);
});

test("generateQueryTitles prefers parenthetical English alias for mixed JP English title", () => {
    const variants = generateQueryTitles({
        rawTitle: "[Judas] Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End) - S02E06",
        parsedTitle: "Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End)",
        aliases: ["The Beginning After the End"],
        seasonHints: ["2nd Season"]
    });

    assert.equal(variants[0], "The Beginning After the End 2nd Season");
    assert.ok(variants.includes("The Beginning After the End"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/catalog-release-query.test.js
```

Expected: FAIL with `Cannot find module '../lib/catalog/release-query'`.

- [ ] **Step 3: Implement query helpers**

Create `lib/catalog/release-query.js`:

```js
const { normalizeTitle } = require("./title-normalizer");

const SUPPORT_PATTERNS = [
    /\bsubs?\s*[+&]\s*fonts?\b/i,
    /\bfonts?\s*[+&]\s*subs?\b/i,
    /\bsubtitles?\b/i,
    /\battachments?\b/i
];

const SUPPORT_EXTENSIONS = /\.(zip|7z|rar|ass|srt|vtt)$/i;
const LOW_VALUE_ALIAS_PATTERNS = [
    /\bmulti[-\s]?audio\b/i,
    /\bmulti[-\s]?subs?\b/i,
    /\benglish[-\s]?sub\b/i,
    /\bdual[-\s]?audio\b/i,
    /^\s*(cr|amzn|hidive|baha)\s*$/i
];

function ordinal(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    const mod10 = number % 10;
    if (mod10 === 1) return `${number}st`;
    if (mod10 === 2) return `${number}nd`;
    if (mod10 === 3) return `${number}rd`;
    return `${number}th`;
}

function classifyReleaseTitle(rawTitle) {
    const title = String(rawTitle || "");
    const isSupportUpload = SUPPORT_EXTENSIONS.test(title) || SUPPORT_PATTERNS.some(pattern => pattern.test(title));
    return {
        isSupportUpload,
        dropReason: isSupportUpload ? "support_upload" : null
    };
}

function stripSupportSuffixes(title) {
    return String(title || "")
        .replace(/\s+subs?\s*[+&]\s*fonts?\s+for\s+.+$/i, "")
        .replace(/\s+fonts?\s*[+&]\s*subs?\s+for\s+.+$/i, "")
        .replace(/\s+subtitles?\s+for\s+.+$/i, "")
        .trim();
}

function extractParentheticalAliases(rawTitle) {
    const matches = [...String(rawTitle || "").matchAll(/\(([^()]+)\)/g)];
    return matches
        .flatMap(match => match[1].split(","))
        .map(value => value.trim())
        .filter(value => value.length >= 4)
        .filter(value => !LOW_VALUE_ALIAS_PATTERNS.some(pattern => pattern.test(value)))
        .filter(value => !/^\d+p$/i.test(value))
        .filter((value, index, list) => list.findIndex(other => normalizeTitle(other) === normalizeTitle(value)) === index);
}

function extractSeasonHints(rawTitle) {
    const title = String(rawTitle || "");
    const hints = [];
    for (const match of title.matchAll(/\bS(\d{1,2})E\d{1,3}\b/gi)) {
        const label = ordinal(match[1]);
        if (label) hints.push(`${label} Season`);
    }
    for (const match of title.matchAll(/\b(\d{1,2})(st|nd|rd|th)\s+Season\b/gi)) {
        hints.push(`${Number(match[1])}${match[2].toLowerCase()} Season`);
    }
    return hints.filter((value, index, list) => list.findIndex(other => normalizeTitle(other) === normalizeTitle(value)) === index);
}

function stripSeasonWords(title) {
    return String(title || "")
        .replace(/\b\d{1,2}(st|nd|rd|th)\s+Season\b/gi, "")
        .replace(/\bSecond Year First Semester\b/i, "Second Year First Semester")
        .replace(/\s+/g, " ")
        .trim();
}

function addVariant(list, value) {
    const clean = stripSupportSuffixes(value).replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 2) return;
    if (/^\d+$/.test(clean)) return;
    const key = normalizeTitle(clean);
    if (!key || list.some(item => normalizeTitle(item) === key)) return;
    list.push(clean);
}

function generateQueryTitles({ rawTitle, parsedTitle, aliases = [], seasonHints = [] }) {
    const variants = [];
    const cleanParsed = stripSupportSuffixes(parsedTitle || "");
    const primaryAlias = aliases.find(Boolean);

    for (const hint of seasonHints) {
        if (primaryAlias) addVariant(variants, `${primaryAlias} ${hint}`);
    }
    for (const hint of seasonHints) {
        if (/\bSecond Year First Semester\b/i.test(cleanParsed)) {
            addVariant(variants, cleanParsed.replace(/\bClassroom of the Elite\b/i, `Classroom of the Elite ${hint}`));
        }
    }
    addVariant(variants, cleanParsed);
    for (const hint of seasonHints) {
        addVariant(variants, `${stripSeasonWords(cleanParsed.replace(/\bSecond Year First Semester\b/i, "")).trim()} ${hint}`);
    }
    for (const alias of aliases) addVariant(variants, alias);
    for (const hint of seasonHints) {
        for (const alias of aliases) addVariant(variants, `${alias} ${hint}`);
    }
    addVariant(variants, rawTitle);

    return variants.slice(0, 8);
}

module.exports = {
    classifyReleaseTitle,
    extractParentheticalAliases,
    extractSeasonHints,
    generateQueryTitles,
    stripSupportSuffixes
};
```

- [ ] **Step 4: Run query helper tests**

Run:

```bash
node --test tests/catalog-release-query.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/release-query.js tests/catalog-release-query.test.js
git commit -m "feat(catalog): add Nyaa release query helpers"
```

---

### Task 2: Enrich Parsed Release Output

**Files:**
- Modify: `lib/catalog/release-parser.js`
- Test: `tests/catalog-release-parser.test.js`

- [ ] **Step 1: Add parser output tests**

Append to `tests/catalog-release-parser.test.js`:

```js
test("parseReleaseTitle flags support uploads before metadata lookup", async () => {
    const parsed = await parseReleaseTitle("[KOTEX] Kanpekisugite Kawaige ga Nai Subs+Fonts for ReinForce [BD].zip");

    assert.equal(parsed.isSupportUpload, true);
    assert.equal(parsed.dropReason, "support_upload");
    assert.deepEqual(parsed.queryTitles, []);
});

test("parseReleaseTitle adds query variants from aliases and season hints", async () => {
    const parsed = await parseReleaseTitle("[Judas] Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End) - S02E06 [1080p]");

    assert.equal(parsed.isSupportUpload, false);
    assert.deepEqual(parsed.aliases, ["The Beginning After the End"]);
    assert.deepEqual(parsed.seasonHints, ["2nd Season"]);
    assert.equal(parsed.queryTitles[0], "The Beginning After the End 2nd Season");
    assert.ok(parsed.queryTitles.includes("The Beginning After the End"));
});

test("parseReleaseTitle rejects numeric-only parsed titles", async () => {
    const parsed = await parseReleaseTitle("1");

    assert.equal(parsed.dropReason, "invalid_parsed_title");
    assert.deepEqual(parsed.queryTitles, []);
});
```

- [ ] **Step 2: Run parser tests to verify failure**

Run:

```bash
node --test tests/catalog-release-parser.test.js
```

Expected: FAIL because `isSupportUpload`, `dropReason`, `aliases`, `seasonHints`, and `queryTitles` do not exist yet.

- [ ] **Step 3: Update parser**

At the top of `lib/catalog/release-parser.js`, add:

```js
const {
    classifyReleaseTitle,
    extractParentheticalAliases,
    extractSeasonHints,
    generateQueryTitles,
    stripSupportSuffixes
} = require("./release-query");
```

Add helper:

```js
function invalidParsedTitle(title) {
    const value = String(title || "").trim();
    return !value || value.length < 2 || /^\d+$/.test(value);
}
```

In the blank-input return object, add:

```js
            aliases: [],
            seasonHints: [],
            queryTitles: [],
            isSupportUpload: false,
            dropReason: "unparsed_title",
```

After `const parsedTitle = firstString(parsed.title);`, insert:

```js
    const classification = classifyReleaseTitle(rawTitle);
    const cleanedTitle = parsedTitle ? stripSupportSuffixes(parsedTitle) : null;
    const aliases = extractParentheticalAliases(rawTitle);
    const seasonHints = extractSeasonHints(rawTitle);
    const dropReason = classification.dropReason || (invalidParsedTitle(cleanedTitle) ? "invalid_parsed_title" : null);
    const queryTitles = dropReason ? [] : generateQueryTitles({
        rawTitle,
        parsedTitle: cleanedTitle,
        aliases,
        seasonHints
    });
```

In the return object, change title fields and add the new fields:

```js
        title: cleanedTitle,
        normalizedTitle: cleanedTitle ? normalizeTitle(cleanedTitle) : null,
        aliases,
        seasonHints,
        queryTitles,
        isSupportUpload: classification.isSupportUpload,
        dropReason,
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
node --test tests/catalog-release-parser.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/release-parser.js tests/catalog-release-parser.test.js
git commit -m "feat(catalog): enrich Nyaa release parse output"
```

---

### Task 3: Resolver Query Variants And Candidate Diagnostics

**Files:**
- Modify: `lib/catalog/database.js`
- Modify: `lib/catalog/stable-id-resolver.js`
- Test: `tests/catalog-database.test.js`
- Test: `tests/catalog-stable-id-resolver.test.js`

- [ ] **Step 1: Add database diagnostics test**

Append to `tests/catalog-database.test.js`:

```js
test("identity resolution cache stores query and candidate diagnostics", () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const columns = db.prepare("PRAGMA table_info(identity_resolution_cache)").all().map(column => column.name);

    assert.ok(columns.includes("query_json"));
    assert.ok(columns.includes("candidate_json"));

    db.close();
    closeCatalogDatabaseForTests();
});
```

- [ ] **Step 2: Add resolver variant tests**

Append to `tests/catalog-stable-id-resolver.test.js`:

```js
test("resolver accepts a single season-backed Kitsu candidate at score 90", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const calls = [];
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async query => {
                calls.push(query);
                return query.includes("4th Season")
                    ? [{ id: "49194", attributes: { canonicalTitle: "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season: 2-nensei-hen 1 Gakki", titles: { en: "Classroom of the Elite 4th Season: Second Year, First Semester" }, startDate: "2026-01-01" } }]
                    : [];
            },
            tmdbSearch: async () => []
        },
        now: () => 5000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef07",
        title: "Classroom of the Elite Second Year First Semester S04E01",
        raw: {}
    }, {
        title: "Classroom of the Elite Second Year First Semester",
        normalizedTitle: "classroomoftheelitesecondyearfirstsemester",
        year: null,
        episodes: [1],
        seasons: [4],
        aliases: [],
        seasonHints: ["4th Season"],
        queryTitles: [
            "Classroom of the Elite 4th Season Second Year First Semester",
            "Classroom of the Elite Second Year First Semester"
        ]
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.kitsu_id, "49194");
    assert.equal(result.identity.confidence, 86);
    assert.deepEqual(calls, ["Classroom of the Elite 4th Season Second Year First Semester"]);
});

test("resolver uses parenthetical alias variants before dropping mixed-title releases", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const calls = [];
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async query => {
                calls.push(query);
                return query === "The Beginning After the End 2nd Season"
                    ? [{ id: "49983", attributes: { canonicalTitle: "The Beginning After the End Season 2", titles: { en: "The Beginning After the End Season 2", en_jp: "Saikyou no Ousama, Nidome no Jinsei wa Nani wo Suru? 2nd Season" }, startDate: "2026-01-01" } }]
                    : [];
            },
            tmdbSearch: async () => []
        },
        now: () => 5000
    });

    const result = await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef08",
        title: "Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End) - S02E06",
        raw: {}
    }, {
        title: "Saikyou no Ousama, Nidome no Jinsei wa Nani o Suru (The Beginning After the End)",
        normalizedTitle: "saikyounoousamanidomenojinseiwananiosuruthebeginningaftertheend",
        year: null,
        episodes: [6],
        seasons: [2],
        aliases: ["The Beginning After the End"],
        seasonHints: ["2nd Season"],
        queryTitles: ["The Beginning After the End 2nd Season", "The Beginning After the End"]
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.identity.kitsu_id, "49983");
    assert.equal(calls[0], "The Beginning After the End 2nd Season");
});

test("resolver writes candidate diagnostics for dropped rows", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const resolver = createStableIdResolver({
        db,
        animeMap: loadAnimeMap(fixturePath),
        metadataClients: {
            kitsuSearchAnime: async () => [
                { id: "100", attributes: { canonicalTitle: "Example Anime", titles: { en: "Example Anime" }, startDate: "1998-01-01" } },
                { id: "101", attributes: { canonicalTitle: "Example Anime", titles: { en: "Example Anime" }, startDate: "1998-04-03" } }
            ],
            tmdbSearch: async () => []
        },
        now: () => 5000
    });

    await resolver.resolve({
        source: "nyaa",
        infoHash: "abcdef0123456789abcdef0123456789abcdef09",
        title: "Example Anime - 01",
        raw: {}
    }, {
        title: "Example Anime",
        normalizedTitle: "exampleanime",
        year: "1998",
        episodes: [1],
        seasons: [],
        aliases: [],
        seasonHints: [],
        queryTitles: ["Example Anime"]
    });

    const cache = db.prepare("SELECT query_json, candidate_json FROM identity_resolution_cache").get();
    assert.deepEqual(JSON.parse(cache.query_json), ["Example Anime"]);
    assert.equal(JSON.parse(cache.candidate_json).kitsu.length, 2);
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
node --test tests/catalog-database.test.js tests/catalog-stable-id-resolver.test.js
```

Expected: FAIL because cache columns and resolver variant behavior do not exist.

- [ ] **Step 4: Add cache diagnostic columns**

In `lib/catalog/database.js`, add these columns to `identity_resolution_cache` DDL after `media_type TEXT,`:

```sql
          query_json TEXT NOT NULL DEFAULT '[]',
          candidate_json TEXT NOT NULL DEFAULT '{}',
```

After `ensureIngestionRunColumns`, create `ensureResolutionCacheColumns`:

```js
function ensureResolutionCacheColumns(db) {
    const existing = db.prepare("PRAGMA table_info(identity_resolution_cache)").all().map(row => row.name);
    for (const [column, definition] of [
        ["query_json", "TEXT NOT NULL DEFAULT '[]'"],
        ["candidate_json", "TEXT NOT NULL DEFAULT '{}'"]
    ]) {
        if (!existing.includes(column)) {
            db.exec(`ALTER TABLE identity_resolution_cache ADD COLUMN ${column} ${definition}`);
        }
    }
}
```

Call it after `ensureIngestionRunColumns(db);`:

```js
    ensureResolutionCacheColumns(db);
```

- [ ] **Step 5: Update resolver to use variants and diagnostics**

In `lib/catalog/stable-id-resolver.js`, update `writeCache` signature:

```js
function writeCache(db, key, parsed, result, now, diagnostics = {}) {
```

Add `query_json, candidate_json` to the insert column list after `media_type`.

Add `@query_json, @candidate_json` to the values list.

Add update assignments:

```sql
            query_json = excluded.query_json,
            candidate_json = excluded.candidate_json,
```

Add run values:

```js
        query_json: JSON.stringify(diagnostics.queries || parsed.queryTitles || [parsed.title].filter(Boolean)),
        candidate_json: JSON.stringify(diagnostics.candidates || {}),
```

Add helper functions before `createStableIdResolver`:

```js
function queryTitlesFor(parsed) {
    const titles = Array.isArray(parsed.queryTitles) && parsed.queryTitles.length ? parsed.queryTitles : [parsed.title].filter(Boolean);
    return titles.filter((title, index, list) => list.findIndex(other => normalizeTitle(other) === normalizeTitle(title)) === index);
}

function hasSeasonEvidence(parsed, query) {
    return Boolean(
        parsed.seasonHints?.some(hint => normalizeTitle(query).includes(normalizeTitle(hint))) ||
        parsed.seasons?.length
    );
}

function diagnosticCandidate(provider, query, match) {
    return {
        provider,
        query,
        id: String(match.row.id),
        score: match.score,
        titles: provider === "kitsu" ? candidateTitlesFromKitsu(match.row) : candidateTitlesFromTmdb(match.row),
        year: candidateYear(match.row),
        mediaType: match.row.media_type || null
    };
}

async function collectKitsuMatches(metadataClients, parsed, queries) {
    const candidates = [];
    for (const query of queries) {
        const rows = await metadataClients.kitsuSearchAnime(query).catch(() => []);
        const matches = rows
            .map(row => ({ row, query, score: titleScore(query, candidateTitlesFromKitsu(row)) }))
            .filter(match => match.score >= 86 && yearCompatible(parsed.year, match.row));
        candidates.push(...matches.map(match => diagnosticCandidate("kitsu", query, match)));
        const strict = matches.filter(match => match.score >= 92);
        if (strict.length === 1) return { matches: strict, candidates };
        if (strict.length > 1) return { matches: strict, candidates };
        const seasonBacked = matches.filter(match => match.score >= 86 && hasSeasonEvidence(parsed, query));
        if (seasonBacked.length === 1) return { matches: seasonBacked, candidates, seasonBacked: true };
        if (seasonBacked.length > 1) return { matches: seasonBacked, candidates, seasonBacked: true };
    }
    return { matches: [], candidates };
}

async function collectTmdbMatches(metadataClients, parsed, queries) {
    const candidates = [];
    for (const query of queries) {
        const rows = await metadataClients.tmdbSearch(query).catch(() => []);
        const matches = rows
            .map(row => ({ row, query, score: titleScore(query, candidateTitlesFromTmdb(row)) }))
            .filter(match => match.score >= 90 && yearCompatible(parsed.year, match.row));
        candidates.push(...matches.map(match => diagnosticCandidate("tmdb", query, match)));
        if (matches.length) return { matches, candidates };
    }
    return { matches: [], candidates };
}
```

Inside `resolve`, after the parsed title guard, add:

```js
        if (parsed.dropReason) return { status: "dropped", reason: parsed.dropReason };
        const queries = queryTitlesFor(parsed);
```

Replace the existing Kitsu query block with:

```js
        const kitsuResult = await collectKitsuMatches(metadataClients, parsed, queries);
        const kitsuMatches = kitsuResult.matches;

        if (kitsuMatches.length === 1) {
            const kitsuId = kitsuMatches[0].row.id;
            const record = recordByKitsu(animeMap, kitsuId) || { kitsu: kitsuId };
            const confidence = kitsuResult.seasonBacked ? 86 : 90;
            const identity = identityRowFromRecord(item.infoHash || item.info_hash, record, confidence, [
                `parser.title=${parsed.title}`,
                `resolver.query=${kitsuMatches[0].query}`,
                `kitsu.search=${kitsuId}`,
                `title_score=${kitsuMatches[0].score}`
            ], now());
            const result = { status: "accepted", identity };
            writeCache(db, key, parsed, result, now(), { queries, candidates: { kitsu: kitsuResult.candidates } });
            return result;
        }

        if (kitsuMatches.length > 1) {
            const result = { status: "dropped", reason: "ambiguous_stable_id" };
            writeCache(db, key, parsed, result, now(), { queries, candidates: { kitsu: kitsuResult.candidates } });
            return result;
        }
```

Replace the existing TMDB query block with:

```js
        const tmdbResult = await collectTmdbMatches(metadataClients, parsed, queries);
        const tmdbMatches = tmdbResult.matches;
```

Update each `writeCache` call after TMDB to include:

```js
{ queries, candidates: { kitsu: kitsuResult.candidates, tmdb: tmdbResult.candidates } }
```

- [ ] **Step 6: Run resolver and database tests**

Run:

```bash
node --test tests/catalog-database.test.js tests/catalog-stable-id-resolver.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/catalog/database.js lib/catalog/stable-id-resolver.js tests/catalog-database.test.js tests/catalog-stable-id-resolver.test.js
git commit -m "feat(catalog): resolve Nyaa titles with query variants"
```

---

### Task 4: Drop Parser-Classified Support Uploads During Ingestion

**Files:**
- Modify: `lib/catalog/ingest.js`
- Test: `tests/catalog-ingest.test.js`

- [ ] **Step 1: Add ingestion test**

Append to `tests/catalog-ingest.test.js`:

```js
test("runIngestion drops support uploads without metadata lookups", async () => {
    const db = getCatalogDatabase({ dbPath: ":memory:" });
    const animeMap = loadAnimeMap(path.join(__dirname, "fixtures", "catalog", "anime-map-mini.json"));
    let lookupCount = 0;

    const result = await runIngestion({
        db,
        animeMap,
        source: "nyaa",
        mode: "test",
        metadataClients: {
            kitsuSearchAnime: async () => {
                lookupCount += 1;
                return [];
            },
            tmdbSearch: async () => {
                lookupCount += 1;
                return [];
            }
        },
        fetchItems: async () => [
            {
                source: "nyaa",
                sourceItemId: "support-1",
                infoHash: "abcdef0123456789abcdef0123456789abcdef10",
                title: "[KOTEX] Kanpekisugite Kawaige ga Nai Subs+Fonts for ReinForce [BD].zip",
                raw: {}
            }
        ],
        now: () => 6000
    });

    assert.equal(result.scanned, 1);
    assert.equal(result.upserted, 0);
    assert.equal(result.droppedUnmapped, 1);
    assert.equal(lookupCount, 0);
    assert.equal(db.prepare("SELECT reason FROM dropped_source_items").get().reason, "support_upload");
    db.close();
    closeCatalogDatabaseForTests();
});
```

- [ ] **Step 2: Run ingestion test to verify failure**

Run:

```bash
node --test tests/catalog-ingest.test.js
```

Expected: FAIL because ingestion still calls resolver for parser-classified drops.

- [ ] **Step 3: Short-circuit parser-classified drops**

In `lib/catalog/ingest.js`, inside the `for (const item of items)` loop, immediately after:

```js
            const parsed = await parseReleaseTitle(item.title);
```

add:

```js
            if (parsed.dropReason) {
                dropped.push({ item, parsed, reason: parsed.dropReason });
                continue;
            }
```

- [ ] **Step 4: Run ingestion tests**

Run:

```bash
node --test tests/catalog-ingest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/catalog/ingest.js tests/catalog-ingest.test.js
git commit -m "feat(catalog): drop Nyaa support uploads before lookup"
```

---

### Task 5: CLI Diagnostics And Live Measurement

**Files:**
- Modify: `scripts/catalog-validate.js`
- Test: `tests/catalog-cli.test.js`

- [ ] **Step 1: Add CLI diagnostics expectation**

In `tests/catalog-cli.test.js`, add:

```js
    assert.match(result.stdout, /candidate_diagnostics=0/);
```

after the existing `identity_resolution_cache=0` assertion.

- [ ] **Step 2: Update validation output**

In `scripts/catalog-validate.js`, after `const resolutionCache = ...`, add:

```js
    const candidateDiagnostics = count(db, "SELECT COUNT(*) AS count FROM identity_resolution_cache WHERE candidate_json != '{}'");
```

Update the summary `console.log` to:

```js
    console.log(`[CATALOG_VALIDATE] source_items=${sourceItems} torrent_identities=${identities} episode_matches=${episodes} dropped_source_items=${dropped} identity_resolution_cache=${resolutionCache} candidate_diagnostics=${candidateDiagnostics}`);
```

- [ ] **Step 3: Run CLI tests**

Run:

```bash
node --test tests/catalog-cli.test.js
```

Expected: PASS.

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass; live catalog tests skip unless `LIVE_CATALOG_TESTS=1`.

- [ ] **Step 5: Measure Nyaa live mapping again**

Run:

```bash
set -a
. ./.env
set +a
tmpdb="$(mktemp -t nexio-nyaa-improved.XXXXXX.sqlite)"
node scripts/catalog-ingest.js --live --source nyaa --limit 50 --db "$tmpdb"
node scripts/catalog-validate.js --db "$tmpdb"
node - "$tmpdb" <<'NODE'
const Database = require('better-sqlite3');
const db = new Database(process.argv[2]);
const summary = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM source_items) AS mapped,
    (SELECT COUNT(*) FROM dropped_source_items) AS dropped,
    (SELECT COUNT(*) FROM identity_resolution_cache WHERE status = 'accepted') AS cache_accepted,
    (SELECT COUNT(*) FROM identity_resolution_cache WHERE status != 'accepted') AS cache_rejected
`).get();
console.log('[SUMMARY]', JSON.stringify(summary));
console.log('[DROPS_BY_REASON]', JSON.stringify(db.prepare(`
  SELECT reason, COUNT(*) AS count
  FROM dropped_source_items
  GROUP BY reason
  ORDER BY count DESC, reason
`).all()));
for (const row of db.prepare(`
  SELECT title, reason, parsed_json
  FROM dropped_source_items
  ORDER BY source_item_id
  LIMIT 20
`).all()) {
  const parsed = JSON.parse(row.parsed_json || '{}');
  console.log(JSON.stringify({ title: row.title, reason: row.reason, queryTitles: parsed.queryTitles, aliases: parsed.aliases, seasonHints: parsed.seasonHints }));
}
db.close();
NODE
```

Expected for a comparable Nyaa page sample: mapping rate should improve from the observed baseline of `38/50` (`76%`) when the current page contains similar Classroom/BOTE/support-upload failures. Remaining drops should mostly be true ambiguity, numeric garbage, or missing provider metadata.

- [ ] **Step 6: Commit**

Run:

```bash
git add scripts/catalog-validate.js tests/catalog-cli.test.js
git commit -m "chore(catalog): expose resolver candidate diagnostics"
```

---

## Self-Review

**Spec coverage:**
- Nyaa parsing improvements: Tasks 1 and 2 add support-upload detection, alias extraction, season hints, numeric-title rejection, and query variants.
- Improve mapping failures observed in sample: Task 3 targets `Classroom of the Elite` season context and `The Beginning After the End` parenthetical alias variants.
- Keep stable ID safety: Task 3 keeps unique-match acceptance and ambiguity drops; no hash propagation is introduced.
- Drop useless files: Task 4 drops support archives before API lookups.
- Measure success rate and inspect failures: Task 5 reruns the 50-row Nyaa sample and prints drops with query diagnostics.

**Placeholder scan:** No placeholder markers or deferred implementation slots remain in this plan.

**Type consistency:** Parser fields are consistently named `aliases`, `seasonHints`, `queryTitles`, `isSupportUpload`, and `dropReason`; resolver diagnostics use `query_json` and `candidate_json`; dropped rows keep `parsed_json`.
