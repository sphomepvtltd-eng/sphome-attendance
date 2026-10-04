// ═══════════════════════════════════════════════════
//  SP HOME INTERIOR — WORKER APP  (app.js)
//  All backend calls use CONFIG.BACKEND_URL
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

/* ── State ── */
const App = {
  worker: null,
  workers: [],
  clockedIn: false,
  stream: null,
  useFrontCam: true,
  capturedBlob: null,
  coords: null,
  online: navigator.onLine,
  offlineQueue: [],
};

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);
const API = (typeof CONFIG !== 'undefined' && CONFIG.BACKEND_URL) || '';
const MAX_SHIFT_MS = 20 * 3600000;   // must match PAY_RULES.MAX_SHIFT_HOURS in Code.gs

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uuid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ''); } catch (_) {}
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

function toast(msg, isErr) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function apiConfigured() {
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(API);
}

function parseJson(r) {
  return r.text().then(function (txt) {
    try { return JSON.parse(txt); }
    catch (_) { throw new Error('Bad server response'); }
  });
}

function api(params) {
  if (!apiConfigured()) return Promise.reject(new Error('Backend URL not set'));
  const url = new URL(API);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  return fetch(url.toString(), { redirect: 'follow' }).then(parseJson);
}

// text/plain (NOT application/json) avoids the CORS preflight Apps Script can't answer.
function apiPost(body) {
  if (!apiConfigured()) return Promise.reject(new Error('Backend URL not set'));
  return fetch(API, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  }).then(parseJson);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.readAsDataURL(blob);
  });
}

/* ── Clock ── */
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

/* ── Offline queue (persisted; removed only after the server answers) ── */
function saveQueue() {
  if (!App.offlineQueue.length) { lsDel('sphome_queue'); return true; }
  return lsSet('sphome_queue', JSON.stringify(App.offlineQueue));
}

function loadQueue() {
  try {
    const raw = lsGet('sphome_queue');
    const list = raw ? JSON.parse(raw) : [];
    App.offlineQueue = Array.isArray(list) ? list : [];
  } catch (_) { App.offlineQueue = []; }
}

function queueAction(payload) {
  App.offlineQueue.push(payload);
  if (!saveQueue()) toast('⚠ Phone storage full — sync soon!', true);
}

let flushing = false;
async function flushQueue() {
  if (flushing || !App.online || !apiConfigured() || !App.offlineQueue.length) return;
  flushing = true;
  let synced = 0, rejected = 0;
  try {
    while (App.offlineQueue.length) {
      let res;
      try { res = await apiPost(App.offlineQueue[0]); }
      catch (_) { break; }                       // network trouble → keep everything, retry later
      App.offlineQueue.shift();
      saveQueue();
      if (res && res.ok) synced++; else rejected++;
    }
  } finally { flushing = false; }
  if (synced) toast('✅ ' + synced + ' offline item(s) synced');
  if (rejected) toast(rejected + ' offline item(s) rejected by server (wrong PIN?)', true);
  if (synced && App.worker) checkStatus();
}
setInterval(flushQueue, 60000);

/* ── Local clock status (so Clock Out works with no signal) ── */
function getLocalStatus(id) {
  try {
    const st = JSON.parse(lsGet('sphome_status_' + id) || 'null');
    if (st && st.in && st.ts && (Date.now() - new Date(st.ts).getTime()) <= MAX_SHIFT_MS) return st;
  } catch (_) {}
  return null;
}
function setLocalStatus(id, isIn, ts) {
  lsSet('sphome_status_' + id, JSON.stringify({ in: !!isIn, ts: ts }));
}

/* ── Workers ── */
function loadWorkers() {
  const sel = $('workerSel');

  function populate(list) {
    sel.innerHTML = '<option value="">— Select Worker —</option>';
    App.workers = Array.isArray(list) ? list : [];
    App.workers.forEach(w => {
      const o = document.createElement('option');
      o.value = w.id;
      o.textContent = w.name + ' (' + w.id + ')';
      sel.appendChild(o);
    });
  }

  let shown = false;
  try {
    const list = JSON.parse(lsGet('sphome_workers') || 'null');
    if (Array.isArray(list) && list.length) { populate(list); shown = true; }
  } catch (_) {}
  if (!shown) populate(CONFIG.DEFAULT_WORKERS || []);

  if (!apiConfigured()) { toast('⚠ Backend URL not set in shared/config.js', true); return; }
  if (!App.online) return;

  api({ action: 'getWorkers' }).then(res => {
    if (res && res.ok && Array.isArray(res.data) && res.data.length) {
      const keep = App.worker ? App.worker.id : '';
      populate(res.data);
      lsSet('sphome_workers', JSON.stringify(res.data));
      if (keep && App.workers.some(w => w.id === keep)) sel.value = keep;
    }
  }).catch(() => { /* keep what is shown */ });
}

