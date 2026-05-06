//===============
// Torrent-title parser used by the stream handler's canonical-gate filter.
// Wraps the existing lib/catalog/release-parser (which uses
// @viren070/parse-torrent-title) and adds two cheap regex helpers that
// surface format hints (Movie/Recap/OVA/Special) which the PTT parser
// doesn't extract on its own.
//===============

const { parseReleaseTitle } = require("../catalog/release-parser");

const FORMAT_HINT_REGEX = [
    { tag: "MOVIE",   re: /\b(Movie|Gekijouban|Gekijou-?ban|Theatrical|The Movie|Film)\b/i },
    { tag: "RECAP",   re: /\b(Recap|Compilation|Summary)\b/i },
    { tag: "OVA",     re: /\bOVA\b/i },
    { tag: "SPECIAL", re: /\b(Special|SP)\b/i },
    { tag: "ONA",     re: /\bONA\b/i }
];

function detectFormatHint(title) {
    const t = String(title || "");
    for (const { tag, re } of FORMAT_HINT_REGEX) {
        if (re.test(t)) return tag;
    }
    return null;
}

function detectDub(title) {
    const t = String(title || "");
    if (/\b(Dual\s*Audio|Multi[-\s]?Audio|Dub(bed)?|ENG[-\s]?DUB|English\s*Dub)\b/i.test(t)) return true;
    return null;
}

//===============
// Returns a stable parsed shape for the gating logic:
//   { rawTitle, parsedTitle, year, seasons, episodes, formatHint, dub }
// `parsedTitle` is the PTT-cleaned title (release group/season/episode tokens
// stripped), suitable for fuzzy comparison against canonical titles.
//===============
async function parseTorrentTitle(rawTitle) {
    const parsed = await parseReleaseTitle(rawTitle);
    return {
        rawTitle,
        parsedTitle: parsed.title || rawTitle,
        year: parsed.year ? parseInt(parsed.year, 10) : null,
        seasons: Array.isArray(parsed.seasons) ? parsed.seasons : [],
        episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
        resolution: parsed.resolution || null,
        formatHint: detectFormatHint(rawTitle),
        dub: detectDub(rawTitle)
    };
}

module.exports = { parseTorrentTitle, detectFormatHint, detectDub };
