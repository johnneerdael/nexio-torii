const crypto = require("node:crypto");

function numberFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function stableJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function generateEtag(value) {
    const content = Buffer.isBuffer(value)
        ? value
        : Buffer.from(typeof value === "string" ? value : stableJson(value));
    const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
    return `W/"${hash}"`;
}

function normalizeEtag(value) {
    return String(value || "").trim().replace(/^W\//, "");
}

function checkEtagMatch(ifNoneMatch, etag) {
    if (!ifNoneMatch) return false;
    return String(ifNoneMatch).split(",").some(candidate => {
        const trimmed = candidate.trim();
        return trimmed === "*" || normalizeEtag(trimmed) === normalizeEtag(etag);
    });
}

function buildStreamCacheControl(options = {}) {
    const maxAge = options.maxAge ?? numberFromEnv("STREAM_HTTP_MAX_AGE_SECONDS", 1800);
    const sMaxAge = options.sMaxAge ?? numberFromEnv("STREAM_HTTP_S_MAXAGE_SECONDS", 3600);
    const staleWhileRevalidate = options.staleWhileRevalidate ?? numberFromEnv("STREAM_HTTP_STALE_REVALIDATE_SECONDS", 21600);
    const staleIfError = options.staleIfError ?? numberFromEnv("STREAM_HTTP_STALE_ERROR_SECONDS", 300);

    return [
        "public",
        `max-age=${maxAge}`,
        `s-maxage=${sMaxAge}`,
        `stale-while-revalidate=${staleWhileRevalidate}`,
        `stale-if-error=${staleIfError}`
    ].join(", ");
}

function shouldApplyStreamCache(pathname) {
    const path = String(pathname || "");
    return path === "/configure"
        || path === "/manifest.json"
        || path.endsWith("/manifest.json")
        || path.startsWith("/stream/")
        || path.includes("/stream/");
}

function patchJsonResponse(req, res, cacheControl) {
    if (res.__nexioCachePatched) return;
    res.__nexioCachePatched = true;

    const originalJson = res.json.bind(res);
    const originalSend = typeof res.send === "function" ? res.send.bind(res) : null;
    const originalEnd = res.end.bind(res);

    function applyBodyCache(body) {
        const etag = generateEtag(body);
        res.setHeader("ETag", etag);
        res.setHeader("Vary", "Accept, Accept-Encoding");
        res.setHeader("Cache-Control", cacheControl);

        if (checkEtagMatch(req.headers && req.headers["if-none-match"], etag)) {
            res.status(304);
            return true;
        }

        return false;
    }

    res.json = body => {
        if (applyBodyCache(body)) {
            originalEnd();
            return res;
        }

        return originalJson(body);
    };

    if (originalSend) {
        res.send = body => {
            if (applyBodyCache(body)) {
                originalEnd();
                return res;
            }

            return originalSend(body);
        };
    }

    res.end = (chunk, encoding, callback) => {
        if (chunk !== undefined && applyBodyCache(chunk)) {
            return originalEnd(undefined, encoding, callback);
        }

        res.setHeader("Cache-Control", cacheControl);
        return originalEnd(chunk, encoding, callback);
    };
}

function applyHttpCacheHeaders(req, res, next) {
    if (req.method === "GET" && shouldApplyStreamCache(req.path)) {
        const cacheControl = buildStreamCacheControl();
        res.setHeader("Cache-Control", cacheControl);
        patchJsonResponse(req, res, cacheControl);
    }
    next();
}

module.exports = {
    applyHttpCacheHeaders,
    buildStreamCacheControl,
    checkEtagMatch,
    generateEtag,
    shouldApplyStreamCache
};
