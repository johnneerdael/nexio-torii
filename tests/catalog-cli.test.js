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
