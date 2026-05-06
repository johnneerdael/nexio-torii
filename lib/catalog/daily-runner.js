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

module.exports = {
    resolveIntervalMs,
    runCycle,
    runDaily,
    runStartupBackfillIfNeeded
};