/* ── Worker selection ── */
function resetSelfie() {
  App.capturedBlob = null;
  stopCamera();
  const preview = $('wPreview'), video = $('wVideo'), ph = $('selfiePh'), zone = $('selfieZone');
  if (preview) { preview.classList.add('hidden'); preview.removeAttribute('src'); }
  if (video) video.classList.add('hidden');
  if (ph) ph.classList.remove('hidden');
  if (zone) zone.classList.remove('live');
  if ($('btnCapture')) $('btnCapture').disabled = true;
  if ($('btnRetake')) $('btnRetake').disabled = true;
}

$('workerSel').addEventListener('change', function () {
  App.worker = App.workers.find(w => w.id === this.value) || null;
  resetSelfie();                       // never reuse another worker's photo
  $('workerSection').classList.toggle('hidden', !App.worker);
  if (App.worker) checkStatus();
});

function checkStatus() {
  const w = App.worker;
  if (!w) return;
  function fromLocal() {
    const st = getLocalStatus(w.id);
    renderStatus(!!st, st ? st.ts : null);
  }
  if (!App.online || !apiConfigured()) { fromLocal(); return; }
  api({ action: 'getStatus', workerId: w.id }).then(res => {
    if (!App.worker || App.worker.id !== w.id) return;   // worker changed meanwhile
    if (res && res.ok) {
      setLocalStatus(w.id, res.clockedIn, res.clockInTime);
      renderStatus(res.clockedIn, res.clockInTime);
    } else fromLocal();
  }).catch(fromLocal);
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
    ssub.textContent = 'Tap Clock In to start';
  }
  $('btnClockIn').disabled = !!isClockedIn;
  $('btnClockOut').disabled = !isClockedIn;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return String(iso); }
}

/* ── Camera ── */
async function startCamera() {
  stopCamera();
  const preview = $('wPreview'), video = $('wVideo'), ph = $('selfiePh'), zone = $('selfieZone');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Camera not supported on this browser', true);
    return;
  }
  try {
    App.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: App.useFrontCam ? 'user' : 'environment', width: { ideal: 640 }, height: { ideal: 640 } },
    });
    video.srcObject = App.stream;
    video.style.transform = App.useFrontCam ? 'scaleX(-1)' : 'scaleX(1)';
    await video.play();
    video.classList.remove('hidden');
    preview.classList.add('hidden');
    ph.classList.add('hidden');
    zone.classList.add('live');
    $('btnCapture').disabled = false;
    $('btnRetake').disabled = true;
    $('btnCamToggle').disabled = false;
    updateLocation();
  } catch (err) {
    stopCamera();
    toast('Camera error: ' + (err && err.message ? err.message : 'permission denied'), true);
  }
}

function stopCamera() {
  if (App.stream) {
    App.stream.getTracks().forEach(t => t.stop());
    App.stream = null;
  }
}
window.addEventListener('pagehide', stopCamera);

function capturePhoto() {
  const video = $('wVideo'), preview = $('wPreview');
  if (!video.videoWidth) { toast('Camera not ready yet', true); return; }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (App.useFrontCam) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    if (!blob) { toast('Could not capture photo', true); return; }
    App.capturedBlob = blob;
    if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
    preview.dataset.url = URL.createObjectURL(blob);
    preview.src = preview.dataset.url;
    preview.classList.remove('hidden');
    video.classList.add('hidden');
    $('selfieZone').classList.remove('live');
    $('btnCapture').disabled = true;
    $('btnRetake').disabled = false;
    stopCamera();
  }, 'image/jpeg', 0.8);
}

$('btnCamera').addEventListener('click', () => startCamera());
$('btnCapture').addEventListener('click', () => capturePhoto());
$('btnRetake').addEventListener('click', () => { App.capturedBlob = null; startCamera(); });
$('btnCamToggle').addEventListener('click', () => { App.useFrontCam = !App.useFrontCam; startCamera(); });

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

/* ── PIN modal + actions ──
   Every action (clock in/out, leave, advance) needs the worker's PIN.
   The SERVER checks it; the phone only checks locally when offline.       */
let pinBuffer = '';
let pending = null;      // { kind, build: () => Promise<payload>, payload }
let pinBusy = false;

