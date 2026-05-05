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
        if (config && (config.NexioTorii || config.Amatsu)) {
            const decoded = fromBase64Safe(config.NexioTorii || config.Amatsu);
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
