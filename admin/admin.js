// ═══════════════════════════════════════════════════
//  SP HOME INTERIOR — ADMIN PANEL  (admin.js)
//  The Admin PIN is checked by the BACKEND (Code.gs → ADMIN_PIN).
//  It is kept in memory only and sent with every request.
// ═══════════════════════════════════════════════════
'use strict';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

const Admin = {
  pin: '',
  loggedIn: false,
  workers: [],
  retiredIds: [],
  workersLoaded: false,
  pendingRequests: 0,
  currentTab: 'payroll',
  selectorsReady: false,
  seq: { payroll: 0, attendance: 0, requests: 0, proof: 0 },
};

const API = (typeof CONFIG !== 'undefined' && CONFIG.BACKEND_URL) || '';
const CUR = (typeof CONFIG !== 'undefined' && CONFIG.CURRENCY) || 'Rs.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeUrl(u) {
  const s = String(u || '');
  return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : '';
}

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function apiConfigured() {
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(API);
}

// Every call is a POST (text/plain → no CORS preflight) so the PIN never appears in a URL.
function call(action, params) {
  if (!apiConfigured()) return Promise.reject(new Error('Backend URL not set in shared/config.js'));
  const body = Object.assign({}, params || {}, { action: action, adminPin: Admin.pin });
  return fetch(API, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  }).then(r => r.text()).then(txt => {
    let res;
    try { res = JSON.parse(txt); } catch (_) { throw new Error('Bad server response'); }
    if (res && res.code === 'AUTH' && Admin.loggedIn) { logout('Session expired — enter PIN again'); throw new Error('Not authorised'); }
    return res;
  });
}

function fmtMoney(v) { return CUR + ' ' + Number(v || 0).toLocaleString(); }
function fmtNum(v) { return Number(v || 0).toLocaleString(); }
function fmtDT(iso) { const d = new Date(iso); return iso && !isNaN(d.getTime()) ? d.toLocaleString() : ''; }
function fmtD(iso) { const d = new Date(iso); return iso && !isNaN(d.getTime()) ? d.toLocaleDateString() : ''; }

/* ── Login / logout ── */
$('loginBtn').addEventListener('click', doLogin);
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const pin = $('pinInput').value.trim();
  if (!pin) return;
  const btn = $('loginBtn');
  btn.disabled = true;
  try {
    Admin.pin = pin;
    const res = await call('adminLogin');
    if (res && res.ok) {
      Admin.loggedIn = true;
      $('loginScreen').classList.add('hidden');
      $('adminApp').classList.remove('hidden');
      initAdmin();
    } else {
      Admin.pin = '';
      $('pinInput').value = '';
      $('pinInput').placeholder = '❌ Wrong PIN';
      setTimeout(() => { $('pinInput').placeholder = '••••'; }, 1500);
      if (res && res.error && res.error !== 'Wrong admin PIN') toast(res.error, true);
    }
  } catch (err) {
    Admin.pin = '';
    toast(err && err.message ? err.message : 'Network error', true);
  } finally { btn.disabled = false; }
}

function logout(msg) {
  Admin.loggedIn = false;
  Admin.pin = '';
  Admin.workersLoaded = false;
  $('adminApp').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('pinInput').value = '';
  if (msg) toast(msg, true);
}
$('logoutBtn').addEventListener('click', () => logout());

/* ── Month / Year selectors (built once) ── */
function initSelectors() {
  if (Admin.selectorsReady) return;
  Admin.selectorsReady = true;
  const now = new Date();
  const mSel = $('monthSel'), ySel = $('yearSel');
  mSel.innerHTML = ''; ySel.innerHTML = '';
  MONTHS.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = i + 1; o.textContent = m;
    if (i === now.getMonth()) o.selected = true;
    mSel.appendChild(o);
  });
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    ySel.appendChild(o);
  }
  mSel.addEventListener('change', refreshCurrentTab);
  ySel.addEventListener('change', refreshCurrentTab);
}

function getMonthYear() {
  return { month: parseInt($('monthSel').value, 10), year: parseInt($('yearSel').value, 10) };
}

