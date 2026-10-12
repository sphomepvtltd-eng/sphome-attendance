// ═══════════════════════════════════════════════════
//  SP HOME INTERIOR — WORKER APP  (app.js)  · v4
//  Log in once with Emp No. / name + PIN → work → auto log-out after 10 idle minutes.
//  All backend calls use CONFIG.BACKEND_URL (POST, so PIN/token never appear in a URL).
// ═══════════════════════════════════════════════════
'use strict';

/* ── Service Worker Registration ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      console.warn('[SW] Registration failed:', err);
    });
  });
}

const CFG = (typeof CONFIG !== 'undefined' && CONFIG) || {};
const API = CFG.BACKEND_URL || '';
const PFX = (CFG.STORE_PREFIX || 'att') + '_';

/* ── State ── */
const App = {
  token: '',               // server session (null while working offline)
  worker: null,            // { id, name }
  pin: '',                 // kept in memory only, used to sync offline items
  clockedIn: false,
  online: navigator.onLine,
  offlineQueue: [],
  policy: { advanceMax: 25000, sessionMinutes: (CFG.IDLE_MINUTES || 10), maxShiftHours: 16, maxTeam: 10 },
  advance: null,
  team: [],
  profile: null,
  coords: null,
  lastActivity: Date.now(),
  lastServerTouch: Date.now(),
  loginBusy: false,
};

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function uuid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ''); } catch (_) {}
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
function lsGet(k) { try { return localStorage.getItem(PFX + k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(PFX + k, v); return true; } catch (_) { return false; } }
function lsDel(k) { try { localStorage.removeItem(PFX + k); } catch (_) {} }
function lsJson(k, dflt) { try { const v = JSON.parse(lsGet(k) || 'null'); return v === null ? dflt : v; } catch (_) { return dflt; } }

function deviceId() {
  let d = lsGet('device');
  if (!d || !/^[A-Za-z0-9_-]{8,64}$/.test(d)) { d = 'd' + uuid(); lsSet('device', d); }
  return d;
}

function toast(msg, isErr) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3600);
}
function busy(on, txt) {
  const b = $('busy');
  if (!b) return;
  if (txt) $('busyTxt').textContent = txt;
  b.classList.toggle('hidden', !on);
}
function showEl(id, on) { const e = $(id); if (e) e.classList.toggle('hidden', !on); }
function money(v) { return (CFG.CURRENCY || 'Rs.') + ' ' + Math.round(Number(v) || 0).toLocaleString('en-US'); }

function apiConfigured() { return /^https:\/\/script\.google(usercontent)?\.com\//.test(API); }

function parseJson(r) {
  return r.text().then(function (txt) {
    try { return JSON.parse(txt); } catch (_) { throw new Error('Bad server response'); }
  });
}
// text/plain (NOT application/json) avoids the CORS preflight Apps Script can't answer.
function apiPost(body) {
  if (!apiConfigured()) return Promise.reject(new Error('Backend URL not set'));
  return fetch(API, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  }).then(parseJson);
}
// Authenticated call. Network problems reject; an ended session logs the worker out.
async function authCall(body) {
  const res = await apiPost(Object.assign({ token: App.token, deviceId: deviceId() }, body));
  App.lastServerTouch = Date.now();
  if (res && res.code === 'SESSION') { logout('Session ended — please log in again', true); throw new Error('session'); }
  return res;
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.readAsDataURL(blob);
  });
}

