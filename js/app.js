import { DEMO_SCENARIOS, BUREAU_LATENCY_MS, SOURCE_CHECK_LATENCY_MS } from './mock-data.js';
import { scoreCorroboration, routeFromCorroboration, routeFromCapture, MIN_TENURE_MONTHS, SOURCES_FOR_CLEAR } from './engine.js';

// ---- state -----------------------------------------------------------
const state = {
  screen: 'welcome',
  scenarioKey: 'thick_file',
  mobile: '', otp: '', pan: '',
  setupType: null,
  workEmail: '', workEmailVerified: null, // null = not attempted, true/false = result
  corroboration: null, routeDecision: null,
  geo: null, geoError: null,
  captureVerdict: null, captureRouteDecision: null,
  stream: null,
};

const scenario = () => DEMO_SCENARIOS[state.scenarioKey];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = document.getElementById('screen-root');
const progressEl = document.getElementById('progress-bar');

function goto(screen) { state.screen = screen; render(); }

// ---- demo panel (not part of the customer-facing product) ------------
function renderDemoPanel() {
  const panel = document.getElementById('demo-panel');
  panel.innerHTML = `
    <div class="dt">Demo scenario</div>
    <select id="scenario-select">
      ${Object.entries(DEMO_SCENARIOS).map(([k, s]) =>
        `<option value="${k}" ${k === state.scenarioKey ? 'selected' : ''}>${s.label}</option>`).join('')}
    </select>
    <div class="exp">Expect: ${scenario().expect}</div>
  `;
  document.getElementById('scenario-select').addEventListener('change', (e) => {
    state.scenarioKey = e.target.value;
    resetFlow();
  });
}

function resetFlow() {
  state.screen = 'welcome'; state.mobile = ''; state.otp = ''; state.pan = '';
  state.setupType = null; state.workEmail = ''; state.workEmailVerified = null;
  state.corroboration = null; state.routeDecision = null;
  state.geo = null; state.geoError = null;
  state.captureVerdict = null; state.captureRouteDecision = null;
  stopStream();
  render();
}

function stopStream() {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
}

// ---- progress bar ------------------------------------------------------
const STAGE_OF = {
  welcome: 0, mobile: 1, otp: 1, pan: 1, profile: 1,
  setup: 2, 'business-stub': 2, 'work-email': 2,
  checking: 3, 'stepup-intro': 3, 'stepup-geo': 3, 'stepup-camera': 3, 'stepup-checking': 3,
  'outcome-clear': 4, 'outcome-stepup-clear': 4, 'outcome-decline': 4,
};
const STAGE_LABELS = ['Start', 'Identity check', 'Setup selection', 'Verification', 'Outcome'];
function renderProgress() {
  const stage = STAGE_OF[state.screen] ?? 0;
  progressEl.innerHTML = `
    <div class="progress-track">
      ${[1, 2, 3, 4].map((i) => `<div class="progress-seg ${i <= stage ? 'done' : ''}"></div>`).join('')}
    </div>
    <div class="progress-label">${STAGE_LABELS[stage]}</div>
  `;
}

