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
