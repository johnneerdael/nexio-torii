const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const nyaa = require("../lib/catalog/source/nyaa");
const animetosho = require("../lib/catalog/source/animetosho");
const tokyotosho = require("../lib/catalog/source/tokyotosho");

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, "fixtures", "catalog", name), "utf8");
}

test("Nyaa RSS parser returns normalized source items", () => {
    const rows = nyaa.parseRss(fixture("nyaa-rss.xml"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "nyaa");
    assert.equal(rows[0].sourceItemId, "123");
    assert.equal(rows[0].infoHash, "abcdef0123456789abcdef0123456789abcdef01");
    assert.equal(rows[0].torrentUrl, "https://nyaa.si/download/123.torrent");
});

test("Nyaa listing parser returns page rows", () => {
    const rows = nyaa.parseListing(fixture("nyaa-listing.html"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceItemId, "123");
    assert.equal(rows[0].seeders, 12);
});

test("AnimeTosho JSON feed parser keeps AniDB evidence", () => {
    const rows = animetosho.parseJsonFeed(fixture("animetosho-feed.json"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "animetosho");
    assert.equal(rows[0].infoHash, "abcdef0123456789abcdef0123456789abcdef02");
    assert.equal(rows[0].raw.aid, "1");
    assert.equal(rows[0].raw.eid, "100");
});

test("AnimeTosho TSV export parser imports stored torrent rows", () => {
    const rows = animetosho.parseTorrentsTsv(fixture("animetosho-torrents.tsv"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceItemId, "88");
    assert.equal(rows[0].infoHash, "abcdef0123456789abcdef0123456789abcdef03");
    assert.equal(rows[0].raw.aid, "1");
    assert.equal(rows[0].torrentUrl, "https://storage.animetosho.org/torrent/abcdef0123456789abcdef0123456789abcdef03/torrent.torrent");
});

test("TokyoTosho RSS parser extracts description magnet hash", () => {
    const rows = tokyotosho.parseRss(fixture("tokyotosho-rss.xml"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "tokyotosho");
    assert.equal(rows[0].infoHash, "fd51c17d2609334d9ec3454a28056c187a69a025");
    assert.equal(rows[0].sizeText, "1.3GB");
});

test("TokyoTosho RSS parser converts CDATA link objects to strings", () => {
    const rows = tokyotosho.parseRss(`
        <rss><channel><item>
          <title>Example</title>
          <link><![CDATA[https://nyaa.si/view/2106734/torrent]]></link>
          <guid><![CDATA[https://www.tokyotosho.info/details.php?id=2079221]]></guid>
          <description><![CDATA[<a href="magnet:?xt=urn:btih:PRJMQNRZLT2WAYIWEOX6LAUVSST5AADW">Magnet Link</a><br />Size: 735.56MB<br />]]></description>
        </item></channel></rss>
    `);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceItemId, "2079221");
    assert.equal(rows[0].torrentUrl, "https://nyaa.si/view/2106734/torrent");
});

test("TokyoTosho listing parser returns stats and details id", () => {
    const rows = tokyotosho.parseListing(fixture("tokyotosho-listing.html"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceItemId, "2079073");
    assert.equal(rows[0].seeders, 25);
    assert.equal(rows[0].completed, 77);
});