/* ── Live clock ── */
function startClock() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function tick() {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const ct = $('clockTime');
    if (ct) ct.textContent = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    const dt = $('clockDate');
    if (dt) dt.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ── Online status ── */
function updateOnline() {
  App.online = navigator.onLine;
  const bar = $('syncBar');
  if (bar) {
    bar.className = 'sync-bar ' + (App.online ? 'online' : 'offline');
    const txt = bar.querySelector('.sync-txt');
    if (txt) txt.textContent = App.online ? 'Live sync' : 'Offline mode';
  }
  if (App.online) flushQueue();
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

/* ── Offline queue (persisted; removed only after the server answers) ──
   Items carry Emp No + PIN (not the session token) so they can be accepted later.   */
function saveQueue() {
  if (!App.offlineQueue.length) { lsDel('queue'); return true; }
  return lsSet('queue', JSON.stringify(App.offlineQueue));
}
function loadQueue() {
  const list = lsJson('queue', []);
  App.offlineQueue = Array.isArray(list) ? list : [];
}
function queueAction(payload) {
  App.offlineQueue.push(payload);
  if (!saveQueue()) toast('⚠ Phone storage full — sync soon!', true);
}
let flushing = false;
async function flushQueue() {
  if (flushing || !App.online || !apiConfigured() || !App.offlineQueue.length) return;
  flushing = true;
  let synced = 0, rejected = 0, lastErr = '';
  try {
    while (App.offlineQueue.length) {
      let res;
      try { res = await apiPost(App.offlineQueue[0]); }
      catch (_) { break; }                       // network trouble → keep everything, retry later
      App.offlineQueue.shift();
      saveQueue();
      if (res && res.ok) synced++; else { rejected++; lastErr = (res && res.error) || ''; }
    }
  } finally { flushing = false; }
  if (synced) toast('✅ ' + synced + ' offline item(s) synced');
  if (rejected) toast(rejected + ' offline item(s) rejected by the server' + (lastErr ? ': ' + lastErr : ''), true);
  if (synced && App.token) refreshHome();
}
setInterval(flushQueue, 60000);

/* ── Local clock status (so Clock Out works with no signal) ── */
function maxShiftMs() { return (App.policy.maxShiftHours || 16) * 3600000; }
function getLocalStatus(id) {
  const st = lsJson('status_' + id, null);
  if (st && st.in && st.ts && (Date.now() - new Date(st.ts).getTime()) <= maxShiftMs()) return st;
  return null;
}
function setLocalStatus(id, isIn, ts) { lsSet('status_' + id, JSON.stringify({ in: !!isIn, ts: ts })); }

/* ═══════════════════════════════════════════════════
   LOGIN / LOGOUT / IDLE TIMEOUT
   ═══════════════════════════════════════════════════ */
let pinBuffer = '';

function renderPinDots() {
  document.querySelectorAll('#loginSection .pin-dot').forEach((d, i) => d.classList.toggle('filled', i < pinBuffer.length));
}
function loginError(msg) { $('loginError').textContent = msg || ''; }
function pinKey(val) {
  if (App.loginBusy) return;
  if (val === 'del') pinBuffer = pinBuffer.slice(0, -1);
  else if (pinBuffer.length < 4 && /^\d$/.test(val)) pinBuffer += val;
  renderPinDots();
  if (pinBuffer.length === 4) setTimeout(submitLogin, 120);
}
function clearPin() { pinBuffer = ''; renderPinDots(); }

function matchKnown(query) {
  const known = lsJson('known', {});
  const q = String(query).trim().toLowerCase().replace(/\s+/g, ' ');
  const compact = q.replace(/\s/g, '');
  const ids = Object.keys(known);
  let hit = ids.filter(id => id.toLowerCase() === compact);
  if (!hit.length) {
    const m = /^[a-z_-]*0*(\d+)$/.exec(compact);
    if (m) hit = ids.filter(id => { const mm = /^[A-Za-z_-]*0*(\d+)$/.exec(id); return mm && parseInt(mm[1], 10) === parseInt(m[1], 10); });
  }
  if (!hit.length) hit = ids.filter(id => String(known[id].name || '').toLowerCase().replace(/\s+/g, ' ') === q);
  return hit.length === 1 ? { id: hit[0], name: known[hit[0]].name, pin: known[hit[0]].pin } : null;
}

async function submitLogin() {
  if (App.loginBusy || pinBuffer.length !== 4) return;
  const query = $('loginId').value.trim();
  if (!query) { loginError('Type your Emp No. or name first'); clearPin(); $('loginId').focus(); return; }
  const pin = pinBuffer;
  App.loginBusy = true;
  loginError('');
  busy(true, 'Logging in…');
  try {
    if (!App.online || !apiConfigured()) { offlineLogin(query, pin); return; }
    let res;
    try { res = await apiPost({ action: 'login', query: query, pin: pin, deviceId: deviceId() }); }
    catch (err) {
      if (!apiConfigured()) { loginError('Backend URL not set in shared/config.js'); clearPin(); return; }
      offlineLogin(query, pin); return;      // server unreachable → work offline if this phone knows the worker
    }
    if (res && res.ok) {
      const known = lsJson('known', {});
      known[res.worker.id] = { name: res.worker.name, pin: pin };
      lsSet('known', JSON.stringify(known));
      lsSet('lastId', res.worker.id);
      startSession(res, pin);
    } else {
      loginError((res && res.error) || 'Login failed');
      clearPin();
    }
  } finally { App.loginBusy = false; busy(false); }
}

function offlineLogin(query, pin) {
  const lockedUntil = Number(lsGet('offlock') || 0);
  if (Date.now() < lockedUntil) { loginError('Too many wrong PINs. Try again in a few minutes.'); clearPin(); return; }
  const k = matchKnown(query);
  if (!k) { loginError('No internet. This phone has not seen this login yet — connect to the internet once.'); clearPin(); return; }
  if (k.pin !== pin) {
    const n = Number(lsGet('offfail') || 0) + 1;
    lsSet('offfail', String(n));
    if (n >= 5) { lsSet('offlock', String(Date.now() + 10 * 60000)); lsSet('offfail', '0'); loginError('Too many wrong PINs. Try again in 10 minutes.'); }
    else loginError('Wrong PIN (' + (5 - n) + ' attempts left)');
    clearPin(); return;
  }
  lsSet('offfail', '0');
  lsSet('lastId', k.id);
  startSession({ ok: true, token: '', worker: { id: k.id, name: k.name }, offline: true,
    status: (function () { const st = getLocalStatus(k.id); return { clockedIn: !!st, clockInTime: st ? st.ts : null }; })(),
    advance: null, team: [], isLeader: false }, pin);
}

function startSession(res, pin) {
  App.token = res.token || '';
  App.worker = res.worker;
  App.pin = pin;
  if (res.policy) App.policy = Object.assign(App.policy, res.policy);
  App.advance = res.advance || null;
  App.team = res.team || [];
  App.lastActivity = Date.now();
  App.lastServerTouch = Date.now();

  clearPin(); loginError('');
  $('loginId').value = '';
  showEl('loginSection', false);
  showEl('workerSection', true);
  $('whoName').textContent = App.worker.name;
  $('whoId').textContent = App.worker.id + (res.offline ? ' · offline' : '');
  resetPayBox();
  renderStatus(res.status && res.status.clockedIn, res.status && res.status.clockInTime);
  renderAdvance();
  renderTeam();
  mainCam.start();
  window.scrollTo(0, 0);
  if (res.usesDefaultPin) toast('Please change your PIN (tap 🔒 PIN) — the default PIN is not safe', true);
  if (res.offline) toast('Offline login — clock in/out will sync later');
}

function closeAllSheets() {
  document.querySelectorAll('.sheet').forEach(s => s.classList.add('hidden'));
  teamCam.stop();
  App.profile = null;
  ['pfPhone', 'pfNic', 'pfDob', 'pfAddress', 'pfBankName', 'pfBranch', 'pfAccNo', 'pfAccName', 'oldPinInput', 'newPinInput', 'confirmPinInput',
   'advanceAmount', 'advanceReason', 'leaveReason'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('pfErr')) $('pfErr').textContent = '';
}

function logout(msg, skipServer) {
  const tok = App.token;
  if (tok && !skipServer && App.online) { apiPost({ action: 'logout', token: tok }).catch(() => {}); }
  App.token = ''; App.worker = null; App.pin = ''; App.team = []; App.advance = null; App.clockedIn = false;
  mainCam.stop(); mainCam.reset();
  closeAllSheets();
  resetPayBox();
  $('payBox').innerHTML = '<div class="pay-hint">Tap the button to see your salary balance so far.</div>';
  showEl('idleWarn', false);
  showEl('workerSection', false);
  showEl('loginSection', true);
  const last = lsGet('lastId');
  $('loginId').value = last || '';
  clearPin();
  if (msg) loginError(msg);
  window.scrollTo(0, 0);
}
$('btnLogout').addEventListener('click', () => logout('', false));

/* idle timer: any touch / key / scroll counts as activity */
function touchActivity() {
  if (!App.worker) return;
  App.lastActivity = Date.now();
  if ($('idleWarn') && !$('idleWarn').classList.contains('hidden')) showEl('idleWarn', false);
  // keep the SERVER session alive while the worker is really using the app
  if (App.token && App.online && Date.now() - App.lastServerTouch > 4 * 60000) {
    App.lastServerTouch = Date.now();
    authCall({ action: 'getStatus' }).catch(() => {});
  }
}
['pointerdown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev => document.addEventListener(ev, touchActivity, { passive: true, capture: true }));

setInterval(function () {
  if (!App.worker) return;
  const idleMs = (App.policy.sessionMinutes || 10) * 60000;
  const left = idleMs - (Date.now() - App.lastActivity);
  if (left <= 0) { logout('Logged out after ' + (App.policy.sessionMinutes || 10) + ' minutes without use. Enter your PIN again.', false); return; }
  if (left <= 60000) {
    showEl('idleWarn', true);
    $('idleWarn').textContent = 'Logging out in ' + Math.ceil(left / 1000) + ' s — tap here to stay logged in';
  }
}, 1000);

document.querySelectorAll('#loginSection .pin-key').forEach(btn => {
  btn.addEventListener('click', function () { if (this.dataset.key) pinKey(this.dataset.key); });
});
document.addEventListener('keydown', function (e) {
  if (App.worker || $('loginSection').classList.contains('hidden')) return;
  if (document.activeElement && document.activeElement.id === 'loginId') {
    if (e.key === 'Enter') { e.preventDefault(); document.activeElement.blur(); }
    return;
  }
  if (/^\d$/.test(e.key)) pinKey(e.key);
  else if (e.key === 'Backspace') pinKey('del');
});

/* ═══════════════════════════════════════════════════
   STATUS / HOME DATA
   ═══════════════════════════════════════════════════ */
function formatTime(iso) {
  try { const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return String(iso); }
}

function renderStatus(isClockedIn, since) {
  App.clockedIn = !!isClockedIn;
  const banner = $('statusBanner');
  const smain = banner.querySelector('.stt-main');
  const ssub = banner.querySelector('.stt-sub');
  if (isClockedIn) {
    banner.className = 'status-banner clocked-in';
    smain.textContent = '🟢 Clocked In';
    ssub.textContent = since ? 'Since ' + formatTime(since) : 'Currently working';
  } else {
    banner.className = 'status-banner';
    smain.textContent = '⚪ Not Clocked In';
    ssub.textContent = 'Take your photo, then tap Clock In';
  }
  updateClockButtons();
}
function updateClockButtons() {
  const has = !!mainCam.blob;
  $('btnClockIn').disabled = !has || App.clockedIn;
  $('btnClockOut').disabled = !has || !App.clockedIn;
}

function renderAdvance() {
  const a = App.advance, box = $('advInfo');
  if (!a) { box.textContent = 'Limit: ' + money(App.policy.advanceMax) + ' per month.'; return; }
  box.innerHTML = 'Limit <b>' + money(a.limit) + '</b> per month · requested/approved this month <b>' + money(a.used) +
    '</b> · you can still request <b>' + money(a.left) + '</b>';
}

async function refreshHome() {
  if (!App.token || !App.online) return;
  try {
    const res = await authCall({ action: 'getStatus' });
    if (res && res.ok) {
      setLocalStatus(App.worker.id, res.status.clockedIn, res.status.clockInTime);
      renderStatus(res.status.clockedIn, res.status.clockInTime);
      App.advance = res.advance; App.team = res.team || [];
      renderAdvance(); renderTeam();
    }
  } catch (_) { /* keep what is shown */ }
}

/* ═══════════════════════════════════════════════════
   CAMERA  (opens by itself — worker only taps Capture; Flip if needed)
   ═══════════════════════════════════════════════════ */
class Cam {
  constructor(ids, front, onChange) {
    this.ids = ids; this.front = front; this.onChange = onChange || function () {};
    this.stream = null; this.blob = null; this.starting = false;
  }
  el(k) { return $(this.ids[k]); }
  msg(text) {
    const m = this.el('msg');
    if (!m) return;
    m.textContent = text || '';
    m.classList.toggle('hidden', !text);
  }
  async start() {
    if (this.starting) return;
    this.starting = true;
    this.stopStream();
    try {
      this.blob = null;
      const video = this.el('video'), preview = this.el('preview'), ph = this.el('ph'), zone = this.el('zone');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.msg('Camera is not supported on this browser'); ph.classList.add('hidden'); this.buttons(false); return;
      }
      this.msg('');
      ph.classList.remove('hidden');
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.front ? 'user' : 'environment', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      } catch (e1) {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch (e2) { throw e2; }
      }
      // user may have logged out / closed the sheet while the permission prompt was open
      if (!this.wanted()) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      video.srcObject = stream;
      video.style.transform = this.front ? 'scaleX(-1)' : 'scaleX(1)';
      await video.play();
      video.classList.remove('hidden');
      preview.classList.add('hidden');
      ph.classList.add('hidden');
      zone.classList.add('live');
      this.buttons(true);
      if (this.ids.loc) updateLocation();
    } catch (err) {
      this.stopStream();
      this.el('ph').classList.add('hidden');
      this.msg('Camera is off. Allow camera permission, then tap here to try again.');
      this.buttons(false, true);
    } finally { this.starting = false; this.onChange(); }
  }
  wanted() { return this.ids.wanted ? this.ids.wanted() : true; }
  buttons(live, canFlip) {
    this.el('capture').disabled = !live;
    this.el('flip').disabled = !(live || canFlip);
    this.el('retake').disabled = true;
  }
  stopStream() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    const v = this.el('video'); if (v) { try { v.srcObject = null; } catch (_) {} }
    const z = this.el('zone'); if (z) z.classList.remove('live');
  }
  stop() { this.stopStream(); }
  capture() {
    const video = this.el('video'), preview = this.el('preview');
    if (!video.videoWidth) { toast('Camera not ready yet', true); return; }
    const max = 720, sc = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * sc); canvas.height = Math.round(video.videoHeight * sc);
    const ctx = canvas.getContext('2d');
    if (this.front) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) { toast('Could not capture photo', true); return; }
      this.blob = blob;
      if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
      preview.dataset.url = URL.createObjectURL(blob);
      preview.src = preview.dataset.url;
      preview.classList.remove('hidden');
      video.classList.add('hidden');
      this.el('zone').classList.remove('live');
      this.el('capture').disabled = true;
      this.el('retake').disabled = false;
      this.stopStream();
      this.onChange();
    }, 'image/jpeg', 0.75);
  }
  reset() {
    this.blob = null;
    const p = this.el('preview'); if (p) { p.classList.add('hidden'); p.removeAttribute('src'); }
    const v = this.el('video'); if (v) v.classList.add('hidden');
    const ph = this.el('ph'); if (ph) ph.classList.remove('hidden');
    this.msg('');
    this.buttons(false);
    this.onChange();
  }
  bind() {
    this.el('capture').addEventListener('click', () => this.capture());
    this.el('retake').addEventListener('click', () => { this.blob = null; this.onChange(); this.start(); });
    this.el('flip').addEventListener('click', () => { this.front = !this.front; this.start(); });
    this.el('msg').addEventListener('click', () => this.start());
  }
}