/* ── Tabs ── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
    this.classList.add('on');
    Admin.currentTab = this.dataset.tab;
    document.querySelectorAll('section[id^="t-"]').forEach(s => s.classList.add('hidden'));
    $('t-' + Admin.currentTab).classList.remove('hidden');
    refreshCurrentTab();
  });
});

function refreshCurrentTab() {
  if (!Admin.loggedIn) return;
  switch (Admin.currentTab) {
    case 'payroll':    loadPayroll();    break;
    case 'attendance': loadAttendance(); break;
    case 'requests':   loadRequests();   break;
    case 'proof':      loadProof();      break;
    case 'settings':   loadWorkers();    break;
  }
}

/* ── Payroll ── */
async function loadPayroll() {
  const { month, year } = getMonthYear();
  const my = ++Admin.seq.payroll;
  $('payTitle').textContent = `Payroll — ${MONTHS[month - 1] || ''} ${year}`;

  try {
    const res = await call('getPayroll', { month: month, year: year });
    if (my !== Admin.seq.payroll) return;                 // a newer request replaced this one
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = res.data || [];

    const T = { basic: 0, otHrs: 0, ot: 0, short: 0, bonus: 0, gross: 0, adv: 0, net: 0 };
    data.forEach(w => {
      T.basic += w.basicPay || 0; T.otHrs += w.otHours || 0; T.ot += w.otPay || 0; T.short += w.shortPay || 0;
      T.bonus += w.bonus || 0; T.gross += w.gross || 0; T.adv += w.advance || 0; T.net += w.net || 0;
    });
    T.otHrs = Math.round(T.otHrs * 100) / 100;

    $('payStats').innerHTML = `
      <div class="a-stat"><div class="sk">Total Workers</div><div class="sv num">${data.length}</div></div>
      <div class="a-stat"><div class="sk">Gross Payroll</div><div class="sv num">${fmtMoney(T.gross)}</div></div>
      <div class="a-stat"><div class="sk">Total OT</div><div class="sv num">${fmtMoney(T.ot)}</div></div>
      <div class="a-stat s-amber"><div class="sk">Total Advances</div><div class="sv num">${fmtMoney(T.adv)}</div></div>
      <div class="a-stat"><div class="sk">Net Payroll</div><div class="sv num">${fmtMoney(T.net)}</div></div>`;
    $('paySub').textContent = `${data.length} workers`;

    const thead = `<thead><tr>
      <th>Emp No.</th><th class="tc-name">Name</th><th>Days</th><th>Daily Rate</th><th>Basic</th>
      <th>OT hrs</th><th>OT Pay</th><th>Short-day Pay</th><th>Bonus</th><th>Gross</th><th>Advance</th><th>Net Pay</th>
    </tr></thead>`;
    const tbody = '<tbody>' + data.map(w => {
      const flag = w.incomplete
        ? ` <span title="${esc(w.incomplete)} shift(s) with no clock-out — check the sheet" style="color:var(--amber,#d4920b)">⚠${esc(w.incomplete)}</span>` : '';
      return `<tr>
        <td class="wno">${esc(w.id)}</td>
        <td class="tc-name">${esc(w.name)}</td>
        <td class="tc-num">${esc(w.days || 0)}${flag}</td>
        <td class="tc-num">${fmtMoney(w.dailySalary)}</td>
        <td class="tc-num">${fmtMoney(w.basicPay)}</td>
        <td class="tc-num">${esc(w.otHours || 0)}</td>
        <td class="tc-num">${fmtMoney(w.otPay)}</td>
        <td class="tc-num">${fmtMoney(w.shortPay)}</td>
        <td class="tc-num">${fmtMoney(w.bonus)}</td>
        <td class="tc-gross tc-num">${fmtMoney(w.gross)}</td>
        <td class="tc-adv tc-num">${fmtMoney(w.advance)}</td>
        <td class="tc-net tc-num">${fmtMoney(w.net)}</td>
      </tr>`;
    }).join('') + '</tbody>';
    const tfoot = `<tfoot><tr>
      <td colspan="4" style="text-align:right">TOTAL</td>
      <td class="tc-num">${fmtMoney(T.basic)}</td>
      <td class="tc-num">${fmtNum(T.otHrs)}</td>
      <td class="tc-num">${fmtMoney(T.ot)}</td>
      <td class="tc-num">${fmtMoney(T.short)}</td>
      <td class="tc-num">${fmtMoney(T.bonus)}</td>
      <td class="tc-num">${fmtMoney(T.gross)}</td>
      <td class="tc-num">${fmtMoney(T.adv)}</td>
      <td class="tc-num">${fmtMoney(T.net)}</td>
    </tr></tfoot>`;
    $('payTable').innerHTML = thead + tbody + tfoot;
  } catch (err) {
    if (my !== Admin.seq.payroll || !Admin.loggedIn) return;
    $('payTable').innerHTML = '<tbody><tr><td colspan="12" style="text-align:center;color:var(--muted);padding:40px">Unable to load payroll data</td></tr></tbody>';
    toast('Payroll load error: ' + err.message, true);
  }
}

