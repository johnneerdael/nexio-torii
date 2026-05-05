const axios = require("axios");

const apiCache = new Map();
const MAX_CACHE_ENTRIES = 500;
const API_USER_AGENT = "NexioTorii/1.0";
const DEFAULT_STREMTHRU_URL = "https://stremthrufortheweak.nhyira.dev";
const PENDING_STATUSES = new Set(["queued", "downloading", "processing", "uploading"]);
const READY_STATUSES = new Set(["cached", "downloaded"]);
const FAILED_STATUSES = new Set(["failed", "invalid"]);

function getStremThruUrl(options = {}) {
    return String(options.stremthruUrl || process.env.STREMTHRU_URL || DEFAULT_STREMTHRU_URL).replace(/\/+$/, "");
}

function setCache(key, dataOrPromise, ttlMs = 60000) {
    if (apiCache.has(key)) apiCache.delete(key);
    else if (apiCache.size >= MAX_CACHE_ENTRIES) apiCache.delete(apiCache.keys().next().value);
    apiCache.set(key, { data: dataOrPromise, expiresAt: Date.now() + ttlMs });
}

function getCache(key) {
    if (!apiCache.has(key)) return null;
    const item = apiCache.get(key);
    if (item.expiresAt <= Date.now()) {
        apiCache.delete(key);
        return null;
    }
    apiCache.delete(key);
    apiCache.set(key, item);
    return item.data;
}

function buildHeaders(entry) {
    return {
        "X-StremThru-Store-Name": entry.service,
        "X-StremThru-Store-Authorization": `Bearer ${entry.apiKey}`,
        "User-Agent": API_USER_AGENT
    };
}

function normalizeStoreFile(file = {}) {
    const index = file.index !== undefined ? file.index : -1;
    const path = file.path || file.name || "Unknown";
    return {
        id: index,
        index,
        link: file.link || "",
        name: file.name || path,
        path,
        size: file.size !== undefined ? file.size : 0
    };
}

function mapTorzItem(item = {}) {
    const status = String(item.status || "unknown").toLowerCase();
    const hash = String(item.hash || "").toLowerCase();
    return {
        hash,
        status,
        isCached: READY_STATUSES.has(status),
        files: Array.isArray(item.files) ? item.files.map(normalizeStoreFile) : []
    };
}

function serviceCacheKey(prefix, entry, extra) {
    return `${prefix}_${entry.service}_${String(entry.apiKey || "").slice(0, 8)}_${extra}`;
}

async function checkStoreTorz(hashes, entry, options = {}) {
    if (!Array.isArray(hashes) || hashes.length === 0) return {};

    const http = options.http || axios;
    const useCache = options.cache !== false;
    const hashKey = [...hashes].map(String).sort().join(",");
    const cacheKey = serviceCacheKey("torz_check", entry, hashKey);
    const cached = useCache ? getCache(cacheKey) : null;
    if (cached) return cached;

    const performFetch = async () => {
        const results = {};
        const chunkSize = options.chunkSize || 500;

        try {
            for (let i = 0; i < hashes.length; i += chunkSize) {
                const chunk = hashes.slice(i, i + chunkSize);
                const url = `${getStremThruUrl(options)}/v0/store/torz/check?hash=${chunk.join(",")}`;
                const res = await http.get(url, {
                    headers: buildHeaders(entry),
                    timeout: options.timeout || 8000
                });

                const items = res.data && res.data.data && Array.isArray(res.data.data.items)
                    ? res.data.data.items
                    : [];
                items.forEach(item => {
                    const mapped = mapTorzItem(item);
                    if (mapped.hash) results[mapped.hash] = mapped;
                });

                if (i + chunkSize < hashes.length) {
                    await new Promise(resolve => setTimeout(resolve, options.chunkDelayMs || 100));
                }
            }
            return { data: results, ttl: 60000 };
        } catch (e) {
            const status = e.response ? e.response.status : 500;
            console.error(`[StremThru ${entry.service} Check Error] Request failed with status code ${status}`);
            const ttl = status === 401 || status === 403 ? 3600000 : status === 429 ? 30000 : 10000;
            return { data: {}, ttl };
        }
    };

    const promise = performFetch().then(result => {
        if (useCache) setCache(cacheKey, result.data, result.ttl);
        return result.data;
    });
    if (useCache) setCache(cacheKey, promise, 10000);
    return promise;
}

async function addStoreTorz(magnet, entry, options = {}) {
    const http = options.http || axios;
    const res = await http.post(`${getStremThruUrl(options)}/v0/store/torz`, { link: magnet }, {
        headers: buildHeaders(entry),
        timeout: options.timeout || 10000
    });
    return mapTorzItem(res.data && res.data.data ? res.data.data : {});
}

async function generateStoreLink(link, entry, options = {}) {
    const http = options.http || axios;
    const res = await http.post(`${getStremThruUrl(options)}/v0/store/torz/link/generate`, { link }, {
        headers: buildHeaders(entry),
        timeout: options.timeout || 10000
    });
    return res.data && res.data.data ? res.data.data.link : "";
}

async function checkStoreUser(entry, options = {}) {
    const http = options.http || axios;
    const res = await http.get(`${getStremThruUrl(options)}/v0/store/user`, {
        headers: buildHeaders(entry),
        timeout: options.timeout || 8000
    });
    return res.data && res.data.data ? res.data.data : null;
}

module.exports = {
    FAILED_STATUSES,
    PENDING_STATUSES,
    READY_STATUSES,
    addStoreTorz,
    checkStoreTorz,
    checkStoreUser,
    generateStoreLink,
    mapTorzItem,
    normalizeStoreFile
};
