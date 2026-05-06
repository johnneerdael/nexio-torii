const axios = require("axios");
const { decodeEntities, extractBtih, normalizeBtih } = require("./hash");

const ANIMETOSHO_FEED = "https://feed.animetosho.org/json";

function torrentUrlForHash(hash) {
    return hash ? `https://storage.animetosho.org/torrent/${hash}/torrent.torrent` : null;
}

function parseJsonFeed(text) {
    const data = typeof text === "string" ? JSON.parse(text) : text;
    if (!Array.isArray(data)) return [];
    return data.map(item => {
        const infoHash = normalizeBtih(item.info_hash || item.btih || extractBtih(item.magnet || item.magnet_uri));
        return {
            source: "animetosho",
            sourceItemId: String(item.id || infoHash),
            infoHash,
            title: decodeEntities(item.title || item.name),
            sourceUrl: item.torrent_url || item.view_url || null,
            torrentUrl: item.torrent_url || torrentUrlForHash(infoHash),
            magnetUrl: item.magnet_uri || item.magnet || null,
            sizeBytes: Number.isFinite(item.total_size) ? item.total_size : null,
            uploadedAt: Number.isFinite(item.timestamp) ? item.timestamp * 1000 : null,
            seeders: Number.isFinite(item.seeders) ? item.seeders : null,
            raw: {
                ...item,
                aid: item.anidb_aid != null ? String(item.anidb_aid) : item.aid != null ? String(item.aid) : undefined,
                eid: item.anidb_eid != null ? String(item.anidb_eid) : item.eid != null ? String(item.eid) : undefined
            }
        };
    }).filter(row => row.infoHash && row.title);
}

function unescapeTsv(value) {
    return String(value || "")
        .replace(/\\\\/g, "\\")
        .replace(/\\t/g, "\t")
        .replace(/\\n/g, "\n")
        .replace(/\\0/g, "\0");
}

function parseTorrentsTsv(text) {
    const lines = String(text || "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split("\t");
    return lines.slice(1).map(line => {
        const values = line.split("\t");
        const item = {};
        headers.forEach((header, index) => {
            item[header] = unescapeTsv(values[index]);
        });
        const infoHash = normalizeBtih(item.btih || extractBtih(item.magnet));
        const storedTorrent = item.stored_torrent === "1";
        return {
            source: "animetosho",
            sourceItemId: String(item.id || infoHash),
            infoHash,
            title: decodeEntities(item.name),
            sourceUrl: item.srcurl || null,
            torrentUrl: storedTorrent ? torrentUrlForHash(infoHash) : item.link || null,
            magnetUrl: item.magnet || null,
            category: item.cat || null,
            sizeBytes: Number(item.totalsize) || null,
            uploadedAt: item.date_posted ? Number(item.date_posted) * 1000 : null,
            raw: {
                ...item,
                aid: item.aid || undefined,
                eid: item.eid || undefined
            }
        };
    }).filter(row => row.infoHash && row.title);
}

async function fetchJsonFeed(options = {}) {
    const params = options.query ? { q: options.query, qx: 1 } : undefined;
    const res = await axios.get(ANIMETOSHO_FEED, { timeout: options.timeoutMs || 10000, params });
    return parseJsonFeed(res.data);
}

module.exports = {
    fetchJsonFeed,
    parseJsonFeed,
    parseTorrentsTsv
};