const mainCam = new Cam({ video: 'wVideo', preview: 'wPreview', ph: 'selfiePh', zone: 'selfieZone', msg: 'camMsg',
  capture: 'btnCapture', retake: 'btnRetake', flip: 'btnCamToggle', loc: true,
  wanted: () => !!App.worker && !anySheetOpen() }, true, updateClockButtons);
const teamCam = new Cam({ video: 'tVideo', preview: 'tPreview', ph: 'tSelfiePh', zone: 'tSelfieZone', msg: 'tCamMsg',
  capture: 'tCapture', retake: 'tRetake', flip: 'tFlip', wanted: () => !$('teamSheet').classList.contains('hidden') }, false,
  function () { $('tConfirm').disabled = !teamCam.blob; });
mainCam.bind(); teamCam.bind();

function anySheetOpen() { return !!document.querySelector('.sheet:not(.hidden)'); }

// battery + privacy: camera off while the app is in the background
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { mainCam.stopStream(); teamCam.stopStream(); return; }
  if (App.worker && !mainCam.blob && !anySheetOpen()) mainCam.start();
  if (!$('teamSheet').classList.contains('hidden') && !teamCam.blob) teamCam.start();
});
window.addEventListener('pagehide', () => { mainCam.stopStream(); teamCam.stopStream(); });

