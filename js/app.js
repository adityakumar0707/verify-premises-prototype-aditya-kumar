import { TOGGLES, PROFILE, BANK_ACCOUNTS, BUSINESS_INFO, lookupPincode, buildGstin } from './mock-data.js';
import { loanTier, checkHomeRecords, checkBusinessDocuments, LOAN_TIER_THRESHOLD } from './engine.js';
import { ICONS } from './icons.js';

// ---- state -----------------------------------------------------------
const state = {
  screen: 'welcome',
  history: [],
  toggles: { ...TOGGLES },
  loanAmount: '', tier: null,
  aadhaarNumber: '', aadhaarOtp: '', aadhaarVerifying: false, resendIn: 0, resendTimer: null,
  persona: null, hasGst: null,
  personalEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
  workEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
  pan: '', cibilScore: null,
  incomeAccount: null,
  homeSameAsAadhaar: null,
  homePincode: '', homeCity: '', homeState: '', homeAddressLine: '',
  homeOwnership: null,
  officeBuilding: '', officeFloor: '', officeUnit: '', officePincode: '', officeCity: '', officeState: '',
  officeValidating: false, officeValidated: false,
  businessChoice: null, businessGstinInput: '', businessPanInput: '',
  captureContext: null, captureShotIndex: 0, geoLoading: false, geoConfirmed: false,
  trace: [], retryTarget: null,
  traceOpen: false,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = document.getElementById('screen-root');
const topbarEl = document.getElementById('topbar');
const phoneEl = document.querySelector('.phone');
const needsGeo = (ctx) => ctx !== 'selfie';
function formatINR(n) {
  const s = String(Number(n));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

// Each context takes two photos (rear camera on the place, front camera on
// the applicant with it visible behind them) except a selfie, which is one
// shot matched to the Aadhaar photo instead of a place.
const CAPTURE_COPY = {
  selfie: {
    introTitle: 'Selfie match',
    introBody: "We'll match this to your Aadhaar photo to confirm it's really you.",
    shots: [
      { title: 'Take a selfie', body: 'Look straight at the camera in good light.' },
    ],
    failReason: 'Your selfie did not match your Aadhaar photo',
    successLabel: 'Selfie matched your Aadhaar photo',
  },
  home: {
    introTitle: 'Home photos',
    introBody: "We'll take two quick photos of your home, along with your location, to confirm you're genuinely there.",
    shots: [
      { title: 'Show your entrance', body: 'Use your rear camera. Point it at your house number or door.' },
      { title: 'Show yourself at home', body: 'Switch to your front camera, with your home visible behind you.' },
    ],
    failReason: 'Your live check did not confirm your home address',
    successLabel: 'Live check confirmed your home address',
  },
  office: {
    introTitle: 'Office photos',
    introBody: "We'll take two quick photos of your office, along with your location.",
    shots: [
      { title: 'Show your office entrance', body: 'Use your rear camera. Point it at the entrance, nameplate, or signage.' },
      { title: 'Show yourself at the office', body: 'Switch to your front camera, with your office visible behind you.' },
    ],
    failReason: 'Your office photo did not confirm the address',
    successLabel: 'Live photo confirmed your office address',
  },
  business: {
    introTitle: 'Shop photos',
    introBody: "We'll take two quick photos of your shop, along with your location. This replaces uploading documents.",
    shots: [
      { title: 'Show your shop front', body: "Use your rear camera. Point it at your shop's signage or entrance." },
      { title: 'Show yourself at the shop', body: 'Switch to your front camera, with your shop visible behind you.' },
    ],
    failReason: 'Your shop photo did not confirm the address',
    successLabel: 'Live photo confirmed your shop address',
  },
};

const TRANSIENT = new Set(['bureau-checking', 'home-checking', 'income-docs-checking', 'capture-checking']);

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

function pushTrace(label) { state.trace.push({ ok: true, label }); }
function declineNow(reason, retryTarget) {
  state.trace.push({ ok: false, label: reason });
  state.retryTarget = retryTarget;
  goto('outcome-decline', { replace: true });
}
function finalizeOutcome() { goto('outcome-clear', { replace: true }); }

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
  const T = state.toggles;
  const rows = [
    ['selfOwnedMatch', 'Property record matches (self-owned)'],
    ['landlordConfirmed', 'Landlord confirms tenancy'],
    ['captureOk', 'Live capture succeeds'],
    ['gstinPanValid', 'GSTIN + business PAN valid'],
    ['epfoAvailable', 'EPFO record available'],
  ];
  panel.innerHTML = `
    <div class="dt">Background checks (reviewer only)</div>
    ${rows.map(([key, label]) => `
      <label class="dtoggle"><input type="checkbox" id="tg-${key}" ${T[key] ? 'checked' : ''}> ${label}</label>
    `).join('')}
    <button class="demo-restart" id="demo-restart">Restart flow</button>
  `;
  rows.forEach(([key]) => {
    document.getElementById(`tg-${key}`).addEventListener('change', (e) => { state.toggles[key] = e.target.checked; });
  });
  document.getElementById('demo-restart').addEventListener('click', resetFlow);
}

function resetFlow() {
  clearInterval(state.resendTimer);
  const toggles = state.toggles;
  Object.assign(state, {
    screen: 'welcome', history: [], toggles,
    loanAmount: '', tier: null,
    aadhaarNumber: '', aadhaarOtp: '', aadhaarVerifying: false, resendIn: 0, resendTimer: null,
    persona: null, hasGst: null,
    personalEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
    workEmail: { value: '', otpSent: false, otp: '', verifying: false, verified: false },
    pan: '', cibilScore: null,
    incomeAccount: null,
    homeSameAsAadhaar: null,
    homePincode: '', homeCity: '', homeState: '', homeAddressLine: '',
    homeOwnership: null,
    officeBuilding: '', officeFloor: '', officeUnit: '', officePincode: '', officeCity: '', officeState: '',
    officeValidating: false, officeValidated: false,
    businessChoice: null, businessGstinInput: '', businessPanInput: '',
    captureContext: null, captureShotIndex: 0, geoLoading: false, geoConfirmed: false,
    trace: [], retryTarget: null, traceOpen: false,
  });
  render();
}

// ---- topbar (back + progress) ------------------------------------------
const STAGE_LABELS = ['', 'Identity', 'CIBIL & income', 'Home address', 'Office & business', 'Done'];
const STATIC_STAGE_OF = {
  welcome: 0,
  'loan-amount': 1, 'tier-notice': 1, 'aadhaar-number': 1, 'aadhaar-otp': 1, persona: 1, 'gst-check': 1, 'email-verify': 1,
  pan: 2, 'bureau-checking': 2, offer: 2, 'income-account': 2, 'income-docs-checking': 2,
  'home-same': 3, 'home-pincode': 3, 'home-ownership': 3, 'home-checking': 3,
  'office-address': 4, 'business-address': 4, 'business-documents': 4,
  'outcome-clear': 5, 'outcome-decline': 5, 'support-stub': 5,
};
const CAPTURE_STAGE = { selfie: 1, home: 3, office: 4, business: 4 };
const NO_BACK = new Set(['welcome', 'bureau-checking', 'home-checking', 'income-docs-checking', 'capture-checking', 'outcome-clear', 'outcome-decline']);

function currentStage() {
  if (state.screen.startsWith('capture-')) return CAPTURE_STAGE[state.captureContext] ?? 1;
  return STATIC_STAGE_OF[state.screen] ?? 0;
}

function renderTopbar() {
  const stage = currentStage();
  const canBack = !NO_BACK.has(state.screen) && state.history.length > 0;
  topbarEl.innerHTML = `
    ${canBack ? `<button class="back-btn" id="back-btn" aria-label="Back">${ICONS.chevronLeft}</button>` : (stage > 0 ? '<span class="back-spacer"></span>' : '')}
    ${stage > 0 ? `
      <div class="progress-wrap">
        <div class="progress-track">
          ${[1, 2, 3, 4, 5].map((i) => `<div class="progress-seg ${i <= stage ? 'done' : ''}"><span class="fill"></span></div>`).join('')}
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
// screen is open, and a full re-render on that cadence recreates the OTP
// input mid-keystroke. Never call render() from a timer that can fire
// while an input on screen might have focus.
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
        <h1 class="screen-title">Let's get your loan verified</h1>
        <p class="screen-sub">A few quick steps, right from your phone. What we ask for depends on your loan amount and how you earn, nothing more than we need.</p>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="loan-amount">Get started</button></div>
    `;
  },

  'loan-amount'() {
    const chips = [100000, 300000, 500000, 1000000];
    return `
      <span class="eyebrow">${ICONS.bank} Loan details</span>
      <h1 class="screen-title">How much would you like to borrow?</h1>
      <label for="loan-amount-input">Loan amount</label>
      <input id="loan-amount-input" type="text" inputmode="numeric" placeholder="e.g. 500000" value="${state.loanAmount}">
      <div class="chip-row">
        ${chips.map((c) => `<button type="button" class="chip" data-amount="${c}">₹${c / 100000}L</button>`).join('')}
      </div>
      <div class="value-nudge">${ICONS.info} Loans above ₹${formatINR(LOAN_TIER_THRESHOLD)} also require a live photo capture of your home, to confirm you actually live there.</div>
      <div class="btn-row"><button class="btn btn-primary" id="continue-loan-amount" ${Number(state.loanAmount) > 0 ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'tier-notice'() {
    return `
      <span class="eyebrow">${ICONS.shield} Before we start</span>
      <h1 class="screen-title">Since you're borrowing ₹${formatINR(state.loanAmount)}, we'll also ask for a few live photos</h1>
      <p class="screen-sub">Each one confirms you're genuinely at the address you give us. We'll ask for these once, at the right point, nothing repeated.</p>
      <div class="reassure-list">
        <div class="reassure-item"><div class="reassure-icon">${ICONS.idcard}</div><div class="reassure-text"><div class="rt">A selfie</div><div class="rs">Matched against your Aadhaar photo</div></div></div>
        <div class="reassure-item"><div class="reassure-icon">${ICONS.home}</div><div class="reassure-text"><div class="rt">Two photos of your home</div><div class="rs">Your entrance and yourself, plus your location</div></div></div>
        <div class="reassure-item"><div class="reassure-icon">${ICONS.bank}</div><div class="reassure-text"><div class="rt">Two photos of your office or shop</div><div class="rs">Same as above, if that applies to you</div></div></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="continue-tier-notice">Continue</button></div>
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
    return `
      <span class="eyebrow">${ICONS.idcard} Verify code</span>
      <h1 class="screen-title">Enter the code we sent</h1>
      <p class="screen-sub">Sent to your Aadhaar-registered mobile number, ending in ${PROFILE.linkedMobileLast4}. <span class="mono">(Demo, any 6 digits work)</span></p>
      <input id="aadhaar-otp-input" class="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="······" value="${state.aadhaarOtp}">
      <div class="btn-row">
        <button class="btn btn-primary" id="verify-aadhaar-otp" ${state.aadhaarOtp.length === 6 ? '' : 'disabled'}>${state.aadhaarVerifying ? '<span class="spin"></span>' : 'Verify'}</button>
        <button class="link-btn" id="resend-aadhaar-otp">Resend code in 0:30</button>
      </div>
    `;
  },

  'capture-intro'() {
    const c = CAPTURE_COPY[state.captureContext];
    return `
      <div style="margin-top:6px;">
        <div class="hero-icon">${ICONS.shield}</div>
        <h1 class="screen-title">${c.introTitle}</h1>
        <p class="screen-sub">${c.introBody}</p>
        <div class="reassure-list">
          <div class="reassure-item"><div class="reassure-icon">${ICONS.lock}</div><div class="reassure-text"><div class="rt">Kept secure</div><div class="rs">Encrypted and used only to verify this application.</div></div></div>
          <div class="reassure-item"><div class="reassure-icon">${ICONS.noVisit}</div><div class="reassure-text"><div class="rt">No one visits</div><div class="rs">This replaces an in-person visit for this step.</div></div></div>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="capture-continue">Continue</button></div>
    `;
  },

  'capture-geo'() {
    if (state.geoConfirmed) {
      return `
        <h1 class="screen-title">Location confirmed</h1>
        <div class="geo-card"><div class="gi">${ICONS.pin}</div><div><div class="gt">You're in the right area</div><div class="gs">Confirmed just now</div></div></div>
        <div class="btn-row"><button class="btn btn-primary" id="geo-continue">Continue</button></div>
      `;
    }
    return `
      <div class="hero-icon">${ICONS.pin}</div>
      <h1 class="screen-title">Confirm your location</h1>
      <p class="screen-sub">We'll only ask for this once, then reuse it for every photo in this application. Not continuous tracking, and never shared elsewhere.</p>
      <div class="btn-row"><button class="btn btn-primary" id="capture-geo-btn">${state.geoLoading ? '<span class="spin"></span>' : 'Share location'}</button></div>
    `;
  },

  'capture-camera'() {
    const c = CAPTURE_COPY[state.captureContext];
    const shot = c.shots[state.captureShotIndex];
    const multi = c.shots.length > 1;
    return `
      <h1 class="screen-title">${shot.title}</h1>
      <p class="screen-sub">${shot.body}</p>
      <div class="camera-illustration" id="camera-view">
        <div class="ci-icon">${ICONS.camera}</div>
        <div class="guidance-pill" id="guidance-pill"><span class="guidance-dot"></span><span id="guidance-text">Position it in the frame</span></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="capture-photo" disabled>${multi ? `Capture (${state.captureShotIndex + 1}/${c.shots.length})` : 'Take photo'}</button></div>
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

  persona() {
    const options = [
      { id: 'salaried', t: 'Salaried', s: 'I work for an employer and get a monthly salary' },
      { id: 'selfEmployed', t: 'Self Employed', s: 'Freelancer, consultant, or professional practice' },
      { id: 'businessOwner', t: 'Business Owner', s: 'I run a shop, store, or business outlet' },
    ];
    return `
      <span class="eyebrow">${ICONS.home} About your work</span>
      <h1 class="screen-title">What best describes you?</h1>
      <p class="screen-sub">This decides what we ask for next, nothing more than we need.</p>
      ${options.map((o) => `
        <div class="radio-card ${state.persona === o.id ? 'selected' : ''}" data-persona="${o.id}">
          <div class="dot"></div>
          <div><div class="rt">${o.t}</div><div class="rs">${o.s}</div></div>
        </div>`).join('')}
      <div class="btn-row"><button class="btn btn-primary" id="continue-persona" ${state.persona ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'gst-check'() {
    return `
      <span class="eyebrow">${ICONS.doc} About your work</span>
      <h1 class="screen-title">Do you have a GST registration?</h1>
      <p class="screen-sub">If your work is registered for GST, we can verify your business address using that registration instead of extra paperwork.</p>
      <div class="radio-card ${state.hasGst === true ? 'selected' : ''}" data-gst="yes"><div class="dot"></div><div><div class="rt">Yes, I have GST registration</div></div></div>
      <div class="radio-card ${state.hasGst === false ? 'selected' : ''}" data-gst="no"><div class="dot"></div><div><div class="rt">No, I don't</div></div></div>
      <div class="btn-row"><button class="btn btn-primary" id="continue-gst" ${state.hasGst === null ? 'disabled' : ''}>Continue</button></div>
    `;
  },

  'email-verify'() {
    const needsWork = state.persona === 'salaried';
    return `
      <span class="eyebrow">${ICONS.mail} Contact details</span>
      <h1 class="screen-title">Verify your email${needsWork ? 's' : ''}</h1>
      <p class="screen-sub">${needsWork ? "Your personal email is where we send statements. Your office email helps confirm your employer and gives us a second way to reach you." : "We'll use this for statements and account updates."}</p>
      ${emailBlock('personalEmail', 'Personal email', 'you@example.com')}
      ${needsWork ? emailBlock('workEmail', 'Office email', 'you@company.com') : ''}
      <div class="btn-row"><button class="btn btn-primary" id="continue-emails" ${state.personalEmail.verified && (!needsWork || state.workEmail.verified) ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  pan() {
    return `
      <span class="eyebrow">${ICONS.bank} Credit check</span>
      <h1 class="screen-title">Let's check your credit score</h1>
      <p class="screen-sub">Enter your PAN. This is a soft check and never affects your credit score.</p>
      <input id="pan-input" type="text" placeholder="ABCDE1234F" maxlength="10" style="text-transform:uppercase" value="${state.pan}">
      <div class="btn-row"><button class="btn btn-primary" id="pull-bureau" ${state.pan.length === 10 ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'bureau-checking'() {
    return `
      <div style="margin-top:12px;">
        <h1 class="screen-title">Just a moment</h1>
        <p class="screen-sub">Checking your credit record.</p>
        <div id="bureau-check-list"></div>
      </div>
    `;
  },

  offer() {
    return `
      <div class="center" style="margin-top:8px;">
        <div class="hero-icon">${ICONS.chart}</div>
        <h1 class="screen-title">Good news, here's your score</h1>
        <p class="screen-sub">Your CIBIL score is <strong>${state.cibilScore}</strong>. Based on this, you're eligible for the amount you asked for.</p>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="income-account">Continue</button></div>
    `;
  },

  'income-account'() {
    return `
      <span class="eyebrow">${ICONS.bank} Income check</span>
      <h1 class="screen-title">Where does your income settle?</h1>
      <p class="screen-sub">We found these accounts linked to your PAN. Pick the one your salary or income is paid into each month.</p>
      ${BANK_ACCOUNTS.map((b) => `
        <div class="radio-card ${state.incomeAccount === b.id ? 'selected' : ''}" data-account="${b.id}">
          <div class="dot"></div>
          <div><div class="rt">${b.label}</div></div>
        </div>`).join('')}
      <div class="btn-row"><button class="btn btn-primary" id="continue-income-account" ${state.incomeAccount ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'income-docs-checking'() {
    const isBiz = state.persona === 'businessOwner';
    return `
      <div style="margin-top:12px;">
        <h1 class="screen-title">Just a moment</h1>
        <p class="screen-sub">${isBiz ? 'Fetching your GST returns.' : 'Fetching your income tax returns.'}</p>
        <div id="income-docs-check-list"></div>
      </div>
    `;
  },

  'home-same'() {
    return `
      <span class="eyebrow">${ICONS.home} Home address</span>
      <h1 class="screen-title">Do you currently live at your Aadhaar address?</h1>
      <p class="screen-sub">${PROFILE.aadhaarAddress}</p>
      <div class="radio-card ${state.homeSameAsAadhaar === true ? 'selected' : ''}" data-same="yes"><div class="dot"></div><div><div class="rt">Yes, same address</div></div></div>
      <div class="radio-card ${state.homeSameAsAadhaar === false ? 'selected' : ''}" data-same="no"><div class="dot"></div><div><div class="rt">No, I live somewhere else now</div></div></div>
      <div class="btn-row"><button class="btn btn-primary" id="continue-home-same" ${state.homeSameAsAadhaar === null ? 'disabled' : ''}>Continue</button></div>
    `;
  },

  'home-pincode'() {
    const showRest = state.homePincode.replace(/\D/g, '').length === 6;
    return `
      <span class="eyebrow">${ICONS.pin} Home address</span>
      <h1 class="screen-title">What's your current address?</h1>
      <p class="screen-sub">Start with your pincode, we'll fill in the city and state.</p>
      <label for="home-pincode-input">Pincode</label>
      <input id="home-pincode-input" type="text" inputmode="numeric" maxlength="6" placeholder="e.g. 400001" value="${state.homePincode}">
      ${showRest ? `
        <div class="value-nudge">${ICONS.pin} ${state.homeCity}, ${state.homeState}</div>
        <label for="home-address-input">Complete address</label>
        <textarea id="home-address-input" rows="3" placeholder="House / flat no., street, locality">${state.homeAddressLine}</textarea>
      ` : ''}
      <div class="btn-row"><button class="btn btn-primary" id="continue-home-pincode" ${showRest && state.homeAddressLine.trim() ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'home-ownership'() {
    const options = [
      { id: 'self', t: 'Self-owned', s: 'This property is registered in my name' },
      { id: 'family', t: 'Family-owned', s: 'Owned by my parents or another family member' },
      { id: 'rented', t: 'Rented', s: "I'm a tenant here" },
    ];
    return `
      <span class="eyebrow">${ICONS.home} Home address</span>
      <h1 class="screen-title">Is this home owned or rented?</h1>
      <p class="screen-sub">This decides how we confirm it, no paperwork either way.</p>
      ${options.map((o) => `
        <div class="radio-card ${state.homeOwnership === o.id ? 'selected' : ''}" data-ownership="${o.id}">
          <div class="dot"></div>
          <div><div class="rt">${o.t}</div><div class="rs">${o.s}</div></div>
        </div>`).join('')}
      <div class="btn-row"><button class="btn btn-primary" id="continue-home-ownership" ${state.homeOwnership ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'home-checking'() {
    return `
      <div style="margin-top:12px;">
        <h1 class="screen-title">Just a moment</h1>
        <p class="screen-sub">${state.homeOwnership === 'rented' ? 'Confirming your tenancy.' : 'Confirming ownership.'}</p>
        <div id="home-check-list"></div>
      </div>
    `;
  },

  'office-address'() {
    const showCityState = state.officePincode.replace(/\D/g, '').length === 6;
    const canValidate = state.officeBuilding.trim() && state.officeFloor.trim() && state.officeUnit.trim() && showCityState;
    return `
      <span class="eyebrow">${ICONS.bank} Office address</span>
      <h1 class="screen-title">What's your office address?</h1>
      <p class="screen-sub">We'll validate this in real time, like checking it on a map.</p>
      <label for="office-building-input">Building name</label>
      <input id="office-building-input" type="text" placeholder="e.g. Cyber Towers" value="${state.officeBuilding}">
      <label for="office-floor-input">Floor</label>
      <input id="office-floor-input" type="text" placeholder="e.g. 4th Floor" value="${state.officeFloor}">
      <label for="office-unit-input">Office / unit number</label>
      <input id="office-unit-input" type="text" placeholder="e.g. Suite 402" value="${state.officeUnit}">
      <label for="office-pincode-input">Pincode</label>
      <input id="office-pincode-input" type="text" inputmode="numeric" maxlength="6" placeholder="e.g. 500081" value="${state.officePincode}">
      ${showCityState ? `<div class="value-nudge">${ICONS.pin} ${state.officeCity}, ${state.officeState}</div>` : ''}
      ${state.officeValidated ? `
        <div class="geo-card"><div class="gi">${ICONS.check}</div><div><div class="gt">Address validated</div><div class="gs">Matches a real location on the map</div></div></div>
        <div class="recovery-card tint-brand">
          <div class="check-row" style="border:none;padding:6px 0;"><div class="check-icon ${state.toggles.epfoAvailable ? 'ok' : ''}">${state.toggles.epfoAvailable ? ICONS.check : ''}</div><div class="check-name">EPFO record found (bonus)</div></div>
          <div class="check-row" style="border:none;padding:6px 0;"><div class="check-icon ${state.toggles.epfoAvailable ? 'ok' : ''}">${state.toggles.epfoAvailable ? ICONS.check : ''}</div><div class="check-name">Salary account matches employer (bonus)</div></div>
        </div>
      ` : ''}
      <div class="btn-row">
        <button class="btn btn-primary" id="${state.officeValidated ? 'continue-office' : 'validate-office'}" ${state.officeValidated || canValidate ? '' : 'disabled'}>${state.officeValidating ? '<span class="spin"></span>' : (state.officeValidated ? 'Continue' : 'Validate address')}</button>
      </div>
    `;
  },

  'business-address'() {
    const gstin = buildGstin(state.pan);
    return `
      <span class="eyebrow">${ICONS.shop} Business address</span>
      <h1 class="screen-title">Let's confirm your business address</h1>
      <div class="geo-card"><div class="gi">${ICONS.doc}</div><div><div class="gt">${BUSINESS_INFO.legalName}</div><div class="gs">GSTIN ${gstin}, found using your PAN</div></div></div>
      <p class="screen-sub">Confirm this address with a live photo of your shop, or upload your GSTIN and business PAN instead.</p>
      <div class="radio-card ${state.businessChoice === 'photo' ? 'selected' : ''}" data-bizchoice="photo">
        <div class="dot"></div><div><div class="rt">Take a live shop photo</div><div class="rs">Quickest, confirms the address right away</div></div>
      </div>
      <div class="radio-card ${state.businessChoice === 'documents' ? 'selected' : ''}" data-bizchoice="documents">
        <div class="dot"></div><div><div class="rt">Upload GSTIN and business PAN</div><div class="rs">No photo needed</div></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="continue-business-choice" ${state.businessChoice ? '' : 'disabled'}>Continue</button></div>
    `;
  },

  'business-documents'() {
    return `
      <span class="eyebrow">${ICONS.doc} Business documents</span>
      <h1 class="screen-title">Confirm your business registration</h1>
      <label for="biz-gstin-input">GSTIN</label>
      <input id="biz-gstin-input" type="text" placeholder="07ABCDE1234F1Z5" maxlength="15" style="text-transform:uppercase" value="${state.businessGstinInput}">
      <label for="biz-pan-input">Business PAN</label>
      <input id="biz-pan-input" type="text" placeholder="ABCDE1234F" maxlength="10" style="text-transform:uppercase" value="${state.businessPanInput}">
      <div class="btn-row"><button class="btn btn-primary" id="submit-business-docs" ${state.businessGstinInput.length === 15 && state.businessPanInput.length === 10 ? '' : 'disabled'}>Submit</button></div>
    `;
  },

  'outcome-clear'() {
    return outcomeMarkup({
      tone: 'success',
      headline: "You're verified",
      sub: 'Your identity, income, and address checks are all confirmed.',
      cta: 'See my loan offer',
      celebrate: true,
    });
  },

  'outcome-decline'() {
    return outcomeMarkup({
      tone: 'neutral',
      headline: "We couldn't confirm this automatically",
      sub: "That's alright, this happens sometimes. You're welcome to try again, or we can help directly.",
      cta: 'Try again',
      ctaAction: 'retry',
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
        ${state.trace.map((t) => `<div class="trace-line ${t.ok ? 'yes' : 'no'}">${t.ok ? ICONS.check : ICONS.x}<span>${t.label}</span></div>`).join('')}
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="outcome-cta" data-action="${ctaAction || 'restart'}">${cta}</button>
      ${secondaryCta ? `<button class="link-btn muted" id="outcome-secondary">${secondaryCta}</button>` : ''}
    </div>
  `;
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

  if (state.screen === 'loan-amount') {
    bindInput('loan-amount-input', {
      transform: (v) => v.replace(/\D/g, ''),
      onChange: (v) => { state.loanAmount = v; },
      buttonId: 'continue-loan-amount', isValid: (v) => Number(v) > 0,
    });
    root.querySelectorAll('[data-amount]').forEach((el) => el.addEventListener('click', () => {
      state.loanAmount = el.dataset.amount; render();
    }));
    document.getElementById('continue-loan-amount')?.addEventListener('click', () => {
      state.tier = loanTier(Number(state.loanAmount));
      goto(state.tier === 'large' ? 'tier-notice' : 'aadhaar-number');
    });
  }

  if (state.screen === 'tier-notice') {
    document.getElementById('continue-tier-notice')?.addEventListener('click', () => goto('aadhaar-number'));
  }

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

  if (state.screen === 'capture-intro') {
    document.getElementById('capture-continue')?.addEventListener('click', () => {
      state.captureShotIndex = 0;
      goto(needsGeo(state.captureContext) && !state.geoConfirmed ? 'capture-geo' : 'capture-camera');
    });
  }
  if (state.screen === 'capture-geo') {
    document.getElementById('capture-geo-btn')?.addEventListener('click', async () => {
      state.geoLoading = true; render();
      await sleep(800);
      state.geoLoading = false; state.geoConfirmed = true; render();
    });
    document.getElementById('geo-continue')?.addEventListener('click', () => goto('capture-camera'));
  }
  if (state.screen === 'capture-camera') runCameraGuidance();
  if (state.screen === 'capture-checking') runCaptureCheck();

  if (state.screen === 'persona') {
    root.querySelectorAll('[data-persona]').forEach((el) => el.addEventListener('click', () => { state.persona = el.dataset.persona; render(); }));
    document.getElementById('continue-persona')?.addEventListener('click', () => {
      goto(state.persona === 'selfEmployed' ? 'gst-check' : 'email-verify');
    });
  }

  if (state.screen === 'gst-check') {
    root.querySelectorAll('[data-gst]').forEach((el) => el.addEventListener('click', () => { state.hasGst = el.dataset.gst === 'yes'; render(); }));
    document.getElementById('continue-gst')?.addEventListener('click', () => goto('email-verify'));
  }

  if (state.screen === 'email-verify') {
    wireEmailBlock('personalEmail');
    if (state.persona === 'salaried') wireEmailBlock('workEmail');
    document.getElementById('continue-emails')?.addEventListener('click', () => {
      pushTrace('Personal email verified');
      if (state.persona === 'salaried') pushTrace('Office email verified');
      goto('pan');
    });
  }

  if (state.screen === 'pan') {
    bindInput('pan-input', {
      transform: (v) => v.toUpperCase().slice(0, 10),
      onChange: (v) => { state.pan = v; },
      buttonId: 'pull-bureau', isValid: (v) => v.length === 10,
    });
    document.getElementById('pull-bureau')?.addEventListener('click', () => goto('bureau-checking'));
  }

  if (state.screen === 'bureau-checking') runBureauCheck();

  if (state.screen === 'income-account') {
    root.querySelectorAll('[data-account]').forEach((el) => el.addEventListener('click', () => { state.incomeAccount = el.dataset.account; render(); }));
    document.getElementById('continue-income-account')?.addEventListener('click', () => {
      const acc = BANK_ACCOUNTS.find((b) => b.id === state.incomeAccount);
      pushTrace(`Income account on file: ${acc.label}`);
      const needsDocs = state.persona === 'businessOwner' || state.persona === 'selfEmployed';
      goto(needsDocs ? 'income-docs-checking' : 'home-same');
    });
  }

  if (state.screen === 'income-docs-checking') runIncomeDocsCheck();

  if (state.screen === 'home-same') {
    root.querySelectorAll('[data-same]').forEach((el) => el.addEventListener('click', () => { state.homeSameAsAadhaar = el.dataset.same === 'yes'; render(); }));
    document.getElementById('continue-home-same')?.addEventListener('click', () => {
      if (state.homeSameAsAadhaar) {
        state.homeAddressLine = PROFILE.aadhaarAddress;
        goto('home-ownership');
      } else {
        goto('home-pincode');
      }
    });
  }

  if (state.screen === 'home-pincode') {
    bindInput('home-pincode-input', {
      transform: (v) => v.replace(/\D/g, '').slice(0, 6),
      onChange: (v) => {
        state.homePincode = v;
        if (v.length === 6) {
          const loc = lookupPincode(v);
          state.homeCity = loc.city; state.homeState = loc.state;
          render();
        }
      },
    });
    bindInput('home-address-input', {
      onChange: (v) => { state.homeAddressLine = v; },
      buttonId: 'continue-home-pincode', isValid: (v) => v.trim().length > 0,
    });
    document.getElementById('continue-home-pincode')?.addEventListener('click', () => goto('home-ownership'));
  }

  if (state.screen === 'home-ownership') {
    root.querySelectorAll('[data-ownership]').forEach((el) => el.addEventListener('click', () => { state.homeOwnership = el.dataset.ownership; render(); }));
    document.getElementById('continue-home-ownership')?.addEventListener('click', () => goto('home-checking'));
  }

  if (state.screen === 'home-checking') runHomeCheck();

  if (state.screen === 'office-address') {
    const canValidate = () => state.officeBuilding.trim() && state.officeFloor.trim() && state.officeUnit.trim() && state.officePincode.replace(/\D/g, '').length === 6;
    bindInput('office-building-input', { onChange: (v) => { state.officeBuilding = v; state.officeValidated = false; }, buttonId: 'validate-office', isValid: canValidate });
    bindInput('office-floor-input', { onChange: (v) => { state.officeFloor = v; state.officeValidated = false; }, buttonId: 'validate-office', isValid: canValidate });
    bindInput('office-unit-input', { onChange: (v) => { state.officeUnit = v; state.officeValidated = false; }, buttonId: 'validate-office', isValid: canValidate });
    bindInput('office-pincode-input', {
      transform: (v) => v.replace(/\D/g, '').slice(0, 6),
      onChange: (v) => {
        state.officePincode = v; state.officeValidated = false;
        if (v.length === 6) {
          const loc = lookupPincode(v);
          state.officeCity = loc.city; state.officeState = loc.state;
          render();
        }
      },
      buttonId: 'validate-office', isValid: canValidate,
    });
    document.getElementById('validate-office')?.addEventListener('click', async () => {
      state.officeValidating = true; render();
      await sleep(700);
      state.officeValidating = false;
      state.officeValidated = true;
      pushTrace('Office address validated');
      if (state.toggles.epfoAvailable) pushTrace('EPFO record and salary account match employer (bonus)');
      render();
    });
    document.getElementById('continue-office')?.addEventListener('click', () => {
      if (state.tier === 'large') { state.captureContext = 'office'; goto('capture-intro'); }
      else finalizeOutcome();
    });
  }

  if (state.screen === 'business-address') {
    root.querySelectorAll('[data-bizchoice]').forEach((el) => el.addEventListener('click', () => { state.businessChoice = el.dataset.bizchoice; render(); }));
    document.getElementById('continue-business-choice')?.addEventListener('click', () => {
      const gstin = buildGstin(state.pan);
      pushTrace(`Business found using your PAN: ${BUSINESS_INFO.legalName} (GSTIN ${gstin})`);
      if (state.businessChoice === 'photo') { state.captureContext = 'business'; goto('capture-intro'); }
      else {
        state.businessGstinInput = state.businessGstinInput || gstin;
        state.businessPanInput = state.businessPanInput || state.pan;
        goto('business-documents');
      }
    });
  }

  if (state.screen === 'business-documents') {
    const isValid = () => state.businessGstinInput.length === 15 && state.businessPanInput.length === 10;
    bindInput('biz-gstin-input', {
      transform: (v) => v.toUpperCase().slice(0, 15),
      onChange: (v) => { state.businessGstinInput = v; },
      buttonId: 'submit-business-docs', isValid,
    });
    bindInput('biz-pan-input', {
      transform: (v) => v.toUpperCase().slice(0, 10),
      onChange: (v) => { state.businessPanInput = v; },
      buttonId: 'submit-business-docs', isValid,
    });
    document.getElementById('submit-business-docs')?.addEventListener('click', () => {
      const result = checkBusinessDocuments(state.toggles.gstinPanValid);
      if (result.ok) { pushTrace(result.reason); finalizeOutcome(); }
      else declineNow(result.reason, 'business-documents');
    });
  }

  if (['outcome-clear', 'outcome-decline'].includes(state.screen)) {
    if (state.screen === 'outcome-clear') fireConfetti();
    document.getElementById('trace-toggle')?.addEventListener('click', () => { state.traceOpen = !state.traceOpen; render(); });
    document.getElementById('outcome-cta')?.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      if (action === 'retry' && state.retryTarget) {
        state.trace = state.trace.filter((t) => t.ok);
        if (state.retryTarget === 'capture-camera') state.captureShotIndex = 0;
        goto(state.retryTarget);
      } else resetFlow();
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
  pushTrace('Aadhaar identity verified');
  showToast('Aadhaar and mobile verified successfully');
  if (state.tier === 'large') { state.captureContext = 'selfie'; goto('capture-intro'); }
  else goto('persona');
}

// ---- async flows ----------------------------------------------------------
async function runCameraGuidance() {
  const pill = document.getElementById('guidance-pill');
  const pillText = document.getElementById('guidance-text');
  const view = document.getElementById('camera-view');
  const btn = document.getElementById('capture-photo');
  await sleep(1200);
  view.classList.add('ready');
  pill.classList.add('ready');
  pillText.textContent = 'Looks good';
  btn.disabled = false;
  btn.addEventListener('click', () => {
    const shots = CAPTURE_COPY[state.captureContext].shots;
    if (state.captureShotIndex < shots.length - 1) {
      state.captureShotIndex++;
      render();
    } else {
      goto('capture-checking');
    }
  }, { once: true });
}

async function animateChecklist(listEl, steps) {
  const rows = steps.map((s, i) => ({ ...s, done: false, delay: i * 90 }));
  const draw = () => {
    listEl.innerHTML = rows.map((r) => `
      <div class="check-row" style="animation-delay:${r.delay}ms">
        <div class="check-icon ${r.done ? 'ok' : ''}">${r.done ? ICONS.check : ''}</div>
        <div class="check-name">${r.name}</div>
      </div>`).join('');
  };
  draw();
  for (const row of rows) { await sleep(550); row.done = true; draw(); }
  await sleep(300);
}

async function runCaptureCheck() {
  const ctx = state.captureContext;
  const ok = state.toggles.captureOk;
  const steps = ctx === 'selfie'
    ? [{ name: 'Confirming this is a live, genuine selfie', ok }, { name: 'Matching your face to your Aadhaar photo', ok }]
    : [{ name: 'Confirming both photos are live and genuine', ok }, { name: 'Matching your location', ok }, { name: 'Reading the signage or number', ok }];
  await animateChecklist(document.getElementById('capture-check-list'), steps);
  if (ok) {
    pushTrace(CAPTURE_COPY[ctx].successLabel);
    afterCaptureCleared();
  } else {
    declineNow(CAPTURE_COPY[ctx].failReason, 'capture-camera');
  }
}

function afterCaptureCleared() {
  if (state.captureContext === 'selfie') { goto('persona', { replace: true }); return; }
  if (state.captureContext === 'home') { afterHomeCleared(); return; }
  finalizeOutcome();
}

async function runBureauCheck() {
  const steps = [{ name: 'Checking your credit score', ok: true }, { name: 'Confirming your PAN details', ok: true }];
  await animateChecklist(document.getElementById('bureau-check-list'), steps);
  state.cibilScore = 762;
  pushTrace(`CIBIL score checked (${state.cibilScore})`);
  goto('offer', { replace: true });
}

async function runIncomeDocsCheck() {
  const isBiz = state.persona === 'businessOwner';
  const steps = [{ name: isBiz ? 'Fetching your GST returns' : 'Fetching your income tax returns', ok: true }];
  await animateChecklist(document.getElementById('income-docs-check-list'), steps);
  pushTrace(isBiz ? 'GST returns fetched' : 'Income tax returns fetched');
  goto('home-same', { replace: true });
}

async function runHomeCheck() {
  const ownership = state.homeOwnership;
  let steps;
  if (ownership === 'self') steps = [{ name: 'Checking government property records', ok: true }];
  else if (ownership === 'family') steps = [{ name: 'Confirming family ownership', ok: true }];
  else steps = [{ name: 'Sending your landlord a confirmation link', ok: true }, { name: 'Waiting for landlord response', ok: state.toggles.landlordConfirmed }];
  await animateChecklist(document.getElementById('home-check-list'), steps);

  const result = checkHomeRecords({
    ownership,
    selfOwnedMatch: state.toggles.selfOwnedMatch,
    landlordConfirmed: state.toggles.landlordConfirmed,
  });
  if (!result.ok) { declineNow(result.reason, 'home-ownership'); return; }
  pushTrace(result.reason);
  if (state.tier === 'large') { state.captureContext = 'home'; goto('capture-intro', { replace: true }); }
  else afterHomeCleared();
}

function afterHomeCleared() {
  if (state.persona === 'salaried') { goto('office-address', { replace: true }); return; }
  if (state.persona === 'businessOwner' || (state.persona === 'selfEmployed' && state.hasGst)) { goto('business-address', { replace: true }); return; }
  finalizeOutcome();
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