/* ── Attendance ── */
async function loadAttendance() {
  const { month, year } = getMonthYear();
  const daysInMonth = new Date(year, month, 0).getDate();
  const my = ++Admin.seq.attendance;
  $('attSub').textContent = `${month}/${year}`;

  try {
    const res = await call('getAttendance', { month: month, year: year });
    if (my !== Admin.seq.attendance) return;
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = res.data || {};

    let thead = '<thead><tr><th>Emp</th><th>Name</th>';
    for (let d = 1; d <= daysInMonth; d++) thead += `<th class="dh day-h">${d}</th>`;
    thead += '<th>Total</th></tr></thead>';

    const tbody = '<tbody>' + Object.values(data).map(w => {
      let total = 0;
      let row = `<tr><td class="wno">${esc(w.id)}</td><td class="tc-name">${esc(w.name)}</td>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const status = (w.days && w.days[d]) || '';
        if (status === 'P') { row += '<td class="tc-in dh">✓</td>'; total++; }
        else row += '<td class="tc-miss dh">·</td>';
      }
      return row + `<td class="tc-num">${total}</td></tr>`;
    }).join('') + '</tbody>';
    $('attTable').innerHTML = thead + tbody;
  } catch (_) {
    if (my !== Admin.seq.attendance) return;
    $('attTable').innerHTML = '<tbody><tr><td colspan="35" style="text-align:center;padding:40px;color:var(--muted)">No attendance data</td></tr></tbody>';
  }
}

/* ── Requests ── */
function setPendingBadge(n) {
  Admin.pendingRequests = n;
  $('reqCnt').textContent = n;
  $('reqCnt').className = 'cnt' + (n === 0 ? ' zero' : '');
}

async function refreshPendingBadge() {
  try {
    const res = await call('getRequests', { filter: 'pending' });
    if (res.ok) setPendingBadge((res.data || []).length);
  } catch (_) { /* badge is cosmetic */ }
}

async function loadRequests() {
  const filter = $('reqFilter').value;
  const grid = $('reqGrid');
  const my = ++Admin.seq.requests;
  grid.innerHTML = '<div class="empty-msg">Loading…</div>';

  try {
    const res = await call('getRequests', { filter: filter });
    if (my !== Admin.seq.requests) return;
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = res.data || [];
    if (filter === 'pending' || filter === 'all') {
      setPendingBadge(data.filter(r => r.status === 'pending').length);
    } else { refreshPendingBadge(); }

    if (!data.length) { grid.innerHTML = '<div class="empty-msg">No requests found</div>'; return; }

    grid.innerHTML = data.map(r => {
      const isLeave = r.type === 'leave';
      const st = String(r.status || '');
      return `
      <div class="rq-card">
        ${st !== 'pending' ? `<span class="rq-badge ${st === 'approved' ? 'appr' : 'rejt'}">${esc(st)}</span>` : ''}
        <div class="rq-card-top">
          <div class="rq-ico ${isLeave ? 'rq-ico-leave' : 'rq-ico-adv'}">${isLeave ? '🌿' : '💰'}</div>
          <div>
            <div class="rq-name">${esc(r.workerName)}</div>
            <div class="rq-meta">${esc(r.workerId)} · ${esc(fmtD(r.ts))}</div>
          </div>
        </div>
        <div class="rq-body">
          ${isLeave
            ? `<div>${esc(r.leaveType || 'Leave')}</div><div style="font-size:12px;margin-top:4px">${esc(r.from)} → ${esc(r.to)}</div>`
            : `<div class="rq-big">${fmtMoney(r.amount)}</div>`}
          ${r.reason ? `<div class="rq-reason">"${esc(r.reason)}"</div>` : ''}
        </div>
        ${st === 'pending' ? `
          <div class="rq-actions">
            <button class="rq-approve" data-act="req" data-id="${esc(r.id)}" data-status="approved">✓ Approve</button>
            <button class="rq-reject" data-act="req" data-id="${esc(r.id)}" data-status="rejected">✕ Reject</button>
          </div>` : ''}
      </div>`;
    }).join('');
  } catch (_) {
    if (my !== Admin.seq.requests) return;
    grid.innerHTML = '<div class="empty-msg">Unable to load requests</div>';
  }
}

async function decideRequest(id, status, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await call('updateRequest', { requestId: id, status: status });
    if (res.ok) { toast(status === 'approved' ? '✅ Approved' : '✕ Rejected'); loadRequests(); }
    else { toast(res.error || 'Failed', true); if (btn) btn.disabled = false; }
  } catch (_) { toast('Network error', true); if (btn) btn.disabled = false; }
}

$('reqGrid').addEventListener('click', function (e) {
  const b = e.target.closest('button[data-act="req"]');
  if (b) decideRequest(b.dataset.id, b.dataset.status, b);
});
$('reqFilter').addEventListener('change', loadRequests);

/* ── Photo Proof ── */
async function loadProof() {
  const workerId = $('proofWorker').value;
  const date = $('proofDate').value;
  const grid = $('proofGrid');
  const my = ++Admin.seq.proof;
  grid.innerHTML = '<div class="empty-msg">Loading…</div>';
  if (!Admin.workersLoaded) loadWorkers(true);

  try {
    const params = {};
    if (workerId) params.workerId = workerId;
    if (date) params.date = date;
    const res = await call('getPhotos', params);
    if (my !== Admin.seq.proof) return;
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = (res.data || []).filter(p => safeUrl(p.url));
    if (!data.length) { grid.innerHTML = '<div class="empty-msg">No photos found</div>'; return; }

    grid.innerHTML = data.map(p => `
      <div class="proof-card" data-act="photo" data-url="${esc(p.url)}" data-name="${esc(p.workerName)}" data-ts="${esc(p.timestamp)}" data-type="${esc(p.type)}">
        <img src="${esc(p.url)}" alt="${esc(p.workerName)}" loading="lazy" referrerpolicy="no-referrer">
        <div class="proof-info">
          <div class="proof-wname">${esc(p.workerName)}</div>
          <div class="proof-meta">${esc(fmtDT(p.timestamp))}</div>
          <span class="proof-type ${p.type === 'clockIn' ? 'in' : 'out'}">${p.type === 'clockIn' ? 'Clock In' : 'Clock Out'}</span>
        </div>
      </div>`).join('');
    grid.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.style.display = 'none'; }));
  } catch (_) {
    if (my !== Admin.seq.proof) return;
    grid.innerHTML = '<div class="empty-msg">Unable to load photos</div>';
  }
}

$('proofWorker').addEventListener('change', loadProof);
$('proofDate').addEventListener('change', loadProof);
$('proofGrid').addEventListener('click', function (e) {
  const c = e.target.closest('[data-act="photo"]');
  if (c) openLightbox(c.dataset.url, c.dataset.name, c.dataset.ts, c.dataset.type);
});

function openLightbox(url, name, ts, type) {
  const u = safeUrl(url);
  if (!u) return;
  $('lbImg').src = u;
  $('lbInfo').innerHTML = `
    <h3>${esc(name)}</h3>
    <p>${esc(fmtDT(ts))} · ${type === 'clockIn' ? 'Clock In' : 'Clock Out'}</p>
    <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">⬇ Download Photo</a>`;
  $('lightbox').classList.remove('hidden');
}
$('lbClose').addEventListener('click', () => $('lightbox').classList.add('hidden'));
$('lightbox').addEventListener('click', function (e) { if (e.target === this) $('lightbox').classList.add('hidden'); });

/* ── Workers (roster) ── */
async function loadWorkers(quiet) {
  try {
    const res = await call('getWorkersAdmin');
    if (!res.ok) throw new Error(res.error || 'Failed');
    Admin.workers = (res.data || []).map(w => ({ id: w.id, name: w.name, salary: w.salary }));
    Admin.retiredIds = res.retiredIds || [];
    Admin.workersLoaded = true;
    renderWorkerTable();
    populateProofWorkerFilter();
  } catch (err) {
    // NEVER fall back to fake/default data here — saving it would overwrite the real roster.
    Admin.workersLoaded = false;
    if (!quiet) {
      $('wtableBody').innerHTML = '<tr><td colspan="5" class="empty-state">Unable to load workers — press ↻ Sync</td></tr>';
      toast('Workers load error: ' + err.message, true);
    }
  }
  $('saveWorkersBtn').disabled = !Admin.workersLoaded;
}

function renderWorkerTable() {
  const tbody = $('wtableBody');
  if (!Admin.workers.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No workers</td></tr>';
    return;
  }
  tbody.innerHTML = Admin.workers.map((w, i) => `
    <tr>
      <td><span class="wno">${esc(w.id)}</span></td>
      <td><input value="${esc(w.name)}" data-i="${i}" data-field="name" maxlength="60"></td>
      <td><input class="sal" value="${esc(w.salary || 0)}" data-i="${i}" data-field="salary" type="number" min="0" step="1"></td>
      <td><button class="pin-reset-btn" data-act="resetpin" data-i="${i}" title="Reset PIN to ${esc(CONFIG.DEFAULT_WORKER_PIN || '0000')}">🔑 Reset PIN</button></td>
      <td><button class="x-btn" data-act="remove" data-i="${i}" aria-label="Remove worker">✕</button></td>
    </tr>`).join('');
}

$('wtableBody').addEventListener('change', function (e) {
  const el = e.target;
  if (!el.dataset || el.dataset.field === undefined) return;
  const w = Admin.workers[parseInt(el.dataset.i, 10)];
  if (!w) return;
  if (el.dataset.field === 'salary') {
    const n = parseFloat(el.value);
    w.salary = isFinite(n) && n >= 0 ? n : 0;
    el.value = w.salary;
  } else {
    w.name = el.value.trim();
  }
});

$('wtableBody').addEventListener('click', function (e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const i = parseInt(b.dataset.i, 10);
  const w = Admin.workers[i];
  if (!w) return;
  if (b.dataset.act === 'resetpin') resetWorkerPin(w.id, w.name);
  if (b.dataset.act === 'remove') removeWorker(i);
});

async function resetWorkerPin(workerId, workerName) {
  const defaultPin = CONFIG.DEFAULT_WORKER_PIN || '0000';
  if (!confirm('Reset PIN for ' + workerName + ' to ' + defaultPin + '?')) return;
  try {
    const res = await call('resetPin', { workerId: workerId, newPin: defaultPin });
    if (res.ok) {
      try { localStorage.removeItem('sphome_pin_' + workerId); } catch (_) {}
      toast('✅ PIN reset to ' + defaultPin + ' for ' + workerName);
    } else toast(res.error || 'Reset failed', true);
  } catch (_) { toast('Network error — could not reset PIN', true); }
}

function removeWorker(i) {
  const w = Admin.workers[i];
  if (!w || !confirm('Remove ' + w.name + '? (History is kept; press Save Workers to apply)')) return;
  Admin.workers.splice(i, 1);
  renderWorkerTable();
}

$('addWorkerBtn').addEventListener('click', () => {
  if (!Admin.workersLoaded) { toast('Load workers first (↻ Sync)', true); return; }
  let max = 0;
  Admin.workers.map(w => w.id).concat(Admin.retiredIds).forEach(id => {
    const m = /^EMP(\d+)$/.exec(String(id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  Admin.workers.push({ id: 'EMP' + String(max + 1).padStart(3, '0'), name: 'New Worker', salary: 2000 });
  renderWorkerTable();
});

$('saveWorkersBtn').addEventListener('click', async function () {
  if (!Admin.workersLoaded) { toast('Workers not loaded — cannot save', true); return; }
  const btn = this;
  const bad = Admin.workers.find(w => !String(w.name || '').trim());
  if (bad) { toast('Name required for ' + bad.id, true); return; }
  btn.disabled = true;
  try {
    const res = await call('saveWorkers', { workers: Admin.workers });
    if (res.ok) { toast('✅ Workers saved'); loadWorkers(true); }
    else toast(res.error || 'Failed', true);
  } catch (_) { toast('Network error', true); }
  finally { btn.disabled = !Admin.workersLoaded; }
});

function populateProofWorkerFilter() {
  const sel = $('proofWorker');
  const keep = sel.value;
  sel.innerHTML = '<option value="">All workers</option>';
  Admin.workers.forEach(w => {
    const o = document.createElement('option');
    o.value = w.id; o.textContent = w.name;
    sel.appendChild(o);
  });
  sel.value = keep;
}

/* ── Export CSV ── */
function csvCell(v) {
  let s = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;      // block spreadsheet formula injection
  return '"' + s.replace(/"/g, '""') + '"';
}

$('exportBtn').addEventListener('click', async function () {
  const { month, year } = getMonthYear();
  try {
    const res = await call('getPayroll', { month: month, year: year });
    if (!res.ok || !res.data) { toast('No data to export', true); return; }
    const rows = [['Emp No.', 'Name', 'Days', 'Daily Rate', 'Basic', 'OT Hours', 'OT Pay', 'Short-day Pay', 'Bonus', 'Gross', 'Advance', 'Net Pay', 'No-clockout shifts']];
    res.data.forEach(w => rows.push([w.id, w.name, w.days, w.dailySalary, w.basicPay, w.otHours, w.otPay, w.shortPay, w.bonus, w.gross, w.advance, w.net, w.incomplete || 0]));
    const csv = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${year}_${String(month).padStart(2, '0')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (_) { toast('Export failed', true); }
});

/* ── Refresh / Clear ── */
$('refreshBtn').addEventListener('click', () => { refreshCurrentTab(); toast('Synced'); });

// Clears cached worker list + cached PINs only. NEVER touches the offline attendance queue
// (workers on the same phone may have unsynced clock-ins).
$('clearBtn').addEventListener('click', () => {
  if (!confirm('Clear cached worker list and cached PINs on this device?')) return;
  try {
    const kill = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === 'sphome_workers' || (k && (k.indexOf('sphome_pin_') === 0 || k.indexOf('sphome_status_') === 0))) kill.push(k);
    }
    kill.forEach(k => localStorage.removeItem(k));
  } catch (_) {}
  toast('Local cache cleared');
});

/* ── Init ── */
function initAdmin() {
  initSelectors();
  loadPayroll();
  refreshPendingBadge();
  loadWorkers(true);      // fills the Photo Proof worker filter right away
}

function boot() {
  const name = (typeof CONFIG !== 'undefined' && CONFIG.COMPANY_NAME) || 'Attendance';
  try { document.title = name + ' — MD Admin'; } catch (_) {}
  const up = String(name).toUpperCase();
  const a = $('coNameLogin'); if (a) a.textContent = up;
  const b = $('coNameTop'); if (b) b.textContent = up;
  if (!apiConfigured()) toast('⚠ Backend URL not set in shared/config.js', true);
  const pi = $('pinInput'); if (pi) pi.focus();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
