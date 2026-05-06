const axios = require("axios");

const KITSU_BASE_URL = "https://kitsu.io/api/edge";
const TMDB_BASE_URL = process.env.TMDB_API_URL || "https://api.themoviedb.org/3";

function createMetadataClients(options = {}) {
    const http = options.http || axios;
    const timeoutMs = options.timeoutMs || 8000;
    const tmdbApiKey = options.tmdbApiKey ?? process.env.TMDB_API_KEY ?? "";

    async function kitsuSearchAnime(query) {
        const response = await http.get(`${KITSU_BASE_URL}/anime`, {
            timeout: timeoutMs,
            headers: {
                Accept: "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json"
            },
            params: {
                "filter[text]": query,
                "page[limit]": 5,
                "page[offset]": 0
            }
        });
        return Array.isArray(response.data?.data) ? response.data.data : [];
    }

    async function tmdbSearch(query) {
        if (!String(tmdbApiKey || "").trim()) return [];
        const common = {
            timeout: timeoutMs,
            params: {
                api_key: tmdbApiKey,
                query,
                include_adult: false,
                page: 1,
                language: "en-US"
            }
        };
        const [tv, movie] = await Promise.all([
            http.get(`${TMDB_BASE_URL}/search/tv`, common).catch(() => ({ data: { results: [] } })),
            http.get(`${TMDB_BASE_URL}/search/movie`, common).catch(() => ({ data: { results: [] } }))
        ]);
        return [
            ...(tv.data?.results || []).map(result => ({ ...result, media_type: "tv" })),
            ...(movie.data?.results || []).map(result => ({ ...result, media_type: "movie" }))
        ];
    }

    return {
        kitsuSearchAnime,
        tmdbSearch
    };
}

module.exports = {
    createMetadataClients
};
