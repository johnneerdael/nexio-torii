const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const configurePage = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("configure page surfaces provider API key links", () => {
    [
        "https://real-debrid.com/apitoken",
        "https://torbox.app/settings",
        "https://alldebrid.com/apikeys",
        "https://premiumize.me/account",
        "https://debrid-link.com/webapp/apikey",
        "https://debrider.app/dashboard/account",
        "https://paradise-cloud.com/products/easydebrid",
        "https://offcloud.com/account",
        "https://mypikpak.com"
    ].forEach(url => {
        assert.match(configurePage, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });

    assert.match(configurePage, /class="[^"]*debrid-api-key-link[^"]*"/);
    assert.match(configurePage, /target="_blank"/);
    assert.match(configurePage, /rel="noopener noreferrer"/);
    assert.match(configurePage, /Get key/);
});
