// engine.js — corroboration + lane-routing decision engine.
//
// This is the piece three rounds of review were about: tenure-weighted,
// multi-source agreement decides Clear / Step-up / Decline. No single
// source — including a live capture — is ever trusted alone.
// See "The Build List" categories 01, 02, 05, 06 for why each rule exists.

export const MIN_TENURE_MONTHS = 3;   // a source younger than this doesn't count toward agreement
export const SOURCES_FOR_CLEAR = 2;   // independent, tenure-qualified sources needed to skip capture
export const MATCH_THRESHOLD = 0.5;   // Jaccard token overlap counted as "same address"

// Stand-in for the LLM-based address normalizer (Build List, category 02).
// Same contract a production model call would have: free-text address in,
// a comparable token set out. Naive exact-string matching is what this
// replaces — see the "would have failed" trace note below for why that
// matters on real Indian address formats.
const ABBREV = {
  'h.no': 'house number', 'h no': 'house number', 'hno': 'house number',
  'apt': 'apartment', 'apts': 'apartment', 'appt': 'apartment',
  'sec': 'sector', 'nr': 'near', 'rd': 'road', 'st': 'street',
  'flr': 'floor', 'blk': 'block', 'soc': 'society', 'colny': 'colony',
};

export function normalizeAddress(raw) {
  let s = ` ${raw.toLowerCase().replace(/[.,#-]/g, ' ')} `;
  for (const [k, v] of Object.entries(ABBREV)) {
    s = s.replace(new RegExp(`\\b${k.replace('.', '\\.')}\\b`, 'g'), v);
  }
  const stop = new Set(['the', 'a', 'an', 'of', 'and']);
  return s.split(/\s+/).filter((t) => t && !stop.has(t)).sort();
}

export function addressSimilarity(a, b) {
  const ta = new Set(normalizeAddress(a));
  const tb = new Set(normalizeAddress(b));
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

function exactMatch(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * sources: [{ name, address, tenureMonths }]
 * Returns agreeCount/conflictCount plus a human-readable trace — this trace
 * IS the structured audit log from Build List category 06, not a demo prop.
 */
export function scoreCorroboration(declaredAddress, sources) {
  const trace = [];
  let agreeCount = 0;
  let conflictCount = 0;

  for (const src of sources) {
    const sim = addressSimilarity(declaredAddress, src.address);
    const addressMatches = sim >= MATCH_THRESHOLD;
    const tenureOk = src.tenureMonths >= MIN_TENURE_MONTHS;

    if (addressMatches && tenureOk) {
      agreeCount++;
      trace.push({
        source: src.name, result: 'agree', tenureMonths: src.tenureMonths,
        detail: exactMatch(declaredAddress, src.address)
          ? 'exact string match'
          : `matched via normalization (${Math.round(sim * 100)}% token overlap) — exact string match would have failed`,
      });
    } else if (addressMatches && !tenureOk) {
      trace.push({
        source: src.name, result: 'too-fresh', tenureMonths: src.tenureMonths,
        detail: `address matches but only ${src.tenureMonths}mo on file — below the ${MIN_TENURE_MONTHS}mo minimum, doesn't count toward agreement`,
      });
    } else {
      conflictCount++;
      trace.push({
        source: src.name, result: 'conflict', tenureMonths: src.tenureMonths,
        detail: `on-file address doesn't match declared address (${Math.round(sim * 100)}% overlap)`,
      });
    }
  }

  return { agreeCount, conflictCount, sourcesChecked: sources.length, trace };
}

export function routeFromCorroboration({ agreeCount, conflictCount }) {
  if (conflictCount >= 2) {
    return {
      lane: 'decline',
      reason: `${conflictCount} independent sources agree with each other on an address that isn't the declared one`,
    };
  }
  if (agreeCount >= SOURCES_FOR_CLEAR) {
    return {
      lane: 'clear',
      reason: `${agreeCount} independent, tenure-qualified sources agree with the declared address`,
    };
  }
  return {
    lane: 'stepup',
    reason: agreeCount === 1
      ? 'one source agrees — not enough alone, live capture can confirm the rest'
      : 'not enough independent history yet — live capture is the only signal available',
  };
}

/**
 * Step-up capture verdict. geofenceOk/ocrLivenessOk are the OCR+liveness
 * pipeline outcome; mockLocationFlag is the device-integrity check
 * (Build List 04) — it overrides everything else, same as a real
 * Play Integrity / mock-location-provider flag would.
 */
export function routeFromCapture({ geofenceOk, ocrLivenessOk, mockLocationFlag }) {
  if (mockLocationFlag) {
    return { lane: 'decline', reason: 'device-integrity check flagged a mock or spoofed location provider' };
  }
  if (geofenceOk && ocrLivenessOk) {
    return { lane: 'stepup-clear', reason: 'live capture confirms presence at the declared premises' };
  }
  return {
    lane: 'decline',
    reason: !geofenceOk
      ? 'captured location falls outside the declared address radius'
      : "capture didn't pass the OCR/liveness check",
  };
}
