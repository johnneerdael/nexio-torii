# Multi-Service StremThru Unlockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Amatsu's RealDebrid/TorBox-only unlocker support with Comet-style multi-service StremThru torrent unlockers.

**Architecture:** Add small backend modules for config normalization, service registry, StremThru API access, stream formatting, and playback resolution. Wire `addon.js`, `server.js`, and `public/index.html` to a single `debridServices` array while keeping Nyaa scraping, parser behavior, P2P streams, fallback videos, and subtitle proxying.

**Tech Stack:** Node.js CommonJS, Express, Stremio Addon SDK, Axios, built-in `node:test`, browser JavaScript in `public/index.html`.

---

## File Structure

- Create `lib/services.js`: supported service registry, service validation, service code helpers, and normalized `debridServices` entries.
- Create `lib/config.js`: Base64 URL-safe encode/decode, `parseConfig`, `encodeConfigPayload`, and config normalization shared by `addon.js` and `server.js`.
- Replace `lib/debrid.js`: generic StremThru torz provider layer with request caching and testable HTTP injection.
- Create `lib/stream-builder.js`: pure function that turns torrents plus per-service StremThru availability into Stremio stream objects.
- Create `lib/playback.js`: pure playback/subtitle resolution helpers returning route actions for `server.js`.
- Modify `addon.js`: import shared config/debrid/stream helpers, remove RD/TB-specific stream branches, and emit stateless `/resolve/:payload/:serviceIndex/...` and `/sub/:payload/:serviceIndex/...` URLs.
- Modify `server.js`: remove provider-specific RealDebrid/TorBox branches and use `lib/playback.js` for generic StremThru resolution.
- Modify `public/index.html`: replace the two password inputs with repeatable multi-service rows and emit `debridServices`.
- Modify `package.json`: add `npm test` script using built-in `node --test`.
- Create tests under `tests/`: config/service normalization, StremThru response mapping, stream construction, and playback action selection.
- Modify `readme.md`: update provider list and self-hosting notes for `STREMTHRU_URL`.

## Task 1: Test Harness, Service Registry, And Config Normalization

**Files:**
- Create: `lib/services.js`
- Create: `lib/config.js`
- Create: `tests/config.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add the test script**

Modify `package.json` so the scripts block is:

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test tests/*.test.js"
}
```

- [ ] **Step 2: Write the failing config tests**

Create `tests/config.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    SUPPORTED_DEBRID_SERVICES,
    getServiceCode,
    normalizeDebridServices
} = require("../lib/services");
const {
    encodeConfigPayload,
    fromBase64Safe,
    normalizeConfig,
    parseConfig,
    toBase64Safe
} = require("../lib/config");

test("service registry contains the recommended StremThru stores", () => {
    assert.deepEqual(Object.keys(SUPPORTED_DEBRID_SERVICES), [
        "realdebrid",
        "torbox",
        "alldebrid",
        "premiumize",
        "debridlink",
        "debrider",
        "easydebrid",
        "offcloud",
        "pikpak"
    ]);
    assert.equal(getServiceCode("premiumize"), "PM");
    assert.equal(getServiceCode("debridlink"), "DL");
});

test("normalizeDebridServices drops malformed entries and keeps duplicates", () => {
    const entries = normalizeDebridServices([
        { service: " RealDebrid ", apiKey: " rd-key " },
        { service: "premiumize", apiKey: "pm-key" },
        { service: "premiumize", apiKey: "second-pm-key" },
        { service: "stremthru", apiKey: "excluded" },
        { service: "torbox", apiKey: "" },
        { service: "", apiKey: "missing-service" },
        null
    ]);

    assert.deepEqual(entries, [
        { service: "realdebrid", apiKey: "rd-key" },
        { service: "premiumize", apiKey: "pm-key" },
        { service: "premiumize", apiKey: "second-pm-key" }
    ]);
});

test("parseConfig decodes Amatsu payload and normalizes greenfield config", () => {
    const raw = {
        debridServices: [
            { service: "torbox", apiKey: "tb-key" },
            { service: "pikpak", apiKey: "pp-key" }
        ],
        enableP2P: true,
        hideUncached: true,
        language: ["ENG", "JPN"],
        resolutions: ["1080p"]
    };
    const payload = encodeConfigPayload(raw);
    const parsed = parseConfig({ Amatsu: payload });

    assert.deepEqual(parsed.debridServices, raw.debridServices);
    assert.equal(parsed.enableP2P, true);
    assert.equal(parsed.hideUncached, true);
    assert.deepEqual(parsed.language, ["ENG", "JPN"]);
    assert.deepEqual(parsed.resolutions, ["1080p"]);
});

test("normalizeConfig removes legacy rdKey and tbKey", () => {
    const normalized = normalizeConfig({
        rdKey: "legacy-rd",
        tbKey: "legacy-tb",
        debridServices: [{ service: "alldebrid", apiKey: "ad-key" }]
    });

    assert.deepEqual(normalized.debridServices, [
        { service: "alldebrid", apiKey: "ad-key" }
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, "rdKey"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, "tbKey"), false);
});

test("base64 helpers round trip URL-safe payloads", () => {
    const encoded = toBase64Safe(JSON.stringify({ key: "a/b+c=" }));
    assert.equal(encoded.includes("+"), false);
    assert.equal(encoded.includes("/"), false);
    assert.equal(encoded.includes("="), false);
    assert.equal(fromBase64Safe(encoded), JSON.stringify({ key: "a/b+c=" }));
});
```

- [ ] **Step 3: Run the config tests and verify they fail**

Run:

```bash
npm test -- --test-name-pattern "service registry|normalizeDebridServices|parseConfig|normalizeConfig|base64"
```

Expected: FAIL with `Cannot find module '../lib/services'`.

- [ ] **Step 4: Implement `lib/services.js`**

Create `lib/services.js`:

