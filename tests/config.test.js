const test = require("node:test");
const assert = require("node:assert/strict");

const {
    SUPPORTED_DEBRID_SERVICES,
    getServiceCode,
    normalizeDebridServices
} = require("../lib/services");
const {
    encodeConfigPayload,
    fromBase64Safe,
    normalizeConfig,
    parseConfig,
    toBase64Safe
} = require("../lib/config");

test("service registry contains the recommended StremThru stores", () => {
    assert.deepEqual(Object.keys(SUPPORTED_DEBRID_SERVICES), [
        "realdebrid",
        "torbox",
        "alldebrid",
        "premiumize",
        "debridlink",
        "debrider",
        "easydebrid",
        "offcloud",
        "pikpak"
    ]);
    assert.equal(getServiceCode("premiumize"), "PM");
    assert.equal(getServiceCode("debridlink"), "DL");
});

test("normalizeDebridServices drops malformed entries and keeps duplicates", () => {
    const entries = normalizeDebridServices([
        { service: " RealDebrid ", apiKey: " rd-key " },
        { service: "premiumize", apiKey: "pm-key" },
        { service: "premiumize", apiKey: "second-pm-key" },
        { service: "stremthru", apiKey: "excluded" },
        { service: "torbox", apiKey: "" },
        { service: "", apiKey: "missing-service" },
        null
    ]);

    assert.deepEqual(entries, [
        { service: "realdebrid", apiKey: "rd-key" },
        { service: "premiumize", apiKey: "pm-key" },
        { service: "premiumize", apiKey: "second-pm-key" }
    ]);
});

test("parseConfig decodes Amatsu payload and normalizes greenfield config", () => {
    const raw = {
        debridServices: [
            { service: "torbox", apiKey: "tb-key" },
            { service: "pikpak", apiKey: "pp-key" }
        ],
        enableP2P: true,
        hideUncached: true,
        language: ["ENG", "JPN"],
        resolutions: ["1080p"]
    };
    const payload = encodeConfigPayload(raw);
    const parsed = parseConfig({ Amatsu: payload });

    assert.deepEqual(parsed.debridServices, raw.debridServices);
    assert.equal(parsed.enableP2P, true);
    assert.equal(parsed.hideUncached, true);
    assert.deepEqual(parsed.language, ["ENG", "JPN"]);
    assert.deepEqual(parsed.resolutions, ["1080p"]);
});

test("normalizeConfig removes legacy rdKey and tbKey", () => {
    const normalized = normalizeConfig({
        rdKey: "legacy-rd",
        tbKey: "legacy-tb",
        debridServices: [{ service: "alldebrid", apiKey: "ad-key" }]
    });

    assert.deepEqual(normalized.debridServices, [
        { service: "alldebrid", apiKey: "ad-key" }
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, "rdKey"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, "tbKey"), false);
});

test("base64 helpers round trip URL-safe payloads", () => {
    const encoded = toBase64Safe(JSON.stringify({ key: "a/b+c=" }));
    assert.equal(encoded.includes("+"), false);
    assert.equal(encoded.includes("/"), false);
    assert.equal(encoded.includes("="), false);
    assert.equal(fromBase64Safe(encoded), JSON.stringify({ key: "a/b+c=" }));
});
