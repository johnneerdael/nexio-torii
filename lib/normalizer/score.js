//===============
// Multi-axis torrent-candidate scorer with hard gates.
//
// Ported from nexio-nagare's lib/normalizer/score.js — same gates, adapted for
// torrent inputs (parsed via lib/normalizer/parse.parseTorrentTitle).
//
// Inputs:
//   canonical  = { format, year, episodeCount, mainTitle, englishTitle, altName, synonyms[] }
//                produced from getAnimeMeta(anilistId) at request time
//   candidate  = parseTorrentTitle output: { parsedTitle, year, seasons[],
//                                            episodes[], formatHint, dub }
//   opts       = { preferDub?, requestedEpisode?, expectedSeason? }
//
// Output: { score, gateFailures[], reasons[] }
//   gateFailures non-empty → REJECT this torrent before it reaches debrid
//   score      → relative ranking among survivors (currently informational)
//===============

const fuzz = require("fuzzball");
const { normalizeTitle } = require("../catalog/title-normalizer");

// Hard-gate tunables (mirrors nagare's defaults).
const YEAR_GATE_HARD_DIFF = 5;
const EP_RATIO_MIN = 0.7;
const EP_RATIO_MAX = 1.3;
const TITLE_DISTANCE_GATE_MAX = 0.4;

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = dp[j];
            dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
            prev = tmp;
        }
    }
    return dp[n];
}

function normalizedDistance(a, b) {
    const max = Math.max(a.length, b.length);
    return max === 0 ? 0 : levenshtein(a, b) / max;
}

function bestTitleRatio(candidateTitle, canonical) {
    const cand = normalizeTitle(candidateTitle);
    if (!cand) return { ratio: 0, normalizedDistance: 1, exact: false, matchedVariant: null };
    const variants = [];
    if (canonical.mainTitle)    variants.push(canonical.mainTitle);
    if (canonical.englishTitle) variants.push(canonical.englishTitle);
    if (canonical.altName && canonical.altName !== canonical.englishTitle) variants.push(canonical.altName);
    if (Array.isArray(canonical.synonyms)) variants.push(...canonical.synonyms);

    let best = { ratio: 0, normalizedDistance: 1, exact: false, matchedVariant: null };
    for (const v of variants) {
        const norm = normalizeTitle(v);
        if (!norm) continue;
        const exact = norm === cand;
        const ratio = exact ? 100 : fuzz.ratio(cand, norm);
        const nd = normalizedDistance(cand, norm);
        if (ratio > best.ratio) best = { ratio, normalizedDistance: nd, exact, matchedVariant: v };
    }
    return best;
}

//===============
// Hard gates — any failure → reject the candidate before scoring.
//===============
function formatGate(canonical, candidate) {
    const cf = String(canonical.format || "").toUpperCase();
    if (!cf) return null;
    const xf = String(candidate.formatHint || "").toUpperCase();
    if (!xf) return null;
    if (cf === "TV" && (xf === "MOVIE" || xf === "RECAP")) return `format: canonical=TV candidate=${xf}`;
    if (cf === "MOVIE" && xf !== "MOVIE") return `format: canonical=MOVIE candidate=${xf}`;
    return null;
}

function yearGate(canonical, candidate) {
    if (!Number.isFinite(canonical.year) || !Number.isFinite(candidate.year)) return null;
    const diff = Math.abs(canonical.year - candidate.year);
    if (diff >= YEAR_GATE_HARD_DIFF) return `year: canonical=${canonical.year} candidate=${candidate.year} diff=${diff}`;
    return null;
}

function titleDistanceGate(titleScore) {
    if (titleScore.normalizedDistance > TITLE_DISTANCE_GATE_MAX) {
        return `title_distance: nd=${titleScore.normalizedDistance.toFixed(2)} > ${TITLE_DISTANCE_GATE_MAX}`;
    }
    return null;
}

function recapTagGate(canonical, candidate) {
    const cf = String(canonical.format || "").toUpperCase();
    if (cf !== "TV") return null;
    const fh = String(candidate.formatHint || "").toUpperCase();
    if (fh === "RECAP") return "recap_tag: candidate has RECAP hint while canonical is TV";
    return null;
}

//===============
// Episode-count gate. For TV canonicals, when the torrent looks like a single
// short release (e.g. a 1-episode 'Recap Movie' parsed as 1 ep) and our
// canonical TV show has many episodes, this fires. We're more permissive than
// nagare's per-show ep-count gate because torrent files are per-episode by
// nature — most won't carry full-show episodeCount info — so we only fire
// when the torrent EXPLICITLY claims to be a 1-episode release while the
// canonical is a long-form TV series.
//===============
function shortReleaseGate(canonical, candidate) {
    const cf = String(canonical.format || "").toUpperCase();
    if (cf !== "TV") return null;
    if (!Number.isFinite(canonical.episodeCount) || canonical.episodeCount < 5) return null;
    const fh = String(candidate.formatHint || "").toUpperCase();
    if (fh === "MOVIE" || fh === "RECAP" || fh === "SPECIAL") {
        return `short_release: canonical TV ${canonical.episodeCount}ep vs candidate ${fh}`;
    }
    return null;
}

const GATES = [
    ["format",       formatGate],
    ["year",         yearGate],
    ["recap_tag",    recapTagGate],
    ["short_release", shortReleaseGate]
];

function scoreCandidate({ canonical, candidate, opts = {} }) {
    const titleScore = bestTitleRatio(candidate.parsedTitle, canonical);

    const gateFailures = [];
    const tdGate = titleDistanceGate(titleScore);
    if (tdGate) gateFailures.push(tdGate);
    for (const [, fn] of GATES) {
        const reason = fn(canonical, candidate);
        if (reason) gateFailures.push(reason);
    }
    if (gateFailures.length > 0) {
        return { score: 0, gateFailures, reasons: [], normalizedTitleScore: titleScore.ratio };
    }

    let score = titleScore.ratio;
    const reasons = [`title=${titleScore.ratio}/100${titleScore.exact ? " exact" : ""}`];

    if (titleScore.exact) { score += 25; reasons.push("+25 exact_title"); }

    if (Number.isFinite(canonical.year) && Number.isFinite(candidate.year)) {
        const diff = Math.abs(canonical.year - candidate.year);
        if (diff === 0) { score += 15; reasons.push("+15 year_exact"); }
        else if (diff <= 1) { score += 8; reasons.push("+8 year_close"); }
    }

    if (canonical.format && candidate.formatHint && String(canonical.format).toUpperCase() === String(candidate.formatHint).toUpperCase()) {
        score += 12; reasons.push("+12 format_match");
    }

    if (typeof opts.preferDub === "boolean" && candidate.dub !== null && opts.preferDub === Boolean(candidate.dub)) {
        score += 8; reasons.push(`+8 dub_pref(${candidate.dub ? "dub" : "sub"})`);
    }

    return { score: Math.round(score), gateFailures: [], reasons, normalizedTitleScore: titleScore.ratio };
}

module.exports = {
    scoreCandidate,
    bestTitleRatio,
    constants: { YEAR_GATE_HARD_DIFF, EP_RATIO_MIN, EP_RATIO_MAX, TITLE_DISTANCE_GATE_MAX }
};
