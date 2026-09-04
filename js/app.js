import { DEMO_SCENARIOS, BUREAU_LATENCY_MS, SOURCE_CHECK_LATENCY_MS } from './mock-data.js';
import { scoreCorroboration, routeFromCorroboration, routeFromCapture } from './engine.js';
import { ICONS } from './icons.js';

// ---- state -----------------------------------------------------------
const state = {
  screen: 'welcome',
  history: [],
  scenarioKey: 'thick_file',
  mobile: '', otp: '', pan: '',
  resendIn: 0, resendTimer: null,
  setupType: null,
  workEmail: '', workEmailVerified: null,
  declaredAddressOverride: null, editingAddress: false, addressDraft: '',
  corroboration: null, routeDecision: null,
  geo: null, geoError: null,
  captureVerdict: null, captureRouteDecision: null,
  cameraReady: false, capturing: false,
  stream: null,
  traceOpen: false,
};

const scenario = () => DEMO_SCENARIOS[state.scenarioKey];
const declaredAddress = () => state.declaredAddressOverride ?? scenario().profile.declaredAddress;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = document.getElementById('screen-root');
const topbarEl = document.getElementById('topbar');

// screens a "back" tap should skip over (transient/computed states)
const TRANSIENT = new Set(['bureau-loading', 'checking', 'stepup-checking']);

function goto(screen, { replace = false } = {}) {
  if (!replace && state.screen !== screen) state.history.push(state.screen);
  state.screen = screen;
  render();
}
function goBack() {
  let prev = state.history.pop();
  while (prev && TRANSIENT.has(prev)) prev = state.history.pop();
  if (prev) { state.screen = prev; render(); }
}

// ---- demo panel (reviewer tool — not part of the customer product) ----
function renderDemoPanel() {
  const panel = document.getElementById('demo-panel');
  panel.innerHTML = `
    <div class="dt">Demo scenario (reviewer only)</div>
    <select id="scenario-select">
      ${Object.entries(DEMO_SCENARIOS).map(([k, s]) =>
        `<option value="${k}" ${k === state.scenarioKey ? 'selected' : ''}>${s.label}</option>`).join('')}
    </select>
    <div class="exp">Expected result: ${scenario().expect}</div>
  `;
  document.getElementById('scenario-select').addEventListener('change', (e) => {
    state.scenarioKey = e.target.value;
    resetFlow();
  });
}

function resetFlow() {
  clearInterval(state.resendTimer);
  stopStream();
  Object.assign(state, {
    screen: 'welcome', history: [],
    mobile: '', otp: '', pan: '', resendIn: 0, resendTimer: null,
    setupType: null, workEmail: '', workEmailVerified: null,
    declaredAddressOverride: null, editingAddress: false, addressDraft: '',
    corroboration: null, routeDecision: null,
    geo: null, geoError: null,
    captureVerdict: null, captureRouteDecision: null,
    cameraReady: false, capturing: false, stream: null, traceOpen: false,
  });
  render();
}

function stopStream() {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
}

// ---- topbar (back + progress) ------------------------------------------
const STAGE_OF = {
  welcome: 0, mobile: 1, otp: 1, pan: 1, 'bureau-loading': 1, profile: 1,
  setup: 2, 'business-stub': 2, 'work-email': 2,
  checking: 3, 'stepup-intro': 3, 'stepup-geo': 3, 'stepup-camera': 3, 'stepup-checking': 3,
  'outcome-clear': 4, 'outcome-stepup-clear': 4, 'outcome-decline': 4, 'support-stub': 4,
};
const STAGE_LABELS = ['', 'Identity check', 'Setup', 'Verification', 'Done'];
const NO_BACK = new Set(['welcome', 'bureau-loading', 'checking', 'stepup-checking', 'outcome-clear', 'outcome-stepup-clear', 'outcome-decline']);

