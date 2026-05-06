#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { runDaily, resolveIntervalMs } = require("../lib/catalog/daily-runner");
const { refreshAnimeMap } = require("../lib/catalog/anime-map-generator");

function parseArgs(argv) {
    const runner = { once: false };
    const ingestArgs = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--once") runner.once = true;
        else if (arg === "--interval-ms") runner.intervalMs = parseInt(argv[++i], 10);
        else ingestArgs.push(arg);
    }
    return { runner, ingestArgs };
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

async function main() {
    const { runner, ingestArgs } = parseArgs(process.argv.slice(2));
    const intervalMs = runner.intervalMs || resolveIntervalMs();
    console.log(`[CATALOG_RUNNER] starting interval_ms=${intervalMs} once=${runner.once}`);
    await runDaily({
        once: runner.once,
        intervalMs,
        refreshAnimeMap,
        ingestCatalog: () => ingestCatalog(ingestArgs),
        log: message => console.log(message)
    });
}

main().catch(error => {
    console.error(`[CATALOG_RUNNER] failed error=${JSON.stringify(error.message)}`);
    process.exit(1);
});
