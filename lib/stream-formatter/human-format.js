const FLAG_BY_CODE = {
    ENG: "🇬🇧", JPN: "🇯🇵", ESP: "🇪🇸", FRE: "🇫🇷", GER: "🇩🇪",
    ITA: "🇮🇹", POR: "🇵🇹", RUS: "🇷🇺", CHI: "🇨🇳", KOR: "🇰🇷",
    HIN: "🇮🇳", ARA: "🇸🇦", DUT: "🇳🇱", POL: "🇵🇱", TUR: "🇹🇷",
    IND: "🇮🇩", VIE: "🇻🇳", MULTI: "🌍", LAT: "💃🏻", SPA: "🇪🇸",
    NLD: "🇳🇱"
};

function humanSize(bytes) {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes === 0) return "0 B";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    const formatted = v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
    return `${parseFloat(formatted)} ${units[i]}`;
}

function humanAge(hours) {
    if (hours == null || !Number.isFinite(hours)) return null;
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = hours / 24;
    if (days < 365) return `${Math.round(days)}d`;
    const years = days / 365;
    return `${Math.round(years)}y`;
}

function languageFlag(label) {
    if (!label) return "🌐";
    const code = String(label).toUpperCase();
    return FLAG_BY_CODE[code] || "🌐";
}

function cacheGlyph(isCached) {
    if (isCached === true) return "⚡";
    if (isCached === false) return "☁️";
    return "📡";
}

function packEpisodes(range) {
    if (!range || !Number.isFinite(range.first) || !Number.isFinite(range.last)) return null;
    const base = `${range.first}-${range.last}`;
    return Number.isFinite(range.total) ? `${base}/${range.total}` : base;
}

module.exports = { humanSize, humanAge, languageFlag, cacheGlyph, packEpisodes };