/* ── Geolocation ── */
function updateLocation() {
  const chip = $('locChip');
  if (!chip) return;
  if (!navigator.geolocation) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  const txt = chip.querySelector('.loc-txt');
  txt.textContent = '📍 Getting location…';
  navigator.geolocation.getCurrentPosition(pos => {
    App.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
    txt.innerHTML = `📍 <b>${App.coords.lat.toFixed(5)}, ${App.coords.lng.toFixed(5)}</b> ±${App.coords.acc}m`;
  }, () => {
    App.coords = null;
    txt.textContent = '📍 Location unavailable';
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}

/* ═══════════════════════════════════════════════════
   CLOCK IN / OUT  (no PIN prompt — the worker is already logged in)
   ═══════════════════════════════════════════════════ */
async function doClock(kind) {
  if (!App.worker) return;
  if (!mainCam.blob) { toast('Please take your photo first', true); return; }
  const isIn = kind === 'clockIn';
  busy(true, isIn ? 'Clocking in…' : 'Clocking out…');
  try {
    const photo = await blobToBase64(mainCam.blob);
    const base = {
      action: kind, clientId: uuid(), deviceId: deviceId(), photo: photo,
      lat: App.coords ? App.coords.lat : null, lng: App.coords ? App.coords.lng : null, accuracy: App.coords ? App.coords.acc : null,
    };
    let res = null, netFail = !App.token || !App.online;
    if (!netFail) { try { res = await authCall(base); } catch (e) { if (!App.worker) return; netFail = true; } }

    if (netFail) {                       // offline (or server unreachable): keep it on the phone, sync later
      if (!apiConfigured()) { toast('Backend URL not set in shared/config.js', true); return; }
      const ts = new Date().toISOString();
      queueAction(Object.assign({}, base, { workerId: App.worker.id, pin: App.pin, offline: true, timestamp: ts }));
      afterClock(isIn, ts, ' (offline — will sync)');
      return;
    }
    if (res && res.ok) { afterClock(isIn, res.at || new Date().toISOString(), res.photoError ? ' (photo not saved)' : ''); }
    else { toast((res && res.error) || 'Server error', true); refreshHome(); }
  } catch (err) {
    if (App.worker) toast(err && err.message ? err.message : 'Something went wrong', true);
  } finally { busy(false); }
}
function afterClock(isIn, ts, sfx) {
  setLocalStatus(App.worker.id, isIn, ts);
  renderStatus(isIn, ts);
  mainCam.reset();
  toast((isIn ? '✅ Clocked In' : '✅ Clocked Out') + (sfx || ''));
  mainCam.start();
}
$('btnClockIn').addEventListener('click', () => doClock('clockIn'));
$('btnClockOut').addEventListener('click', () => doClock('clockOut'));

/* ═══════════════════════════════════════════════════
   TEAM LEADER MODE
   ═══════════════════════════════════════════════════ */
function renderTeam() {
  const list = App.team || [];
  showEl('teamCard', list.length > 0 && !!App.token);
  $('teamList').innerHTML = list.map(m => `
    <div class="team-row">
      <div class="tn">${esc(m.name)}<small class="${m.clockedIn ? 'on' : ''}">${esc(m.id)} · ${m.clockedIn ? '🟢 In since ' + esc(formatTime(m.since)) : '⚪ Not clocked in'}</small></div>
      <button class="btn ${m.clockedIn ? 'btn-red' : 'btn-green'}" data-act="team" data-id="${esc(m.id)}" data-type="${m.clockedIn ? 'out' : 'in'}">${m.clockedIn ? 'Clock Out' : 'Clock In'}</button>
    </div>`).join('');
}
let teamTarget = null;
$('teamList').addEventListener('click', function (e) {
  const b = e.target.closest('button[data-act="team"]');
  if (!b) return;
  const m = (App.team || []).find(x => x.id === b.dataset.id);
  if (!m) return;
  teamTarget = { id: m.id, name: m.name, type: b.dataset.type };
  $('teamSheetTitle').textContent = (teamTarget.type === 'in' ? '🟢 Clock In — ' : '🔴 Clock Out — ') + m.name;
  $('tConfirm').textContent = 'Confirm ' + (teamTarget.type === 'in' ? 'Clock In' : 'Clock Out') + ' for ' + m.name;
  $('tConfirm').disabled = true;
  $('tErr').textContent = '';
  mainCam.stopStream();
  $('teamSheet').classList.remove('hidden');
  teamCam.reset();
  teamCam.start();
});
function closeTeamSheet() {
  $('teamSheet').classList.add('hidden');
  teamCam.stop(); teamCam.reset(); teamTarget = null;
  if (App.worker && !mainCam.blob && !anySheetOpen()) mainCam.start();
}
$('closeTeamSheet').addEventListener('click', closeTeamSheet);
$('tConfirm').addEventListener('click', async function () {
  if (!teamTarget || !teamCam.blob || !App.worker) return;
  if (!App.token || !App.online) { $('tErr').textContent = 'Internet connection needed for team clocking'; return; }
  const btn = this;
  btn.disabled = true; $('tErr').textContent = '';
  busy(true, 'Saving…');
  try {
    const photo = await blobToBase64(teamCam.blob);
    const res = await authCall({ action: 'teamClock', targetId: teamTarget.id, type: teamTarget.type, clientId: uuid(), photo: photo,
      lat: App.coords ? App.coords.lat : null, lng: App.coords ? App.coords.lng : null, accuracy: App.coords ? App.coords.acc : null });
    if (res && res.ok) {
      if (res.team) { App.team = res.team; renderTeam(); }
      toast('✅ ' + teamTarget.name + (teamTarget.type === 'in' ? ' clocked in' : ' clocked out'));
      closeTeamSheet();
    } else {
      $('tErr').textContent = (res && res.error) || 'Could not save';
      btn.disabled = false;
      refreshHome();
    }
  } catch (err) {
    if (App.worker) { $('tErr').textContent = 'Network error — try again'; btn.disabled = false; }
  } finally { busy(false); }
});

/* ═══════════════════════════════════════════════════
   MY SALARY / NOTICES
   ═══════════════════════════════════════════════════ */
function resetPayBox() {
  const box = $('payBox');
  if (box) box.innerHTML = '<div class="pay-hint">Tap the button to see your salary balance so far.</div>';
  const btn = $('btnShowPay');
  if (btn) btn.textContent = '👁 Show My Salary';
}
function needOnline() {
  if (!App.token || !App.online) { toast('Internet connection needed', true); return true; }
  return false;
}

function renderPay(res) {
  const box = $('payBox');
  const p = res && res.pay;
  if (!p) { box.innerHTML = '<div class="pay-hint">Could not load salary</div>'; return; }
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const asOf = res.asOf ? new Date(res.asOf) : new Date();
  const fixed = p.payType === 'fixed';
  const rows = fixed
    ? `<div class="pay-row"><span>Fixed monthly salary</span><span class="num">${money(p.basicPay)}</span></div>`
    : `<div class="pay-row"><span>Full working days</span><span class="num">${esc(p.days)}</span></div>
       <div class="pay-row"><span>Day pay</span><span class="num">${money(p.basicPay)}</span></div>
       <div class="pay-row"><span>OT (${esc(p.otHours)} hrs)</span><span class="num">${money(p.otPay)}</span></div>
       <div class="pay-row"><span>Short-day pay</span><span class="num">${money(p.shortPay)}</span></div>
       <div class="pay-row"><span>Attendance bonus</span><span class="num">${money(p.bonus)}</span></div>`;
  const allow = (p.allowance || 0) > 0 ? `<div class="pay-row"><span>Special allowance</span><span class="num">${money(p.allowance)}</span></div>` : '';
  box.innerHTML = `
    <div class="pay-big">
      <div class="k">Balance so far · ${esc(months[(res.month || 1) - 1])} ${esc(res.year)}</div>
      <div class="v num">${money(p.net)}</div>
    </div>
    ${rows}${allow}
    <div class="pay-row"><span>Total earned</span><span class="num">${money(p.gross)}</span></div>
    <div class="pay-row neg"><span>Advances taken</span><span class="num">− ${money(p.advance)}</span></div>
    <div class="pay-note">${fixed ? '' : 'Bonus: ' + money(res.bonusPerDay) + ' per full day, only when you complete ' + esc(res.bonusMinDays) + ' or more full days. '}
      Updated ${esc(asOf.toLocaleString())}. Final amount is confirmed by the office at month end.</div>
    ${p.incomplete ? `<div class="pay-warn">⚠ ${esc(p.incomplete)} shift(s) have no clock-out and are not counted yet. Tell the office.</div>` : ''}`;
  $('btnShowPay').textContent = '↻ Refresh';
}

$('btnShowPay').addEventListener('click', async function () {
  if (needOnline()) return;
  const btn = this; btn.disabled = true;
  try {
    const res = await authCall({ action: 'getMyPay' });
    if (res && res.ok) renderPay(res); else toast((res && res.error) || 'Could not load salary', true);
  } catch (_) { if (App.worker) toast('Network error — try again', true); }
  finally { btn.disabled = false; }
});

function renderMemos(res) {
  const box = $('msgContent');
  const list = (res && Array.isArray(res.data)) ? res.data : [];
  box.innerHTML = list.length ? list.map(m => {
    const d = m.ts ? new Date(m.ts) : null;
    return `<div class="memo">
      ${m.title ? `<div class="mt">${esc(m.title)}</div>` : ''}
      <div class="mb">${esc(m.message)}</div>
      <div class="md">${d && !isNaN(d.getTime()) ? esc(d.toLocaleString()) : ''}</div>
    </div>`;
  }).join('') : '<div class="empty-msg">No notices</div>';
  $('msgSheet').classList.remove('hidden');
}
$('btnMessages').addEventListener('click', async function () {
  if (needOnline()) return;
  const btn = this; btn.disabled = true;
  try {
    const res = await authCall({ action: 'getMyMemos' });
    if (res && res.ok) { mainCam.stopStream(); renderMemos(res); } else toast((res && res.error) || 'Could not load notices', true);
  } catch (_) { if (App.worker) toast('Network error — try again', true); }
  finally { btn.disabled = false; }
});
function closeSheet(id) {
  $(id).classList.add('hidden');
  if (App.worker && !mainCam.blob && !anySheetOpen()) mainCam.start();
}
$('closeMsgSheet').addEventListener('click', () => closeSheet('msgSheet'));

/* ═══════════════════════════════════════════════════
   MY DETAILS (phone, ID, birthday, address, bank)
   ═══════════════════════════════════════════════════ */
function closeProfSheet() {
  App.profile = null;
  ['pfPhone', 'pfNic', 'pfDob', 'pfAddress', 'pfBankName', 'pfBranch', 'pfAccNo', 'pfAccName'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('pfErr')) $('pfErr').textContent = '';
  closeSheet('profSheet');
}

function renderProfile(res) {
  const pr = res && res.profile;
  if (!pr) { toast('Could not load your details', true); return; }
  const pending = res.pending || null;
  App.profile = { profile: pr, pending: pending, changeMode: false };
  $('pfErr').textContent = '';
  $('pfPhone').value = pr.phone || '';
  $('pfNic').value = pr.nic || '';
  $('pfDob').value = pr.dob || '';
  $('pfAddress').value = pr.address || '';
  ['pfBankName', 'pfBranch', 'pfAccNo', 'pfAccName'].forEach(id => { $(id).value = ''; });

  if (pr.bankLocked) {
    $('bankLockedRows').innerHTML = [['Bank', pr.bankName], ['Branch', pr.branch], ['Account', pr.accountNo], ['Holder', pr.accountName]]
      .map(r => `<div class="pay-row"><span>${esc(r[0])}</span><span class="num">${esc(r[1])}</span></div>`).join('');
    showEl('bankLockedBox', !pending);
    showEl('bankForm', false);
    if (pending) {
      $('bankPendingBox').innerHTML = '🕒 Bank change waiting for office approval:<br><b>' +
        esc(pending.bankName) + ' · ' + esc(pending.branch) + ' · ' + esc(pending.accountNo) + ' · ' + esc(pending.accountName) + '</b><br>Your current account stays active until it is approved.';
    }
    showEl('bankPendingBox', !!pending);
  } else {
    showEl('bankLockedBox', false);
    showEl('bankPendingBox', false);
    showEl('bankForm', true);
    showEl('bankFirstWarn', true);
    showEl('btnSendBankChange', false);
  }
  mainCam.stopStream();
  $('profSheet').classList.remove('hidden');
}

function readBankInputs() {
  return {
    bankName: $('pfBankName').value.trim(), branch: $('pfBranch').value.trim(),
    accountNo: $('pfAccNo').value.replace(/[\s-]/g, ''), accountName: $('pfAccName').value.trim(),
  };
}
function bankInputsError(b) {
  if (!b.bankName || !b.branch || !b.accountNo || !b.accountName) return 'Fill in all four bank fields';
  if (!/^\d{6,20}$/.test(b.accountNo)) return 'Account number must be 6-20 digits';
  return '';
}

$('btnProfile').addEventListener('click', async function () {
  if (needOnline()) return;
  const btn = this; btn.disabled = true;
  try {
    const res = await authCall({ action: 'getMyProfile' });
    if (res && res.ok) renderProfile(res);
    else toast((res && res.error) || 'Could not load your details', true);
  } catch (_) { if (App.worker) toast('Network error — try again', true); }
  finally { btn.disabled = false; }
});
$('closeProfSheet').addEventListener('click', closeProfSheet);

$('btnBankChange').addEventListener('click', () => {
  if (!App.profile) return;
  App.profile.changeMode = true;
  showEl('bankLockedBox', false);
  showEl('bankForm', true);
  showEl('bankFirstWarn', false);
  showEl('btnSendBankChange', true);
  $('pfErr').textContent = '';
  $('pfBankName').focus();
});

async function profileCall(btn, payload, onOk) {
  const err = $('pfErr');
  if (!App.worker || !App.token) { err.textContent = 'Session ended — log in again'; return; }
  if (!App.online) { err.textContent = 'Internet connection needed'; return; }
  btn.disabled = true;
  err.textContent = '';
  try {
    const res = await authCall(payload);
    if (res && res.ok) onOk(res);
    else err.textContent = (res && res.error) || 'Could not save';
  } catch (_) {
    if (App.worker) err.textContent = 'Network error — try again';
  } finally { btn.disabled = false; }
}

$('btnSaveProfile').addEventListener('click', function () {
  if (!App.profile) return;
  const p = App.profile.profile;
  const payload = {
    action: 'saveMyProfile', phone: $('pfPhone').value.trim(), nic: $('pfNic').value.trim(),
    dob: $('pfDob').value, address: $('pfAddress').value.trim(),
  };
  if (!p.bankLocked) {
    const b = readBankInputs();
    const any = b.bankName || b.branch || b.accountNo || b.accountName;
    if (any) {
      const e = bankInputsError(b);
      if (e) { $('pfErr').textContent = e; return; }
      if (!confirm('Save these bank details?\n\n' + b.bankName + ' · ' + b.branch + '\n' + b.accountNo + '\n' + b.accountName +
        '\n\nAfter saving you cannot change them without office approval.')) return;
      Object.assign(payload, b);
    }
  }
  profileCall(this, payload, res => {
    toast(res.bankSaved ? '✅ Saved. Bank details are now locked' : '✅ Details saved');
    renderProfile(res);
  });
});

$('btnSendBankChange').addEventListener('click', function () {
  const b = readBankInputs();
  const e = bankInputsError(b);
  if (e) { $('pfErr').textContent = e; return; }
  profileCall(this, Object.assign({ action: 'requestBankChange' }, b), res => {
    toast('✅ Request sent to the office');
    renderProfile({ profile: App.profile.profile, pending: res.pending });
  });
});

/* ═══════════════════════════════════════════════════
   CHANGE PIN
   ═══════════════════════════════════════════════════ */
$('btnChangePin').addEventListener('click', function () {
  if (!App.worker) return;
  if (needOnline()) return;
  mainCam.stopStream();
  $('changePinSheet').classList.remove('hidden');
  $('oldPinInput').value = ''; $('newPinInput').value = ''; $('confirmPinInput').value = '';
  $('changePinError').textContent = '';
});
$('closePinSheet').addEventListener('click', () => closeSheet('changePinSheet'));

$('submitPinChange').addEventListener('click', async function () {
  const btn = this;
  const oldPin = $('oldPinInput').value.trim();
  const newPin = $('newPinInput').value.trim();
  const confirmPin = $('confirmPinInput').value.trim();
  const err = $('changePinError');

  if (!oldPin || !newPin || !confirmPin) { err.textContent = 'All fields required'; return; }
  if (!/^\d{4}$/.test(newPin)) { err.textContent = 'PIN must be 4 digits'; return; }
  if (newPin !== confirmPin) { err.textContent = 'PINs do not match'; return; }
  if (needOnline()) return;

  btn.disabled = true;
  try {
    const res = await authCall({ action: 'changePin', oldPin: oldPin, newPin: newPin });
    if (res.ok) {
      const known = lsJson('known', {});
      if (known[App.worker.id]) { known[App.worker.id].pin = newPin; lsSet('known', JSON.stringify(known)); }
      App.pin = newPin;
      closeSheet('changePinSheet');
      toast('✅ PIN changed successfully');
    } else {
      err.textContent = res.error || 'Wrong current PIN';
      if (res.code === 'BLOCKED') logout(res.error, true);
    }
  } catch (_) {
    if (App.worker) err.textContent = 'Network error — try again';
  } finally { btn.disabled = false; }
});

/* ═══════════════════════════════════════════════════
   LEAVE + ADVANCE REQUESTS
   ═══════════════════════════════════════════════════ */
$('btnLeave').addEventListener('click', () => { mainCam.stopStream(); $('leaveSheet').classList.remove('hidden'); });
$('closeLeaveSheet').addEventListener('click', () => closeSheet('leaveSheet'));

// Requests are sent straight away when online; when offline they wait on the phone (with Emp No + PIN) and sync later.
async function sendRequest(btn, base, okMsg) {
  if (!App.worker) return null;
  btn.disabled = true;
  try {
    let res = null, netFail = !App.token || !App.online;
    if (!netFail) { try { res = await authCall(base); } catch (e) { if (!App.worker) return null; netFail = true; } }
    if (netFail) {
      if (!apiConfigured()) { toast('Backend URL not set in shared/config.js', true); return null; }
      queueAction(Object.assign({}, base, { workerId: App.worker.id, pin: App.pin, offline: true }));
      toast(okMsg + ' (offline — will send when online)');
      return { ok: true, queued: true };
    }
    if (res && res.ok) { toast('✅ ' + okMsg); return res; }
    toast((res && res.error) || 'Server error', true);
    if (res && res.advance) { App.advance = res.advance; renderAdvance(); }
    return res;
  } catch (_) { toast('Something went wrong', true); return null; }
  finally { btn.disabled = false; }
}

$('submitLeave').addEventListener('click', async function () {
  const from = $('leaveFrom').value, to = $('leaveTo').value;
  if (!from || !to) { toast('Please select dates', true); return; }
  if (to < from) { toast('"To" date is before "From" date', true); return; }
  const res = await sendRequest(this, { action: 'leaveRequest', clientId: uuid(), deviceId: deviceId(), leaveType: $('leaveType').value, from: from, to: to, reason: $('leaveReason').value.trim() }, 'Leave request sent');
  if (res && res.ok) { $('leaveReason').value = ''; closeSheet('leaveSheet'); }
});

$('btnAdvanceSubmit').addEventListener('click', async function () {
  const amt = parseFloat($('advanceAmount').value);
  if (!isFinite(amt) || amt <= 0) { toast('Enter a valid amount', true); return; }
  const lim = App.policy.advanceMax || 25000;
  if (amt > lim) { toast('The advance limit is ' + money(lim) + ' per month', true); return; }
  if (App.advance && amt > App.advance.left) {
    toast('Limit exceeded. You can request only ' + money(App.advance.left) + ' more this month', true); return;
  }
  const res = await sendRequest(this, { action: 'advanceRequest', clientId: uuid(), deviceId: deviceId(), amount: amt, reason: $('advanceReason').value.trim() }, 'Advance request sent');
  if (res && res.ok) {
    $('advanceAmount').value = ''; $('advanceReason').value = '';
    if (res.advance) { App.advance = res.advance; renderAdvance(); }
  }
});

/* ═══════════════════════════════════════════════════
   RECORDS
   ═══════════════════════════════════════════════════ */
let recTab = 'attendance';
$('btnRecords').addEventListener('click', function () {
  mainCam.stopStream();
  $('recordsSheet').classList.remove('hidden');
  loadRecords(recTab);
});
$('closeRecordsSheet').addEventListener('click', () => closeSheet('recordsSheet'));

document.querySelectorAll('.rec-tab').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.rec-tab').forEach(b => b.classList.remove('on'));
    this.classList.add('on');
    recTab = this.dataset.tab;
    loadRecords(recTab);
  });
});

