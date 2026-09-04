import { DEMO_SCENARIOS, BUREAU_LATENCY_MS } from './mock-data.js';
import { routeFromCapture } from './engine.js';
import { ICONS } from './icons.js';

// ---- state -----------------------------------------------------------
const state = {
  screen: 'welcome',
  history: [],
  scenarioKey: 'verified',
  aadhaarNumber: '', aadhaarOtp: '', aadhaarVerifying: false, resendIn: 0, resendTimer: null,
  setupType: null,
  personalEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
  workEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
  pan: '',
  currentSameAsPermanent: true, currentAddressDraft: '',
  editingPermanent: false, permanentAddressDraft: '', permanentAddressOverride: null,
  geoLoading: false, geoConfirmed: false,
  captureVerdict: null, captureRouteDecision: null,
  traceOpen: false,
};

const scenario = () => DEMO_SCENARIOS[state.scenarioKey];
const permanentAddress = () => state.permanentAddressOverride ?? scenario().profile.permanentAddress;
const declaredAddress = () => (state.currentSameAsPermanent ? permanentAddress() : state.currentAddressDraft);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = document.getElementById('screen-root');
const topbarEl = document.getElementById('topbar');
const phoneEl = document.querySelector('.phone');

const TRANSIENT = new Set(['bureau-loading', 'checking', 'capture-checking']);

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