```js
const SUPPORTED_DEBRID_SERVICES = Object.freeze({
    realdebrid: Object.freeze({ code: "RD", displayName: "RealDebrid", apiKeyUrl: "https://real-debrid.com/apitoken", helpText: "API token" }),
    torbox: Object.freeze({ code: "TB", displayName: "TorBox", apiKeyUrl: "https://torbox.app/settings", helpText: "API key" }),
    alldebrid: Object.freeze({ code: "AD", displayName: "AllDebrid", apiKeyUrl: "https://alldebrid.com/apikeys", helpText: "API key" }),
    premiumize: Object.freeze({ code: "PM", displayName: "Premiumize", apiKeyUrl: "https://premiumize.me/account", helpText: "API key" }),
    debridlink: Object.freeze({ code: "DL", displayName: "Debrid-Link", apiKeyUrl: "https://debrid-link.com/webapp/apikey", helpText: "API key" }),
    debrider: Object.freeze({ code: "DB", displayName: "Debrider", apiKeyUrl: "https://debrider.app/dashboard/account", helpText: "API key" }),
    easydebrid: Object.freeze({ code: "ED", displayName: "EasyDebrid", apiKeyUrl: "https://paradise-cloud.com/products/easydebrid", helpText: "API key" }),
    offcloud: Object.freeze({ code: "OC", displayName: "Offcloud", apiKeyUrl: "https://offcloud.com/account", helpText: "Email:password or API key accepted by StremThru" }),
    pikpak: Object.freeze({ code: "PP", displayName: "PikPak", apiKeyUrl: "https://mypikpak.com", helpText: "Email:password accepted by StremThru" })
});

function normalizeServiceName(service) {
    return String(service || "").trim().toLowerCase().replace(/[-_\s]/g, "");
}

function isSupportedService(service) {
    return Object.prototype.hasOwnProperty.call(SUPPORTED_DEBRID_SERVICES, normalizeServiceName(service));
}

function getServiceInfo(service) {
    return SUPPORTED_DEBRID_SERVICES[normalizeServiceName(service)] || null;
}

function getServiceCode(service) {
    const info = getServiceInfo(service);
    return info ? info.code : "";
}

function getServiceDisplayName(service) {
    const info = getServiceInfo(service);
    return info ? info.displayName : String(service || "");
}

function normalizeDebridServices(value) {
    if (!Array.isArray(value)) return [];

    return value.reduce((entries, item) => {
        if (!item || typeof item !== "object") return entries;

        const service = normalizeServiceName(item.service);
        const apiKey = String(item.apiKey || "").trim();

        if (!service || !apiKey || !isSupportedService(service)) return entries;
        entries.push({ service, apiKey });
        return entries;
    }, []);
}

function isOffcloud(service) {
    return normalizeServiceName(service) === "offcloud";
}

module.exports = {
    SUPPORTED_DEBRID_SERVICES,
    getServiceCode,
    getServiceDisplayName,
    getServiceInfo,
    isOffcloud,
    isSupportedService,
    normalizeDebridServices,
    normalizeServiceName
};
```

- [ ] **Step 5: Implement `lib/config.js`**

Create `lib/config.js`:

```js
const { normalizeDebridServices } = require("./services");

function toBase64Safe(str) {
    return Buffer.from(String(str), "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

function fromBase64Safe(str) {
    try {
        return Buffer.from(String(str || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    } catch (e) {
        return "";
    }
}

function normalizeConfig(raw) {
    const config = raw && typeof raw === "object" ? raw : {};
    const normalized = {
        useEnglishTitles: Boolean(config.useEnglishTitles),
        showSeasonalSeries: config.showSeasonalSeries !== false,
        showAiringSeries: config.showAiringSeries !== false,
        showTrendingSeries: config.showTrendingSeries !== false,
        showTopSeries: config.showTopSeries !== false,
        showTrendingMovies: config.showTrendingMovies !== false,
        showTopMovies: config.showTopMovies !== false,
        hideUncached: Boolean(config.hideUncached),
        enableP2P: Boolean(config.enableP2P),
        debridServices: normalizeDebridServices(config.debridServices)
    };

    if (Array.isArray(config.language) && config.language.length > 0) {
        normalized.language = config.language.map(String).filter(Boolean);
    } else if (typeof config.language === "string" && config.language.trim()) {
        normalized.language = [config.language.trim()];
    }

    if (Array.isArray(config.resolutions) && config.resolutions.length > 0) {
        normalized.resolutions = config.resolutions.map(String).filter(Boolean);
    }

    return normalized;
}

function parseConfig(config) {
    let parsed = {};
    try {
        if (config && config.Amatsu) {
            const decoded = fromBase64Safe(config.Amatsu);
            parsed = JSON.parse(decoded);
        } else {
            parsed = config || {};
        }
    } catch (e) {
        parsed = {};
    }
    return normalizeConfig(parsed);
}

function encodeConfigPayload(config) {
    return toBase64Safe(JSON.stringify(normalizeConfig(config)));
}

module.exports = {
    encodeConfigPayload,
    fromBase64Safe,
    normalizeConfig,
    parseConfig,
    toBase64Safe
};
```

- [ ] **Step 6: Run config tests and verify they pass**

Run:

```bash
npm test -- --test-name-pattern "service registry|normalizeDebridServices|parseConfig|normalizeConfig|base64"
```

Expected: PASS for all tests in `tests/config.test.js`.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json lib/services.js lib/config.js tests/config.test.js
git commit -m "test: add multi-service config foundation"
```

## Task 2: Generic StremThru Torz Provider Layer

**Files:**
- Modify: `lib/debrid.js`
- Create: `tests/debrid.test.js`

- [ ] **Step 1: Write failing StremThru provider tests**

Create `tests/debrid.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    addStoreTorz,
    checkStoreTorz,
    checkStoreUser,
    generateStoreLink,
    mapTorzItem,
    normalizeStoreFile
} = require("../lib/debrid");

test("normalizeStoreFile maps StremThru file shape for Amatsu parser", () => {
    assert.deepEqual(normalizeStoreFile({
        index: 4,
        link: "stremthru://file",
        name: "Episode 01.mkv",
        path: "/Show/Episode 01.mkv",
        size: 123
    }), {
        id: 4,
        index: 4,
        link: "stremthru://file",
        name: "Episode 01.mkv",
        path: "/Show/Episode 01.mkv",
        size: 123
    });
});

