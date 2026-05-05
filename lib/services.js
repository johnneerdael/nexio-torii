const SUPPORTED_DEBRID_SERVICES = Object.freeze({
    realdebrid: Object.freeze({ code: "RD", displayName: "RealDebrid", apiKeyUrl: "https://real-debrid.com/apitoken", helpText: "API token" }),
    torbox: Object.freeze({ code: "TB", displayName: "TorBox", apiKeyUrl: "https://torbox.app/settings", helpText: "API key" }),
    alldebrid: Object.freeze({ code: "AD", displayName: "AllDebrid", apiKeyUrl: "https://alldebrid.com/apikeys", helpText: "API key" }),
    premiumize: Object.freeze({ code: "PM", displayName: "Premiumize", apiKeyUrl: "https://premiumize.me/account", helpText: "API key" }),
    debridlink: Object.freeze({ code: "DL", displayName: "Debrid-Link", apiKeyUrl: "https://debrid-link.com/webapp/apikey", helpText: "API key" }),
    debrider: Object.freeze({ code: "DB", displayName: "Debrider", apiKeyUrl: "https://debrider.app/dashboard/account", helpText: "API key" }),
    easydebrid: Object.freeze({ code: "ED", displayName: "EasyDebrid", apiKeyUrl: "https://paradise-cloud.com/products/easydebrid", helpText: "API key" }),
    offcloud: Object.freeze({ code: "OC", displayName: "Offcloud", apiKeyUrl: "https://offcloud.com/account", helpText: "Email:password or API key accepted by StremThru" }),
    pikpak: Object.freeze({ code: "PP", displayName: "PikPak", apiKeyUrl: "https://mypikpak.com", helpText: "Email:password accepted by StremThru" })
});

function normalizeServiceName(service) {
    return String(service || "").trim().toLowerCase().replace(/[-_\s]/g, "");
}

function isSupportedService(service) {
    return Object.prototype.hasOwnProperty.call(SUPPORTED_DEBRID_SERVICES, normalizeServiceName(service));
}

function getServiceInfo(service) {
    return SUPPORTED_DEBRID_SERVICES[normalizeServiceName(service)] || null;
}

function getServiceCode(service) {
    const info = getServiceInfo(service);
    return info ? info.code : "";
}

function getServiceDisplayName(service) {
    const info = getServiceInfo(service);
    return info ? info.displayName : String(service || "");
}

function normalizeDebridServices(value) {
    if (!Array.isArray(value)) return [];

    return value.reduce((entries, item) => {
        if (!item || typeof item !== "object") return entries;

        const service = normalizeServiceName(item.service);
        const apiKey = String(item.apiKey || "").trim();

        if (!service || !apiKey || !isSupportedService(service)) return entries;
        entries.push({ service, apiKey });
        return entries;
    }, []);
}

function isOffcloud(service) {
    return normalizeServiceName(service) === "offcloud";
}

module.exports = {
    SUPPORTED_DEBRID_SERVICES,
    getServiceCode,
    getServiceDisplayName,
    getServiceInfo,
    isOffcloud,
    isSupportedService,
    normalizeDebridServices,
    normalizeServiceName
};