// ---- screens ------------------------------------------------------------
const screens = {
  welcome() {
    return `
      <div class="center" style="margin:auto 0;">
        <div class="emoji-lg">🏦</div>
        <h1 class="screen-title">Welcome to Loans24</h1>
        <p class="screen-sub">Verify your address in minutes — no paperwork, no field visit, for most applicants.</p>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="mobile">Get started</button></div>
    `;
  },

  mobile() {
    return `
      <span class="eyebrow">Identity check</span>
      <h1 class="screen-title">Enter your mobile number</h1>
      <p class="screen-sub">We'll text you a one-time code.</p>
      <label for="mobile-input">Mobile number</label>
      <input id="mobile-input" type="tel" placeholder="98XXX XXXXX" value="${state.mobile}" maxlength="10">
      <div class="value-nudge">🔒 Used to confirm it's you. Nothing else.</div>
      <div class="btn-row"><button class="btn btn-primary" id="send-otp" ${state.mobile.length === 10 ? '' : 'disabled'}>Send code</button></div>
    `;
  },

  otp() {
    return `
      <span class="eyebrow">Identity check</span>
      <h1 class="screen-title">Enter the 6-digit code</h1>
      <p class="screen-sub">Sent to +91 ${state.mobile}. <span class="mono">(Demo: any 6 digits work)</span></p>
      <input id="otp-input" class="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="——————" value="${state.otp}">
      <div class="btn-row"><button class="btn btn-primary" id="verify-otp" ${state.otp.length === 6 ? '' : 'disabled'}>Verify</button></div>
    `;
  },

  pan() {
    return `
      <span class="eyebrow">Identity check</span>
      <h1 class="screen-title">Check your loan eligibility</h1>
      <p class="screen-sub">Enter your PAN — this is a soft pull and won't affect your credit score.</p>
      <input id="pan-input" type="text" placeholder="ABCDE1234F" maxlength="10" style="text-transform:uppercase" value="${state.pan}">
      <div class="btn-row"><button class="btn btn-primary" id="pull-bureau" ${state.pan.length === 10 ? '' : 'disabled'}>Check my loan offer</button></div>
    `;
  },

  'bureau-loading'() {
    return `<div class="center" style="margin:auto 0;"><div class="spinner"></div><p class="screen-sub" style="margin-top:16px;">Pulling your bureau record…</p></div>`;
  },

  profile() {
    const p = scenario().profile;
    return `
      <span class="eyebrow">Identity check</span>
      <h1 class="screen-title">Is this you?</h1>
      <p class="screen-sub">Fetched automatically — no documents to upload.</p>
      <div class="profile-card">
        <div class="profile-row"><span class="k">Name</span><span class="v">${p.name}</span></div>
        <div class="profile-row"><span class="k">DOB</span><span class="v">${p.dob}</span></div>
        <div class="profile-row"><span class="k">Declared address</span><span class="v" style="max-width:60%;">${p.declaredAddress}</span></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" data-go="setup">Yes, this is correct</button></div>
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
      <span class="eyebrow">Setup selection</span>
      <h1 class="screen-title">Where do you work from?</h1>
      <p class="screen-sub">So we only ask for what's relevant.</p>
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
        <div class="emoji-lg">🚧</div>
        <h1 class="screen-title">Business path — Phase 2</h1>
        <p class="screen-sub">Per the locked Build List, the storefront/GSTIN-Udyam path ships after the Residential path proves out. This prototype covers Salaried, WFH, and self-employed-without-storefront.</p>
      </div>
      <div class="btn-row"><button class="btn btn-secondary" data-go="setup">← Back</button></div>
    `;
  },

  'work-email'() {
    return `
      <span class="eyebrow">Setup selection</span>
      <h1 class="screen-title">Verify your work email</h1>
      <p class="screen-sub">Optional — runs alongside address verification as a second contact channel, not instead of it.</p>
      <input id="email-input" type="email" placeholder="you@company.com" value="${state.workEmail}">
      <div class="btn-row">
        <button class="btn btn-primary" id="check-email" ${state.workEmail.includes('@') ? '' : 'disabled'}>Verify domain</button>
        <button class="link-btn" data-go="checking">Skip this step</button>
      </div>
    `;
  },

  checking() {
    return `
      <span class="eyebrow">Verification</span>
      <h1 class="screen-title">Checking your address</h1>
      <p class="screen-sub">Comparing independent records — no photo needed yet.</p>
      <div id="check-list"></div>
    `;
  },

  'outcome-clear'() {
    return outcomeMarkup({
      bannerClass: 'clear', laneTag: 'Lane A — Clear', headline: 'Verified — no capture needed',
      body: state.routeDecision.reason,
      cta: 'See loan offer',
    });
  },

  'stepup-intro'() {
    return `
      <span class="eyebrow">Verification</span>
      <h1 class="screen-title">One more step</h1>
      <p class="screen-sub">${state.routeDecision.reason}. A quick live location + photo confirms the rest — this is the fallback for applicants without enough record history yet, not the norm.</p>
      <div class="btn-row"><button class="btn btn-primary" data-go="stepup-geo">Continue</button></div>
    `;
  },

  'stepup-geo'() {
    if (state.geoError) {
      return `
        <span class="eyebrow">Verification</span>
        <h1 class="screen-title">Location access needed</h1>
        <p class="screen-sub">1. Tap the lock/info icon in your browser bar.<br>2. Switch Location to "Allow."<br>3. Try again below.</p>
        <div class="btn-row"><button class="btn btn-primary" id="retry-geo">Try again</button></div>
      `;
    }
    if (state.geo) {
      return `
        <span class="eyebrow">Verification</span>
        <h1 class="screen-title">Location captured</h1>
        <div class="geo-readout">lat ${state.geo.lat.toFixed(5)}, lon ${state.geo.lon.toFixed(5)}<br>accuracy ±${Math.round(state.geo.accuracy)}m · ${new Date(state.geo.timestamp).toLocaleTimeString()}</div>
        <p class="screen-sub">One-time read, per RBI's digital-lending permission rules — not continuous tracking.</p>
        <div class="btn-row"><button class="btn btn-primary" data-go="stepup-camera">Continue</button></div>
      `;
    }
    return `
      <span class="eyebrow">Verification</span>
      <h1 class="screen-title">Confirm your location</h1>
      <p class="screen-sub">One-time check against your declared address. Nothing is tracked continuously.</p>
      <div class="btn-row"><button class="btn btn-primary" id="capture-geo">Share location</button></div>
    `;
  },

  'stepup-camera'() {
    return `
      <span class="eyebrow">Verification</span>
      <h1 class="screen-title">Show your door number</h1>
      <p class="screen-sub">Live camera only — no gallery uploads accepted.</p>
      <div class="camera-view" id="camera-view">
        <div class="camera-placeholder" id="camera-placeholder">Starting camera…</div>
        <div class="camera-frame"></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="capture-photo" disabled>Take photo</button></div>
    `;
  },

  'stepup-checking'() {
    return `
      <span class="eyebrow">Verification</span>
      <h1 class="screen-title">Checking your submission</h1>
      <div id="capture-check-list"></div>
    `;
  },

  'outcome-stepup-clear'() {
    return outcomeMarkup({
      bannerClass: 'clear', laneTag: 'Lane B — Step-up, Clear', headline: 'Verified via live capture',
      body: state.captureRouteDecision.reason,
      cta: 'See loan offer',
    });
  },

  'outcome-decline'() {
    const reason = state.captureRouteDecision?.reason || state.routeDecision?.reason || 'Could not verify automatically.';
    return outcomeMarkup({
      bannerClass: 'decline', laneTag: 'Declined — automatic, no human review', headline: "We can't approve this automatically",
      body: reason,
      cta: 'Start over',
      declineNote: true,
    });
  },
};

