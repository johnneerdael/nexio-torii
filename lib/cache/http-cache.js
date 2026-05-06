function numberFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
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
    return pathname.startsWith("/stream/")
        || pathname === "/manifest.json"
        || pathname === "/configure";
}

function applyHttpCacheHeaders(req, res, next) {
    if (req.method === "GET" && shouldApplyStreamCache(req.path)) {
        res.setHeader("Cache-Control", buildStreamCacheControl());
    }
    next();
}

module.exports = {
    applyHttpCacheHeaders,
    buildStreamCacheControl,
    shouldApplyStreamCache
};
