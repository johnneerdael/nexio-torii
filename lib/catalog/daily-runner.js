function resolveIntervalMs(env = process.env) {
    const parsed = parseInt(env.CATALOG_DAILY_INTERVAL_MS || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 24 * 60 * 60 * 1000;
}

async function runCycle(options) {
    const log = options.log || console.log;
    const map = await options.refreshAnimeMap();
    log(`[CATALOG_RUNNER] anime_map refreshed=${map.refreshed} used_existing=${map.usedExisting || false} identity_records=${map.identityRecords}`);
    const ingestion = await options.ingestCatalog();
    return { map, ingestion };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDaily(options) {
    const intervalMs = options.intervalMs || resolveIntervalMs();
    let cycle = 0;

    while (true) {
        cycle += 1;
        try {
            await runCycle(options);
        } catch (error) {
            if (cycle === 1) throw error;
            (options.log || console.log)(`[CATALOG_RUNNER] cycle_failed error=${JSON.stringify(error.message)}`);
        }

        if (options.once) return;
        await (options.sleep || sleep)(intervalMs);
    }
}

module.exports = {
    resolveIntervalMs,
    runCycle,
    runDaily
};
