const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { ingestBackfill } = require("../scripts/catalog-daily-runner");

test("startup backfill runs each source independently and reports partial failure", async () => {
    const calls = [];
    const result = await ingestBackfill(["--max-pages", "2"], {
        runChild: async args => {
            calls.push(args);
            if (args.includes("nyaa")) throw new Error("Request failed with status code 403");
        },
        log: () => {}
    });

    assert.deepEqual(calls.map(args => args[2]), ["nyaa", "animetosho", "tokyotosho"]);
    assert.equal(result.complete, false);
    assert.equal(result.summary.nyaa.status, "failed");
    assert.equal(result.summary.animetosho.status, "complete");
    assert.equal(result.summary.tokyotosho.status, "complete");
});

test("docker compose does not wrap catalog daily runner through npm script defaults", () => {
    const compose = fs.readFileSync("docker-compose.yml", "utf8");

    assert.doesNotMatch(compose, /"npm", "run", "catalog:daily"/);
    assert.match(compose, /"node",\s*"scripts\/catalog-daily-runner\.js"/);
});