async function loadRecords(tab) {
  const container = $('recordsContent');
  if (!App.worker) return;
  container.innerHTML = '<div class="empty-msg">Loading…</div>';
  if (!App.token || !App.online) { container.innerHTML = '<div class="empty-msg">Records need an internet connection</div>'; return; }
  try {
    const res = await authCall({ action: 'getWorkerRecords', tab: tab });
    if (tab !== recTab) return;
    if (res.ok && res.data) renderRecords(res.data, tab, container);
    else container.innerHTML = '<div class="empty-msg">No records found</div>';
  } catch (_) {
    if (App.worker) container.innerHTML = '<div class="empty-msg">Unable to load records</div>';
  }
}

function renderRecords(data, tab, container) {
  if (!data || !data.length) { container.innerHTML = '<div class="empty-msg">No records</div>'; return; }
  const icoCls = tab === 'attendance' ? 'ai-clock' : tab === 'leaves' ? 'ai-leave' : 'ai-adv';
  const ico = tab === 'attendance' ? '🕐' : tab === 'leaves' ? '🌿' : '💰';
  container.innerHTML = data.map(item => {
    const status = String(item.status || '').replace(/[^a-z]/gi, '');
    return `<div class="act-item">
      <div class="act-ico ${icoCls}">${ico}</div>
      <div class="act-mid">
        <div class="act-title">${esc(item.title || item.date || '')}</div>
        <div class="act-sub">${esc(item.sub || item.note || '')}</div>
      </div>
      ${status ? `<span class="act-badge badge-${status}">${esc(status)}</span>` : ''}
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════ */
function applyBranding() {
  const name = CFG.COMPANY_NAME || 'Attendance';
  try { document.title = name + ' — Worker'; } catch (_) {}
  const el = $('coName');
  if (el) el.textContent = name;
}

function init() {
  applyBranding();
  startClock();
  loadQueue();
  updateOnline();
  deviceId();
  $('loginId').value = lsGet('lastId') || '';
  if (!apiConfigured()) toast('⚠ Backend URL not set in shared/config.js', true);
  else if (App.online) apiPost({ action: 'ping' }).catch(() => {});      // wakes the server while the worker types the PIN
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
