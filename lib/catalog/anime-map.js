const fs = require("node:fs");
const path = require("node:path");

function defaultAnimeMapPath() {
    return process.env.ANIME_MAP_PATH || path.join(process.cwd(), "data", "anime", "nexio-anime-map-v1.json");
}

function loadAnimeMap(filePath = defaultAnimeMapPath()) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
        records: data.identityRecordsByKitsu || {},
        indexes: data.indexes || {},
        episodeMappings: data.episodeMappingsByAnidb || {}
    };
}

function emptyAnimeMap() {
    return {
        records: {},
        indexes: {},
        episodeMappings: {}
    };
}

function recordByAnidb(animeMap, anidbId) {
    const kitsu = animeMap.indexes.byAnidb?.[String(anidbId)];
    return kitsu ? animeMap.records[kitsu] || null : null;
}

module.exports = {
    defaultAnimeMapPath,
    emptyAnimeMap,
    loadAnimeMap,
    recordByAnidb
};