function openPin(kind, build) {
  if (!App.worker) { toast('Select your name first', true); return; }
  pending = { kind: kind, build: build, payload: null };
  pinBuffer = '';
  pinBusy = false;
  renderPinDots();
  $('pinError').textContent = '';
  $('pinWorkerLbl').textContent = App.worker.name;
  $('pinModal').classList.remove('hidden');
}

function closePinModal() {
  $('pinModal').classList.add('hidden');
  pinBuffer = '';
  pending = null;
  pinBusy = false;
}

function renderPinDots() {
  document.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('filled', i < pinBuffer.length));
}

function pinFail(msg) {
  $('pinError').textContent = msg;
  pinBuffer = '';
  renderPinDots();
}

function pinKey(val) {
  if (pinBusy) return;
  if (val === 'del') pinBuffer = pinBuffer.slice(0, -1);
  else if (pinBuffer.length < 4 && /^\d$/.test(val)) pinBuffer += val;
  renderPinDots();
  if (pinBuffer.length === 4) setTimeout(submitPin, 150);
}

function localPinOk(workerId, pin) {
  const expected = lsGet('sphome_pin_' + workerId) || (CONFIG.DEFAULT_WORKER_PIN || '0000');
  return pin === expected;
}

async function submitPin() {
  if (!pending || pinBusy || pinBuffer.length !== 4) return;
  pinBusy = true;
  const job = pending;
  const pin = pinBuffer;
  const worker = App.worker;
  try {
    if (!job.payload) job.payload = await job.build();          // photo → base64 only once
    const payload = Object.assign({}, job.payload, { pin: pin });

    let res = null, netFail = !App.online;
    if (!netFail) {
      try { res = await apiPost(payload); } catch (_) { netFail = true; }
    }

    if (netFail) {                                              // offline / server unreachable
      if (!apiConfigured()) { closePinModal(); toast('Backend URL not set in shared/config.js', true); return; }
      if (!localPinOk(worker.id, pin)) { pinFail('Wrong PIN'); return; }
      queueAction(payload);
      finishAction(job.kind, payload, true);
      return;
    }
    if (res && res.ok) {
      lsSet('sphome_pin_' + worker.id, pin);
      finishAction(job.kind, payload, false);
    } else if (res && res.code === 'PIN') {
      pinFail(res.error || 'Wrong PIN — try again');
    } else {
      closePinModal();
      toast((res && res.error) || 'Server error', true);
    }
  } catch (err) {
    closePinModal();
    toast(err && err.message ? err.message : 'Something went wrong', true);
  } finally {
    pinBusy = false;
  }
}

function finishAction(kind, payload, queued) {
  closePinModal();
  const sfx = queued ? ' (offline)' : '';
  if (kind === 'clockIn' || kind === 'clockOut') {
    const isIn = kind === 'clockIn';
    setLocalStatus(payload.workerId, isIn, payload.timestamp);
    renderStatus(isIn, payload.timestamp);
    resetSelfie();
    toast((isIn ? '✅ Clocked In' : '✅ Clocked Out') + sfx);
  } else if (kind === 'leave') {
    $('leaveSheet').classList.add('hidden');
    $('leaveReason').value = '';
    toast(queued ? 'Leave request saved offline' : '✅ Leave request sent');
  } else if (kind === 'advance') {
    $('advanceAmount').value = '';
    $('advanceReason').value = '';
    toast(queued ? 'Advance saved offline' : '✅ Advance request sent');
  }
}

function clockPayload(kind) {
  return async function () {
    const photo = App.capturedBlob ? await blobToBase64(App.capturedBlob) : '';
    return {
      action: kind,
      clientId: uuid(),
      workerId: App.worker.id,
      timestamp: new Date().toISOString(),
      photo: photo,
      lat: App.coords ? App.coords.lat : null,
      lng: App.coords ? App.coords.lng : null,
      accuracy: App.coords ? App.coords.acc : null,
    };
  };
}

$('btnClockIn').addEventListener('click', () => {
  if (!App.capturedBlob) { toast('Please take a selfie photo first', true); return; }
  openPin('clockIn', clockPayload('clockIn'));
});
$('btnClockOut').addEventListener('click', () => {
  if (!App.capturedBlob) { toast('Please take a clock-out photo first', true); return; }
  openPin('clockOut', clockPayload('clockOut'));
});

document.querySelectorAll('.pin-key').forEach(btn => {
  btn.addEventListener('click', function () { if (this.dataset.key) pinKey(this.dataset.key); });
});
$('pinCancel').addEventListener('click', closePinModal);

