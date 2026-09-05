# Loans24 — Verification Prototype

Clickable prototype of the full loan-verification flow: identity, CIBIL and
income, home address, and office or business address. Plain HTML/CSS/JS, no
build step, no framework, and fully simulated: no camera or location
permission is ever requested, so it never blocks on a browser or OS prompt.

## Run it

```
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Why the flow is built this way

The whole design turns on one asymmetry: some facts about an applicant have
a genuinely independent government or registry record behind them, and some
don't. Where one exists, we check it automatically and never ask for a
live photo. Where it doesn't, only a live check can actually confirm
presence, so we ask for exactly one, and only when the loan size justifies
the friction.

That also caps how many places an applicant can be asked to physically be
at once. Home is the one live check a large loan always asks for. Office
and business address never add a second unconditional one on top of it:
their automated check (a maps lookup, or GSTIN and business PAN derived
from the applicant's own PAN) runs first regardless of loan size, and a
live photo is only asked for as a fallback if that check fails. A
high-ticket applicant is never required to prove they're at their home and
their office in the same sitting.

1. **Loan amount, first.** Everything downstream (whether a live capture is
   ever asked for at all) depends on this, so we ask before anything else.
   Above ₹5,00,000 is the "large" tier. Large-tier applicants immediately
   see one screen listing everything extra that tier requires (a selfie,
   home photos, office or shop photos), so it's said once, upfront, never
   repeated as a surprise at each individual step.
2. **Aadhaar number → one OTP.** The code goes to the mobile number UIDAI
   already has on file for that Aadhaar, so verifying it confirms two
   things at once: this is a real Aadhaar identity, and the applicant
   controls the phone linked to it. Large-tier loans add one more step
   here: a selfie matched against the Aadhaar photo. This is mandatory at
   this tier, not a skippable extra, so there is no "do this later" option
   on any of the tier's live checks.
3. **Persona**: Salaried, Self Employed, or Business Owner. Self Employed
   gets one follow-up (GST registration or not), since that decides how
   their business address gets confirmed later, not whether it does.
4. **Email verification**: personal always, office email too if Salaried,
   each with its own inline verify-by-OTP control.
5. **CIBIL and income**: a soft PAN pull, then pick which linked bank
   account your income settles into. Self Employed and Business Owner
   personas add one more automatic pull (IT returns or GST returns).
6. **Home address.** Same-as-Aadhaar or not (pincode-autofill if not), then
   how you hold it: self-owned checks against a government property
   record, family-owned is taken as self-declared, rented sends an
   automated confirmation link to the landlord (no manual call, this is a
   self-serve yes/no, never a human phone call). Only on a large loan does
   this add a live check on top, and only after the ownership check itself
   has already passed.
7. **Office address** (Salaried) or **business address** (Business Owner,
   or Self Employed with GST). Office address is entered as separate
   building, floor, and unit fields plus a pincode that auto-fills city
   and state, then validated in real time like a maps lookup. Business
   address is found automatically using the PAN already entered at the
   credit-check step (a GSTIN is derived from its owner's PAN, so no
   separate GSTIN entry is needed) and confirmed against it in the
   background. Both run at any loan size and, when they pass, that's the
   end of it, no photo either way. Only when the automated check fails
   does it fall back to one live photo (office entrance, or shop front),
   and EPFO / salary-account matches are shown as background bonuses on
   the office side that never block the outcome either way. Self Employed
   without GST skips this step entirely, the home address result stands
   alone.

Every live check (selfie, home, and a fallback office/business one) takes
two photos, rear camera on the place and front camera on the applicant
with it visible behind them, plus location. Location is asked for once,
the first time any check needs it, and silently reused for every check
after that; it is never asked for a second time in the same application.

There is no step that leans on telecom or bank KYC as a stand-in for an
independent check: in India that KYC is itself mostly Aadhaar-derived, so
it would just be re-confirming the same fact rather than a second,
independent one.

## What's real vs. mocked

| Real | Mocked |
|---|---|
| Screen flow, state machine, routing logic | Aadhaar / bureau / registry lookups (`js/mock-data.js`) |
| Decision logic for every check (`js/engine.js`) | The check outcomes themselves (reviewer-controlled toggles) |
| Inline per-field email OTP verification UI | Actual email/SMS delivery |
| Real-time office-address validation UX | The actual maps/geocoding lookup |

## Files

- `js/engine.js` — the decision rules: loan tiering, and the one fact each
  address check turns on (a property record, a landlord's confirmation,
  uploaded registration documents). Sequencing lives in `app.js`, this file
  only answers pass or fail for a given fact.
- `js/mock-data.js` — profile, bank accounts, business registry, pincode
  lookup, and the six background-check toggles.
- `js/app.js` — screens, state, and the input-handling pattern (see below).
- `js/icons.js` — small hand-drawn icon set (no external icon library).
- `css/styles.css`, `index.html` — presentation shell.

## Demo controls

The panel in the top corner holds six toggles standing in for backend
checks a real server would run, all defaulting to true so the default
click-through is a full happy path with no live photos needed at all
beyond a large-tier selfie and home check:

- Property record matches (self-owned homes)
- Landlord confirms tenancy (rented homes)
- Live capture succeeds (shared by every live check: selfie, home, and
  the office/business fallback)
- GSTIN + business PAN valid (the automatic business-address check; turn
  this off to see the live-shop-photo fallback trigger)
- EPFO record available (office-address bonus line, never gates anything)
- Office address validates on the map (turn this off to see the
  live-office-photo fallback trigger)

Everything else, loan amount, persona, ownership, and the office-address
fields, comes from real interaction with the UI, not a pre-baked scenario.

## Bugs worth documenting

- **OTP input losing focus mid-keystroke.** Root cause: the OTP resend
  countdown called a full re-render every second, recreating the input's
  DOM node while the user might be mid-keystroke. Fixed by never calling
  `render()` from anything that can fire while an input might have focus:
  `bindInput()` updates state and toggles button state directly against
  existing DOM nodes, and the resend timer mutates its own button's text
  directly instead of re-rendering the screen. Covered by a test that
  types with 900ms gaps specifically to cross multiple timer ticks
  mid-entry, since fast automated typing never exercised the collision.
- **Checklist rows invisible.** `.check-row` (used by every animated
  checklist: bureau, home-ownership, capture, and the office-address bonus
  panel) referenced a `row-in` animation that was never defined anywhere
  in the stylesheet, so every row sat at `opacity:0` permanently. Fixed by
  adding the missing keyframe.

## UX choices worth noting

- **Nothing is a dead end.** A decline always offers a real next step:
  retry with a corrected answer, or reach support.
- **Permission-free by design.** No `getUserMedia` or `geolocation` calls
  anywhere; location and camera steps are simulated timers so the demo
  never depends on what a browser or OS permission dialog does.
- **Large-tier live checks are explained once, upfront.** The tier-notice
  screen lists everything extra up front so no individual step needs to
  re-justify itself; those checks are then mandatory, not skippable, so
  there's no "do this later" escape hatch to maintain or exploit.
- **Back navigation** is available anywhere it's safe to go back.

## Scope

No localization. The business-registry pull (GSTIN/Udyam) and the
property-record and EPFO lookups are simulated as always finding a
record; only the pass/fail outcome downstream of them is toggle-driven.
