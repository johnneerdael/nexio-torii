const nyaa = require("./nyaa");
const animetosho = require("./animetosho");
const tokyotosho = require("./tokyotosho");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectPagedBackfill(options) {
    const maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0 ? options.maxPages : 1000;
    const pageDelayMs = Number.isFinite(options.pageDelayMs) && options.pageDelayMs > 0 ? options.pageDelayMs : 0;
    const fetchPage = options.fetchPage;
    const sleeper = options.sleep || sleep;
    const opportunistic = options.opportunistic === true;
    const items = [];

    for (let page = 1; page <= maxPages; page++) {
        let pageItems;
        try {
            pageItems = await fetchPage(page);
        } catch (error) {
            if (opportunistic && items.length > 0) break;
            throw error;
        }
        if (!pageItems.length) break;
        items.push(...pageItems);
        if (pageDelayMs > 0 && page < maxPages) await sleeper(pageDelayMs);
    }

    return items;
}

async function fetchNyaaBackfill(options = {}) {
    const source = options.source || nyaa;
    return collectPagedBackfill({
        maxPages: options.maxPages,
        pageDelayMs: options.pageDelayMs,
        fetchPage: page => source.fetchListingPage(page, "1_0", { timeoutMs: options.timeoutMs || 10000 })
    });
}

async function fetchTokyoToshoBackfill(options = {}) {
    const source = options.source || tokyotosho;
    return collectPagedBackfill({
        maxPages: options.maxPages,
        pageDelayMs: options.pageDelayMs,
        opportunistic: true,
        fetchPage: page => source.fetchListingPage(page, { timeoutMs: options.timeoutMs || 20000 })
    });
}

async function fetchAnimeToshoBackfill(options = {}) {
    const source = options.source || animetosho;
    if (options.animeToshoTsvUrl || process.env.ANIMETOSHO_TSV_URL) {
        return source.fetchTorrentsTsv({
            url: options.animeToshoTsvUrl || process.env.ANIMETOSHO_TSV_URL,
            timeoutMs: options.timeoutMs || 60000
        });
    }
    return source.fetchJsonFeed({ timeoutMs: options.timeoutMs || 10000 });
}

module.exports = {
    collectPagedBackfill,
    fetchAnimeToshoBackfill,
    fetchNyaaBackfill,
    fetchTokyoToshoBackfill
};