test("mapTorzItem preserves cached status and empty Offcloud files", () => {
    assert.deepEqual(mapTorzItem({
        hash: "ABC",
        status: "cached",
        files: []
    }), {
        hash: "abc",
        status: "cached",
        isCached: true,
        files: []
    });
});

test("checkStoreTorz chunks hashes and sends StremThru store headers", async () => {
    const calls = [];
    const http = {
        get: async (url, options) => {
            calls.push({ url, options });
            return {
                data: {
                    data: {
                        items: [
                            {
                                hash: "ABC",
                                status: "cached",
                                files: [{ index: 1, link: "locked-link", name: "Video.mkv", size: 10 }]
                            }
                        ]
                    }
                }
            };
        }
    };

    const result = await checkStoreTorz(["ABC"], { service: "premiumize", apiKey: "pm-key" }, { http, cache: false });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://stremthru.13377001.xyz/v0/store/torz/check?hash=ABC");
    assert.equal(calls[0].options.headers["X-StremThru-Store-Name"], "premiumize");
    assert.equal(calls[0].options.headers["X-StremThru-Store-Authorization"], "Bearer pm-key");
    assert.equal(result.abc.files[0].link, "locked-link");
});

test("addStoreTorz posts magnet through StremThru", async () => {
    const calls = [];
    const http = {
        post: async (url, body, options) => {
            calls.push({ url, body, options });
            return { data: { data: { hash: "abc", status: "queued", files: [] } } };
        }
    };

    const result = await addStoreTorz("magnet:?xt=urn:btih:abc", { service: "alldebrid", apiKey: "ad-key" }, { http });

    assert.equal(calls[0].url, "https://stremthru.13377001.xyz/v0/store/torz");
    assert.deepEqual(calls[0].body, { link: "magnet:?xt=urn:btih:abc" });
    assert.equal(result.status, "queued");
});

test("generateStoreLink returns direct link from StremThru", async () => {
    const http = {
        post: async () => ({ data: { data: { link: "https://cdn.example/video.mkv" } } })
    };

    const link = await generateStoreLink("locked-link", { service: "debridlink", apiKey: "dl-key" }, { http });

    assert.equal(link, "https://cdn.example/video.mkv");
});

test("checkStoreUser returns user data", async () => {
    const http = {
        get: async () => ({ data: { data: { subscription_status: "premium" } } })
    };

    const user = await checkStoreUser({ service: "torbox", apiKey: "tb-key" }, { http });

    assert.deepEqual(user, { subscription_status: "premium" });
});
```

- [ ] **Step 2: Run provider tests and verify they fail**

Run:

```bash
npm test -- --test-name-pattern "normalizeStoreFile|mapTorzItem|checkStoreTorz|addStoreTorz|generateStoreLink|checkStoreUser"
```

Expected: FAIL because `lib/debrid.js` does not export the generic StremThru functions.

- [ ] **Step 3: Replace `lib/debrid.js` with generic StremThru implementation**

Replace `lib/debrid.js` with:

```js
const axios = require("axios");

const apiCache = new Map();
const MAX_CACHE_ENTRIES = 500;
const API_USER_AGENT = "Amatsu/1.0";
const DEFAULT_STREMTHRU_URL = "https://stremthru.13377001.xyz";
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
```

- [ ] **Step 4: Run provider tests and verify they pass**

Run:

```bash
npm test -- --test-name-pattern "normalizeStoreFile|mapTorzItem|checkStoreTorz|addStoreTorz|generateStoreLink|checkStoreUser"
```

Expected: PASS for all tests in `tests/debrid.test.js`.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/debrid.js tests/debrid.test.js
git commit -m "feat: add generic StremThru torz provider"
```

## Task 3: Pure Debrid Stream Builder

**Files:**
- Create: `lib/stream-builder.js`
- Create: `tests/stream-builder.test.js`

- [ ] **Step 1: Write failing stream builder tests**

Create `tests/stream-builder.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDebridStreams } = require("../lib/stream-builder");
const { encodeConfigPayload } = require("../lib/config");

const baseTorrent = {
    hash: "ABCDEF",
    title: "Example Show - 01 [1080p].mkv",
    size: "1.2 GB",
    seeders: "42"
};

function baseInput(overrides = {}) {
    const userConfig = {
        debridServices: [
            { service: "realdebrid", apiKey: "rd-key" },
            { service: "premiumize", apiKey: "pm-key" }
        ],
        hideUncached: false,
        language: ["ENG"]
    };
    return {
        torrents: [baseTorrent],
        availabilityByEntry: [
            {
                abcdef: {
                    status: "cached",
                    isCached: true,
                    files: [
                        { id: 0, index: 0, link: "video-link", name: "Example Show - 01 [1080p].mkv", path: "Example Show - 01 [1080p].mkv", size: 1200 },
                        { id: 1, index: 1, link: "sub-link", name: "Example Show - 01.eng.srt", path: "Example Show - 01.eng.srt", size: 10 }
                    ]
                }
            },
            {}
        ],
        userConfig,
        amatsuPayload: encodeConfigPayload(userConfig),
        baseUrl: "https://amatsu.example",
        requestedEp: 1,
        expectedSeason: 1,
        isMovie: false,
        isRawSearch: false,
        flags: { ENG: "EN" },
        extractTags: () => ({ res: "1080p" }),
        extractLanguage: () => "ENG",
        parseSizeToBytes: () => 1200,
        selectBestVideoFile: files => files.find(file => file.name.endsWith(".mkv")),
        isEpisodeMatch: () => true,
        isSeasonBatch: () => false,
        ...overrides
    };
}

test("buildDebridStreams emits cached and uncached streams for multiple services", () => {
    const streams = buildDebridStreams(baseInput());

    assert.equal(streams.length, 2);
    assert.equal(streams[0].name, "AMATSU [⚡ RD]\n🎥 1080p");
    assert.equal(streams[0].url, "https://amatsu.example/resolve/" + baseInput().amatsuPayload + "/0/ABCDEF/1?title=Example%20Show%20-%2001%20%5B1080p%5D.mkv");
    assert.equal(streams[0].subtitles.length, 1);
    assert.equal(streams[1].name, "AMATSU [☁️ PM]\n🎥 1080p");
    assert.equal(streams[1]._isCached, false);
});

test("buildDebridStreams honors hideUncached", () => {
    const input = baseInput({
        userConfig: {
            debridServices: [
                { service: "realdebrid", apiKey: "rd-key" },
                { service: "premiumize", apiKey: "pm-key" }
            ],
            hideUncached: true,
            language: ["ENG"]
        }
    });
    input.amatsuPayload = encodeConfigPayload(input.userConfig);

    const streams = buildDebridStreams(input);

    assert.equal(streams.length, 1);
    assert.equal(streams[0].name, "AMATSU [⚡ RD]\n🎥 1080p");
});

test("buildDebridStreams skips Offcloud series cache without files", () => {
    const userConfig = {
        debridServices: [{ service: "offcloud", apiKey: "oc-key" }],
        hideUncached: true,
        language: ["ENG"]
    };

    const streams = buildDebridStreams(baseInput({
        userConfig,
        amatsuPayload: encodeConfigPayload(userConfig),
        availabilityByEntry: [{ abcdef: { status: "cached", isCached: true, files: [] } }]
    }));

    assert.equal(streams.length, 0);
});
```

