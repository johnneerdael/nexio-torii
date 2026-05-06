function decodeEntities(text) {
    return String(text || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'");
}

function base32ToHex(input) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";

    for (const char of String(input || "").replace(/=+$/, "").toUpperCase()) {
        const value = alphabet.indexOf(char);
        if (value < 0) return "";
        bits += value.toString(2).padStart(5, "0");
    }

    let hex = "";
    for (let i = 0; i + 4 <= bits.length; i += 4) {
        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex.slice(0, 40).toLowerCase();
}

function normalizeBtih(rawHash) {
    const hash = decodeEntities(rawHash).trim();
    if (/^[a-f0-9]{40}$/i.test(hash)) return hash.toLowerCase();
    if (/^[a-z2-7]{32}$/i.test(hash)) return base32ToHex(hash);
    return "";
}

function extractBtih(text) {
    const decoded = decodeEntities(text);
    const match = decoded.match(/btih:([^"&<\s]+)/i);
    return match ? normalizeBtih(match[1]) : "";
}

module.exports = {
    decodeEntities,
    extractBtih,
    normalizeBtih
};
