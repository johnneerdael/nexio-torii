const axios = require("axios");
const cheerio = require("cheerio");
const { XMLParser } = require("fast-xml-parser");
const { decodeEntities, extractBtih } = require("./hash");

const TOKYO_BASE = "https://www.tokyotosho.info";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", cdataPropName: "__cdata" });

function itemArray(parsed) {
    const item = parsed?.rss?.channel?.item;
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
}

function descriptionText(item) {
    if (typeof item.description === "string") return item.description;
    return item.description?.__cdata || "";
}

function sizeFromText(text) {
    const match = String(text || "").match(/Size:\s*([\d.]+\s*[MGTK]?B)/i);
    return match ? match[1] : null;
}

function sourceIdFromText(text) {
    const match = String(text || "").match(/ID:\s*(\d+)/i);
    return match ? match[1] : "";
}

function absoluteTokyoUrl(href) {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    return `${TOKYO_BASE}/${href.replace(/^\/+/, "")}`;
}

function parseRss(xml) {
    const parsed = parser.parse(xml);
    return itemArray(parsed).map(item => {
        const description = descriptionText(item);
        const infoHash = extractBtih(description) || extractBtih(item.link);
        return {
            source: "tokyotosho",
            sourceItemId: sourceIdFromText(description) || infoHash,
            infoHash,
            title: decodeEntities(item.title),
            sourceUrl: null,
            torrentUrl: item.link || null,
            magnetUrl: infoHash ? `magnet:?xt=urn:btih:${infoHash}` : null,
            sizeText: sizeFromText(description),
            raw: item
        };
    }).filter(row => row.infoHash && row.title);
}

function parseListing(html) {
    const $ = cheerio.load(html);
    const rows = [];
    $("td.desc-top").each((_, td) => {
        const top = $(td);
        const row = top.closest("tr");
        const bot = row.next("tr").find("td.desc-bot");
        const stats = row.next("tr").find("td.stats");
        const web = row.find("td.web");
        const torrent = top.find('a[type="application/x-bittorrent"]').first();
        const magnetHref = top.find('a[href^="magnet:"]').first().attr("href");
        const infoHash = extractBtih(magnetHref);
        const statsText = stats.text().replace(/\s+/g, " ").trim();
        const detailsHref = web.find('a[href^="details.php?id="]').first().attr("href");
        const sourceItemId = sourceIdFromText(statsText) || (detailsHref || "").match(/id=(\d+)/)?.[1] || infoHash;
        if (!infoHash || !torrent.text().trim()) return;
        rows.push({
            source: "tokyotosho",
            sourceItemId,
            infoHash,
            title: decodeEntities(torrent.text().replace(/\s+/g, " ").trim()),
            sourceUrl: absoluteTokyoUrl(detailsHref),
            torrentUrl: torrent.attr("href") || null,
            magnetUrl: magnetHref || null,
            sizeText: sizeFromText(bot.text()),
            seeders: parseInt(statsText.match(/S:\s*(\d+)/i)?.[1], 10) || 0,
            leechers: parseInt(statsText.match(/L:\s*(\d+)/i)?.[1], 10) || 0,
            completed: parseInt(statsText.match(/C:\s*(\d+)/i)?.[1], 10) || 0,
            raw: { detailsHref, stats: statsText }
        });
    });
    return rows;
}

async function fetchRss(options = {}) {
    const url = options.url || `${TOKYO_BASE}/rss.php`;
    const res = await axios.get(url, {
        timeout: options.timeoutMs || 20000,
        headers: { "User-Agent": "Mozilla/5.0 NexioToriiCatalog/1.0" }
    });
    return parseRss(res.data);
}

async function fetchListingPage(page = 1, options = {}) {
    const res = await axios.get(`${TOKYO_BASE}/?page=${encodeURIComponent(page)}`, {
        timeout: options.timeoutMs || 20000,
        headers: { "User-Agent": "Mozilla/5.0 NexioToriiCatalog/1.0" }
    });
    return parseListing(res.data);
}

module.exports = {
    fetchListingPage,
    fetchRss,
    parseListing,
    parseRss
};
