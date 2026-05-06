#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { getCatalogDatabase } = require("../lib/catalog/database");
const {
    isBackfillComplete,
    markBackfillComplete,
    markBackfillFailed
} = require("../lib/catalog/backfill-state");
const { runDaily, runStartupBackfillIfNeeded, resolveIntervalMs } = require("../lib/catalog/daily-runner");
const { refreshAnimeMap } = require("../lib/catalog/anime-map-generator");

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

function runChild(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit"
        });
        child.on("error", reject);
        child.on("exit", code => {
            if (code === 0) resolve();
            else reject(new Error(`${args[0]} exited with code ${code}`));
        });
    });
}

async function ingestCatalog(args) {
    await runChild(["scripts/catalog-ingest.js", ...args]);
    return [];
}

async function ingestBackfill(args) {
    await runChild(["scripts/catalog-ingest.js", "--source", "all", "--mode", "backfill", "--live", ...args]);
    return { mode: "backfill" };
}

async function main() {
    const { runner, dailyArgs, backfillArgs } = parseArgs(process.argv.slice(2));
    const db = getCatalogDatabase();
    const intervalMs = runner.intervalMs || resolveIntervalMs();
    console.log(`[CATALOG_RUNNER] starting interval_ms=${intervalMs} once=${runner.once}`);
    if (runner.startupBackfill) {
        await runStartupBackfillIfNeeded({
            isBackfillComplete: () => isBackfillComplete(db),
            ingestBackfill: () => ingestBackfill(backfillArgs),
            markBackfillComplete: payload => markBackfillComplete(db, payload),
            markBackfillFailed: payload => markBackfillFailed(db, payload),
            log: message => console.log(message)
        });
    }
    await runDaily({
        once: runner.once,
        intervalMs,
        refreshAnimeMap,
        ingestCatalog: () => ingestCatalog(dailyArgs),
        log: message => console.log(message)
    });
}

main().catch(error => {
    console.error(`[CATALOG_RUNNER] failed error=${JSON.stringify(error.message)}`);
    process.exit(1);
});
