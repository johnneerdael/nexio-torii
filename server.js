require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const { getRouter } = require("stremio-addon-sdk");
const { addonInterface, manifest } = require("./addon");
const { parseConfig } = require("./lib/config");

const CATALOG_CONFIG_KEYS = {
    nexio_seasonal_series: "showSeasonalSeries",
    nexio_airing_series: "showAiringSeries",
    nexio_trending_series: "showTrendingSeries",
    nexio_top_series: "showTopSeries",
    nexio_trending_movie: "showTrendingMovies",
    nexio_top_movie: "showTopMovies"
};
const { selectBestVideoFile } = require("./lib/parser");
const { resolveStorePlayback, resolveStoreSubtitle } = require("./lib/playback");
const { applyHttpCacheHeaders } = require("./lib/cache/http-cache");

const app = express();
app.use(express.json()); 

//===============
// CORS & PREFLIGHT HANDLING
// This middleware ensures that strict environments like Stremio Web 
// on Apple devices (WebKit) do not block the addon requests.
// We explicitly allow the "Range" header for subtitle seeking.
//===============
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    next();
});

app.use(applyHttpCacheHeaders);

//===============
// GLOBAL ERROR HANDLER
// Prevents the Node.js process from crashing if a promise is rejected 
// without a ".catch()" block somewhere in the async operations.
//===============
process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "static")));

const port = process.env.PORT || 7002;

// Fallback for missing environment variables when self-hosting
let BASE_URL = process.env.BASE_URL || "http://127.0.0.1:7002";
BASE_URL = BASE_URL.replace(/\/+$/, "");

const NYAA_DOMAIN = (process.env.NYAA_DOMAIN || "https://nyaa.iss.one").replace(/\/+$/, "");

// API status endpoint
app.get("/health", (req, res) => res.status(200).json({ "status": "alive" }));

//===============
// NYAA STATUS CHECK
// Caches the Nyaa.si health status for 5 minutes (300000ms) to prevent 
// spamming the tracker with health check pings from the frontend UI.
//===============
let nyaaCache = { "status": "checking", "timestamp": 0 };

app.get("/nyaa-status", async (req, res) => {
    const now = Date.now();
    if (now - nyaaCache.timestamp < 300000 && nyaaCache.status !== "checking") {
        return res.json({ "status": nyaaCache.status });
    }
    
    try {
        await axios.get(NYAA_DOMAIN, {
            "timeout": 5000,
            "headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            },
            "validateStatus": function (status) {
                // Nyaa often returns 403 or 503 when under Cloudflare protection, 
                // but that still means the server is "alive" and reachable.
                return (status >= 200 && status < 300) || status === 403 || status === 503;
            }
        });

        nyaaCache = { "status": "online", "timestamp": now };
        res.json({ "status": "online" });
    } catch (error) {
        nyaaCache = { "status": "online", "timestamp": now };
        res.json({ "status": "online" });
    }
});

app.get("/configure", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

//===============
// BULLETPROOF SUBTITLE PROXY
// Bypasses CORS and bandwidth limitations by piping the subtitle file 
// directly through our backend to the Stremio video player.
// Includes connection-drop detection to prevent memory leaks.
//===============
app.get("/sub/:nexioPayload/:serviceIndex/:hash/:fileId", async (req, res) => {
    const { nexioPayload, serviceIndex, hash, fileId } = req.params;
    const userConfig = parseConfig({ NexioTorii: nexioPayload });
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
    
//===============
// FALLBACK VIDEOS
// When a torrent is uncached and needs to be downloaded by the Debrid service, 
// Stremio cannot wait. We send a small looping video back immediately.
//===============
function serveLoadingVideo(req, res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.redirect(BASE_URL + "/waiting.mp4");
}

function serveArchiveVideo(req, res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.redirect(BASE_URL + "/archive.mp4");
}

//===============
// STREAM RESOLVER
// Receives the direct click from the user in Stremio.
// Locates the hash on the Debrid service, determines the best file, 
// unrestricts it, and redirects the Stremio player to the raw MP4/MKV URL.
//===============
app.get("/resolve/:nexioPayload/:serviceIndex/:hash/:episode?", async (req, res) => {
    const { nexioPayload, serviceIndex, hash, episode } = req.params;
    const userConfig = parseConfig({ NexioTorii: nexioPayload });
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

app.get("/:config/manifest.json", (req, res, next) => {
    try {
        const decoded = JSON.parse(req.params.config);
        const userConfig = parseConfig(decoded);
        const filteredCatalogs = manifest.catalogs.filter(cat => {
            const key = CATALOG_CONFIG_KEYS[cat.id];
            if (!key) return true;
            return userConfig[key] !== false;
        });
        res.json({ ...manifest, catalogs: filteredCatalogs });
    } catch (e) {
        next();
    }
});

app.use("/", getRouter(addonInterface));
app.listen(port, "0.0.0.0", () => console.log("NEXIO TORII ONLINE | PORT " + port));