- [ ] **Step 2: Run stream builder tests and verify they fail**

Run:

```bash
npm test -- --test-name-pattern "buildDebridStreams"
```

Expected: FAIL with `Cannot find module '../lib/stream-builder'`.

- [ ] **Step 3: Implement `lib/stream-builder.js`**

Create `lib/stream-builder.js`:

```js
const { getServiceCode, isOffcloud } = require("./services");

function buildResolveUrl(baseUrl, amatsuPayload, serviceIndex, hash, requestedEp, title) {
    return `${baseUrl}/resolve/${amatsuPayload}/${serviceIndex}/${hash}/${requestedEp}?title=${encodeURIComponent(title || "")}`;
}

function buildSubtitleUrl(baseUrl, amatsuPayload, serviceIndex, hash, file, userLangs, extractLanguage) {
    return {
        id: String(file.id),
        url: `${baseUrl}/sub/${amatsuPayload}/${serviceIndex}/${hash}/${file.id}?filename=${encodeURIComponent(file.name || file.path || "sub.srt")}`,
        lang: extractLanguage(file.name || file.path || "", userLangs) || "ENG"
    };
}

function buildDebridStreams(input) {
    const {
        torrents,
        availabilityByEntry,
        userConfig,
        amatsuPayload,
        baseUrl,
        requestedEp,
        expectedSeason,
        isMovie,
        isRawSearch,
        flags,
        extractTags,
        extractLanguage,
        parseSizeToBytes,
        selectBestVideoFile,
        isEpisodeMatch,
        isSeasonBatch
    } = input;

    const userLangs = Array.isArray(userConfig.language) ? userConfig.language : [userConfig.language || "ENG"];
    const streams = [];
    let epDropCount = 0;

    torrents.forEach(t => {
        const hashLow = t.hash.toLowerCase();
        const { res } = extractTags(t.title);
        const bytes = parseSizeToBytes(t.size);
        const streamLang = extractLanguage(t.title, userLangs);
        const flag = flags[streamLang] || "ENG";
        const seeders = parseInt(t.seeders, 10) || 0;
        let isBatch = false;
        let isValidMatch = false;

        if (isMovie || isRawSearch) {
            isValidMatch = true;
        } else {
            isBatch = isSeasonBatch(t.title, expectedSeason);
            isValidMatch = isBatch || isEpisodeMatch(t.title, requestedEp, expectedSeason);
        }

        if (!isValidMatch) {
            epDropCount++;
            return;
        }

        const batchStr = isBatch ? " | 📦 Batch" : "";

        userConfig.debridServices.forEach((entry, serviceIndex) => {
            const availability = availabilityByEntry[serviceIndex] || {};
            const cached = availability[hashLow];
            const files = cached && Array.isArray(cached.files) ? cached.files : [];
            const isCached = Boolean(cached && cached.isCached);
            const serviceCode = getServiceCode(entry.service);

            if (isOffcloud(entry.service) && isCached && files.length === 0 && !isMovie && !isRawSearch) {
                return;
            }

            const matchedFile = files.length > 0 ? selectBestVideoFile(files, requestedEp, expectedSeason, isMovie) : null;
            if (isCached && files.length > 0 && !matchedFile && !isMovie) {
                epDropCount++;
                return;
            }

            if (!isCached && userConfig.hideUncached) return;

            const uiName = isCached ? `AMATSU [⚡ ${serviceCode}]` : `AMATSU [☁️ ${serviceCode}]`;
            const streamStatus = isCached ? "⚡ Cached" : "☁️ Download";
            const streamPayload = {
                name: `${uiName}\n🎥 ${res}`,
                description: `${flag} Nyaa | ${streamStatus}${batchStr}\n📄 ${t.title}\n💾 ${t.size} | 👥 ${seeders} Seeds`,
                url: buildResolveUrl(baseUrl, amatsuPayload, serviceIndex, t.hash, requestedEp, t.title),
                behaviorHints: {
                    bingeGroup: `amatsu_${entry.service}_${serviceIndex}_${t.hash}`,
                    filename: matchedFile ? matchedFile.name : undefined
                },
                _bytes: bytes,
                _lang: streamLang,
                _isCached: isCached,
                _res: res,
                _prog: 0,
                _seeders: seeders,
                _isBatch: isBatch
            };

            const subtitles = files
                .filter(file => /\.(srt|vtt|ass|ssa)$/i.test(file.name || file.path || ""))
                .map(file => buildSubtitleUrl(baseUrl, amatsuPayload, serviceIndex, t.hash, file, userLangs, extractLanguage));

            if (subtitles.length > 0) streamPayload.subtitles = subtitles;
            streams.push(streamPayload);
        });
    });

    return streams;
}

module.exports = {
    buildDebridStreams,
    buildResolveUrl,
    buildSubtitleUrl
};
```

- [ ] **Step 4: Run stream builder tests and verify they pass**

Run:

```bash
npm test -- --test-name-pattern "buildDebridStreams"
```

Expected: PASS for all tests in `tests/stream-builder.test.js`.