// ---- toast ---------------------------------------------------------------
function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="ti">${ICONS.check}</span><span>${message}</span>`;
  phoneEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, 2200);
}

// ---- demo panel (reviewer tool, not part of the customer product) ----
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
  Object.assign(state, {
    screen: 'welcome', history: [],
    aadhaarNumber: '', aadhaarOtp: '', aadhaarVerifying: false, resendIn: 0, resendTimer: null,
    setupType: null,
    personalEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
    workEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
    pan: '',
    currentSameAsPermanent: scenario().currentSameAsPermanentDefault,
    currentAddressDraft: scenario().currentAddressSuggestion,
    editingPermanent: false, permanentAddressDraft: '', permanentAddressOverride: null,
    geoLoading: false, geoConfirmed: false,
    captureVerdict: null, captureRouteDecision: null, traceOpen: false,
  });
  render();
}

// ---- topbar (back + progress) ------------------------------------------
const STAGE_OF = {
  welcome: 0,
  'aadhaar-number': 1, 'aadhaar-otp': 1,
  setup: 2, 'business-stub': 2,
  'email-verify': 2, pan: 2, 'bureau-loading': 2, profile: 2,
  'capture-intro': 3, 'capture-geo': 3, 'capture-camera': 3, 'capture-checking': 3,
  'outcome-clear': 4, 'outcome-decline': 4, 'support-stub': 4,
};
const STAGE_LABELS = ['', 'Identity check', 'Details', 'Verification', 'Done'];
const NO_BACK = new Set(['welcome', 'bureau-loading', 'capture-checking', 'outcome-clear', 'outcome-decline']);

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

// ---- input helper: updates state + button state without wiping the
// input's own DOM node, so focus and the mobile keyboard never drop.
// NOTHING that runs while a screen with a live input is mounted may call
// render() outside of this pattern — see startResendTimer for why. ----
function bindInput(id, { transform = (v) => v, onChange, buttonId, isValid }) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', (e) => {
    const v = transform(e.target.value);
    if (v !== e.target.value) e.target.value = v;
    onChange(v);
    if (buttonId) {
      const btn = document.getElementById(buttonId);
      if (btn) btn.disabled = isValid ? !isValid(v) : false;
    }
  });
}
function formatAadhaar(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 12);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

// Ticks a resend countdown by mutating the button directly. Deliberately
// never calls render(): this runs on a 1s interval for as long as an OTP
// screen is open, and a full re-render on that cadence was recreating the
// OTP input mid-keystroke, which is why "type a digit, losing focus" kept
// happening. Never call render() from a timer that can fire while an
// input on screen might have focus.
function startResendTimer(btnId) {
  clearInterval(state.resendTimer);
  state.resendIn = 30;
  const tick = () => {
    const btn = document.getElementById(btnId);
    if (!btn) { clearInterval(state.resendTimer); return; }
    if (state.resendIn <= 0) {
      btn.textContent = 'Resend code';
      btn.disabled = false;
      btn.classList.remove('muted');
      clearInterval(state.resendTimer);
      return;
    }
    btn.textContent = `Resend code in 0:${String(state.resendIn).padStart(2, '0')}`;
    btn.disabled = true;
    btn.classList.add('muted');
    state.resendIn--;
  };
  tick();
  state.resendTimer = setInterval(tick, 1000);
}

// ---- reusable inline email verification block ---------------------------
function emailBlock(key, label, placeholder) {
  const e = state[key];
  if (e.verified) {
    return `
      <div class="email-block">
        <label>${label}</label>
        <div class="email-verified-row">
          <span class="ev-check">${ICONS.check}</span>
          <span class="ev-value">${e.value}</span>
          <span class="ev-tag">Verified</span>
        </div>
      </div>`;
  }
  if (e.otpSent) {
    return `
      <div class="email-block">
        <label>${label}</label>
        <input id="${key}-input" type="email" value="${e.value}" disabled>
        <div class="otp-inline-row">
          <input id="${key}-otp-input" class="otp-input-sm" type="text" inputmode="numeric" maxlength="6" placeholder="······" value="${e.otp}">
          <button class="btn-sm-primary" id="${key}-verify-otp" ${e.otp.length === 6 ? '' : 'disabled'}>${e.verifying ? '<span class="spin"></span>' : 'Confirm'}</button>
        </div>
        <p class="field-hint">Code sent to ${e.value}. <span class="mono">(Demo, any 6 digits work)</span></p>
      </div>`;
  }
  return `
    <div class="email-block">
      <label for="${key}-input">${label}</label>
      <input id="${key}-input" type="email" placeholder="${placeholder}" value="${e.value}" autocomplete="off">
      <button class="verify-link" id="${key}-send-otp" ${e.value.includes('@') ? '' : 'disabled'}>Verify</button>
    </div>`;
}

function wireEmailBlock(key) {
  const e = state[key];
  if (e.verified) return;
  if (!e.otpSent) {
    bindInput(`${key}-input`, {
      onChange: (v) => { state[key].value = v; },
      buttonId: `${key}-send-otp`, isValid: (v) => v.includes('@'),
    });
    document.getElementById(`${key}-send-otp`)?.addEventListener('click', () => {
      state[key].otpSent = true; render();
    });
  } else {
    bindInput(`${key}-otp-input`, {
      transform: (v) => v.replace(/\D/g, '').slice(0, 6),
      onChange: (v) => { state[key].otp = v; if (v.length === 6) verifyEmailOtp(key); },
      buttonId: `${key}-verify-otp`, isValid: (v) => v.length === 6,
    });
    document.getElementById(`${key}-verify-otp`)?.addEventListener('click', () => verifyEmailOtp(key));
  }
}
async function verifyEmailOtp(key) {
  if (state[key].otp.length !== 6) return;
  state[key].verifying = true; render();
  await sleep(400);
  state[key].verifying = false;
  state[key].verified = true;
  render();
  showToast(`${key === 'personalEmail' ? 'Personal' : 'Office'} email verified successfully`);
}

// ---- screens ------------------------------------------------------------
const screens = {
  welcome() {
    return `
      <div class="center" style="margin:auto 0;">
        <div class="hero-icon">${ICONS.home}</div>
        <h1 class="screen-title">Let's verify where you live or work</h1>
        <p class="screen-sub">Most people finish in a few minutes, right from your phone. No paperwork, no one visiting your door until the live check at the end.</p>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="aadhaar-number">Get started</button></div>
    `;
  },

  'aadhaar-number'() {
    return `
      <span class="eyebrow">${ICONS.idcard} Identity verification</span>
      <h1 class="screen-title">Verify with Aadhaar</h1>
      <p class="screen-sub">Enter your Aadhaar number. We'll send a code to your registered mobile number to confirm it's you.</p>
      <label for="aadhaar-input">Aadhaar number</label>
      <input id="aadhaar-input" type="text" inputmode="numeric" placeholder="XXXX XXXX XXXX" value="${state.aadhaarNumber}" maxlength="14">
      <div class="value-nudge">${ICONS.lock} Used only to verify your identity and permanent address.</div>
      <div class="btn-row"><button class="btn btn-primary" id="send-aadhaar-otp" ${state.aadhaarNumber.replace(/\D/g, '').length === 12 ? '' : 'disabled'}>Send code</button></div>
    `;
  },

  'aadhaar-otp'() {
    const last4 = scenario().profile.linkedMobileLast4;
    return `
      <span class="eyebrow">${ICONS.idcard} Verify code</span>
      <h1 class="screen-title">Enter the code we sent</h1>
      <p class="screen-sub">Sent to your Aadhaar-registered mobile number, ending in ${last4}. <span class="mono">(Demo, any 6 digits work)</span></p>
      <input id="aadhaar-otp-input" class="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="······" value="${state.aadhaarOtp}">
      <div class="btn-row">
        <button class="btn btn-primary" id="verify-aadhaar-otp" ${state.aadhaarOtp.length === 6 ? '' : 'disabled'}>${state.aadhaarVerifying ? '<span class="spin"></span>' : 'Verify'}</button>
        <button class="link-btn" id="resend-aadhaar-otp">Resend code in 0:30</button>
      </div>
    `;
  },

  setup() {
    const options = [
      { id: 'employed', t: 'Employed', s: 'Salaried, whether from an office or remote' },
      { id: 'shop', t: 'Shop / store owner', s: 'I run a retail shop or business outlet' },
      { id: 'selfemployed', t: 'Self-employed, no storefront', s: 'Freelancer, consultant, or home-based practice' },
    ];
    return `
      <span class="eyebrow">${ICONS.home} Setup</span>
      <h1 class="screen-title">What best describes your work?</h1>
      <p class="screen-sub">This decides what we ask for next, nothing more than we need.</p>
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
        <p class="screen-sub">Business verification isn't live in this preview yet. We're finishing it next. Try Employed or Self-employed to see the full journey.</p>
      </div>
      <div class="btn-row"><button class="btn btn-secondary" data-go="setup">← Choose a different option</button></div>
    `;
  },

  'email-verify'() {
    const needsWork = state.setupType === 'employed';
    return `
      <span class="eyebrow">${ICONS.mail} Contact details</span>
      <h1 class="screen-title">Verify your email${needsWork ? 's' : ''}</h1>
      <p class="screen-sub">${needsWork ? "Your personal email is where we send statements. Your office email gives us a second way to reach you if we can't reach you at home." : "We'll use this for statements and account updates."}</p>
      ${emailBlock('personalEmail', 'Personal email', 'you@example.com')}
      ${needsWork ? emailBlock('workEmail', 'Office email', 'you@company.com') : ''}
      <div class="btn-row"><button class="btn btn-primary" id="continue-emails" ${state.personalEmail.verified && (!needsWork || state.workEmail.verified) ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  pan() {
    return `
      <span class="eyebrow">${ICONS.bank} Eligibility check</span>
      <h1 class="screen-title">Let's see what you're eligible for</h1>
      <p class="screen-sub">Enter your PAN. This is a soft check and never affects your credit score.</p>
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
    if (state.editingPermanent) {
      return `
        <span class="eyebrow">${ICONS.idcard} Your details</span>
        <h1 class="screen-title">Update your permanent address</h1>
        <p class="screen-sub">We'll use this instead of the one from Aadhaar.</p>
        <div class="inline-edit"><input id="permanent-draft-input" type="text" value="${state.permanentAddressDraft}"></div>
        <div class="btn-row"><button class="btn btn-primary" id="save-permanent">Save</button><button class="link-btn muted" id="cancel-permanent">Cancel</button></div>
      `;
    }
    return `
      <span class="eyebrow">${ICONS.idcard} Your details</span>
      <h1 class="screen-title">Good news, we found your details</h1>
      <p class="screen-sub">Pulled securely from Aadhaar and your credit record. No documents to upload.</p>
      <div class="profile-card">
        <div class="profile-row"><span class="k">Name</span><span class="v">${p.name}</span></div>
        <div class="profile-row"><span class="k">Date of birth</span><span class="v">${p.dob}</span></div>
        <div class="profile-row"><span class="k">Permanent address</span><span class="v">${permanentAddress()}</span></div>
      </div>
      <div class="check-toggle ${state.currentSameAsPermanent ? 'checked' : ''}" id="same-address-toggle">
        <div class="box">${ICONS.check}</div>
        <div><div class="ct">I currently live at my permanent address</div><div class="cs">Uncheck this if you've moved since Aadhaar was last updated.</div></div>
      </div>
      ${!state.currentSameAsPermanent ? `
        <label for="current-address-input">Current address</label>
        <input id="current-address-input" type="text" value="${state.currentAddressDraft}">
      ` : ''}
      <div class="btn-row">
        <button class="btn btn-primary" data-go="capture-intro">Yes, that's correct</button>
        <button class="link-btn muted" id="edit-permanent">That's not quite right</button>
      </div>
    `;
  },

  'capture-intro'() {
    return `
      <div style="margin-top:6px;">
        <div class="hero-icon">${ICONS.shield}</div>
        <h1 class="screen-title">Let's confirm your premises</h1>
        <p class="screen-sub">A verified Aadhaar and email tell us who you are and how to reach you. This last step confirms you're actually at this address right now, it takes about 30 seconds.</p>
        <div class="reassure-list">
          <div class="reassure-item"><div class="reassure-icon">${ICONS.pin}</div><div class="reassure-text"><div class="rt">Used once</div><div class="rs">We check your location only for this step, nothing is tracked afterward.</div></div></div>
          <div class="reassure-item"><div class="reassure-icon">${ICONS.lock}</div><div class="reassure-text"><div class="rt">Kept secure</div><div class="rs">Your photo is encrypted and used only to verify this application.</div></div></div>
          <div class="reassure-item"><div class="reassure-icon">${ICONS.noVisit}</div><div class="reassure-text"><div class="rt">No one visits</div><div class="rs">This replaces an in-person visit for this step.</div></div></div>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="capture-geo">Continue</button></div>
    `;
  },

  'capture-geo'() {
    if (state.geoConfirmed) {
      return `
        <h1 class="screen-title">Location confirmed</h1>
        <div class="geo-card"><div class="gi">${ICONS.pin}</div><div><div class="gt">You're in the right area</div><div class="gs">Confirmed just now, used once for this check</div></div></div>
        <div class="btn-row"><button class="btn btn-primary" data-go="capture-camera">Continue</button></div>
      `;
    }
    return `
      <div class="hero-icon">${ICONS.pin}</div>
      <h1 class="screen-title">Confirm your location</h1>
      <p class="screen-sub">A one-time check against your address. Not continuous tracking, and never shared elsewhere.</p>
      <div class="btn-row"><button class="btn btn-primary" id="capture-geo-btn">${state.geoLoading ? '<span class="spin"></span>' : 'Share location'}</button></div>
    `;
  },

  'capture-camera'() {
    return `
      <h1 class="screen-title">Show your door number</h1>
      <p class="screen-sub">Point your camera at your house number or door plate.</p>
      <div class="camera-illustration" id="camera-view">
        <div class="ci-icon">${ICONS.camera}</div>
        <div class="guidance-pill" id="guidance-pill"><span class="guidance-dot"></span><span id="guidance-text">Position it in the frame</span></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="capture-photo" disabled>Take photo</button></div>
    `;
  },

  'capture-checking'() {
    return `
      <div style="margin-top:12px;">
        <h1 class="screen-title">Just a moment</h1>
        <p class="screen-sub">Confirming your submission.</p>
        <div id="capture-check-list"></div>
      </div>
    `;
  },

  'outcome-clear'() {
    return outcomeMarkup({
      tone: 'success',
      headline: "You're verified",
      sub: 'Your identity, contact details, and live premises check are all confirmed.',
      cta: 'See my loan offer',
      celebrate: true,
    });
  },

  'outcome-decline'() {
    return outcomeMarkup({
      tone: 'neutral',
      headline: "We couldn't confirm this automatically",
      sub: "Location or photo signals don't always come through clearly on the first try. You're welcome to try again, or we can help directly.",
      cta: 'Try again',
      ctaAction: 'retry-capture',
      secondaryCta: 'Contact support',
    });
  },

  'support-stub'() {
    return `
      <div class="center" style="margin:auto 0;">
        <div class="hero-icon">${ICONS.headset}</div>
        <h1 class="screen-title">We're here to help</h1>
        <p class="screen-sub">In the full product this connects you to a real person, by chat or callback. No need to redo the whole application.</p>
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
    <button class="trace-toggle ${state.traceOpen ? 'open' : ''}" id="trace-toggle">What we checked ${ICONS.chevronDown}</button>
    <div class="trace-panel ${state.traceOpen ? 'open' : ''}">
      <div class="trace-panel-inner">
        ${trace.map((t) => `<div class="trace-line ${t.ok ? 'yes' : 'no'}">${t.ok ? ICONS.check : ICONS.x}<span>${t.label}</span></div>`).join('')}
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="outcome-cta" data-action="${ctaAction || 'restart'}">${cta}</button>
      ${secondaryCta ? `<button class="link-btn muted" id="outcome-secondary">${secondaryCta}</button>` : ''}
    </div>
  `;
}

function buildFullTrace() {
  const lines = [
    { ok: true, label: 'Aadhaar: identity verified' },
    { ok: true, label: 'Personal email: verified' },
  ];
  if (state.setupType === 'employed') lines.push({ ok: true, label: 'Office email: verified' });
  if (state.captureVerdict) {
    lines.push({ ok: state.captureVerdict.ok, label: state.captureVerdict.ok ? 'Live capture: confirmed genuine and live at this address' : 'Live capture: could not confirm this was a genuine, live submission' });
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

  if (state.screen === 'aadhaar-number') {
    bindInput('aadhaar-input', {
      transform: formatAadhaar,
      onChange: (v) => { state.aadhaarNumber = v; },
      buttonId: 'send-aadhaar-otp', isValid: (v) => v.replace(/\D/g, '').length === 12,
    });
    document.getElementById('send-aadhaar-otp')?.addEventListener('click', () => {
      goto('aadhaar-otp');
      startResendTimer('resend-aadhaar-otp');
    });
  }

  if (state.screen === 'aadhaar-otp') {
    bindInput('aadhaar-otp-input', {
      transform: (v) => v.replace(/\D/g, '').slice(0, 6),
      onChange: (v) => { state.aadhaarOtp = v; if (v.length === 6) verifyAadhaarOtp(); },
      buttonId: 'verify-aadhaar-otp', isValid: (v) => v.length === 6,
    });
    document.getElementById('verify-aadhaar-otp')?.addEventListener('click', verifyAadhaarOtp);
    document.getElementById('resend-aadhaar-otp')?.addEventListener('click', () => startResendTimer('resend-aadhaar-otp'));
  }

  if (state.screen === 'setup') {
    root.querySelectorAll('[data-setup]').forEach((el) => el.addEventListener('click', () => { state.setupType = el.dataset.setup; render(); }));
    document.getElementById('continue-setup')?.addEventListener('click', () => {
      if (state.setupType === 'shop') goto('business-stub');
      else goto('email-verify');
    });
  }

  if (state.screen === 'email-verify') {
    wireEmailBlock('personalEmail');
    if (state.setupType === 'employed') wireEmailBlock('workEmail');
    document.getElementById('continue-emails')?.addEventListener('click', () => goto('pan'));
  }

  if (state.screen === 'pan') {
    bindInput('pan-input', {
      transform: (v) => v.toUpperCase().slice(0, 10),
      onChange: (v) => { state.pan = v; },
      buttonId: 'pull-bureau', isValid: (v) => v.length === 10,
    });
    document.getElementById('pull-bureau')?.addEventListener('click', async () => {
      goto('bureau-loading', { replace: true });
      await sleep(BUREAU_LATENCY_MS);
      goto('profile', { replace: true });
    });
  }

  if (state.screen === 'profile') {
    document.getElementById('same-address-toggle')?.addEventListener('click', () => {
      state.currentSameAsPermanent = !state.currentSameAsPermanent;
      render();
    });
    bindInput('current-address-input', { onChange: (v) => { state.currentAddressDraft = v; } });
    document.getElementById('edit-permanent')?.addEventListener('click', () => {
      state.editingPermanent = true; state.permanentAddressDraft = permanentAddress(); render();
    });
    document.getElementById('cancel-permanent')?.addEventListener('click', () => { state.editingPermanent = false; render(); });
    document.getElementById('save-permanent')?.addEventListener('click', () => {
      const v = document.getElementById('permanent-draft-input').value.trim();
      if (v) state.permanentAddressOverride = v;
      state.editingPermanent = false; render();
    });
    bindInput('permanent-draft-input', { onChange: (v) => { state.permanentAddressDraft = v; } });
  }

  if (state.screen === 'capture-checking') runCaptureCheck();

  if (state.screen === 'capture-geo') {
    document.getElementById('capture-geo-btn')?.addEventListener('click', async () => {
      state.geoLoading = true; render();
      await sleep(800);
      state.geoLoading = false; state.geoConfirmed = true; render();
    });
  }
  if (state.screen === 'capture-camera') runCameraGuidance();

  if (['outcome-clear', 'outcome-decline'].includes(state.screen)) {
    if (state.screen === 'outcome-clear') fireConfetti();
    document.getElementById('trace-toggle')?.addEventListener('click', () => { state.traceOpen = !state.traceOpen; render(); });
    document.getElementById('outcome-cta')?.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      if (action === 'retry-capture') { state.geoConfirmed = false; goto('capture-geo'); }
      else resetFlow();
    });
    document.getElementById('outcome-secondary')?.addEventListener('click', () => goto('support-stub'));
  }
  if (state.screen === 'support-stub') document.getElementById('restart')?.addEventListener('click', resetFlow);
}

async function verifyAadhaarOtp() {
  if (state.aadhaarOtp.length !== 6) return;
  state.aadhaarVerifying = true; render();
  await sleep(450);
  state.aadhaarVerifying = false;
  clearInterval(state.resendTimer);
  goto('setup');
  showToast('Aadhaar and mobile verified successfully');
}

// ---- async flows ----------------------------------------------------------
async function runCameraGuidance() {
  const pill = document.getElementById('guidance-pill');
  const pillText = document.getElementById('guidance-text');
  const view = document.getElementById('camera-view');
  const btn = document.getElementById('capture-photo');
  await sleep(1400);
  view.classList.add('ready');
  pill.classList.add('ready');
  pillText.textContent = 'Looks good';
  btn.disabled = false;
  btn.addEventListener('click', () => {
    goto('capture-checking');
  }, { once: true });
}

async function runCaptureCheck() {
  const s = scenario();
  const ok = (s.capture || { ok: true }).ok;
  const steps = [
    { name: 'Confirming this is a live, genuine photo', ok },
    { name: 'Matching your location', ok },
    { name: 'Reading your door number', ok },
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

  state.captureVerdict = { ok };
  state.captureRouteDecision = routeFromCapture({ geofenceOk: ok, ocrLivenessOk: ok, mockLocationFlag: !ok });
  goto(state.captureRouteDecision.lane === 'clear' ? 'outcome-clear' : 'outcome-decline', { replace: true });
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
state.currentSameAsPermanent = scenario().currentSameAsPermanentDefault;
state.currentAddressDraft = scenario().currentAddressSuggestion;
render();