function renderTopbar() {
  const stage = STAGE_OF[state.screen] ?? 0;
  const canBack = !NO_BACK.has(state.screen) && state.history.length > 0;
  topbarEl.innerHTML = `
    ${canBack ? `<button class="back-btn" id="back-btn" aria-label="Back">${ICONS.chevronLeft}</button>` : (stage > 0 ? '<span class="back-spacer"></span>' : '')}
    ${stage > 0 ? `
      <div class="progress-wrap">
        <div class="progress-track">
          ${[1, 2, 3, 4].map((i) => `<div class="progress-seg ${i <= stage ? 'done' : ''}"><span class="fill"></span></div>`).join('')}
        </div>
        <div class="progress-label">${STAGE_LABELS[stage]}</div>
      </div>` : ''}
  `;
  document.getElementById('back-btn')?.addEventListener('click', goBack);
}

// ---- screens ------------------------------------------------------------
const screens = {
  welcome() {
    return `
      <div class="center" style="margin:auto 0;">
        <div class="hero-icon">${ICONS.home}</div>
        <h1 class="screen-title">Let's verify where you live or work</h1>
        <p class="screen-sub">Most people finish in under two minutes — right from your phone, no paperwork, no one visiting your door.</p>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="mobile">Get started</button></div>
    `;
  },

  mobile() {
    return `
      <span class="eyebrow">${ICONS.phone} Step 1 of 3</span>
      <h1 class="screen-title">First, let's confirm it's you</h1>
      <p class="screen-sub">We'll text a quick code to your phone.</p>
      <label for="mobile-input">Mobile number</label>
      <input id="mobile-input" type="tel" placeholder="98765 43210" value="${state.mobile}" maxlength="10" autocomplete="tel">
      <div class="value-nudge">${ICONS.lock} Just to confirm it's really you — we won't call or spam you.</div>
      <div class="btn-row"><button class="btn btn-primary" id="send-otp" ${state.mobile.length === 10 ? '' : 'disabled'}>Send code</button></div>
    `;
  },

  otp() {
    return `
      <span class="eyebrow">${ICONS.phone} Step 1 of 3</span>
      <h1 class="screen-title">Enter the code we sent</h1>
      <p class="screen-sub">Sent to +91 ${state.mobile}. <span class="mono">(Demo — any 6 digits work)</span></p>
      <input id="otp-input" class="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="——————" value="${state.otp}" autocomplete="one-time-code">
      <div class="btn-row">
        <button class="btn btn-primary" id="verify-otp" ${state.otp.length === 6 ? '' : 'disabled'}>
          ${state.verifying ? '<span class="spin"></span>' : 'Verify'}
        </button>
        <button class="link-btn ${state.resendIn > 0 ? 'muted' : ''}" id="resend-otp" ${state.resendIn > 0 ? 'disabled' : ''}>
          ${state.resendIn > 0 ? `Resend code in 0:${String(state.resendIn).padStart(2, '0')}` : 'Resend code'}
        </button>
      </div>
    `;
  },

  pan() {
    return `
      <span class="eyebrow">${ICONS.bank} Step 2 of 3</span>
      <h1 class="screen-title">Let's see what you're eligible for</h1>
      <p class="screen-sub">Enter your PAN — this is a soft check and never affects your credit score.</p>
      <input id="pan-input" type="text" placeholder="ABCDE1234F" maxlength="10" style="text-transform:uppercase" value="${state.pan}">
      <div class="btn-row"><button class="btn btn-primary" id="pull-bureau" ${state.pan.length === 10 ? '' : 'disabled'}>Check my offer</button></div>
    `;
  },

  'bureau-loading'() {
    return `
      <div class="loading-wrap">
        <div class="ring"><svg viewBox="0 0 54 54"><circle class="track" cx="27" cy="27" r="24"/><circle class="head" cx="27" cy="27" r="24"/></svg></div>
        <p class="loading-text">Looking up your details…</p>
      </div>
    `;
  },

  profile() {
    const p = scenario().profile;
    if (state.editingAddress) {
      return `
        <span class="eyebrow">${ICONS.bank} Step 2 of 3</span>
        <h1 class="screen-title">Update your address</h1>
        <p class="screen-sub">We'll use this instead of the one on file.</p>
        <div class="inline-edit">
          <input id="address-draft" type="text" value="${state.addressDraft}">
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="save-address">Save</button>
          <button class="link-btn muted" id="cancel-address">Cancel</button>
        </div>
      `;
    }
    return `
      <span class="eyebrow">${ICONS.bank} Step 2 of 3</span>
      <h1 class="screen-title">Good news — we found your details</h1>
      <p class="screen-sub">Pulled securely from your credit record. No documents to upload.</p>
      <div class="profile-card">
        <div class="profile-row"><span class="k">Name</span><span class="v">${p.name}</span></div>
        <div class="profile-row"><span class="k">Date of birth</span><span class="v">${p.dob}</span></div>
        <div class="profile-row"><span class="k">Address</span><span class="v">${declaredAddress()}</span></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" data-go="setup">Yes, that's correct</button>
        <button class="link-btn muted" id="edit-address">That's not quite right</button>
      </div>
    `;
  },

  setup() {
    const options = [
      { id: 'salaried', t: 'Office worker (salaried)', s: 'I work at a company or corporate site' },
      { id: 'shop', t: 'Shop / store owner', s: 'I run a retail shop or business outlet' },
      { id: 'wfh', t: 'Work from home / remote', s: 'I work from my home desk or a shared setup' },
      { id: 'selfemployed', t: 'Self-employed, no storefront', s: 'Freelancer, consultant, or home-based practice' },
    ];
    return `
      <span class="eyebrow">${ICONS.home} Step 3 of 3</span>
      <h1 class="screen-title">Where do you work from?</h1>
      <p class="screen-sub">This decides what we ask for next — nothing more than we need.</p>
      ${options.map((o) => `
        <div class="radio-card ${state.setupType === o.id ? 'selected' : ''}" data-setup="${o.id}">
          <div class="dot"></div>
          <div><div class="rt">${o.t}</div><div class="rs">${o.s}</div></div>
        </div>`).join('')}
      <div class="btn-row"><button class="btn btn-primary" id="continue-setup" ${state.setupType ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'business-stub'() {
    return `
      <div class="center" style="margin:auto 0;">
        <div class="hero-icon">${ICONS.clock}</div>
        <h1 class="screen-title">Almost there for shop owners</h1>
        <p class="screen-sub">Business verification isn't live in this preview yet — we're finishing it next. Try the salaried, remote, or self-employed path to see the full journey.</p>
      </div>
      <div class="btn-row"><button class="btn btn-secondary" data-go="setup">← Choose a different option</button></div>
    `;
  },

  'work-email'() {
    return `
      <span class="eyebrow">${ICONS.mail} Optional</span>
      <h1 class="screen-title">Have a work email?</h1>
      <p class="screen-sub">Adding it can help you skip extra steps later — it's optional, and never a requirement.</p>
      <input id="email-input" type="email" placeholder="you@company.com" value="${state.workEmail}">
      <div class="btn-row">
        <button class="btn btn-primary" id="check-email" ${state.workEmail.includes('@') ? '' : 'disabled'}>
          ${state.checkingEmail ? '<span class="spin"></span>' : 'Add work email'}
        </button>
        <button class="link-btn muted" data-go="checking">Skip for now</button>
      </div>
    `;
  },

  checking() {
    return `
      <div style="margin-top:12px;">
        <h1 class="screen-title">Checking your address</h1>
        <p class="screen-sub">Comparing a few records that already know you — no photo needed yet.</p>
        <div id="check-list"></div>
      </div>
    `;
  },

  'outcome-clear'() {
    return outcomeMarkup({
      tone: 'success',
      headline: "You're verified",
      sub: 'We matched your address across trusted records — no photos or visits needed.',
      cta: 'See my loan offer',
      celebrate: true,
    });
  },

  'stepup-intro'() {
    return `
      <div style="margin-top:6px;">
        <div class="hero-icon">${ICONS.shield}</div>
        <h1 class="screen-title">One quick check left</h1>
        <p class="screen-sub">We didn't find enough matching records yet — a live photo and location check finishes this in about 30 seconds.</p>
        <div class="reassure-list">
          <div class="reassure-item"><div class="reassure-icon">${ICONS.pin}</div><div class="reassure-text"><div class="rt">Used once</div><div class="rs">We check your location only for this step — nothing is tracked afterward.</div></div></div>
          <div class="reassure-item"><div class="reassure-icon">${ICONS.lock}</div><div class="reassure-text"><div class="rt">Kept secure</div><div class="rs">Your photo is encrypted and used only to verify this application.</div></div></div>
          <div class="reassure-item"><div class="reassure-icon">${ICONS.noVisit}</div><div class="reassure-text"><div class="rt">No one visits</div><div class="rs">This replaces an in-person visit entirely — for this step.</div></div></div>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="stepup-geo">Continue</button></div>
    `;
  },

  'stepup-geo'() {
    if (state.geoError) {
      return `
        <h1 class="screen-title">We need location access</h1>
        <p class="screen-sub">Your browser blocked it — that's easy to fix:</p>
        <div class="recovery-card">
          <ol>
            <li>Tap the lock icon in your address bar</li>
            <li>Switch Location to "Allow"</li>
            <li>Tap try again below</li>
          </ol>
        </div>
        <div class="btn-row"><button class="btn btn-primary" id="retry-geo">Try again</button></div>
      `;
    }
    if (state.geo) {
      return `
        <h1 class="screen-title">Location confirmed</h1>
        <div class="geo-card">
          <div class="gi">${ICONS.pin}</div>
          <div><div class="gt">You're in the right area</div><div class="gs">Captured just now, used once for this check</div></div>
        </div>
        <button class="detail-link" id="toggle-geo-detail">${state.showGeoDetail ? 'Hide' : 'View'} technical details</button>
        ${state.showGeoDetail ? `<p class="field-hint mono" style="margin-top:10px;">lat ${state.geo.lat.toFixed(5)}, lon ${state.geo.lon.toFixed(5)} · ±${Math.round(state.geo.accuracy)}m · ${new Date(state.geo.timestamp).toLocaleTimeString()}</p>` : ''}
        <div class="btn-row"><button class="btn btn-primary" data-go="stepup-camera">Continue</button></div>
      `;
    }
    return `
      <div class="hero-icon">${ICONS.pin}</div>
      <h1 class="screen-title">Share your location</h1>
      <p class="screen-sub">A one-time check against your address — not continuous tracking, and never shared elsewhere.</p>
      <div class="btn-row"><button class="btn btn-primary" id="capture-geo">${state.locating ? '<span class="spin"></span>' : 'Share location'}</button></div>
    `;
  },

  'stepup-camera'() {
    return `
      <h1 class="screen-title">Show your door number</h1>
      <p class="screen-sub">Point your camera at your house number or door plate.</p>
      <div class="camera-view" id="camera-view">
        <div class="camera-placeholder" id="camera-placeholder">Starting camera…</div>
        <div class="camera-frame" id="camera-frame"></div>
        <div class="guidance-pill" id="guidance-pill" style="display:none;"><span class="guidance-dot"></span><span id="guidance-text">Position it in the frame</span></div>
        <div class="shutter-flash" id="shutter-flash"></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="capture-photo" disabled>Take photo</button></div>
    `;
  },

  'stepup-checking'() {
    return `
      <div style="margin-top:12px;">
        <h1 class="screen-title">Just a moment</h1>
        <p class="screen-sub">Confirming your submission.</p>
        <div id="capture-check-list"></div>
      </div>
    `;
  },

  'outcome-stepup-clear'() {
    return outcomeMarkup({
      tone: 'success',
      headline: 'Verified',
      sub: 'Your live photo and location confirm the rest — you did great.',
      cta: 'See my loan offer',
      celebrate: true,
    });
  },

  'outcome-decline'() {
    const isConflict = state.routeDecision?.lane === 'decline';
    return outcomeMarkup({
      tone: 'neutral',
      headline: isConflict ? "That address doesn't match our records" : "We couldn't confirm this automatically",
      sub: isConflict
        ? "The address you entered doesn't match what we found on file. Double-check it and try again — most mismatches are a quick fix."
        : "Location or photo signals don't always come through clearly on the first try. You're welcome to try again, or we can help directly.",
      cta: isConflict ? 'Review my address' : 'Try again',
      ctaAction: isConflict ? 'review-address' : 'retry-stepup',
      secondaryCta: 'Contact support',
    });
  },

  'support-stub'() {
    return `
      <div class="center" style="margin:auto 0;">
        <div class="hero-icon">${ICONS.headset}</div>
        <h1 class="screen-title">We're here to help</h1>
        <p class="screen-sub">In the full product this connects you to a real person — by chat or callback — no need to redo the whole application.</p>
      </div>
      <div class="btn-row"><button class="btn btn-secondary" id="restart">Start over</button></div>
    `;
  },
};

function outcomeMarkup({ tone, headline, sub, cta, celebrate, ctaAction, secondaryCta }) {
  const trace = buildFullTrace();
  return `
    <div class="outcome-badge ${tone}">
      ${celebrate ? `<div class="confetti" id="confetti"></div>` : ''}
      <div class="badge-icon ${tone}">${tone === 'success' ? ICONS.check : ICONS.info}</div>
      <div class="outcome-headline">${headline}</div>
      <div class="outcome-sub">${sub}</div>
    </div>
    ${trace.length ? `
    <button class="trace-toggle ${state.traceOpen ? 'open' : ''}" id="trace-toggle">What we checked ${ICONS.chevronDown}</button>
    <div class="trace-panel ${state.traceOpen ? 'open' : ''}">
      <div class="trace-panel-inner">
        ${trace.map((t) => `<div class="trace-line ${t.ok ? 'yes' : 'no'}">${t.ok ? ICONS.check : ICONS.x}<span>${t.label}</span></div>`).join('')}
      </div>
    </div>` : ''}
    <div class="btn-row">
      <button class="btn btn-primary" id="outcome-cta" data-action="${ctaAction || 'restart'}">${cta}</button>
      ${secondaryCta ? `<button class="link-btn muted" id="outcome-secondary">${secondaryCta}</button>` : ''}
    </div>
  `;
}

// Plain-language summary only — no internal match percentages or engine terms.
function buildFullTrace() {
  const lines = [];
  if (state.corroboration) {
    for (const t of state.corroboration.trace) {
      lines.push({ ok: t.result === 'agree', label: `${t.source}: ${t.result === 'agree' ? 'matches your address' : t.result === 'too-fresh' ? "on file, but too recent to count yet" : "doesn't match your address"}` });
    }
  }
  if (state.captureVerdict) {
    const c = state.captureVerdict;
    lines.push({ ok: !c.mockLocationFlag, label: c.mockLocationFlag ? 'Live capture: could not confirm this was a genuine, live submission' : 'Live capture: confirmed genuine and live' });
    lines.push({ ok: c.geofenceOk, label: c.geofenceOk ? 'Location: matches your declared address' : "Location: didn't match your declared address" });
  }
  return lines;
}

// ---- render dispatcher --------------------------------------------------
function render() {
  renderDemoPanel();
  renderTopbar();
  root.innerHTML = screens[state.screen] ? screens[state.screen]() : `<p>Unknown screen: ${state.screen}</p>`;
  wireEvents();
}

// ---- event wiring per screen ---------------------------------------------
function wireEvents() {
  root.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => goto(el.dataset.go)));

  if (state.screen === 'mobile') {
    const input = document.getElementById('mobile-input');
    input.addEventListener('input', (e) => { state.mobile = e.target.value.replace(/\D/g, '').slice(0, 10); render(); focusEnd('mobile-input'); });
    document.getElementById('send-otp')?.addEventListener('click', () => { startResendTimer(); goto('otp'); });
  }

  if (state.screen === 'otp') {
    const input = document.getElementById('otp-input');
    input.addEventListener('input', (e) => {
      state.otp = e.target.value.replace(/\D/g, '').slice(0, 6);
      render(); focusEnd('otp-input');
      if (state.otp.length === 6) verifyOtp();
    });
    document.getElementById('verify-otp')?.addEventListener('click', verifyOtp);
    document.getElementById('resend-otp')?.addEventListener('click', startResendTimer);
  }

  if (state.screen === 'pan') {
    const input = document.getElementById('pan-input');
    input.addEventListener('input', (e) => { state.pan = e.target.value.toUpperCase().slice(0, 10); render(); focusEnd('pan-input'); });
    document.getElementById('pull-bureau')?.addEventListener('click', async () => {
      goto('bureau-loading', { replace: true });
      await sleep(BUREAU_LATENCY_MS);
      state.addressDraft = declaredAddress();
      goto('profile', { replace: true });
    });
  }

  if (state.screen === 'profile') {
    document.getElementById('edit-address')?.addEventListener('click', () => { state.editingAddress = true; state.addressDraft = declaredAddress(); render(); });
    document.getElementById('cancel-address')?.addEventListener('click', () => { state.editingAddress = false; render(); });
    document.getElementById('save-address')?.addEventListener('click', () => {
      const v = document.getElementById('address-draft').value.trim();
      if (v) state.declaredAddressOverride = v;
      state.editingAddress = false; render();
    });
    document.getElementById('address-draft')?.addEventListener('input', (e) => { state.addressDraft = e.target.value; });
  }

  if (state.screen === 'setup') {
    root.querySelectorAll('[data-setup]').forEach((el) => el.addEventListener('click', () => { state.setupType = el.dataset.setup; render(); }));
    document.getElementById('continue-setup')?.addEventListener('click', () => {
      if (state.setupType === 'shop') goto('business-stub');
      else if (state.setupType === 'salaried') goto('work-email');
      else goto('checking');
    });
  }

  if (state.screen === 'work-email') {
    const input = document.getElementById('email-input');
    input.addEventListener('input', (e) => { state.workEmail = e.target.value; render(); focusEnd('email-input'); });
    document.getElementById('check-email')?.addEventListener('click', async () => {
      state.checkingEmail = true; render();
      await sleep(500);
      state.workEmailVerified = !/@(gmail|yahoo|outlook|hotmail)\./i.test(state.workEmail);
      state.checkingEmail = false;
      goto('checking');
    });
  }

  if (state.screen === 'checking') runCorroborationCheck();
  if (state.screen === 'stepup-checking') runCaptureCheck();

  if (state.screen === 'stepup-geo') {
    document.getElementById('capture-geo')?.addEventListener('click', captureGeo);
    document.getElementById('retry-geo')?.addEventListener('click', captureGeo);
    document.getElementById('toggle-geo-detail')?.addEventListener('click', () => { state.showGeoDetail = !state.showGeoDetail; render(); });
  }
  if (state.screen === 'stepup-camera') startCamera();

  if (['outcome-clear', 'outcome-stepup-clear', 'outcome-decline'].includes(state.screen)) {
    if (state.screen !== 'outcome-decline') fireConfetti();
    document.getElementById('trace-toggle')?.addEventListener('click', () => { state.traceOpen = !state.traceOpen; render(); });
    document.getElementById('outcome-cta')?.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      if (action === 'review-address') { state.editingAddress = true; goto('profile'); }
      else if (action === 'retry-stepup') { state.geo = null; state.geoError = null; state.cameraReady = false; goto('stepup-geo'); }
      else resetFlow();
    });
    document.getElementById('outcome-secondary')?.addEventListener('click', () => goto('support-stub'));
  }
  if (state.screen === 'support-stub') document.getElementById('restart')?.addEventListener('click', resetFlow);
}

function focusEnd(id) { const el = document.getElementById(id); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } }

function startResendTimer() {
  clearInterval(state.resendTimer);
  state.resendIn = 30;
  state.resendTimer = setInterval(() => {
    state.resendIn--;
    if (state.resendIn <= 0) clearInterval(state.resendTimer);
    if (state.screen === 'otp') render();
  }, 1000);
}

async function verifyOtp() {
  if (state.otp.length !== 6) return;
  state.verifying = true; render();
  await sleep(450);
  state.verifying = false;
  clearInterval(state.resendTimer);
  goto('pan');
}

// ---- async flows ----------------------------------------------------------
async function runCorroborationCheck() {
  const s = scenario();
  const list = document.getElementById('check-list');
  const sources = s.sources;
  const rows = sources.map((src, i) => ({ src, done: false, delay: i * 90 }));
  const draw = () => {
    list.innerHTML = rows.map(({ src, done, delay }) => `
      <div class="check-row" style="animation-delay:${delay}ms">
        <div class="check-icon ${done ? 'ok' : ''}">${done ? ICONS.check : ''}</div>
        <div class="check-name">${src.name}</div>
      </div>`).join('') || `<p class="field-hint">No extra records on file for this profile yet — we'll confirm the rest with a quick live check.</p>`;
  };
  draw();
  for (const row of rows) {
    await sleep(SOURCE_CHECK_LATENCY_MS);
    row.done = true; draw();
  }
  await sleep(350);

  state.corroboration = scoreCorroboration(declaredAddress(), sources);
  state.routeDecision = routeFromCorroboration(state.corroboration);

  if (state.routeDecision.lane === 'clear') goto('outcome-clear', { replace: true });
  else if (state.routeDecision.lane === 'decline') goto('outcome-decline', { replace: true });
  else goto('stepup-intro', { replace: true });
}

