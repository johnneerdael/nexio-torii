#!/usr/bin/env node
const { getCatalogDatabase } = require("../lib/catalog/database");
const { emptyAnimeMap, loadAnimeMap } = require("../lib/catalog/anime-map");
const { runIngestion } = require("../lib/catalog/ingest");
const nyaa = require("../lib/catalog/source/nyaa");
const animetosho = require("../lib/catalog/source/animetosho");
const tokyotosho = require("../lib/catalog/source/tokyotosho");
const {
    fetchAnimeToshoBackfill,
    fetchNyaaBackfill,
    fetchTokyoToshoBackfill
} = require("../lib/catalog/source/backfill");

function parseArgs(argv) {
    const args = { source: "all", mode: "daily", live: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--live") args.live = true;
        else if (arg === "--db") args.db = argv[++i];
        else if (arg === "--anime-map") args.animeMap = argv[++i];
        else if (arg === "--source") args.source = argv[++i];
        else if (arg === "--mode") args.mode = argv[++i];
        else if (arg === "--limit") args.limit = parseInt(argv[++i], 10);
        else if (arg === "--page") args.page = parseInt(argv[++i], 10);
        else if (arg === "--max-pages") args.maxPages = parseInt(argv[++i], 10);
        else if (arg === "--page-delay-ms") args.pageDelayMs = parseInt(argv[++i], 10);
        else if (arg === "--animetosho-tsv-url") args.animeToshoTsvUrl = argv[++i];
    }
    return args;
}

function sourceList(source) {
    if (source === "all") return ["nyaa", "animetosho", "tokyotosho"];
    if (source === "none") return [];
    return [source];
}

function limited(items, limit) {
    return Number.isFinite(limit) && limit > 0 ? items.slice(0, limit) : items;
}

function backfillOptions(args) {
    return {
        maxPages: Number.isFinite(args.maxPages) ? args.maxPages : undefined,
        pageDelayMs: Number.isFinite(args.pageDelayMs) ? args.pageDelayMs : undefined,
        animeToshoTsvUrl: args.animeToshoTsvUrl
    };
}

function fetcherFor(source, args) {
    if (!args.live) {
        return async () => [];
    }
    if (args.mode === "backfill") {
        if (source === "nyaa") return async () => fetchNyaaBackfill(backfillOptions(args));
        if (source === "animetosho") return async () => fetchAnimeToshoBackfill(backfillOptions(args));
        if (source === "tokyotosho") return async () => fetchTokyoToshoBackfill(backfillOptions(args));
    }
    if (source === "nyaa") {
        return async () => limited(await nyaa.fetchListingPage(args.page || 1, "1_0", { timeoutMs: 10000 }), args.limit);
    }
    if (source === "animetosho") {
        return async () => limited(await animetosho.fetchJsonFeed({ timeoutMs: 10000 }), args.limit);
    }
    if (source === "tokyotosho") {
        return async () => limited(await tokyotosho.fetchRss({ timeoutMs: 20000 }), args.limit);
    }
    throw new Error(`Unsupported source: ${source}`);
}

function loadMap(args) {
    if (args.animeMap) return loadAnimeMap(args.animeMap);
    try {
        return loadAnimeMap();
    } catch (error) {
        return emptyAnimeMap();
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const db = getCatalogDatabase({ dbPath: args.db });
    const animeMap = loadMap(args);

    const sources = sourceList(args.source);
    if (sources.length === 0) {
        console.log(`[CATALOG] source=none mode=${args.mode} scanned=0 upserted=0 matched=0 failed=0`);
        return;
    }

    for (const source of sources) {
        const result = await runIngestion({
            db,
            animeMap,
            source,
            mode: args.mode,
            fetchItems: fetcherFor(source, args)
        });
        console.log(`[CATALOG] source=${source} mode=${args.mode} scanned=${result.scanned} upserted=${result.upserted} matched=${result.matched} dropped_unmapped=${result.droppedUnmapped} duplicate_skipped=${result.duplicateSkipped} failed=${result.failed}`);
    }
}

main().catch(error => {
    console.error(`[CATALOG] failed error=${JSON.stringify(error.message)}`);
    process.exit(1);
});
