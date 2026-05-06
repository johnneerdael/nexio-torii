const umlautMap = new Map([
    ["Ä", "Ae"], ["ä", "ae"],
    ["Ö", "Oe"], ["ö", "oe"],
    ["Ü", "Ue"], ["ü", "ue"],
    ["ß", "ss"]
]);

function foldTitle(value) {
    return String(value || "")
        .split("")
        .map(char => umlautMap.get(char) || char)
        .join("")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "and");
}

function cleanTitle(value) {
    return foldTitle(value)
        .replace(/[♪♫★☆♡♥]/g, " ")
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function normalizeTitle(value) {
    return foldTitle(value)
        .replace(/[^\p{L}\p{N}+]+/gu, "")
        .toLowerCase();
}

function titleTokens(value) {
    return cleanTitle(value).split(" ").filter(Boolean);
}

module.exports = {
    cleanTitle,
    normalizeTitle,
    titleTokens
};