async function captureGeo() {
  state.geoError = null; state.locating = true; render();
  if (!navigator.geolocation) { state.locating = false; state.geoError = true; render(); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.locating = false;
      state.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp };
      render();
    },
    () => { state.locating = false; state.geoError = true; render(); },
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

async function startCamera() {
  const placeholder = document.getElementById('camera-placeholder');
  const view = document.getElementById('camera-view');
  const frame = document.getElementById('camera-frame');
  const pill = document.getElementById('guidance-pill');
  const pillText = document.getElementById('guidance-text');
  const btn = document.getElementById('capture-photo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    state.stream = stream;
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.srcObject = stream;
    placeholder.remove();
    view.prepend(video);
    pill.style.display = 'flex';

    // Simulated real-time capture guidance (no real CV — this is a UI-only
    // prototype). Mirrors what an on-device quality check would surface.
    await sleep(1400);
    frame.classList.add('ready');
    pill.classList.add('ready');
    pillText.textContent = 'Looks good';
    btn.disabled = false;

    btn.addEventListener('click', () => {
      document.getElementById('shutter-flash').classList.add('flash');
      video.pause();
      setTimeout(() => { stopStream(); goto('stepup-checking'); }, 260);
    });
  } catch (err) {
    placeholder.style.display = 'flex';
    placeholder.textContent = 'Camera access needed — tap the lock icon in your address bar, allow Camera, then retry.';
    btn.textContent = 'Retry';
    btn.disabled = false;
    btn.addEventListener('click', startCamera, { once: true });
  }
}

