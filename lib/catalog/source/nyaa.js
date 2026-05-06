const axios = require("axios");
const cheerio = require("cheerio");
const { XMLParser } = require("fast-xml-parser");
const { decodeEntities, extractBtih, normalizeBtih } = require("./hash");

const NYAA_BASE = "https://nyaa.si";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

function itemArray(parsed) {
    const item = parsed?.rss?.channel?.item;
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
}

function sourceIdFromUrl(url) {
    const match = String(url || "").match(/\/(?:view|download)\/(\d+)/i);
    return match ? match[1] : "";
}

function parseSizeToBytes(sizeText) {
    const match = String(sizeText || "").match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.includes("t")) return Math.round(value * 1024 ** 4);
    if (unit.includes("g")) return Math.round(value * 1024 ** 3);
    if (unit.includes("m")) return Math.round(value * 1024 ** 2);
    if (unit.includes("k")) return Math.round(value * 1024);
    return Math.round(value);
}

function absoluteUrl(href) {
    if (!href) return null;
    return href.startsWith("http") ? href : `${NYAA_BASE}${href}`;
}

function parseRss(xml) {
    const parsed = parser.parse(xml);
    return itemArray(parsed).map(item => {
        const infoHash = normalizeBtih(item["nyaa:infoHash"]);
        const viewUrl = item.guid && typeof item.guid === "object" ? item.guid["#text"] : item.guid;
        const sourceItemId = sourceIdFromUrl(viewUrl || item.link);
        return {
            source: "nyaa",
            sourceItemId: sourceItemId || infoHash,
            infoHash,
            title: decodeEntities(item.title),
            sourceUrl: sourceItemId ? `${NYAA_BASE}/view/${sourceItemId}` : viewUrl || null,
            torrentUrl: absoluteUrl(item.link),
            magnetUrl: item.magnet || null,
            sizeText: item["nyaa:size"] || null,
            sizeBytes: parseSizeToBytes(item["nyaa:size"]),
            seeders: parseInt(item["nyaa:seeders"], 10) || 0,
            leechers: parseInt(item["nyaa:leechers"], 10) || 0,
            completed: parseInt(item["nyaa:downloads"], 10) || 0,
            raw: item
        };
    }).filter(row => row.infoHash && row.title);
}

function parseListing(html) {
    const $ = cheerio.load(html);
    const rows = [];
    $("table.torrent-list tbody tr").each((_, tr) => {
        const cells = $(tr).find("td");
        const viewHref = $(tr).find('a[href^="/view/"]').first().attr("href");
        const torrentHref = $(tr).find('a[href^="/download/"]').first().attr("href");
        const magnetHref = $(tr).find('a[href^="magnet:"]').first().attr("href");
        const sourceItemId = sourceIdFromUrl(viewHref || torrentHref);
        const infoHash = extractBtih(magnetHref);
        const title = $(tr).find('a[href^="/view/"]').first().text().trim();
        const sizeText = $(cells[3]).text().trim();
        if (!infoHash || !title) return;
        rows.push({
            source: "nyaa",
            sourceItemId: sourceItemId || infoHash,
            infoHash,
            title: decodeEntities(title),
            sourceUrl: sourceItemId ? `${NYAA_BASE}/view/${sourceItemId}` : null,
            torrentUrl: absoluteUrl(torrentHref),
            magnetUrl: magnetHref || null,
            category: $(cells[0]).text().trim() || null,
            sizeText,
            sizeBytes: parseSizeToBytes(sizeText),
            seeders: parseInt($(cells[5]).text().trim(), 10) || 0,
            leechers: parseInt($(cells[6]).text().trim(), 10) || 0,
            completed: parseInt($(cells[7]).text().trim(), 10) || 0,
            raw: { sourceItemId }
        });
    });
    return rows;
}

async function fetchRss(queryOrUrl = "", options = {}) {
    const url = queryOrUrl && String(queryOrUrl).startsWith("http")
        ? queryOrUrl
        : `${NYAA_BASE}/?page=rss&q=${encodeURIComponent(queryOrUrl || "")}&c=1_0&f=0`;
    const res = await axios.get(url, { timeout: options.timeoutMs || 10000 });
    return parseRss(res.data);
}

async function fetchListingPage(page = 1, category = "1_0", options = {}) {
    const url = `${NYAA_BASE}/?c=${encodeURIComponent(category)}&f=0&p=${encodeURIComponent(page)}`;
    const res = await axios.get(url, { timeout: options.timeoutMs || 10000 });
    return parseListing(res.data);
}

module.exports = {
    fetchListingPage,
    fetchRss,
    parseListing,
    parseRss
};
