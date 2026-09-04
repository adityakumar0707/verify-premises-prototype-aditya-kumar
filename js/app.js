import { DEMO_SCENARIOS, AADHAAR_TENURE_MONTHS, BUREAU_LATENCY_MS, SOURCE_CHECK_LATENCY_MS } from './mock-data.js';
import { scoreCorroboration, routeFromCorroboration, routeFromCapture } from './engine.js';
import { ICONS } from './icons.js';

// ---- state -----------------------------------------------------------
const state = {
  screen: 'welcome',
  history: [],
  scenarioKey: 'thick_file',
  mobile: '', otp: '', verifying: false, resendIn: 0, resendTimer: null,
  personalEmail: '',
  aadhaarNumber: '', aadhaarOtp: '', aadhaarVerifying: false,
  pan: '',
  currentSameAsPermanent: true, currentAddressDraft: '',
  editingPermanent: false, permanentAddressDraft: '', permanentAddressOverride: null,
  setupType: null,
  workEmail: '', checkingEmail: false,
  corroboration: null, routeDecision: null,
  capturing: false, geoLoading: false, geoConfirmed: false,
  cameraReady: false,
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
  }, 2000);
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
    mobile: '', otp: '', verifying: false, resendIn: 0, resendTimer: null,
    personalEmail: '',
    aadhaarNumber: '', aadhaarOtp: '', aadhaarVerifying: false,
    pan: '',
    currentSameAsPermanent: scenario().currentSameAsPermanentDefault,
    currentAddressDraft: scenario().currentAddressSuggestion,
    editingPermanent: false, permanentAddressDraft: '', permanentAddressOverride: null,
    setupType: null,
    workEmail: '', checkingEmail: false,
    corroboration: null, routeDecision: null,
    capturing: false, geoLoading: false, geoConfirmed: false, cameraReady: false,
    captureVerdict: null, captureRouteDecision: null, traceOpen: false,
  });
  render();
}