/* ── Change PIN ── */
$('btnChangePin').addEventListener('click', function () {
  if (!App.worker) return;
  $('changePinSheet').classList.remove('hidden');
  $('oldPinInput').value = '';
  $('newPinInput').value = '';
  $('confirmPinInput').value = '';
  $('changePinError').textContent = '';
});
$('closePinSheet').addEventListener('click', () => $('changePinSheet').classList.add('hidden'));

$('submitPinChange').addEventListener('click', async function () {
  const btn = this;
  const oldPin = $('oldPinInput').value.trim();
  const newPin = $('newPinInput').value.trim();
  const confirmPin = $('confirmPinInput').value.trim();
  const err = $('changePinError');

  if (!oldPin || !newPin || !confirmPin) { err.textContent = 'All fields required'; return; }
  if (!/^\d{4}$/.test(newPin)) { err.textContent = 'PIN must be 4 digits'; return; }
  if (newPin !== confirmPin) { err.textContent = 'PINs do not match'; return; }
  if (!App.online) { err.textContent = 'Internet needed to change PIN'; return; }

  btn.disabled = true;
  try {
    const res = await apiPost({ action: 'changePin', workerId: App.worker.id, oldPin: oldPin, newPin: newPin });
    if (res.ok) {
      lsSet('sphome_pin_' + App.worker.id, newPin);
      $('changePinSheet').classList.add('hidden');
      toast('✅ PIN changed successfully');
    } else {
      err.textContent = res.error || 'Wrong current PIN';
    }
  } catch (_) {
    err.textContent = 'Network error — try again';
  } finally { btn.disabled = false; }
});

/* ── Leave Request ── */
$('btnLeave').addEventListener('click', () => $('leaveSheet').classList.remove('hidden'));
$('closeLeaveSheet').addEventListener('click', () => $('leaveSheet').classList.add('hidden'));

$('submitLeave').addEventListener('click', function () {
  const type = $('leaveType').value;
  const from = $('leaveFrom').value;
  const to = $('leaveTo').value;
  const reason = $('leaveReason').value.trim();
  if (!from || !to) { toast('Please select dates', true); return; }
  if (to < from) { toast('"To" date is before "From" date', true); return; }
  const snapshot = { action: 'leaveRequest', clientId: uuid(), workerId: App.worker.id, leaveType: type, from: from, to: to, reason: reason, ts: new Date().toISOString() };
  openPin('leave', async () => snapshot);
});

/* ── Advance Request ── */
$('btnAdvanceSubmit').addEventListener('click', function () {
  const amt = parseFloat($('advanceAmount').value);
  const reason = $('advanceReason').value.trim();
  if (!isFinite(amt) || amt <= 0) { toast('Enter a valid amount', true); return; }
  if (amt > 10000000) { toast('Amount too large', true); return; }
  const snapshot = { action: 'advanceRequest', clientId: uuid(), workerId: App.worker.id, amount: amt, reason: reason, ts: new Date().toISOString() };
  openPin('advance', async () => snapshot);
});

/* ── Records ── */
let recTab = 'attendance';
$('btnRecords').addEventListener('click', function () {
  $('recordsSheet').classList.remove('hidden');
  loadRecords(recTab);
});
$('closeRecordsSheet').addEventListener('click', () => $('recordsSheet').classList.add('hidden'));

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
  const w = App.worker;
  if (!w) return;
  container.innerHTML = '<div class="empty-msg">Loading…</div>';
  if (!App.online) { container.innerHTML = '<div class="empty-msg">Records require internet connection</div>'; return; }
  try {
    const res = await api({ action: 'getWorkerRecords', workerId: w.id, tab: tab });
    if (tab !== recTab) return;                       // user switched tab meanwhile
    if (res.ok && res.data) renderRecords(res.data, tab, container);
    else container.innerHTML = '<div class="empty-msg">No records found</div>';
  } catch (_) {
    container.innerHTML = '<div class="empty-msg">Unable to load records</div>';
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

/* ── Init ── */
function applyBranding() {
  const name = (typeof CONFIG !== 'undefined' && CONFIG.COMPANY_NAME) || 'Attendance';
  try { document.title = name + ' — Worker'; } catch (_) {}
  const el = $('coName');
  if (el) el.textContent = name;
}

function init() {
  applyBranding();
  startClock();
  loadQueue();          // load BEFORE updateOnline() so stored items get flushed
  updateOnline();
  loadWorkers();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
