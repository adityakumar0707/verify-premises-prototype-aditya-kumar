# Loans24 — Premises Verification Prototype

Clickable prototype of the Residential-premises verification flow locked in
**The Build List** (RICE-prioritized Phase 1 scope). Plain HTML/CSS/JS, no
build step, no framework.

## Run it

```
python3 -m http.server 4173
```

Open `http://localhost:4173`. Grant camera/location permission when prompted
— both are used for real (live camera preview, live `navigator.geolocation`
read); everything upstream of that (bureau/Aadhaar/telecom/GSTIN calls) is
mocked, since this is a design prototype, not a wired-up backend.

## What's real vs. mocked

| Real | Mocked |
|---|---|
| Screen flow, state machine, routing logic | Bureau / Aadhaar / Telecom / GSTIN API calls (`js/mock-data.js`) |
| Address-normalization + agreement scoring (`js/engine.js`) | OCR / liveness verdict (scenario-driven, not a real CV model) |
| Live camera capture (`getUserMedia`, no gallery upload) | Device-integrity flag (scenario-driven, not a real Play Integrity call) |
| Live one-time geolocation read | Geofence pass/fail (scenario-driven — this dev box isn't at any of the demo addresses) |

## Files

- `js/engine.js` — the decision engine: tenure-weighted source agreement,
  Clear / Step-up / Decline routing, structured rule-trace log. This is the
  piece three rounds of design review were actually about; everything else
  is UI around it.
- `js/mock-data.js` — four demo scenarios (thick-file, thin-file,
  conflicting-records, spoofed-capture) standing in for real source calls.
- `js/app.js` — screens, state, and the real browser API integrations.
- `css/styles.css`, `index.html` — presentation shell.

## Demo scenarios

Switch scenarios from the picker in the top-right (reload triggered
automatically). Each is designed to hit a different lane:

- **Salaried · thick file** → Clear, no capture (2 sources agree)
- **New-to-credit · thin file** → Step-up → Clear (real geo + camera capture)
- **Conflicting records** → Decline, before any capture is even asked for
- **Thin file · spoofed capture** → Step-up → Decline (device-integrity flag)

## Scope

Residential premises type only (salaried, WFH, self-employed-without-
storefront) — the Business/storefront path is a deliberate Phase 2 stub.
No localization. See `The Build List` and `Corroboration-First
Verification` for why.
