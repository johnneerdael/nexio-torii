#!/usr/bin/env node
const fs = require("node:fs");
const { refreshAnimeMap } = require("../lib/catalog/anime-map-generator");

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--map") args.mapPath = argv[++i];
        else if (arg === "--provenance") args.provenancePath = argv[++i];
        else if (arg === "--fribb-file") args.fribbFile = argv[++i];
        else if (arg === "--scudlee-file") args.scudleeFile = argv[++i];
        else if (arg === "--timeout-ms") args.timeoutMs = parseInt(argv[++i], 10);
    }
    return args;
}

function fileSourceFetcher(args) {
    if (!args.fribbFile && !args.scudleeFile) return null;
    if (!args.fribbFile || !args.scudleeFile) {
        throw new Error("--fribb-file and --scudlee-file must be provided together");
    }
    return async () => ({
        fribb: {
            url: args.fribbFile,
            commit: null,
            text: fs.readFileSync(args.fribbFile, "utf8")
        },
        scudlee: {
            url: args.scudleeFile,
            commit: null,
            text: fs.readFileSync(args.scudleeFile, "utf8")
        }
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const result = await refreshAnimeMap({
        mapPath: args.mapPath,
        provenancePath: args.provenancePath,
        timeoutMs: args.timeoutMs,
        fetchSources: fileSourceFetcher(args) || undefined
    });
    console.log(`[ANIME_MAP] refreshed=${result.refreshed} used_existing=${result.usedExisting || false} identity_records=${result.identityRecords} episode_mappings=${result.episodeMappingRecords} path=${result.mapPath}`);
}

main().catch(error => {
    console.error(`[ANIME_MAP] failed error=${JSON.stringify(error.message)}`);
    process.exit(1);
});
