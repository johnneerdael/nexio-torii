const test = require("node:test");
const assert = require("node:assert/strict");

const { _private } = require("../lib/nyaa");

test("parseTokyoToshoRssItems extracts base32 magnet hashes from RSS descriptions", () => {
    const items = _private.parseTokyoToshoRssItems([
        {
            title: "[NanakoRaws] One Piece - 968 (BS8 4K 2160p HEVC AAC).mkv",
            link: "https://nekobt.to/api/v1/torrents/10834684923145/download?public%3Dtrue",
            description: '<a href="magnet:?xt=urn:btih:7VI4C7JGBEZU3HWDIVFCQBLMDB5GTIBF&amp;tr=https%3A%2F%2Ftracker.example%2Fannounce">Magnet Link</a><br />Size: 1.3GB<br />'
        }
    ]);

    assert.deepEqual(items, [
        {
            title: "[NanakoRaws] One Piece - 968 (BS8 4K 2160p HEVC AAC).mkv",
            hash: "fd51c17d2609334d9ec3454a28056c187a69a025",
            seeders: 0,
            size: "1.3GB"
        }
    ]);
});

test("parseTokyoToshoRssItems keeps hex magnet hashes from RSS descriptions", () => {
    const items = _private.parseTokyoToshoRssItems([
        {
            title: "Show - 01 [1080p].mkv",
            description: '<a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&tr=udp%3A%2F%2Ftracker.example">Magnet Link</a><br />Size: 700MB<br />'
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].hash, "0123456789abcdef0123456789abcdef01234567");
    assert.equal(items[0].size, "700MB");
});