async function runCaptureCheck() {
  const s = scenario();
  const cap = s.capture || { geofenceOk: true, ocrLivenessOk: true, mockLocationFlag: false };
  const steps = [
    { name: 'Confirming this is a live, genuine photo', ok: !cap.mockLocationFlag },
    { name: 'Matching your location', ok: cap.geofenceOk },
    { name: 'Reading your door number', ok: cap.ocrLivenessOk },
  ];
  const list = document.getElementById('capture-check-list');
  const rows = steps.map((s2, i) => ({ ...s2, done: false, delay: i * 90 }));
  const draw = () => {
    list.innerHTML = rows.map((r) => `
      <div class="check-row" style="animation-delay:${r.delay}ms">
        <div class="check-icon ${r.done ? 'ok' : ''}">${r.done ? ICONS.check : ''}</div>
        <div class="check-name">${r.name}</div>
      </div>`).join('');
  };
  draw();
  for (const row of rows) { await sleep(550); row.done = true; draw(); }
  await sleep(350);

  state.captureVerdict = cap;
  state.captureRouteDecision = routeFromCapture(cap);
  goto(state.captureRouteDecision.lane === 'stepup-clear' ? 'outcome-stepup-clear' : 'outcome-decline', { replace: true });
}

function fireConfetti() {
  const el = document.getElementById('confetti');
  if (!el) return;
  const colors = ['#127A56', '#B9791E', '#5CE0A6', '#F2C94C'];
  let html = '';
  for (let i = 0; i < 26; i++) {
    const left = Math.random() * 100;
    const delay = Math.random() * 250;
    const dur = 1.2 + Math.random() * 0.6;
    const color = colors[i % colors.length];
    html += `<i style="left:${left}%; background:${color}; animation-delay:${delay}ms; animation-duration:${dur}s;"></i>`;
  }
  el.innerHTML = html;
}

// ---- boot ----------------------------------------------------------------
render();