- [ ] **Step 5: Commit Task 3**

```bash
git add lib/stream-builder.js tests/stream-builder.test.js
git commit -m "feat: build debrid streams from StremThru services"
```

## Task 4: Wire Stream Handler To Multi-Service StremThru Checks

**Files:**
- Modify: `addon.js`
- Test: `tests/config.test.js`, `tests/debrid.test.js`, `tests/stream-builder.test.js`

- [ ] **Step 1: Replace imports in `addon.js`**

At the top of `addon.js`, replace:

```js
const { checkRD, checkTorbox, getActiveRD, getActiveTorbox } = require("./lib/debrid");
```

with:

```js
const { encodeConfigPayload, fromBase64Safe, parseConfig, toBase64Safe } = require("./lib/config");
const { checkStoreTorz } = require("./lib/debrid");
const { buildDebridStreams } = require("./lib/stream-builder");
```

Remove the local definitions of `toBase64Safe`, `fromBase64Safe`, and `parseConfig` from `addon.js`.

- [ ] **Step 2: Replace playback validation**

Inside `builder.defineStreamHandler`, replace:

```js
if (!userConfig.rdKey && !userConfig.tbKey && !userConfig.enableP2P) {
    console.log(`[PIPELINE] 🛑 ABBRUCH: Weder Debrid-Dienste noch P2P aktiviert.`);
    return { "streams": [] };
}
```

with:

```js
if (userConfig.debridServices.length === 0 && !userConfig.enableP2P) {
    console.log("[PIPELINE] Stop: no debrid services configured and P2P disabled.");
    return { "streams": [] };
}
```

- [ ] **Step 3: Replace debrid availability calls**

Replace the existing `Promise.all` block that creates `rdC`, `tbC`, `rdA`, and `tbA` with:

```js
const availabilityByEntry = await Promise.all(
    userConfig.debridServices.map(entry =>
        checkStoreTorz(hashes, entry).catch(error => {
            console.error(`[PIPELINE] ${entry.service} availability failed: ${error.message}`);
            return {};
        })
    )
);
const amatsuPayload = encodeConfigPayload(userConfig);
```

- [ ] **Step 4: Replace RD/TorBox stream generation with generic builder call**

Keep the existing P2P block inside `torrents.forEach`. Delete the provider-specific `if (userConfig.rdKey)` and `if (userConfig.tbKey)` blocks. After the P2P block and before the end of `torrents.forEach`, do not add provider streams there.

After the `torrents.forEach` block closes, append generic debrid streams:

```js
const debridStreams = buildDebridStreams({
    torrents,
    availabilityByEntry,
    userConfig,
    amatsuPayload,
    baseUrl: BASE_URL,
    requestedEp,
    expectedSeason,
    isMovie,
    isRawSearch,
    flags,
    extractTags,
    extractLanguage,
    parseSizeToBytes,
    selectBestVideoFile,
    isEpisodeMatch,
    isSeasonBatch
});
streams.push(...debridStreams);
```

Keep the existing sorter. It already sorts by `_isCached`, language, resolution, batch, seeders, and size. `_prog` remains `0` for generic debrid streams.

- [ ] **Step 5: Export shared helpers for smoke tests**

At the bottom of `addon.js`, keep the existing export shape but ensure `parseConfig` still resolves from `lib/config.js`:

```js
module.exports = { "addonInterface": builder.getInterface(), manifest, parseConfig };
```

- [ ] **Step 6: Run all current tests**

Run:

```bash
npm test
```

Expected: PASS for config, debrid, and stream-builder tests.

- [ ] **Step 7: Run a syntax smoke check**

Run:

```bash
node -e "require('./addon'); console.log('addon ok')"
```

Expected output includes:

```text
addon ok
```

- [ ] **Step 8: Commit Task 4**

```bash
git add addon.js
git commit -m "feat: use multi-service StremThru stream checks"
```

## Task 5: Generic Playback And Subtitle Resolution

**Files:**
- Create: `lib/playback.js`
- Create: `tests/playback.test.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing playback tests**

Create `tests/playback.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildMagnet,
    resolveStorePlayback,
    resolveStoreSubtitle
} = require("../lib/playback");

test("buildMagnet includes hash, title, and trackers", () => {
    const magnet = buildMagnet("ABC", "Example Title", [
        "udp://tracker.example:1337/announce"
    ]);

    assert.equal(
        magnet,
        "magnet:?xt=urn:btih:ABC&dn=Example%20Title&tr=udp%3A%2F%2Ftracker.example%3A1337%2Fannounce"
    );
});

test("resolveStorePlayback returns loading for pending status", async () => {
    const action = await resolveStorePlayback({
        entry: { service: "premiumize", apiKey: "pm-key" },
        hash: "ABC",
        episode: 1,
        title: "Example",
        addStoreTorz: async () => ({ status: "queued", files: [] }),
        generateStoreLink: async () => "not-called",
        selectBestVideoFile: () => null
    });

    assert.deepEqual(action, { type: "loading" });
});

test("resolveStorePlayback generates redirect for cached selected file", async () => {
    const action = await resolveStorePlayback({
        entry: { service: "realdebrid", apiKey: "rd-key" },
        hash: "ABC",
        episode: 1,
        title: "Example",
        addStoreTorz: async () => ({
            status: "cached",
            files: [{ id: 2, link: "locked-video", name: "Example - 01.mkv", size: 1 }]
        }),
        generateStoreLink: async link => {
            assert.equal(link, "locked-video");
            return "https://cdn.example/video.mkv";
        },
        selectBestVideoFile: files => files[0]
    });

    assert.deepEqual(action, { type: "redirect", url: "https://cdn.example/video.mkv" });
});

test("resolveStorePlayback returns archive when cached torrent has no matching file", async () => {
    const action = await resolveStorePlayback({
        entry: { service: "torbox", apiKey: "tb-key" },
        hash: "ABC",
        episode: 3,
        title: "Example",
        addStoreTorz: async () => ({
            status: "cached",
            files: [{ id: 2, link: "locked-video", name: "Example - 01.mkv", size: 1 }]
        }),
        generateStoreLink: async () => "not-called",
        selectBestVideoFile: () => null
    });

    assert.deepEqual(action, { type: "archive" });
});

