const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    buildAnimeMap,
    refreshAnimeMap,
    validateAnimeMap
} = require("../lib/catalog/anime-map-generator");

const fribbFixture = JSON.stringify([
    {
        anidb_id: 69,
        kitsu_id: 12,
        mal_id: 21,
        anilist_id: 21,
        tvdb_id: 81797,
        themoviedb_id: 37854,
        imdb_id: "tt0388629",
        type: "TV",
        season: { tvdb: 1, tmdb: 1 }
    },
    {
        anidb_id: 18413,
        kitsu_id: 48946,
        mal_id: 56038,
        anilist_id: 16498,
        type: "MOVIE"
    }
]);

const scudleeFixture = `<?xml version="1.0" encoding="UTF-8"?>
<anime-list>
  <anime anidbid="69" tvdbid="81797" tmdbtv="37854" imdbid="tt0388629" defaulttvdbseason="1" tmdbseason="1" episodeoffset="0">
    <name>One Piece</name>
    <mapping-list>
      <mapping anidbseason="1" tvdbseason="1" start="1" end="10" offset="0">11-11; 12-12</mapping>
    </mapping-list>
  </anime>
  <anime anidbid="18413" tmdbid="1297842" imdbid="tt33332385">
    <name>Chainsaw Man - The Movie: Reze Arc</name>
  </anime>
</anime-list>`;

test("buildAnimeMap creates the Nexio schema and stable id indexes", () => {
    const asset = buildAnimeMap({
        fribbJson: fribbFixture,
        scudleeXml: scudleeFixture,
        generatedAt: "2026-05-06T00:00:00.000Z"
    });

    assert.equal(asset.schemaVersion, 2);
    assert.equal(asset.mappingPolicyVersion, 1);
    assert.equal(asset.counts.identityRecords, 2);
    assert.equal(asset.indexes.byAnidb["69"], "12");
    assert.equal(asset.indexes.byImdb.tt0388629[0], "12");
    assert.equal(asset.indexes.byTmdbMovie["1297842"], "48946");
    assert.equal(asset.identityRecordsByKitsu["12"].hasMappingRules, true);
    assert.equal(asset.episodeMappingsByAnidb["69"].ranges[0].targetProvider, "TVDB");
    assert.equal(asset.episodeMappingsByAnidb["69"].explicitMaps[0].sourceEpisode, 11);
});

test("refreshAnimeMap writes map and provenance atomically", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-map-refresh-"));
    const mapPath = path.join(dir, "anime", "nexio-anime-map-v1.json");
    const provenancePath = path.join(dir, "anime", "nexio-anime-map-provenance.json");

    const result = await refreshAnimeMap({
        mapPath,
        provenancePath,
        fetchSources: async () => ({
            fribb: { url: "https://example.test/fribb.json", commit: "abc123", text: fribbFixture },
            scudlee: { url: "https://example.test/scudlee.xml", commit: "def456", text: scudleeFixture }
        }),
        now: () => new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.identityRecords, 2);
    assert.equal(validateAnimeMap(JSON.parse(fs.readFileSync(mapPath, "utf8"))).identityRecords, 2);

    const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
    assert.equal(provenance.sources.fribb.commit, "abc123");
    assert.equal(provenance.counts.episodeMappingRecords, 1);
    assert.equal(fs.existsSync(`${mapPath}.tmp`), false);
});

test("refreshAnimeMap keeps an existing valid map when upstream refresh fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-map-refresh-fallback-"));
    const mapPath = path.join(dir, "nexio-anime-map-v1.json");
    fs.writeFileSync(mapPath, JSON.stringify(buildAnimeMap({
        fribbJson: fribbFixture,
        scudleeXml: scudleeFixture,
        generatedAt: "2026-05-06T00:00:00.000Z"
    })));

    const result = await refreshAnimeMap({
        mapPath,
        fetchSources: async () => {
            throw new Error("network down");
        }
    });

    assert.equal(result.refreshed, false);
    assert.equal(result.usedExisting, true);
});