function outcomeMarkup({ bannerClass, laneTag, headline, body, cta, declineNote }) {
  const trace = buildFullTrace();
  return `
    <span class="eyebrow">Outcome</span>
    <div class="lane-banner ${bannerClass}">
      <div class="lt">${laneTag}</div>
      <div class="lh">${headline}</div>
    </div>
    <p class="screen-sub">${body}</p>
    <button class="trace-toggle" id="trace-toggle">Why this decision ▾</button>
    <div class="trace-panel" id="trace-panel" hidden>
      ${trace.map((t) => `<div class="tr ${t.result}"><span class="flag">${resultFlag(t.result)}</span><span>${t.source}: ${t.detail}</span></div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="restart">${cta}</button>
      ${declineNote ? '<p class="field-hint" style="margin-top:6px;">No agent visit needed for this decision — it was made automatically from the records above.</p>' : ''}
    </div>
  `;
}
function resultFlag(r) { return { agree: '✓', conflict: '✕', 'too-fresh': '~' }[r] || '·'; }
function buildFullTrace() {
  const base = state.corroboration ? state.corroboration.trace : [];
  const capture = state.captureVerdict ? [{
    source: 'Live capture', result: state.captureVerdict.mockLocationFlag ? 'conflict' : (state.captureVerdict.geofenceOk && state.captureVerdict.ocrLivenessOk ? 'agree' : 'conflict'),
    detail: state.captureRouteDecision.reason,
  }] : [];
  return [...base, ...capture];
}

// ---- render dispatcher --------------------------------------------------
function render() {
  renderDemoPanel();
  renderProgress();
  root.innerHTML = screens[state.screen] ? screens[state.screen]() : `<p>Unknown screen: ${state.screen}</p>`;
  wireEvents();
}

// ---- event wiring per screen ---------------------------------------------
function wireEvents() {
  root.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => goto(el.dataset.go)));

  if (state.screen === 'mobile') {
    const input = document.getElementById('mobile-input');
    input.addEventListener('input', (e) => { state.mobile = e.target.value.replace(/\D/g, '').slice(0, 10); render(); document.getElementById('mobile-input').focus(); });
    document.getElementById('send-otp')?.addEventListener('click', () => goto('otp'));
  }

  if (state.screen === 'otp') {
    const input = document.getElementById('otp-input');
    input.addEventListener('input', (e) => { state.otp = e.target.value.replace(/\D/g, '').slice(0, 6); render(); document.getElementById('otp-input').focus(); });
    document.getElementById('verify-otp')?.addEventListener('click', () => goto('pan'));
  }

  if (state.screen === 'pan') {
    const input = document.getElementById('pan-input');
    input.addEventListener('input', (e) => { state.pan = e.target.value.toUpperCase().slice(0, 10); render(); document.getElementById('pan-input').focus(); });
    document.getElementById('pull-bureau')?.addEventListener('click', async () => {
      goto('bureau-loading');
      await sleep(BUREAU_LATENCY_MS);
      goto('profile');
    });
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
    input.addEventListener('input', (e) => { state.workEmail = e.target.value; render(); document.getElementById('email-input').focus(); });
    document.getElementById('check-email')?.addEventListener('click', async () => {
      const personal = /@(gmail|yahoo|outlook|hotmail)\./i.test(state.workEmail);
      await sleep(500);
      state.workEmailVerified = !personal;
      goto('checking');
    });
  }

  if (state.screen === 'checking') runCorroborationCheck();
  if (state.screen === 'stepup-checking') runCaptureCheck();

  if (state.screen === 'stepup-geo') {
    document.getElementById('capture-geo')?.addEventListener('click', captureGeo);
    document.getElementById('retry-geo')?.addEventListener('click', captureGeo);
  }
  if (state.screen === 'stepup-camera') startCamera();

  if (['outcome-clear', 'outcome-stepup-clear', 'outcome-decline'].includes(state.screen)) {
    document.getElementById('trace-toggle')?.addEventListener('click', () => {
      const p = document.getElementById('trace-panel');
      p.hidden = !p.hidden;
    });
    document.getElementById('restart')?.addEventListener('click', resetFlow);
  }
}

// ---- async flows ----------------------------------------------------------
async function runCorroborationCheck() {
  const s = scenario();
  const list = document.getElementById('check-list');
  const sources = s.sources;
  const rows = sources.map((src) => ({ src, done: false }));
  const draw = () => {
    list.innerHTML = rows.map(({ src, done }) => `
      <div class="check-row">
        <div class="check-icon ${done ? 'ok' : 'pending'}">${done ? '✓' : ''}</div>
        <div class="check-name">${src.name}</div>
      </div>`).join('') || '<p class="field-hint">No independent records available for this profile yet.</p>';
  };
  draw();
  for (const row of rows) {
    await sleep(SOURCE_CHECK_LATENCY_MS);
    row.done = true; draw();
  }
  await sleep(300);

  state.corroboration = scoreCorroboration(s.profile.declaredAddress, sources);
  state.routeDecision = routeFromCorroboration(state.corroboration);

  if (state.routeDecision.lane === 'clear') goto('outcome-clear');
  else if (state.routeDecision.lane === 'decline') goto('outcome-decline');
  else goto('stepup-intro');
}

async function captureGeo() {
  state.geoError = null;
  if (!navigator.geolocation) { state.geoError = true; render(); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp };
      render();
    },
    () => { state.geoError = true; render(); },
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

async function startCamera() {
  const placeholder = document.getElementById('camera-placeholder');
  const view = document.getElementById('camera-view');
  const btn = document.getElementById('capture-photo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    state.stream = stream;
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.srcObject = stream;
    placeholder.remove();
    view.prepend(video);
    btn.disabled = false;
    btn.addEventListener('click', () => {
      video.pause();
      stopStream();
      goto('stepup-checking');
    });
  } catch (err) {
    placeholder.textContent = 'Camera access needed — tap the lock icon in your browser bar, allow Camera, then retry.';
    btn.textContent = 'Retry';
    btn.disabled = false;
    btn.addEventListener('click', startCamera);
  }
}

async function runCaptureCheck() {
  const s = scenario();
  const cap = s.capture || { geofenceOk: true, ocrLivenessOk: true, mockLocationFlag: false };
  const steps = [
    { name: 'Geofence match', ok: cap.geofenceOk },
    { name: 'Device-integrity check', ok: !cap.mockLocationFlag },
    { name: 'OCR + liveness', ok: cap.ocrLivenessOk },
  ];
  const list = document.getElementById('capture-check-list');
  const rows = steps.map((s2) => ({ ...s2, done: false }));
  const draw = () => {
    list.innerHTML = rows.map((r) => `
      <div class="check-row">
        <div class="check-icon ${r.done ? 'ok' : 'pending'}">${r.done ? '✓' : ''}</div>
        <div class="check-name">${r.name}</div>
      </div>`).join('');
  };
  draw();
  for (const row of rows) { await sleep(600); row.done = true; draw(); }
  await sleep(300);

  state.captureVerdict = cap;
  state.captureRouteDecision = routeFromCapture(cap);
  goto(state.captureRouteDecision.lane === 'stepup-clear' ? 'outcome-stepup-clear' : 'outcome-decline');
}

// ---- boot ----------------------------------------------------------------
render();