test("resolveStoreSubtitle generates a direct subtitle link", async () => {
    const action = await resolveStoreSubtitle({
        entry: { service: "alldebrid", apiKey: "ad-key" },
        hash: "ABC",
        fileId: "4",
        title: "Example",
        addStoreTorz: async () => ({
            status: "cached",
            files: [
                { id: 4, link: "locked-sub", name: "Example.en.srt", size: 1 }
            ]
        }),
        generateStoreLink: async link => {
            assert.equal(link, "locked-sub");
            return "https://cdn.example/sub.srt";
        }
    });

    assert.deepEqual(action, {
        type: "redirect",
        url: "https://cdn.example/sub.srt",
        fileName: "Example.en.srt"
    });
});
```

- [ ] **Step 2: Run playback tests and verify they fail**

Run:

```bash
npm test -- --test-name-pattern "buildMagnet|resolveStorePlayback|resolveStoreSubtitle"
```

Expected: FAIL with `Cannot find module '../lib/playback'`.

- [ ] **Step 3: Implement `lib/playback.js`**

Create `lib/playback.js`:

```js
const {
    FAILED_STATUSES,
    PENDING_STATUSES,
    READY_STATUSES,
    addStoreTorz,
    generateStoreLink
} = require("./debrid");

function buildMagnet(hash, title, trackers = []) {
    const parts = [`magnet:?xt=urn:btih:${hash}`];
    if (title) parts.push(`dn=${encodeURIComponent(title)}`);
    trackers.forEach(tracker => {
        if (tracker) parts.push(`tr=${encodeURIComponent(tracker)}`);
    });
    return parts.join("&");
}

function isBatchTitle(title) {
    return /batch|complete|all\s+episodes/i.test(title || "");
}

async function resolveStorePlayback(options) {
    const add = options.addStoreTorz || addStoreTorz;
    const generate = options.generateStoreLink || generateStoreLink;
    const magnet = buildMagnet(options.hash, options.title, options.trackers || []);
    const torz = await add(magnet, options.entry, options.providerOptions || {});
    const status = String(torz.status || "unknown").toLowerCase();

    if (PENDING_STATUSES.has(status)) return { type: "loading" };
    if (FAILED_STATUSES.has(status)) return { type: "not_found", message: "Torrent is not playable." };
    if (!READY_STATUSES.has(status)) return { type: "loading" };

    const files = Array.isArray(torz.files) ? torz.files : [];
    const isMovie = Boolean(options.isMovie);
    const bestFile = options.selectBestVideoFile(
        files,
        options.episode || 1,
        options.expectedSeason || 1,
        isMovie || !isBatchTitle(options.title)
    );

    if (!bestFile || !bestFile.link) return { type: "archive" };

    const directLink = await generate(bestFile.link, options.entry, options.providerOptions || {});
    if (!directLink) return { type: "loading" };

    return { type: "redirect", url: directLink };
}

async function resolveStoreSubtitle(options) {
    const add = options.addStoreTorz || addStoreTorz;
    const generate = options.generateStoreLink || generateStoreLink;
    const magnet = buildMagnet(options.hash, options.title, options.trackers || []);
    const torz = await add(magnet, options.entry, options.providerOptions || {});
    const status = String(torz.status || "unknown").toLowerCase();

    if (!READY_STATUSES.has(status)) return { type: "not_found", message: "Subtitle torrent is not ready." };

    const file = (torz.files || []).find(candidate => String(candidate.id) === String(options.fileId));
    if (!file || !file.link) return { type: "not_found", message: "Subtitle not found." };

    const directLink = await generate(file.link, options.entry, options.providerOptions || {});
    if (!directLink) return { type: "not_found", message: "Subtitle link not found." };

    return {
        type: "redirect",
        url: directLink,
        fileName: file.name || file.path || options.fileName || "sub.srt"
    };
}

