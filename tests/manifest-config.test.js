const test = require("node:test");
const assert = require("node:assert/strict");

const { configuredManifest, manifest } = require("../addon");
const { encodeConfigPayload } = require("../lib/config");

test("configuredManifest keeps search catalogs by default", () => {
    const out = configuredManifest({});
    assert.equal(out.catalogs.filter(cat => cat.id === "nexio_search").length, 3);
});

test("configuredManifest removes search catalogs when disabled", () => {
    const payload = encodeConfigPayload({ showSearchCatalog: false });
    const out = configuredManifest({ NexioTorii: payload });
    assert.equal(out.catalogs.some(cat => cat.id === "nexio_search"), false);
    assert.equal(manifest.catalogs.some(cat => cat.id === "nexio_search"), true);
});
