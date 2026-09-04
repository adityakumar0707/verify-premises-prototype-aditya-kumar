// engine.js — the one decision that matters: did live capture confirm the
// applicant is genuinely, currently at the declared premises. Verified
// identity (Aadhaar) and verified contact details (email) establish who
// someone is and how to reach them; neither proves where they currently
// live or work, so this is never skipped, only ever pass or fail.

export function routeFromCapture({ geofenceOk, ocrLivenessOk, mockLocationFlag }) {
  if (mockLocationFlag) {
    return { lane: 'decline', reason: 'device-integrity check flagged a mock or spoofed location provider' };
  }
  if (geofenceOk && ocrLivenessOk) {
    return { lane: 'clear', reason: 'live capture confirms presence at the declared premises' };
  }
  return {
    lane: 'decline',
    reason: !geofenceOk
      ? 'captured location falls outside the declared address radius'
      : "capture didn't pass the OCR/liveness check",
  };
}
