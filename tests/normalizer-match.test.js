const test = require("node:test");
const assert = require("node:assert/strict");

const { filterByCanonical } = require("../lib/normalizer/match");

const NARUTO = { mainTitle: "NARUTO", englishTitle: "Naruto", synonyms: [], format: "TV", year: 2002, episodeCount: 220 };
const ONE_PIECE = { mainTitle: "ONE PIECE", englishTitle: "ONE PIECE", synonyms: [], format: "TV", year: 1999, episodeCount: 1100 };

test("filterByCanonical drops a same-title different-year torrent", async () => {
    const torrents = [
        // legitimate
        { title: "[SubsPlease] Naruto - 01 [1080p].mkv", hash: "good", size: "500 MB", seeders: 100, source: "nyaa" },
        // year-gate fail (Naruto 2002 vs hypothetical 2030 reboot)
        { title: "Naruto Reboot 2030 - 01.mkv", hash: "bad-year", size: "500 MB", seeders: 1, source: "nyaa" }
    ];
    const { kept, dropped } = await filterByCanonical({ canonical: NARUTO, torrents });
    const keptHashes = kept.map(t => t.hash);
    assert.ok(keptHashes.includes("good"), "expected the SubsPlease torrent to survive");
    assert.ok(!keptHashes.includes("bad-year"), "expected the 2030 reboot torrent to be dropped");
    assert.equal(dropped.length, 1);
    assert.match(dropped[0].gateFailures.join(" | "), /year/);
});

test("filterByCanonical drops Recap Movie when canonical is TV", async () => {
    const torrents = [
        { title: "[Erai-raws] One Piece - 1100 [1080p].mkv", hash: "tv", size: "500 MB", seeders: 100 },
        { title: "One Piece Recap Movie [BD 1080p]", hash: "recap", size: "1 GB", seeders: 50 }
    ];
    const { kept, dropped } = await filterByCanonical({ canonical: ONE_PIECE, torrents });
    const keptHashes = kept.map(t => t.hash);
    assert.ok(keptHashes.includes("tv"));
    assert.ok(!keptHashes.includes("recap"));
    assert.match(dropped[0].gateFailures.join(" | "), /recap_tag|short_release|format/);
});

test("filterByCanonical leaves everything kept when no gates fire", async () => {
    const torrents = [
        { title: "[SubsPlease] One Piece - 1100 [1080p].mkv", hash: "a" },
        { title: "[Erai-raws] One Piece - 1101 [720p].mkv", hash: "b" }
    ];
    const { kept, dropped } = await filterByCanonical({ canonical: ONE_PIECE, torrents });
    assert.equal(kept.length, 2);
    assert.equal(dropped.length, 0);
});

test("filterByCanonical attaches matchScore + reasons to surviving torrents", async () => {
    const torrents = [
        { title: "[SubsPlease] Naruto - 01 [1080p].mkv", hash: "n" }
    ];
    const { kept } = await filterByCanonical({ canonical: NARUTO, torrents });
    assert.equal(kept.length, 1);
    assert.ok(Number.isFinite(kept[0]._matchScore));
    assert.ok(Array.isArray(kept[0]._matchReasons));
});

test("filterByCanonical returns input verbatim when canonical is missing", async () => {
    const torrents = [{ title: "anything", hash: "x" }];
    const { kept, dropped } = await filterByCanonical({ canonical: null, torrents });
    assert.equal(kept, torrents);
    assert.deepEqual(dropped, []);
});

test("filterByCanonical handles empty torrent list gracefully", async () => {
    const { kept, dropped } = await filterByCanonical({ canonical: NARUTO, torrents: [] });
    assert.deepEqual(kept, []);
    assert.deepEqual(dropped, []);
});
