const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("catalog validate prints source counts for a sqlite database", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-catalog-cli-"));
    const dbPath = path.join(dir, "catalog.sqlite");
    const init = spawnSync(process.execPath, ["scripts/catalog-ingest.js", "--source", "none", "--db", dbPath], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);

    const result = spawnSync(process.execPath, ["scripts/catalog-validate.js", "--db", dbPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /source_items=0/);
    assert.match(result.stdout, /torrent_identities=0/);
});

test("anime map refresh cli writes a validated map from local source files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexio-anime-map-cli-"));
    const fribbPath = path.join(dir, "fribb.json");
    const scudleePath = path.join(dir, "scudlee.xml");
    const mapPath = path.join(dir, "nexio-anime-map-v1.json");
    fs.writeFileSync(fribbPath, JSON.stringify([
        { anidb_id: 69, kitsu_id: 12, mal_id: 21, anilist_id: 21, type: "TV" }
    ]));
    fs.writeFileSync(scudleePath, '<anime-list><anime anidbid="69" tvdbid="81797"><name>One Piece</name></anime></anime-list>');

    const result = spawnSync(process.execPath, [
        "scripts/anime-map-refresh.js",
        "--fribb-file", fribbPath,
        "--scudlee-file", scudleePath,
        "--map", mapPath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /identity_records=1/);
    const asset = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    assert.equal(asset.indexes.byAnidb["69"], "12");
});
