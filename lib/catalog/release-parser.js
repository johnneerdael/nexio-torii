const { normalizeTitle } = require("./title-normalizer");
const {
    classifyReleaseTitle,
    extractParentheticalAliases,
    extractSeasonHints,
    generateQueryTitles,
    stripSupportSuffixes
} = require("./release-query");

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

function invalidParsedTitle(title) {
    const value = String(title || "").trim();
    return !value || value.length < 2 || /^\d+$/.test(value);
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
            aliases: [],
            seasonHints: [],
            queryTitles: [],
            isSupportUpload: false,
            dropReason: "unparsed_title",
            confidence: 0
        };
    }

    const parser = await getParser();
    const parsed = parser.parse(rawTitle);
    const parsedTitle = firstString(parsed.title);
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

    return {
        rawTitle,
        title: cleanedTitle,
        normalizedTitle: cleanedTitle ? normalizeTitle(cleanedTitle) : null,
        year: parsed.year ? String(parsed.year) : null,
        seasons: listOfNumbers(parsed.seasons ?? parsed.season),
        episodes: listOfNumbers(parsed.episodes ?? parsed.episode),
        volumes: listOfNumbers(parsed.volumes ?? parsed.volume),
        resolution: firstString(parsed.resolution),
        quality: firstString(parsed.quality),
        releaseGroup: firstString(parsed.releaseGroup, parsed.group),
        aliases,
        seasonHints,
        queryTitles,
        isSupportUpload: classification.isSupportUpload,
        dropReason,
        confidence: cleanedTitle ? 80 : 0
    };
}

module.exports = {
    parseReleaseTitle
};
