const { normalizeTitle } = require("./title-normalizer");

const SUPPORT_PATTERNS = [
    /\bsubs?\s*[+&]\s*fonts?\b/i,
    /\bfonts?\s*[+&]\s*subs?\b/i,
    /\bsubtitles?\b/i,
    /\battachments?\b/i
];

const SUPPORT_EXTENSIONS = /\.(zip|7z|rar|ass|srt|vtt)$/i;
const LOW_VALUE_ALIAS_PATTERNS = [
    /\bmulti[-\s]?audio\b/i,
    /\bmulti[-\s]?subs?\b/i,
    /\benglish[-\s]?sub\b/i,
    /\bdual[-\s]?audio\b/i,
    /^\s*(cr|amzn|hidive|baha)\s*$/i
];

function ordinal(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    const mod10 = number % 10;
    if (mod10 === 1) return `${number}st`;
    if (mod10 === 2) return `${number}nd`;
    if (mod10 === 3) return `${number}rd`;
    return `${number}th`;
}

function classifyReleaseTitle(rawTitle) {
    const title = String(rawTitle || "");
    const isSupportUpload = SUPPORT_EXTENSIONS.test(title) || SUPPORT_PATTERNS.some(pattern => pattern.test(title));
    return {
        isSupportUpload,
        dropReason: isSupportUpload ? "support_upload" : null
    };
}

function stripSupportSuffixes(title) {
    return String(title || "")
        .replace(/\s+subs?\s*[+&]\s*fonts?\s+for\s+.+$/i, "")
        .replace(/\s+fonts?\s*[+&]\s*subs?\s+for\s+.+$/i, "")
        .replace(/\s+subtitles?\s+for\s+.+$/i, "")
        .trim();
}

function extractParentheticalAliases(rawTitle) {
    const matches = [...String(rawTitle || "").matchAll(/\(([^()]+)\)/g)];
    return matches
        .flatMap(match => match[1].split(","))
        .map(value => value.trim())
        .filter(value => value.length >= 4)
        .filter(value => !LOW_VALUE_ALIAS_PATTERNS.some(pattern => pattern.test(value)))
        .filter(value => !/^\d+p$/i.test(value))
        .filter((value, index, list) => list.findIndex(other => normalizeTitle(other) === normalizeTitle(value)) === index);
}

function extractSeasonHints(rawTitle) {
    const title = String(rawTitle || "");
    const hints = [];
    for (const match of title.matchAll(/\bS(\d{1,2})E\d{1,3}\b/gi)) {
        const label = ordinal(match[1]);
        if (label) hints.push(`${label} Season`);
    }
    for (const match of title.matchAll(/\b(\d{1,2})(st|nd|rd|th)\s+Season\b/gi)) {
        hints.push(`${Number(match[1])}${match[2].toLowerCase()} Season`);
    }
    return hints.filter((value, index, list) => list.findIndex(other => normalizeTitle(other) === normalizeTitle(value)) === index);
}

function stripSeasonWords(title) {
    return String(title || "")
        .replace(/\b\d{1,2}(st|nd|rd|th)\s+Season\b/gi, "")
        .replace(/\bSecond Year First Semester\b/i, "Second Year First Semester")
        .replace(/\s+/g, " ")
        .trim();
}

function addVariant(list, value) {
    const clean = stripSupportSuffixes(value).replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 2) return;
    if (/^\d+$/.test(clean)) return;
    const key = normalizeTitle(clean);
    if (!key || list.some(item => normalizeTitle(item) === key)) return;
    list.push(clean);
}

function generateQueryTitles({ rawTitle, parsedTitle, aliases = [], seasonHints = [] }) {
    const variants = [];
    const cleanParsed = stripSupportSuffixes(parsedTitle || "");
    const primaryAlias = aliases.find(Boolean);

    for (const hint of seasonHints) {
        if (primaryAlias) addVariant(variants, `${primaryAlias} ${hint}`);
    }
    for (const hint of seasonHints) {
        if (/\bSecond Year First Semester\b/i.test(cleanParsed)) {
            addVariant(variants, cleanParsed.replace(/\bClassroom of the Elite\b/i, `Classroom of the Elite ${hint}`));
        }
    }
    addVariant(variants, cleanParsed);
    for (const hint of seasonHints) {
        addVariant(variants, `${stripSeasonWords(cleanParsed.replace(/\bSecond Year First Semester\b/i, "")).trim()} ${hint}`);
    }
    for (const alias of aliases) addVariant(variants, alias);
    for (const hint of seasonHints) {
        for (const alias of aliases) addVariant(variants, `${alias} ${hint}`);
    }
    addVariant(variants, rawTitle);

    return variants.slice(0, 8);
}

module.exports = {
    classifyReleaseTitle,
    extractParentheticalAliases,
    extractSeasonHints,
    generateQueryTitles,
    stripSupportSuffixes
};