// ---- topbar (back + progress) ------------------------------------------
const STAGE_OF = {
  welcome: 0,
  mobile: 1, otp: 1, 'personal-email': 1, 'aadhaar-number': 1, 'aadhaar-otp': 1, pan: 1, 'bureau-loading': 1, profile: 1,
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

// ---- input helper: updates state + button state without wiping the
// input's own DOM node, so focus and the mobile keyboard never drop. ----
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

// ---- screens ------------------------------------------------------------
const screens = {
  welcome() {
    return `
      <div class="center" style="margin:auto 0;">
        <div class="hero-icon">${ICONS.home}</div>
        <h1 class="screen-title">Let's verify where you live or work</h1>
        <p class="screen-sub">Most people finish in under two minutes, right from your phone. No paperwork, no one visiting your door.</p>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="mobile">Get started</button></div>
    `;
  },

  mobile() {
    return `
      <span class="eyebrow">${ICONS.phone} Mobile number</span>
      <h1 class="screen-title">First, let's confirm it's you</h1>
      <p class="screen-sub">We'll text a quick code to your phone.</p>
      <label for="mobile-input">Mobile number</label>
      <input id="mobile-input" type="tel" placeholder="98765 43210" value="${state.mobile}" maxlength="10" autocomplete="tel">
      <div class="value-nudge">${ICONS.lock} Just to confirm it's really you. We won't call or spam you.</div>
      <div class="btn-row"><button class="btn btn-primary" id="send-otp" ${state.mobile.length === 10 ? '' : 'disabled'}>Send code</button></div>
    `;
  },

  otp() {
    return `
      <span class="eyebrow">${ICONS.phone} Verify code</span>
      <h1 class="screen-title">Enter the code we sent</h1>
      <p class="screen-sub">Sent to +91 ${state.mobile}. <span class="mono">(Demo, any 6 digits work)</span></p>
      <input id="otp-input" class="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="······" value="${state.otp}" autocomplete="one-time-code">
      <div class="btn-row">
        <button class="btn btn-primary" id="verify-otp" ${state.otp.length === 6 ? '' : 'disabled'}>${state.verifying ? '<span class="spin"></span>' : 'Verify'}</button>
        <button class="link-btn ${state.resendIn > 0 ? 'muted' : ''}" id="resend-otp" ${state.resendIn > 0 ? 'disabled' : ''}>${state.resendIn > 0 ? `Resend code in 0:${String(state.resendIn).padStart(2, '0')}` : 'Resend code'}</button>
      </div>
    `;
  },

  'personal-email'() {
    return `
      <span class="eyebrow">${ICONS.mail} Contact email</span>
      <h1 class="screen-title">What's your email?</h1>
      <p class="screen-sub">We'll use this for statements and account updates, nothing else.</p>
      <input id="personal-email-input" type="email" placeholder="you@example.com" value="${state.personalEmail}">
      <div class="btn-row"><button class="btn btn-primary" id="continue-email" ${state.personalEmail.includes('@') ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'aadhaar-number'() {
    return `
      <span class="eyebrow">${ICONS.idcard} Aadhaar verification</span>
      <h1 class="screen-title">Verify with Aadhaar</h1>
      <p class="screen-sub">This confirms your identity and permanent address directly from UIDAI records.</p>
      <label for="aadhaar-input">Aadhaar number</label>
      <input id="aadhaar-input" type="text" inputmode="numeric" placeholder="XXXX XXXX XXXX" value="${state.aadhaarNumber}" maxlength="14">
      <div class="value-nudge">${ICONS.lock} Used only to verify your identity and permanent address.</div>
      <div class="btn-row"><button class="btn btn-primary" id="send-aadhaar-otp" ${state.aadhaarNumber.replace(/\D/g, '').length === 12 ? '' : 'disabled'}>Send code</button></div>
    `;
  },

  'aadhaar-otp'() {
    return `
      <span class="eyebrow">${ICONS.idcard} Verify code</span>
      <h1 class="screen-title">Enter the code we sent</h1>
      <p class="screen-sub">Sent to your Aadhaar-linked mobile number. <span class="mono">(Demo, any 6 digits work)</span></p>
      <input id="aadhaar-otp-input" class="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="······" value="${state.aadhaarOtp}">
      <div class="btn-row"><button class="btn btn-primary" id="verify-aadhaar-otp" ${state.aadhaarOtp.length === 6 ? '' : 'disabled'}>${state.aadhaarVerifying ? '<span class="spin"></span>' : 'Verify'}</button></div>
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
        <button class="btn btn-primary" data-go="setup">Yes, that's correct</button>
        <button class="link-btn muted" id="edit-permanent">That's not quite right</button>
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

  'work-email'() {
    return `
      <span class="eyebrow">${ICONS.mail} Optional</span>
      <h1 class="screen-title">Add your work email</h1>
      <p class="screen-sub">This gives us a second way to reach you if we're ever unable to reach you at home.</p>
      <input id="work-email-input" type="email" placeholder="you@company.com" value="${state.workEmail}">
      <div class="btn-row">
        <button class="btn btn-primary" id="check-work-email" ${state.workEmail.includes('@') ? '' : 'disabled'}>${state.checkingEmail ? '<span class="spin"></span>' : 'Add work email'}</button>
        <button class="link-btn muted" data-go="checking">Skip for now</button>
      </div>
    `;
  },

  checking() {
    return `
      <div style="margin-top:12px;">
        <h1 class="screen-title">Checking your address</h1>
        <p class="screen-sub">Comparing a couple of records that already know you. No photo needed yet.</p>
        <div id="check-list"></div>
      </div>
    `;
  },

  'outcome-clear'() {
    return outcomeMarkup({
      tone: 'success',
      headline: "You're verified",
      sub: 'We matched your address across trusted records. No photos or visits needed.',
      cta: 'See my loan offer',
      celebrate: true,
    });
  },

  'stepup-intro'() {
    return `
      <div style="margin-top:6px;">
        <div class="hero-icon">${ICONS.shield}</div>
        <h1 class="screen-title">One quick check left</h1>
        <p class="screen-sub">We didn't find enough matching records yet. A live photo and location check finishes this in about 30 seconds.</p>
        <div class="reassure-list">
          <div class="reassure-item"><div class="reassure-icon">${ICONS.pin}</div><div class="reassure-text"><div class="rt">Used once</div><div class="rs">We check your location only for this step, nothing is tracked afterward.</div></div></div>
          <div class="reassure-item"><div class="reassure-icon">${ICONS.lock}</div><div class="reassure-text"><div class="rt">Kept secure</div><div class="rs">Your photo is encrypted and used only to verify this application.</div></div></div>
          <div class="reassure-item"><div class="reassure-icon">${ICONS.noVisit}</div><div class="reassure-text"><div class="rt">No one visits</div><div class="rs">This replaces an in-person visit for this step.</div></div></div>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="stepup-geo">Continue</button></div>
    `;
  },

  'stepup-geo'() {
    if (state.geoConfirmed) {
      return `
        <h1 class="screen-title">Location confirmed</h1>
        <div class="geo-card"><div class="gi">${ICONS.pin}</div><div><div class="gt">You're in the right area</div><div class="gs">Confirmed just now, used once for this check</div></div></div>
        <div class="btn-row"><button class="btn btn-primary" data-go="stepup-camera">Continue</button></div>
      `;
    }
    return `
      <div class="hero-icon">${ICONS.pin}</div>
      <h1 class="screen-title">Confirm your location</h1>
      <p class="screen-sub">A one-time check against your address. Not continuous tracking, and never shared elsewhere.</p>
      <div class="btn-row"><button class="btn btn-primary" id="capture-geo">${state.geoLoading ? '<span class="spin"></span>' : 'Share location'}</button></div>
    `;
  },

  'stepup-camera'() {
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
      sub: 'Your live photo and location confirm the rest. You did great.',
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
        ? "The address you entered doesn't match what we found on file. Double-check it and try again, most mismatches are a quick fix."
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

// Plain-language summary only, no internal match percentages or engine terms.
function buildFullTrace() {
  const lines = [];
  if (state.corroboration) {
    for (const t of state.corroboration.trace) {
      lines.push({ ok: t.result === 'agree', label: `${t.source}: ${t.result === 'agree' ? 'matches your address' : t.result === 'too-fresh' ? 'on file, but too recent to count yet' : "doesn't match your address"}` });
    }
  }
  if (state.captureVerdict) {
    lines.push({ ok: state.captureVerdict.ok, label: state.captureVerdict.ok ? 'Live capture: confirmed genuine and live' : 'Live capture: could not confirm this was a genuine, live submission' });
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
    bindInput('mobile-input', {
      transform: (v) => v.replace(/\D/g, '').slice(0, 10),
      onChange: (v) => { state.mobile = v; },
      buttonId: 'send-otp', isValid: (v) => v.length === 10,
    });
    document.getElementById('send-otp')?.addEventListener('click', () => { startResendTimer(); goto('otp'); });
  }

  if (state.screen === 'otp') {
    bindInput('otp-input', {
      transform: (v) => v.replace(/\D/g, '').slice(0, 6),
      onChange: (v) => { state.otp = v; if (v.length === 6) verifyMobileOtp(); },
      buttonId: 'verify-otp', isValid: (v) => v.length === 6,
    });
    document.getElementById('verify-otp')?.addEventListener('click', verifyMobileOtp);
    document.getElementById('resend-otp')?.addEventListener('click', startResendTimer);
  }

  if (state.screen === 'personal-email') {
    bindInput('personal-email-input', {
      onChange: (v) => { state.personalEmail = v; },
      buttonId: 'continue-email', isValid: (v) => v.includes('@'),
    });
    document.getElementById('continue-email')?.addEventListener('click', () => goto('aadhaar-number'));
  }

  if (state.screen === 'aadhaar-number') {
    bindInput('aadhaar-input', {
      transform: formatAadhaar,
      onChange: (v) => { state.aadhaarNumber = v; },
      buttonId: 'send-aadhaar-otp', isValid: (v) => v.replace(/\D/g, '').length === 12,
    });
    document.getElementById('send-aadhaar-otp')?.addEventListener('click', () => goto('aadhaar-otp'));
  }

  if (state.screen === 'aadhaar-otp') {
    bindInput('aadhaar-otp-input', {
      transform: (v) => v.replace(/\D/g, '').slice(0, 6),
      onChange: (v) => { state.aadhaarOtp = v; if (v.length === 6) verifyAadhaarOtp(); },
      buttonId: 'verify-aadhaar-otp', isValid: (v) => v.length === 6,
    });
    document.getElementById('verify-aadhaar-otp')?.addEventListener('click', verifyAadhaarOtp);
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

  if (state.screen === 'setup') {
    root.querySelectorAll('[data-setup]').forEach((el) => el.addEventListener('click', () => { state.setupType = el.dataset.setup; render(); }));
    document.getElementById('continue-setup')?.addEventListener('click', () => {
      if (state.setupType === 'shop') goto('business-stub');
      else if (state.setupType === 'employed') goto('work-email');
      else goto('checking');
    });
  }

  if (state.screen === 'work-email') {
    bindInput('work-email-input', {
      onChange: (v) => { state.workEmail = v; },
      buttonId: 'check-work-email', isValid: (v) => v.includes('@'),
    });
    document.getElementById('check-work-email')?.addEventListener('click', async () => {
      state.checkingEmail = true; render();
      await sleep(500);
      state.checkingEmail = false;
      goto('checking');
    });
  }

  if (state.screen === 'checking') runCorroborationCheck();
  if (state.screen === 'stepup-checking') runCaptureCheck();

  if (state.screen === 'stepup-geo') {
    document.getElementById('capture-geo')?.addEventListener('click', async () => {
      state.geoLoading = true; render();
      await sleep(800);
      state.geoLoading = false; state.geoConfirmed = true; render();
    });
  }
  if (state.screen === 'stepup-camera') runCameraGuidance();

  if (['outcome-clear', 'outcome-stepup-clear', 'outcome-decline'].includes(state.screen)) {
    if (state.screen !== 'outcome-decline') fireConfetti();
    document.getElementById('trace-toggle')?.addEventListener('click', () => { state.traceOpen = !state.traceOpen; render(); });
    document.getElementById('outcome-cta')?.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      if (action === 'review-address') { state.editingPermanent = false; goto('profile'); }
      else if (action === 'retry-stepup') { state.geoConfirmed = false; state.cameraReady = false; goto('stepup-geo'); }
      else resetFlow();
    });
    document.getElementById('outcome-secondary')?.addEventListener('click', () => goto('support-stub'));
  }
  if (state.screen === 'support-stub') document.getElementById('restart')?.addEventListener('click', resetFlow);
}

function startResendTimer() {
  clearInterval(state.resendTimer);
  state.resendIn = 30;
  state.resendTimer = setInterval(() => {
    state.resendIn--;
    if (state.resendIn <= 0) clearInterval(state.resendTimer);
    if (state.screen === 'otp') render();
  }, 1000);
}

async function verifyMobileOtp() {
  if (state.otp.length !== 6) return;
  state.verifying = true; render();
  await sleep(450);
  state.verifying = false;
  clearInterval(state.resendTimer);
  goto('personal-email');
  showToast('Number verified successfully');
}

async function verifyAadhaarOtp() {
  if (state.aadhaarOtp.length !== 6) return;
  state.aadhaarVerifying = true; render();
  await sleep(450);
  state.aadhaarVerifying = false;
  goto('pan');
  showToast('Aadhaar verified successfully');
}

// ---- async flows ----------------------------------------------------------
async function runCorroborationCheck() {
  const s = scenario();
  const sources = [
    { name: 'Aadhaar', address: permanentAddress(), tenureMonths: AADHAAR_TENURE_MONTHS },
    { name: 'Telecom KYC', address: s.telecomAddress.address, tenureMonths: s.telecomAddress.tenureMonths },
  ];
  const list = document.getElementById('check-list');
  const rows = sources.map((src, i) => ({ src, done: false, delay: i * 90 }));
  const draw = () => {
    list.innerHTML = rows.map(({ src, done, delay }) => `
      <div class="check-row" style="animation-delay:${delay}ms">
        <div class="check-icon ${done ? 'ok' : ''}">${done ? ICONS.check : ''}</div>
        <div class="check-name">${src.name}</div>
      </div>`).join('');
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
    goto('stepup-checking');
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
state.currentSameAsPermanent = scenario().currentSameAsPermanentDefault;
state.currentAddressDraft = scenario().currentAddressSuggestion;
render();
