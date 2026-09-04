# Loans24 — Premises Verification Prototype

Clickable prototype of the Residential-premises verification flow. Plain
HTML/CSS/JS, no build step, no framework, and fully simulated: no camera or
location permission is ever requested, so it never blocks on a browser or
OS prompt.

## Run it

```
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## The flow, and why it's ordered this way

1. **Aadhaar number → one OTP.** The code goes to the mobile number UIDAI
   already has on file for that Aadhaar, so verifying it confirms two
   things at once: this is a real Aadhaar identity, and the applicant
   controls the phone linked to it. No separate "enter and verify a mobile
   number" step.
2. **Work classification** (Employed / Shop owner / Self-employed) right
   after identity, before anything else needs it.
3. **Email verification**, personal always and office email too if
   Employed, each with its own inline verify-by-OTP control on one screen.
   Office email is mandatory for that persona, not skippable: it's the
   contact channel that stays reachable if the home address stops being
   accurate.
4. **PAN** for the eligibility/bureau pull.
5. **Profile confirmation**: permanent address comes directly from
   Aadhaar (fetched once, not re-verified against itself later). A
   same-as-permanent checkbox asks the one question Aadhaar can't answer
   on its own — do you still live there — and reveals an editable current
   address when unchecked.
6. **Live capture, mandatory for everyone.** A verified identity and
   verified contact details establish who someone is and how to reach
   them; neither proves where they currently live or work, so a live
   location + photo check always runs, never conditionally skipped.

There is no separate corroboration source (no telecom-KYC-style lookup)
standing in for that last step — capture is the proof, not a fallback for
when something else couldn't provide it.

## What's real vs. mocked

| Real | Mocked |
|---|---|
| Screen flow, state machine, routing logic | Aadhaar / bureau lookups (`js/mock-data.js`) |
| Decision logic for the capture verdict (`js/engine.js`) | The capture verdict itself (geofence/liveness/OCR are simulated, scenario-driven) |
| Inline per-field email OTP verification UI | Actual email/SMS delivery |

## Files

- `js/engine.js` — the one real decision: did live capture confirm the
  applicant is genuinely at the declared premises. Everything else is UI
  around it.
- `js/mock-data.js` — three demo scenarios standing in for Aadhaar/bureau
  responses.
- `js/app.js` — screens, state, and the input-handling pattern (see below).
- `js/icons.js` — small hand-drawn icon set (no external icon library).
- `css/styles.css`, `index.html` — presentation shell.

## A bug worth documenting

Text inputs kept losing focus mid-keystroke, forcing a re-tap between
characters. Root cause: the OTP resend countdown called a full re-render
every second, which recreates the input's DOM node while the user might be
mid-keystroke. Fixed by never calling `render()` from anything that can
fire while an input might have focus — `bindInput()` updates state and
toggles button state directly against existing DOM nodes, and the resend
timer mutates its own button's text directly instead of re-rendering the
screen. Covered by a test that types with 900ms gaps specifically to cross
multiple timer ticks mid-entry, since fast automated typing never
exercised the collision.

## UX choices worth noting

- **Nothing is a dead end.** A decline always offers a real next step,
  retry the live check or reach support, never just "start over."
- **Permission-free by design.** No `getUserMedia` or `geolocation` calls
  anywhere; the location and camera steps are simulated timers so the demo
  never depends on what a browser or OS permission dialog does.
- **The capture step gives live feedback** (simulated) instead of a
  silent shutter button.
- **Back navigation** is available anywhere it's safe to go back.

## Demo scenarios

Switch scenarios from the picker in the top-right (reload triggered
automatically):

- **Has not moved, capture succeeds** → Clear
- **Just moved, capture succeeds** → Clear (exercises the current-address
  edit path)
- **Capture not confirmed** → Decline, with a working retry and a support
  path

## Scope

Residential premises type only (Employed, Self-employed-without-
storefront) — the Business/storefront path is a deliberate stub. No
localization.
