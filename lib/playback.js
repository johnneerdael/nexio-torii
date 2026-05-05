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