module.exports = {
    buildMagnet,
    resolveStorePlayback,
    resolveStoreSubtitle
};
```

- [ ] **Step 4: Run playback tests and verify they pass**

Run:

```bash
npm test -- --test-name-pattern "buildMagnet|resolveStorePlayback|resolveStoreSubtitle"
```

Expected: PASS for all tests in `tests/playback.test.js`.

- [ ] **Step 5: Replace `server.js` imports**

At the top of `server.js`, remove:

```js
const axios = require("axios");
const fs = require("fs");
```

Add:

```js
const axios = require("axios");
const { parseConfig } = require("./lib/config");
const { resolveStorePlayback, resolveStoreSubtitle } = require("./lib/playback");
```

Keep `axios` because the subtitle proxy still fetches the generated direct subtitle URL as a stream.

- [ ] **Step 6: Replace subtitle route**

Replace:

```js
app.get("/sub/:provider/:apiKey/:hash/:fileId", async (req, res) => {
```

through the end of that route with:

```js
app.get("/sub/:amatsuPayload/:serviceIndex/:hash/:fileId", async (req, res) => {
    const { amatsuPayload, serviceIndex, hash, fileId } = req.params;
    const userConfig = parseConfig({ Amatsu: amatsuPayload });
    const entry = userConfig.debridServices[parseInt(serviceIndex, 10)];
    let clientAborted = false;

    req.on("close", () => { clientAborted = true; });

    if (!entry) return res.status(404).send("Debrid service not found");

    try {
        const action = await resolveStoreSubtitle({
            entry,
            hash,
            fileId,
            title: req.query.title || "",
            fileName: req.query.filename || "sub.srt"
        });

        if (action.type !== "redirect") return res.status(404).send(action.message || "Subtitle not found");

        const subResponse = await axios.get(action.url, { responseType: "stream", timeout: 10000 });
        if (clientAborted) {
            if (subResponse.data && subResponse.data.destroy) subResponse.data.destroy();
            return;
        }

        const ext = String(action.fileName || "sub.srt").split(".").pop().toLowerCase();
        let finalMime = subResponse.headers["content-type"];

        if (!finalMime || finalMime.includes("octet-stream") || finalMime.includes("plain")) {
            if (ext === "vtt") finalMime = "text/vtt";
            else if (ext === "ass" || ext === "ssa") finalMime = "text/x-ssa";
            else if (ext === "srt") finalMime = "application/x-subrip";
            else finalMime = "text/plain";
        }

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", finalMime);
        res.setHeader("Cache-Control", "public, max-age=86400");

        subResponse.data.on("error", () => res.end());
        req.on("close", () => {
            if (subResponse.data && subResponse.data.destroy) subResponse.data.destroy();
        });
        subResponse.data.pipe(res);
    } catch (e) {
        console.error("[Sub Proxy Error]", e.message);
        res.status(500).send("Error fetching subtitle data");
    }
});
```

- [ ] **Step 7: Replace playback route**

Replace:

```js
app.get("/resolve/:provider/:apiKey/:hash/:episode?", async (req, res) => {
```

through the end of that route with:

```js
app.get("/resolve/:amatsuPayload/:serviceIndex/:hash/:episode?", async (req, res) => {
    const { amatsuPayload, serviceIndex, hash, episode } = req.params;
    const userConfig = parseConfig({ Amatsu: amatsuPayload });
    const entry = userConfig.debridServices[parseInt(serviceIndex, 10)];

    if (!entry) return res.status(404).send("Debrid service not found");

    try {
        const action = await resolveStorePlayback({
            entry,
            hash,
            episode: parseInt(episode || "1", 10) || 1,
            expectedSeason: parseInt(req.query.season || "1", 10) || 1,
            title: req.query.title || "",
            isMovie: req.query.movie === "1",
            selectBestVideoFile
        });

        if (action.type === "redirect") return res.redirect(action.url);
        if (action.type === "archive") return serveArchiveVideo(req, res);
        if (action.type === "not_found") return res.status(404).send(action.message || "Torrent is not playable.");
        return serveLoadingVideo(req, res);
    } catch (e) {
        console.error("[Resolve Error] Core resolution failure: " + e.message);
        return serveLoadingVideo(req, res);
    }
});
```

- [ ] **Step 8: Run tests and server syntax check**

Run:

```bash
npm test
```

Expected: PASS.

Run:

```bash
node -c server.js
```

Expected: no output and exit code `0`.

- [ ] **Step 9: Commit Task 5**

```bash
git add lib/playback.js tests/playback.test.js server.js
git commit -m "feat: resolve playback through StremThru stores"
```

## Task 6: Multi-Service Configure UI

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace provider inputs with a dynamic container**

In `public/index.html`, replace the `Providers & Access` block containing `rdKey` and `tbKey` with:

```html
<div class="space-y-4">
    <div class="flex items-center justify-between gap-4">
        <p class="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-2 pl-2">Providers & Access</p>
        <button type="button" id="addDebridService" class="text-[10px] font-mono text-blue-400 hover:text-white uppercase tracking-widest">Add</button>
    </div>
    <div id="debridServicesContainer" class="space-y-3"></div>
</div>
```

- [ ] **Step 2: Add service UI data and row helpers**

At the top of the `<script>` block, before `showModal`, add:

```js
const DEBRID_SERVICES = {
    realdebrid: { name: "RealDebrid", helpText: "API token" },
    torbox: { name: "TorBox", helpText: "API key" },
    alldebrid: { name: "AllDebrid", helpText: "API key" },
    premiumize: { name: "Premiumize", helpText: "API key" },
    debridlink: { name: "Debrid-Link", helpText: "API key" },
    debrider: { name: "Debrider", helpText: "API key" },
    easydebrid: { name: "EasyDebrid", helpText: "API key" },
    offcloud: { name: "Offcloud", helpText: "Email:password or API key accepted by StremThru" },
    pikpak: { name: "PikPak", helpText: "Email:password accepted by StremThru" }
};

let debridServiceCounter = 0;

function addDebridServiceRow(service = "realdebrid", apiKey = "") {
    const container = document.getElementById("debridServicesContainer");
    const entryId = debridServiceCounter++;
    const row = document.createElement("div");
    row.className = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2 items-center";
    row.dataset.entryId = String(entryId);
    row.innerHTML = `
        <select class="debrid-service-select input-glass rounded-xl px-3 py-3 text-white outline-none font-mono text-xs bg-black/40">
            ${Object.entries(DEBRID_SERVICES).map(([value, meta]) => `<option value="${value}">${meta.name}</option>`).join("")}
        </select>
        <input type="password" class="debrid-api-key input-glass rounded-xl px-4 py-3 text-white outline-none input-glow font-mono text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button type="button" class="remove-debrid-service text-gray-600 hover:text-red-400 px-2 py-2" title="Remove">×</button>
    `;
    row.querySelector(".debrid-service-select").value = service;
    row.querySelector(".debrid-api-key").value = apiKey;
    row.querySelector(".debrid-api-key").title = DEBRID_SERVICES[service].helpText;
    row.querySelector(".debrid-service-select").addEventListener("change", event => {
        row.querySelector(".debrid-api-key").title = DEBRID_SERVICES[event.target.value].helpText;
        generateManifestUrl();
    });
    row.querySelector(".debrid-api-key").addEventListener("input", generateManifestUrl);
    row.querySelector(".remove-debrid-service").addEventListener("click", () => {
        row.remove();
        generateManifestUrl();
    });
    container.appendChild(row);
    generateManifestUrl();
}

function getDebridServices() {
    return Array.from(document.querySelectorAll("#debridServicesContainer > div")).map(row => ({
        service: row.querySelector(".debrid-service-select").value,
        apiKey: row.querySelector(".debrid-api-key").value.trim()
    })).filter(entry => entry.service && entry.apiKey);
}
```

- [ ] **Step 3: Update manifest generation**

In `generateManifestUrlLogic`, replace:

```js
const rd = document.getElementById("rdKey").value.trim();
const tb = document.getElementById("tbKey").value.trim();
```

with:

```js
const debridServices = getDebridServices();
```

Replace:

```js
if (!rd && !tb && !enableP2P) {
```

with:

```js
if (debridServices.length === 0 && !enableP2P) {
```

Replace:

```js
if (rd) rawConfig.rdKey = rd;
if (tb) rawConfig.tbKey = tb;
```

with:

```js
if (debridServices.length > 0) rawConfig.debridServices = debridServices;
```

- [ ] **Step 4: Update DOMContentLoaded listeners**

In `DOMContentLoaded`, replace the `inputs` array:

```js
const inputs = [
    "rdKey", "tbKey", "enableP2P",
    "hideUncached", "useEnglishTitles",
    "showSeasonalSeries", "showAiringSeries", "showTrendingSeries", "showTopSeries",
    "showTrendingMovies", "showTopMovies"
];
```

with:

```js
const inputs = [
    "enableP2P",
    "hideUncached", "useEnglishTitles",
    "showSeasonalSeries", "showAiringSeries", "showTrendingSeries", "showTopSeries",
    "showTrendingMovies", "showTopMovies"
];
```

Add this after the existing listener setup:

```js
document.getElementById("addDebridService").addEventListener("click", () => addDebridServiceRow());
addDebridServiceRow("realdebrid", "");
```

Delete the final `document.querySelectorAll("input[type=\"password\"]")` block that only resets borders for the old fixed password inputs.

- [ ] **Step 5: Update modal copy**

Replace the modal paragraph text with:

```html
<p class="text-gray-400 text-sm mb-8 font-mono leading-relaxed">At least one debrid service OR the P2P option is required to establish connection.</p>
```

- [ ] **Step 6: Run a static grep for removed legacy IDs**

Run:

```bash
rg -n "rdKey|tbKey" public/index.html
```

Expected: no matches.

- [ ] **Step 7: Commit Task 6**

```bash
git add public/index.html
git commit -m "feat: configure multiple debrid services"
```

## Task 7: Documentation And Full Verification

**Files:**
- Modify: `readme.md`
- Test: all tests and runtime smoke checks

- [ ] **Step 1: Update README provider copy**

In `readme.md`, replace the line that says:

```md
The definitive high-performance bridge between Nyaa.si and Stremio. Access the world's largest library of high-quality Anime and Live Action Content via Real-Debrid, Torbox, or Direct P2P BitTorrent with bulletproof episode parsing, a strict 3-phase sorting engine, multi-language subtitle injection, and zero server-side tracking.
```

with:

```md
The definitive high-performance bridge between Nyaa.si and Stremio. Access the world's largest library of high-quality Anime and Live Action Content via StremThru-backed premium unlockers, including RealDebrid, TorBox, AllDebrid, Premiumize, Debrid-Link, Debrider, EasyDebrid, Offcloud, PikPak, or Direct P2P BitTorrent with bulletproof episode parsing, a strict 3-phase sorting engine, multi-language subtitle injection, and zero server-side tracking.
```

- [ ] **Step 2: Update Quick Start**

Replace Quick Start step 2 with:

```md
2. Add one or more premium unlocker accounts under **Providers & Access**, **OR** toggle the **"Enable Simple P2P"** option if you do not have a Debrid subscription.
```

- [ ] **Step 3: Update environment variables**

In the environment variables block, add:

```md
STREMTHRU_URL: Optional. StremThru instance used for all premium unlocker API calls. Defaults to https://stremthru.13377001.xyz.
```

Remove the `ROOT_TORBOX_KEY` line from the README because cache checks no longer use the TorBox radar fallback.

- [ ] **Step 4: Run all automated tests**

Run:

```bash
npm test
```

Expected: PASS for every test file in `tests/`.

- [ ] **Step 5: Run syntax checks**

Run:

```bash
node -c addon.js
```

Expected: no output and exit code `0`.

Run:

```bash
node -c server.js
```

Expected: no output and exit code `0`.

- [ ] **Step 6: Run addon import smoke check**

Run:

```bash
node -e "const { parseConfig } = require('./addon'); const cfg = parseConfig({ Amatsu: require('./lib/config').encodeConfigPayload({ debridServices: [{ service: 'premiumize', apiKey: 'x' }] }) }); console.log(cfg.debridServices[0].service)"
```

Expected output:

```text
premiumize
```

- [ ] **Step 7: Start local server and check health**

Run:

```bash
npm start
```

Expected output includes:

```text
AMATSU ONLINE | PORT 7002
```

In a second terminal, run:

```bash
curl -s http://127.0.0.1:7002/health
```

Expected output:

```json
{"status":"alive"}
```

Stop the server with `Ctrl-C`.

- [ ] **Step 8: Verify generated manifest payload manually**

Open:

```text
http://127.0.0.1:7002/configure
```

Add two service rows:

```text
RealDebrid / test-rd-key
Premiumize / test-pm-key
```

Expected generated manifest URL contains one `Amatsu` payload. With the configure page still open, run this in the browser developer console:

```js
const url = document.getElementById("manifestUrlDisplay").value;
const config = JSON.parse(decodeURIComponent(url.match(/\/([^/]+)\/manifest\.json/)[1]));
const payload = config.Amatsu.replace(/-/g, "+").replace(/_/g, "/");
console.log(atob(payload));
```

Expected decoded JSON contains:

```json
{"debridServices":[{"service":"realdebrid","apiKey":"test-rd-key"},{"service":"premiumize","apiKey":"test-pm-key"}]}
```

- [ ] **Step 9: Commit Task 7**

```bash
git add readme.md
git commit -m "docs: document multi-service unlockers"
```

## Self-Review Checklist

- Spec coverage:
  - Multi-service config is implemented in Tasks 1, 4, and 6.
  - Recommended provider set is implemented in Task 1.
  - Generic StremThru torz provider layer is implemented in Task 2.
  - Generic stream generation and Offcloud conservative behavior are implemented in Task 3 and wired in Task 4.
  - Stateless playback and subtitle routes with opaque payloads are implemented in Task 5.
  - Docs and verification are implemented in Task 7.
- Placeholder scan:
  - The plan contains concrete file paths, commands, snippets, and expected results for every task.
  - The plan does not rely on unspecified future decisions.
- Type consistency:
  - `debridServices` entries always use `{ service, apiKey }`.
  - StremThru file mappings always expose `id`, `index`, `link`, `name`, `path`, and `size`.
  - Playback actions always use `type: "redirect" | "loading" | "archive" | "not_found"`.
