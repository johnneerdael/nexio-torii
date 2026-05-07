const { humanSize, humanAge, languageFlag, cacheGlyph, packEpisodes } = require("./human-format");

function formatCrossIds(c) {
    const parts = [];
    if (c.anilistId) parts.push(`anilist:${c.anilistId}`);
    if (c.malId)     parts.push(`mal:${c.malId}`);
    if (c.kitsuId)   parts.push(`kitsu:${c.kitsuId}`);
    if (c.anidbId)   parts.push(`anidb:${c.anidbId}`);
    if (c.imdbId)    parts.push(`imdb:${c.imdbId}`);
    return parts.join(" · ");
}

function formatToriiStream(enriched, base) {
    const s = enriched.source;
    const p = enriched.parsed;
    const c = enriched.canonical;
    const d = enriched.debrid;
    const m = enriched.match;

    const visualBits = [p.resolution, p.quality, p.encode].filter(Boolean);
    const visualExtras = [...p.visualTags].filter(Boolean);
    const line1 = [visualBits.join(" · "), visualExtras.join(" ")].filter(Boolean).join(" · ");

    const cacheService = d.serviceCode ? `${cacheGlyph(d.isCached)} ${d.serviceCode}` : `📡 P2P`;
    const audioPart = p.languages.length > 0 ? `🎙 ${p.languages.join("+")}` : null;
    const channelPart = p.audioChannels[0] || null;
    const subPart = p.subtitles.length > 0 ? `📝 ${p.subtitles.join(",")}` : null;
    const line2 = [cacheService, audioPart, channelPart, subPart].filter(Boolean).join(" · ");

    const nameLines = [line1 || "Unknown", line2, "⛩ Torii"];

    const descLines = [];
    const fname = d.selectedFile?.name || s.rawTitle;
    descLines.push(`📄 ${fname}`);

    const sizeParts = [];
    if (d.selectedFile?.sizeBytes) sizeParts.push(`💾 ${humanSize(d.selectedFile.sizeBytes)}`);
    else if (s.sizeBytes) sizeParts.push(`💾 ${humanSize(s.sizeBytes)}`);
    if (p.isSeasonPack && s.sizeBytes && d.selectedFile?.sizeBytes && s.sizeBytes !== d.selectedFile.sizeBytes) {
        sizeParts.push(`📦 ${humanSize(s.sizeBytes)}`);
    } else if (p.isSeasonPack && s.sizeBytes && !d.selectedFile?.sizeBytes) {
        sizeParts.push(`📦 ${humanSize(s.sizeBytes)}`);
    }
    if (Number.isFinite(s.seeders)) sizeParts.push(`👥 ${s.seeders}`);
    if (s.ageHours != null) sizeParts.push(`📅 ${humanAge(s.ageHours)}`);
    if (sizeParts.length > 0) descLines.push(sizeParts.join(" · "));

    const indexerParts = [s.indexer, p.releaseGroup, p.network].filter(Boolean);
    if (indexerParts.length > 0) descLines.push(`📡 ${indexerParts.join(" · ")}`);

    const canonLine = [
        c.englishTitle || c.mainTitle, c.year, c.format,
        c.episodeCount ? `${c.episodeCount}ep` : null
    ].filter(Boolean).join(" · ");
    if (canonLine) descLines.push(`🎬 ${canonLine}`);

    if (c.episodeTitle) descLines.push(`📺 S${c.season}E${c.episode} · "${c.episodeTitle}"`);
    if (p.isSeasonPack && p.episodeRange) descLines.push(`🌐 batch ${packEpisodes(p.episodeRange)}`);

    if (Number.isFinite(m.score)) {
        descLines.push(`🎯 ${m.confidence} (${m.score}) · ${m.reasons.join(" · ") || "match"}`);
    }
    const cross = formatCrossIds(c);
    if (cross) descLines.push(`🆔 ${cross}`);

    return {
        name: nameLines.join("\n"),
        description: descLines.join("\n"),
        url: base.url,
        behaviorHints: base.behaviorHints || {}
    };
}

module.exports = { formatToriiStream, formatCrossIds };
