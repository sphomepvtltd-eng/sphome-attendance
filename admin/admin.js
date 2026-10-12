// ═══════════════════════════════════════════════════
//  SP HOME INTERIOR — ADMIN PANEL  (admin.js)  · v4
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
  blockedIds: [],
  policy: {},
  attCompact: false,
  workersLoaded: false,
  pendingRequests: 0,
  currentTab: 'payroll',
  selectorsReady: false,
  seq: { payroll: 0, attendance: 0, requests: 0, proof: 0, memos: 0, profiles: 0 },
  slip: null,
  transfer: null,
};

const API = (typeof CONFIG !== 'undefined' && CONFIG.BACKEND_URL) || '';
const PFX = ((typeof CONFIG !== 'undefined' && CONFIG.STORE_PREFIX) || 'att') + '_';
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
  Admin.slip = null; Admin.transfer = null;
  $('docModal').classList.add('hidden');
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
    case 'memos':      loadMemos();      break;
    case 'profiles':   loadProfiles();   break;
    case 'settings':   loadWorkers();    break;
  }
}

/* ── Payroll ── */
async function loadPayroll() {
  const { month, year } = getMonthYear();
  const my = ++Admin.seq.payroll;
  $('payTitle').textContent = `Payroll — ${MONTHS[month - 1] || ''} ${year}`;
  $('payDue').textContent = 'Salary period 1–' + new Date(year, month, 0).getDate() + ' ' + (MONTHS[month - 1] || '') + ' · pay by ' + SPPDF.fmtDate(dueDate(month, year));

  try {
    const res = await call('getPayroll', { month: month, year: year });
    if (my !== Admin.seq.payroll) return;                 // a newer request replaced this one
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = res.data || [];

    const T = { basic: 0, otHrs: 0, ot: 0, short: 0, bonus: 0, allow: 0, gross: 0, adv: 0, net: 0 };
    data.forEach(w => {
      T.basic += w.basicPay || 0; T.otHrs += w.otHours || 0; T.ot += w.otPay || 0; T.short += w.shortPay || 0;
      T.bonus += w.bonus || 0; T.allow += w.allowance || 0; T.gross += w.gross || 0; T.adv += w.advance || 0; T.net += w.net || 0;
    });
    T.otHrs = Math.round(T.otHrs * 100) / 100;

    $('payStats').innerHTML = `
      <div class="a-stat"><div class="sk">Total Workers</div><div class="sv num">${data.length}</div></div>
      <div class="a-stat"><div class="sk">Gross Payroll</div><div class="sv num">${fmtMoney(T.gross)}</div></div>
      <div class="a-stat"><div class="sk">Total OT</div><div class="sv num">${fmtMoney(T.ot)}</div></div>
      <div class="a-stat s-amber"><div class="sk">Total Advances</div><div class="sv num">${fmtMoney(T.adv)}</div></div>
      <div class="a-stat"><div class="sk">To Pay (Net)</div><div class="sv num">${fmtMoney(T.net)}</div></div>`;
    $('paySub').textContent = `${data.length} workers`;

    const thead = `<thead><tr>
      <th>Emp No.</th><th class="tc-name">Name</th><th>Days</th><th>Daily Rate</th><th>Basic</th>
      <th>OT hrs</th><th>OT Pay</th><th>Short-day Pay</th><th>Bonus</th><th>Allowance</th><th>Gross</th><th>Advance</th><th>Net Pay</th><th>Payslip / Allowance</th>
    </tr></thead>`;
    const tbody = '<tbody>' + data.map(w => {
      const flag = w.incomplete
        ? ` <span title="${esc(w.incomplete)} shift(s) with no clock-out — check the sheet" style="color:var(--amber,#d4920b)">⚠${esc(w.incomplete)}</span>` : '';
      return `<tr>
        <td class="wno">${esc(w.id)}</td>
        <td class="tc-name">${esc(w.name)}${w.payType === 'fixed' ? ' <span class="fixed-tag">FIXED</span>' : ''}</td>
        <td class="tc-num">${esc(w.days || 0)}${flag}</td>
        <td class="tc-num">${w.payType === 'fixed' ? fmtMoney(w.monthly) + '<small>/mo</small>' : fmtMoney(w.dailySalary)}</td>
        <td class="tc-num">${fmtMoney(w.basicPay)}</td>
        <td class="tc-num">${esc(w.otHours || 0)}</td>
        <td class="tc-num">${fmtMoney(w.otPay)}</td>
        <td class="tc-num">${fmtMoney(w.shortPay)}</td>
        <td class="tc-num">${fmtMoney(w.bonus)}</td>
        <td class="tc-num">${w.allowance ? fmtMoney(w.allowance) : '<span style="color:var(--muted-2)">—</span>'}</td>
        <td class="tc-gross tc-num">${fmtMoney(w.gross)}</td>
        <td class="tc-adv tc-num">${fmtMoney(w.advance)}</td>
        <td class="tc-net tc-num">${fmtMoney(w.net)}</td>
        <td><button class="slip-btn" data-act="slip" data-id="${esc(w.id)}" title="Payslip for ${esc(w.name)}">📄 Payslip</button> <button class="slip-btn" data-act="allow" data-id="${esc(w.id)}" title="Add a special allowance for ${esc(w.name)}">➕ Allowance</button></td>
      </tr>`;
    }).join('') + '</tbody>';
    const tfoot = `<tfoot><tr>
      <td colspan="4" style="text-align:right">TOTAL</td>
      <td class="tc-num">${fmtMoney(T.basic)}</td>
      <td class="tc-num">${fmtNum(T.otHrs)}</td>
      <td class="tc-num">${fmtMoney(T.ot)}</td>
      <td class="tc-num">${fmtMoney(T.short)}</td>
      <td class="tc-num">${fmtMoney(T.bonus)}</td>
      <td class="tc-num">${fmtMoney(T.allow)}</td>
      <td class="tc-num">${fmtMoney(T.gross)}</td>
      <td class="tc-num">${fmtMoney(T.adv)}</td>
      <td class="tc-num">${fmtMoney(T.net)}</td>
      <td></td>
    </tr></tfoot>`;
    $('payTable').innerHTML = thead + tbody + tfoot;
  } catch (err) {
    if (my !== Admin.seq.payroll || !Admin.loggedIn) return;
    $('payTable').innerHTML = '<tbody><tr><td colspan="14" style="text-align:center;color:var(--muted);padding:40px">Unable to load payroll data</td></tr></tbody>';
    toast('Payroll load error: ' + err.message, true);
  }
}

/* ── Attendance grid (in / out times) + forgotten clock-outs ── */
const FLAG_ICON = { team: '👥', admin: '🛠', phone: '📱' };
const FLAG_TEXT = { team: 'clocked by team leader', admin: 'clock-out added by office', phone: 'used another person\'s phone' };

async function loadAttendance() {
  const { month, year } = getMonthYear();
  const daysInMonth = new Date(year, month, 0).getDate();
  const my = ++Admin.seq.attendance;
  $('attSub').textContent = `${MONTHS[month - 1]} ${year}`;
  $('attTable').classList.toggle('compact', Admin.attCompact);
  $('attModeBtn').textContent = Admin.attCompact ? '🕐 Show times' : '✓ Compact view';
  loadOpenShifts();

  try {
    const res = await call('getAttendance', { month: month, year: year });
    if (my !== Admin.seq.attendance) return;
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = res.data || [];
    const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    let thead = '<thead><tr><th>Emp</th><th>Name</th>';
    for (let d = 1; d <= daysInMonth; d++) {
      const wd = new Date(year, month - 1, d).getDay();
      thead += `<th class="dh day-h${wd === 0 ? ' sun' : ''}">${d}<small>${WD[wd]}</small></th>`;
    }
    thead += '<th>Full days</th></tr></thead>';

    const tbody = '<tbody>' + data.map(w => {
      let row = `<tr><td class="wno">${esc(w.id)}</td><td class="tc-name">${esc(w.name)}${w.payType === 'fixed' ? ' <span class="fixed-tag">FIXED</span>' : ''}</td>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const wd = new Date(year, month - 1, d).getDay();
        const list = (w.days && w.days[d]) || [];
        if (!list.length) { row += `<td class="tc-miss dh${wd === 0 ? ' sun' : ''}">·</td>`; continue; }
        const first = list[0];
        const cls = first.kind === 'full' ? 'g-full' : first.kind === 'short' ? 'g-short' : 'g-bad';
        const flags = list.reduce((a, x) => a.concat(x.flags || []), []).filter((f, i, arr) => arr.indexOf(f) === i);
        const fIcons = flags.map(f => FLAG_ICON[f] || '').join('');
        const tip = list.map(x => `${x.in} → ${x.out || 'NO CLOCK-OUT'}${x.ot ? ' · OT ' + x.ot + 'h' : ''}`).join('\n') +
          (flags.length ? '\n' + flags.map(f => FLAG_TEXT[f] || f).join(', ') : '');
        const times = first.kind === 'incomplete'
          ? `<span>${esc(first.in)}</span><span class="miss">⚠ no out</span>`
          : `<span>${esc(first.in)}</span><span>${esc(first.out)}</span>`;
        row += `<td class="gcell ${cls} dh${wd === 0 ? ' sun' : ''}" title="${esc(tip)}"><div class="tm">${Admin.attCompact ? (first.kind === 'incomplete' ? '⚠' : '✓') : times}${list.length > 1 ? '<span class="more">+' + (list.length - 1) + '</span>' : ''}${fIcons ? '<span class="ic">' + fIcons + '</span>' : ''}</div></td>`;
      }
      return row + `<td class="tc-num">${esc(w.full)}</td></tr>`;
    }).join('') + '</tbody>';
    $('attTable').innerHTML = thead + tbody;
  } catch (_) {
    if (my !== Admin.seq.attendance) return;
    $('attTable').innerHTML = '<tbody><tr><td colspan="35" style="text-align:center;padding:40px;color:var(--muted)">No attendance data</td></tr></tbody>';
  }
}
$('attModeBtn').addEventListener('click', () => { Admin.attCompact = !Admin.attCompact; loadAttendance(); });

async function loadOpenShifts() {
  const box = $('openBox');
  try {
    const res = await call('getOpenShifts');
    if (!res.ok) throw new Error(res.error || 'Failed');
    Admin.openShifts = res.data || [];
    const std = res.standardOut || '17:30';
    const old = Admin.openShifts.filter(o => o.beforeToday);
    if (!Admin.openShifts.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="open-box">
      <div class="ob-h">⚠ Clock-outs missing (${Admin.openShifts.length}) <span class="sub">Workers who clocked in but never clocked out. No pay / OT is counted until you fix them.</span></div>
      ${old.length ? `<div class="ob-all">Close every shift from before today at <input class="memo-in ob-time" id="obAllTime" type="time" value="${esc(std)}"> <button class="btn btn-green" data-act="forceall">🛠 Force all (${old.length})</button></div>` : ''}
      <div class="ob-list">${Admin.openShifts.map((o, i) => `
        <div class="ob-row">
          <div class="ob-w"><b>${esc(o.name)}</b> <span class="wno">${esc(o.workerId)}</span><br>
            <small>In ${esc(o.inTime)} on ${esc(o.inDate)} · ${o.working ? '🟢 still working? (' + esc(o.ageHours) + ' h)' : esc(o.ageHours) + ' h ago'} ${(o.flags || []).map(f => FLAG_ICON[f] || '').join('')}</small></div>
          <label class="ob-lbl">Out time <input class="memo-in ob-time" type="time" value="${esc(std)}" data-i="${i}"></label>
          <label class="ob-lbl"><input type="checkbox" data-nd="${i}"> next day</label>
          <button class="btn btn-ghost" data-act="force" data-i="${i}">Force clock-out</button>
        </div>`).join('')}</div></div>`;
  } catch (_) { box.innerHTML = ''; }
}

$('openBox').addEventListener('click', async function (e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  b.disabled = true;
  try {
    if (b.dataset.act === 'force') {
      const o = Admin.openShifts[parseInt(b.dataset.i, 10)];
      const time = this.querySelector('input.ob-time[data-i="' + b.dataset.i + '"]').value;
      const nd = this.querySelector('input[data-nd="' + b.dataset.i + '"]').checked;
      if (!o || !time) { toast('Enter the out time', true); return; }
      if (!confirm('Clock out ' + o.name + ' at ' + time + (nd ? ' (next day)' : '') + ' for the shift that started ' + o.inDate + ' ' + o.inTime + '?')) return;
      const res = await call('forceClockOut', { workerId: o.workerId, inTs: o.inTs, time: time, nextDay: nd });
      if (res.ok) { toast('✅ ' + o.name + ' clocked out at ' + time); loadAttendance(); if (Admin.currentTab === 'payroll') loadPayroll(); }
      else toast(res.error || 'Failed', true);
    } else if (b.dataset.act === 'forceall') {
      const time = $('obAllTime').value;
      if (!time) { toast('Enter the out time', true); return; }
      if (!confirm('Close ALL open shifts from before today with a clock-out at ' + time + '?')) return;
      const res = await call('forceClockOut', { all: true, time: time });
      if (res.ok) { toast('✅ ' + res.closed + ' shift(s) closed' + (res.skipped.length ? ' · ' + res.skipped.length + ' skipped' : '')); if (res.skipped.length) alert('Not closed:\n' + res.skipped.join('\n')); loadAttendance(); }
      else toast(res.error || 'Failed', true);
    }
  } catch (_) { if (Admin.loggedIn) toast('Network error', true); }
  finally { b.disabled = false; }
});

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
      const overLimit = !isLeave && (r.othersThisMonth + r.amount) > r.limit;
      const advInfo = isLeave ? '' : `<div class="rq-lim${overLimit ? ' over' : ''}">Other advances this month: ${fmtMoney(r.othersThisMonth)} · limit ${fmtMoney(r.limit)}${overLimit ? ' · ⚠ over the limit' : ''}</div>`;
      let actions = '';
      if (st === 'pending') {
        actions = `<div class="rq-actions">
            <button class="rq-approve" data-act="req" data-id="${esc(r.id)}" data-status="approved">✓ Approve</button>
            <button class="rq-reject" data-act="req" data-id="${esc(r.id)}" data-status="rejected">✕ Reject</button>
          </div>`;
      } else if (!isLeave) {
        actions = `<div class="rq-actions">
            <select class="memo-in rq-st"><option value="approved"${st === 'approved' ? ' selected' : ''}>Approved</option><option value="rejected"${st === 'rejected' ? ' selected' : ''}>Rejected</option><option value="pending">Back to pending</option></select>
            <button class="rq-approve" data-act="reqsave" data-id="${esc(r.id)}">💾 Save change</button>
          </div>`;
      }
      return `
      <div class="rq-card" data-rid="${esc(r.id)}" data-others="${esc(r.othersThisMonth || 0)}" data-limit="${esc(r.limit || 0)}" data-orig="${esc(r.amount)}">
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
            : `<div class="rq-amt-row"><span>Amount (you can change it)</span><input class="memo-in rq-amt num" type="number" min="1" step="1" value="${esc(r.amount)}"></div>${advInfo}`}
          ${r.reason ? `<div class="rq-reason">"${esc(r.reason)}"</div>` : ''}
          ${r.adminNote ? `<div class="rq-note">📝 ${esc(r.adminNote)}</div>` : ''}
        </div>
        ${actions}
      </div>`;
    }).join('');
  } catch (_) {
    if (my !== Admin.seq.requests) return;
    grid.innerHTML = '<div class="empty-msg">Unable to load requests</div>';
  }
}

async function decideRequest(id, status, btn) {
  const card = btn && btn.closest('.rq-card');
  const params = { requestId: id, status: status };
  const amtEl = card && card.querySelector('.rq-amt');
  if (amtEl) {
    const amt = Number(amtEl.value);
    if (!isFinite(amt) || amt <= 0) { toast('Enter a valid amount', true); return; }
    params.amount = amt;
    const others = Number(card.dataset.others) || 0, limit = Number(card.dataset.limit) || 0;
    if (status === 'approved' && limit && others + amt > limit &&
        !confirm('This worker would have ' + fmtMoney(others + amt) + ' in advances this month — over the ' + fmtMoney(limit) + ' limit. Approve anyway?')) return;
  }
  if (btn) btn.disabled = true;
  try {
    const res = await call('updateRequest', params);
    if (res.ok) { toast(status === 'approved' ? '✅ Approved' : '✕ Rejected'); loadRequests(); }
    else { toast(res.error || 'Failed', true); if (btn) btn.disabled = false; }
  } catch (_) { toast('Network error', true); if (btn) btn.disabled = false; }
}

$('reqGrid').addEventListener('click', function (e) {
  const b = e.target.closest('button[data-act="req"]');
  if (b) { decideRequest(b.dataset.id, b.dataset.status, b); return; }
  const sv = e.target.closest('button[data-act="reqsave"]');
  if (sv) decideRequest(sv.dataset.id, sv.closest('.rq-card').querySelector('.rq-st').value, sv);
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
          ${p.byName ? `<div class="proof-flag">👥 clocked by ${esc(p.byName)} (team leader)</div>` : ''}
          ${p.phoneOf ? `<div class="proof-flag warn">📱 used ${esc(p.phoneOf)}'s phone</div>` : ''}
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


/* ── Payslips, bank transfer, worker details ── */
function dueDate(month, year) {            // salary for month M is paid by the 10th of M+1
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1;
  return ny + '-' + String(nm).padStart(2, '0') + '-10';
}
function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function openModal(title, bodyHtml, buttons) {
  $('docBody').onclick = null;
  $('docTitle').textContent = title;
  $('docBody').innerHTML = bodyHtml;
  const foot = $('docFoot');
  foot.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || 'btn-ghost');
    el.textContent = b.label;
    el.disabled = !!b.disabled;
    el.addEventListener('click', () => b.fn(el));
    foot.appendChild(el);
  });
  $('docModal').classList.remove('hidden');
}
function closeModal() { $('docModal').classList.add('hidden'); Admin.slip = null; Admin.transfer = null; }
$('docClose').addEventListener('click', closeModal);
$('docModal').addEventListener('click', e => { if (e.target === $('docModal')) closeModal(); });

function pdfReady() {
  if (!window.SPPDF || !window.jspdf) { toast('PDF library did not load — refresh the page', true); return false; }
  return true;
}

$('payTable').addEventListener('click', function (e) {
  const b = e.target.closest('button[data-act="slip"]');
  if (b) { openSlip(b.dataset.id, b); return; }
  const al = e.target.closest('button[data-act="allow"]');
  if (al) openAllowance(al.dataset.id);
});

async function openSlip(workerId, btn) {
  if (!pdfReady()) return;
  const { month, year } = getMonthYear();
  if (btn) btn.disabled = true;
  try {
    const res = await call('getPaySheets', { month: month, year: year, workerId: workerId });
    if (!res.ok || !res.sheets || !res.sheets.length) { toast(res.error || 'Could not load payslip', true); return; }
    const sh = res.sheets[0];
    Admin.slip = { data: res, sh: sh };
    const phone = sh.phone ? '+' + esc(sh.phone) : '';
    const rows = (sh.payType === 'fixed' ? [['Fixed monthly salary', fmtMoney(sh.basicPay)]] : [
      ['Full working days', esc(sh.days)], ['Day pay', fmtMoney(sh.basicPay)],
      ['OT (' + esc(sh.otHours) + ' hrs)', fmtMoney(sh.otPay)], ['Short-day pay', fmtMoney(sh.shortPay)],
      ['Attendance bonus', fmtMoney(sh.bonus)],
    ]).concat(sh.allowance ? [['Special allowance', fmtMoney(sh.allowance)]] : []).concat([['Gross', fmtMoney(sh.gross)], ['Advances deducted', '− ' + fmtMoney(sh.advance)]]).map(r => `<div class="mrow"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
    openModal('Payslip — ' + sh.name + ' (' + sh.id + ')', `
      <div class="mnote" style="margin:0 0 8px">${esc(SPPDF.monthName(res.month))} ${esc(res.year)} · ${esc(SPPDF.fmtDate(res.periodStart))} – ${esc(SPPDF.fmtDate(res.periodEnd))} · pay by ${esc(SPPDF.fmtDate(res.payDue))}</div>
      ${rows}
      <div class="mrow big"><span>NET PAY</span><span>${fmtMoney(sh.net)}</span></div>
      <div class="mnote">The PDF also lists ${esc(sh.detail.length)} attendance row(s), ${esc(sh.advances.length)} advance(s) and ${esc(sh.leaves.length)} leave record(s).</div>
      ${sh.incomplete ? `<div class="mwarn">⚠ ${esc(sh.incomplete)} shift(s) have no clock-out and are not paid. Fix them in the Sheet before sending.</div>` : ''}
      ${phone ? `<div class="mnote">WhatsApp number: ${phone}</div>` : '<div class="mwarn">No phone number saved yet — the worker can add it in their app (My Details). You can still download the PDF or send it as an in-app notice.</div>'}
    `, [
      { label: '⬇ Download PDF', cls: 'btn-ghost', fn: () => slipDownload() },
      { label: '💬 Send via WhatsApp', cls: 'btn-green', fn: () => slipWhatsApp() },
      { label: '📨 Send in app', cls: 'btn-ghost', fn: el => slipNotice(el) },
      { label: 'Close', cls: 'btn-ghost', fn: closeModal },
    ]);
  } catch (err) {
    if (Admin.loggedIn) toast('Payslip error: ' + err.message, true);
  } finally { if (btn) btn.disabled = false; }
}

function slipFileName() {
  const d = Admin.slip.data, id = Admin.slip.sh.id;
  return 'Payslip_' + id + '_' + d.year + '-' + String(d.month).padStart(2, '0') + '.pdf';
}
function slipDoc() {
  const s = Admin.slip;
  return SPPDF.payslipsDoc(Object.assign({}, s.data, { sheets: [s.sh] }));
}
function slipDownload() {
  if (!Admin.slip) return;
  try { slipDoc().save(slipFileName()); } catch (err) { toast('PDF error: ' + err.message, true); }
}

// Phones/PCs that support file sharing open the share sheet (choose WhatsApp). Otherwise the PDF is
// downloaded and a WhatsApp chat with a short text is opened — the PDF must then be attached by hand.
async function slipWhatsApp() {
  if (!Admin.slip) return;
  const s = Admin.slip, text = SPPDF.payslipText(s.sh, s.data);
  let doc;
  try { doc = slipDoc(); } catch (err) { toast('PDF error: ' + err.message, true); return; }
  const name = slipFileName();
  try {
    const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Payslip', text: text });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;      // user closed the share sheet
  }
  doc.save(name);
  if (s.sh.phone) window.open('https://wa.me/' + encodeURIComponent(s.sh.phone) + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
  toast(s.sh.phone ? 'PDF downloaded — attach it in the WhatsApp chat that opened' : 'PDF downloaded — no phone number saved, open WhatsApp and attach it', false);
}

async function slipNotice(btn) {
  if (!Admin.slip) return;
  const s = Admin.slip;
  if (!confirm('Send this payslip summary to ' + s.sh.name + ' as a private notice in the app?')) return;
  btn.disabled = true;
  try {
    const res = await call('sendMemo', {
      target: [s.sh.id], title: 'Payslip - ' + SPPDF.monthName(s.data.month) + ' ' + s.data.year,
      message: SPPDF.payslipText(s.sh, s.data).slice(0, 500),
    });
    if (res.ok) toast('✅ Payslip sent to ' + s.sh.name + ' (Notices)'); else toast(res.error || 'Failed', true);
  } catch (_) { toast('Network error — not sent', true); }
  finally { btn.disabled = false; }
}

$('allSlipsBtn').addEventListener('click', async function () {
  if (!pdfReady()) return;
  const btn = this, { month, year } = getMonthYear();
  btn.disabled = true;
  try {
    const res = await call('getPaySheets', { month: month, year: year });
    if (!res.ok || !res.sheets || !res.sheets.length) { toast(res.error || 'No data', true); return; }
    SPPDF.payslipsDoc(res).save('Payslips_' + year + '-' + String(month).padStart(2, '0') + '.pdf');
    toast('✅ ' + res.sheets.length + ' payslips downloaded');
  } catch (err) { if (Admin.loggedIn) toast('Payslip error: ' + err.message, true); }
  finally { btn.disabled = false; }
});

$('transferBtn').addEventListener('click', async function () {
  if (!pdfReady()) return;
  const btn = this, { month, year } = getMonthYear();
  btn.disabled = true;
  try {
    const res = await call('getTransferData', { month: month, year: year });
    if (!res.ok) { toast(res.error || 'Failed', true); return; }
    Admin.transfer = res;
    const bankWord = String(res.company.bank || '').toLowerCase().split(' ')[0];
    const samp = res.lines.filter(l => bankWord && String(l.bankName).toLowerCase().indexOf(bankWord) !== -1).length;
    const lines = res.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.accountName)}</td><td>${esc(l.bankName)}</td><td>${esc(l.branch)}</td><td>${esc(l.accountNo)}</td><td class="r">${fmtMoney(l.amount)}</td></tr>`).join('');
    const exc = res.excluded.length ? `<div class="mwarn"><b>Not included (${res.excluded.length}):</b><br>${res.excluded.map(x => esc(x.name) + ' (' + esc(x.id) + ') — ' + esc(x.reason) + (x.reason === 'Bank details missing' ? ', net ' + fmtMoney(x.net) : '')).join('<br>')}</div>` : '';
    const inc = res.lines.filter(l => l.incomplete).length;
    openModal('Bank transfer — ' + SPPDF.monthName(res.month) + ' ' + res.year, `
      <div class="mrow"><span>Debit account</span><span>${esc(res.company.name)} · ${esc(res.company.bank)} ${esc(res.company.branch)} · ${esc(res.company.account)}</span></div>
      <div class="mrow"><span>Salary period</span><span>${esc(SPPDF.fmtDate(res.periodStart))} – ${esc(SPPDF.fmtDate(res.periodEnd))}</span></div>
      <div class="mrow"><span>Pay on or before</span><span>${esc(SPPDF.fmtDate(res.payDue))}</span></div>
      <div class="mrow"><span>Beneficiaries</span><span>${res.lines.length} (${samp} ${esc(res.company.bank)}, ${res.lines.length - samp} other banks)</span></div>
      <div class="mrow big"><span>TOTAL TO TRANSFER</span><span>${fmtMoney(res.total)}</span></div>
      ${inc ? `<div class="mwarn">⚠ ${inc} worker(s) below have shifts with no clock-out that are NOT in their amount. Fix the Sheet first if needed.</div>` : ''}
      ${exc}
      ${res.lines.length ? `<table class="mini-table"><thead><tr><th>#</th><th>Account holder</th><th>Bank</th><th>Branch</th><th>Account No.</th><th class="r">Amount</th></tr></thead><tbody>${lines}</tbody></table>` : '<div class="mnote">Nobody to pay yet for this month.</div>'}
      <div class="mnote">Check this list before sending it to the bank. The CSV is a plain file; ask the branch whether ${esc(res.company.bank)}'s bulk-upload template needs different columns, and do not re-save the CSV in Excel (it drops leading zeros in account numbers).</div>
    `, [
      { label: '⬇ Letter to bank (PDF)', cls: 'btn-green', disabled: !res.lines.length, fn: () => transferPdf() },
      { label: '⬇ CSV file', cls: 'btn-ghost', disabled: !res.lines.length, fn: () => transferCsv() },
      { label: 'Close', cls: 'btn-ghost', fn: closeModal },
    ]);
  } catch (err) { if (Admin.loggedIn) toast('Transfer error: ' + err.message, true); }
  finally { btn.disabled = false; }
});

function transferName(ext) { const t = Admin.transfer; return 'Salary_Transfer_' + t.year + '-' + String(t.month).padStart(2, '0') + '.' + ext; }
function transferPdf() {
  if (!Admin.transfer) return;
  try { SPPDF.transferDoc(Admin.transfer, todayYmd()).save(transferName('pdf')); } catch (err) { toast('PDF error: ' + err.message, true); }
}
function transferCsv() {
  if (!Admin.transfer) return;
  saveBlob(new Blob([SPPDF.bankCsv(Admin.transfer)], { type: 'text/csv;charset=utf-8' }), transferName('csv'));
}

/* Special allowance: the MD can add one at any time; it is paid with that salary month */
async function openAllowance(workerId) {
  const w = Admin.workers.find(x => x.id === workerId) || { id: workerId, name: workerId };
  const { month, year } = getMonthYear();
  const today = new Date();
  const mm = String(month).padStart(2, '0');
  const sameMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const defDate = sameMonth ? todayYmd() : year + '-' + mm + '-' + String(new Date(year, month, 0).getDate()).padStart(2, '0');
  let list = [];
  try {
    const res = await call('getAllowances', { workerId: workerId, month: month, year: year });
    if (!res.ok) { toast(res.error || 'Failed', true); return; }
    list = res.data || [];
  } catch (_) { if (Admin.loggedIn) toast('Network error', true); return; }

  const draw = lst => {
    $('alList').innerHTML = lst.length ? lst.map(a => `<div class="mrow"><span>${esc(a.date)} · ${esc(a.note || 'Special allowance')}</span><span>${fmtMoney(a.amount)} <button class="slip-btn" data-act="delallow" data-id="${esc(a.id)}">🗑</button></span></div>`).join('') +
      `<div class="mrow big"><span>Total this month</span><span>${fmtMoney(lst.reduce((s, a) => s + a.amount, 0))}</span></div>` : '<div class="mnote">No allowance added for this month yet.</div>';
  };
  openModal('➕ Special allowance — ' + w.name + ' (' + w.id + ')', `
    <div class="mnote" style="margin:0 0 8px">Salary month: <b>${esc(MONTHS[month - 1])} ${esc(year)}</b> (change the month at the top to add to another month). It is added to gross pay and printed on the payslip.</div>
    <div id="alList"></div>
    <div class="al-form">
      <label>Amount (Rs.)<input class="memo-in num" type="number" id="alAmt" min="1" step="1" placeholder="0"></label>
      <label>Reason<input class="memo-in" type="text" id="alNote" maxlength="100" placeholder="e.g. Festival allowance"></label>
      <label>Date<input class="memo-in" type="date" id="alDate" value="${esc(defDate)}"></label>
    </div>`, [
    { label: '➕ Add allowance', cls: 'btn-green', fn: async el => {
      const amount = Number($('alAmt').value);
      if (!isFinite(amount) || amount <= 0) { toast('Enter the amount', true); return; }
      el.disabled = true;
      try {
        const res = await call('addAllowance', { workerId: workerId, amount: amount, note: $('alNote').value.trim(), date: $('alDate').value });
        if (res.ok) { toast('✅ Allowance added'); $('alAmt').value = ''; $('alNote').value = ''; draw(res.data.filter(a => a.date.slice(0, 7) === year + '-' + mm)); loadPayroll(); }
        else toast(res.error || 'Failed', true);
      } catch (_) { toast('Network error', true); } finally { el.disabled = false; }
    } },
    { label: 'Close', cls: 'btn-ghost', fn: closeModal },
  ]);
  draw(list);
  $('docBody').onclick = async function (e) {
    const b = e.target.closest('button[data-act="delallow"]');
    if (!b || !confirm('Delete this allowance?')) return;
    b.disabled = true;
    try {
      const res = await call('deleteAllowance', { id: b.dataset.id });
      if (res.ok) { toast('Deleted'); draw(res.data); loadPayroll(); } else { toast(res.error || 'Failed', true); b.disabled = false; }
    } catch (_) { toast('Network error', true); b.disabled = false; }
  };
}

/* Worker details tab */
function setProfBadge(n) { $('profCnt').textContent = n; $('profCnt').className = 'cnt' + (n === 0 ? ' zero' : ''); }
async function refreshProfBadge() {
  try { const res = await call('getProfilesAdmin'); if (res.ok) setProfBadge(res.pendingCount || 0); } catch (_) { /* cosmetic */ }
}

async function loadProfiles() {
  const my = ++Admin.seq.profiles;
  $('profTable').innerHTML = '<tbody><tr><td style="padding:30px;color:var(--muted)">Loading…</td></tr></tbody>';
  try {
    const res = await call('getProfilesAdmin');
    if (my !== Admin.seq.profiles) return;
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = res.data || [];
    setProfBadge(res.pendingCount || 0);
    const done = data.filter(w => w.complete).length;
    $('profSub').textContent = done + ' of ' + data.length + ' complete';

    const pend = data.filter(w => w.pending);
    $('pendBox').innerHTML = pend.length ? `<div class="pend-grid">${pend.map(w => `
      <div class="pend-card">
        <div class="pc-h">🏦 Bank change request — ${esc(w.name)} (${esc(w.id)})</div>
        <div class="old">${esc(w.bankName)} · ${esc(w.branch)} · ${esc(w.accountNo)} · ${esc(w.accountName)}</div>
        <div>➜ <b>${esc(w.pending.bankName)} · ${esc(w.pending.branch)} · ${esc(w.pending.accountNo)} · ${esc(w.pending.accountName)}</b></div>
        <div class="rq-actions">
          <button class="rq-approve" data-act="bank" data-id="${esc(w.pending.id)}" data-status="approved">✓ Approve</button>
          <button class="rq-reject" data-act="bank" data-id="${esc(w.pending.id)}" data-status="rejected">✕ Reject</button>
        </div>
      </div>`).join('')}</div>` : '';

    const dash = v => v ? esc(v) : '<span style="color:var(--muted-2)">—</span>';
    $('profTable').innerHTML = `<thead><tr><th>Emp No.</th><th class="tc-name">Name</th><th>Phone</th><th>ID No.</th><th>Birthday</th><th>Address</th><th>Bank</th><th>Branch</th><th>Account No.</th><th>Account holder</th><th>Status</th></tr></thead><tbody>${
      data.map(w => `<tr><td class="wno">${esc(w.id)}</td><td class="tc-name">${esc(w.name)}</td><td>${dash(w.phone)}</td><td>${dash(w.nic)}</td><td>${dash(w.dob)}</td><td style="white-space:normal;min-width:180px">${dash(w.address)}</td><td>${dash(w.bankName)}</td><td>${dash(w.branch)}</td><td>${dash(w.accountNo)}</td><td>${dash(w.accountName)}</td><td>${w.complete ? '✅' : '⚠ incomplete'}${w.pending ? ' 🕒' : ''}</td></tr>`).join('')}</tbody>`;
  } catch (_) {
    if (my !== Admin.seq.profiles) return;
    $('profTable').innerHTML = '<tbody><tr><td style="padding:30px;color:var(--muted)">Unable to load worker details</td></tr></tbody>';
  }
}

$('pendBox').addEventListener('click', async function (e) {
  const b = e.target.closest('button[data-act="bank"]');
  if (!b) return;
  if (b.dataset.status === 'approved' && !confirm('Approve this bank change? Future salary transfers will go to the NEW account.')) return;
  b.disabled = true;
  try {
    const res = await call('decideBankChange', { id: b.dataset.id, status: b.dataset.status });
    if (res.ok) { toast(b.dataset.status === 'approved' ? '✅ Bank details updated' : '✕ Request rejected'); loadProfiles(); }
    else { toast(res.error || 'Failed', true); b.disabled = false; }
  } catch (_) { toast('Network error', true); b.disabled = false; }
});

/* ── Notices (memos) ── */
function memoMode() {
  const r = document.querySelector('input[name="memoTo"]:checked');
  return r ? r.value : 'all';
}

function renderMemoPick() {
  const box = $('memoPick');
  const keep = new Set(Array.from(box.querySelectorAll('input[data-id]:checked')).map(i => i.dataset.id));
  box.innerHTML = '<label class="pick-all"><input type="checkbox" id="memoPickAll"> Select all</label>' +
    Admin.workers.map(w => `<label><input type="checkbox" data-id="${esc(w.id)}"${keep.has(w.id) ? ' checked' : ''}> ${esc(w.name)}</label>`).join('');
}

function syncMemoMode() {
  const sel = memoMode() === 'sel';
  $('memoPick').classList.toggle('hidden', !sel);
  if (sel) renderMemoPick();
}

document.querySelectorAll('input[name="memoTo"]').forEach(r => r.addEventListener('change', syncMemoMode));
$('memoPick').addEventListener('change', function (e) {
  if (e.target.id === 'memoPickAll') {
    $('memoPick').querySelectorAll('input[data-id]').forEach(i => { i.checked = e.target.checked; });
  }
});
$('memoText').addEventListener('input', () => { $('memoCount').textContent = $('memoText').value.length + ' / 500'; });

async function loadMemos() {
  const my = ++Admin.seq.memos;
  const list = $('memoList');
  if (!Admin.workersLoaded) await loadWorkers(true);
  syncMemoMode();
  try {
    const res = await call('getMemosAdmin');
    if (my !== Admin.seq.memos) return;
    if (!res.ok) throw new Error(res.error || 'Failed');
    const data = res.data || [];
    if (!data.length) { list.innerHTML = '<div class="empty-msg">No notices sent yet</div>'; return; }
    list.innerHTML = data.map(m => `
      <div class="memo-item">
        <button class="mi-del" data-act="delmemo" data-id="${esc(m.id)}" title="Delete (workers will no longer see it)">🗑</button>
        ${m.title ? `<div class="mi-t">${esc(m.title)}</div>` : ''}
        <div class="mi-b">${esc(m.message)}</div>
        <div class="mi-m">${esc(fmtDT(m.ts))} · To: ${m.toAll ? 'All workers' : esc(m.recipients.join(', '))}</div>
      </div>`).join('');
  } catch (_) {
    if (my !== Admin.seq.memos) return;
    list.innerHTML = '<div class="empty-msg">Unable to load notices</div>';
  }
}

$('memoSendBtn').addEventListener('click', async function () {
  const btn = this;
  const message = $('memoText').value.trim();
  const title = $('memoTitle').value.trim();
  if (!message) { toast('Type a message first', true); return; }
  let target = 'ALL';
  if (memoMode() === 'sel') {
    target = Array.from($('memoPick').querySelectorAll('input[data-id]:checked')).map(i => i.dataset.id);
    if (!target.length) { toast('Select at least one worker', true); return; }
  }
  btn.disabled = true;
  try {
    const res = await call('sendMemo', { target: target, title: title, message: message });
    if (res.ok) {
      toast('✅ Sent to ' + res.sentTo + ' worker(s)');
      $('memoText').value = ''; $('memoTitle').value = ''; $('memoCount').textContent = '0 / 500';
      loadMemos();
    } else toast(res.error || 'Failed', true);
  } catch (_) { toast('Network error — not sent', true); }
  finally { btn.disabled = false; }
});

$('memoList').addEventListener('click', async function (e) {
  const b = e.target.closest('button[data-act="delmemo"]');
  if (!b || !confirm('Delete this notice? Workers will no longer see it.')) return;
  b.disabled = true;
  try {
    const res = await call('deleteMemo', { id: b.dataset.id });
    if (res.ok) { toast('Deleted'); loadMemos(); } else { toast(res.error || 'Failed', true); b.disabled = false; }
  } catch (_) { toast('Network error', true); b.disabled = false; }
});

/* ── Workers (roster) ── */
function applyWorkers(res) {
  Admin.workers = (res.data || []).map(w => ({
    id: w.id, name: w.name, salary: Number(w.salary) || 0, payType: w.payType === 'fixed' ? 'fixed' : 'daily',
    monthly: Number(w.monthly) || 0, team: Array.isArray(w.team) ? w.team.slice() : [],
  }));
  Admin.retiredIds = res.retiredIds || [];
  Admin.blockedIds = res.blockedIds || [];
  Admin.workersLoaded = true;
  renderWorkerTable();
  populateProofWorkerFilter();
  $('saveWorkersBtn').disabled = false;
}

async function loadWorkers(quiet) {
  try {
    const res = await call('getWorkersAdmin');
    if (!res.ok) throw new Error(res.error || 'Failed');
    applyWorkers(res);
  } catch (err) {
    // NEVER fall back to fake/default data here — saving it would overwrite the real roster.
    Admin.workersLoaded = false;
    if (!quiet) {
      $('wtableBody').innerHTML = '<tr><td colspan="6" class="empty-state">Unable to load workers — press ↻ Sync</td></tr>';
      toast('Workers load error: ' + err.message, true);
    }
  }
  $('saveWorkersBtn').disabled = !Admin.workersLoaded;
}

function renderWorkerTable() {
  const tbody = $('wtableBody');
  if (!Admin.workers.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No workers</td></tr>';
    return;
  }
  tbody.innerHTML = Admin.workers.map((w, i) => {
    const fixed = w.payType === 'fixed';
    const blocked = Admin.blockedIds.indexOf(w.id) !== -1;
    const tn = (w.team || []).length;
    return `
    <tr>
      <td><span class="wno">${esc(w.id)}</span></td>
      <td><input value="${esc(w.name)}" data-i="${i}" data-field="name" maxlength="60"></td>
      <td><select class="memo-in" data-i="${i}" data-field="payType"><option value="daily"${fixed ? '' : ' selected'}>Daily rate</option><option value="fixed"${fixed ? ' selected' : ''}>Fixed monthly</option></select></td>
      <td><input class="sal" value="${esc(fixed ? w.monthly : w.salary)}" data-i="${i}" data-field="${fixed ? 'monthly' : 'salary'}" type="number" min="0" step="1" aria-label="${fixed ? 'Monthly salary' : 'Daily salary'}"></td>
      <td><button class="pin-reset-btn" data-act="team" data-i="${i}" title="People this person can clock in/out from his phone">👥 Team${tn ? ' (' + tn + ')' : ''}</button></td>
      <td class="pin-cell">
        ${blocked ? `<span class="blk-tag">🚫 BLOCKED</span> <button class="pin-reset-btn unb" data-act="unblock" data-i="${i}">🔓 Unblock</button> ` : ''}
        <button class="pin-reset-btn" data-act="resetpin" data-i="${i}" title="Reset PIN to ${esc(CONFIG.DEFAULT_WORKER_PIN || '0000')}">🔑 Reset PIN</button>
      </td>
      <td><button class="x-btn" data-act="remove" data-i="${i}" aria-label="Remove worker">✕</button></td>
    </tr>`;
  }).join('');
}

$('wtableBody').addEventListener('change', function (e) {
  const el = e.target;
  if (!el.dataset || el.dataset.field === undefined) return;
  const w = Admin.workers[parseInt(el.dataset.i, 10)];
  if (!w) return;
  const f = el.dataset.field;
  if (f === 'salary' || f === 'monthly') {
    const n = parseFloat(el.value);
    w[f] = isFinite(n) && n >= 0 ? n : 0;
    el.value = w[f];
  } else if (f === 'payType') {
    w.payType = el.value === 'fixed' ? 'fixed' : 'daily';
    renderWorkerTable();
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
  if (b.dataset.act === 'resetpin') resetWorkerPin(w.id, w.name, b);
  if (b.dataset.act === 'unblock') unblockWorker(w.id, w.name, b);
  if (b.dataset.act === 'team') openTeamModal(i);
  if (b.dataset.act === 'remove') removeWorker(i);
});

async function resetWorkerPin(workerId, workerName, btn) {
  const defaultPin = CONFIG.DEFAULT_WORKER_PIN || '0000';
  if (!confirm('Reset PIN for ' + workerName + ' to ' + defaultPin + '? (This also unblocks the account.)')) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Resetting…';
  try {
    const res = await call('resetPin', { workerId: workerId, newPin: defaultPin });
    if (res.ok) {
      Admin.blockedIds = Admin.blockedIds.filter(x => x !== workerId);
      toast('✅ PIN reset to ' + defaultPin + ' for ' + workerName);
      renderWorkerTable();
    } else { toast(res.error || 'Reset failed', true); btn.disabled = false; btn.textContent = old; }
  } catch (_) { toast('Network error — could not reset PIN', true); btn.disabled = false; btn.textContent = old; }
}

async function unblockWorker(workerId, workerName, btn) {
  if (!confirm('Unblock ' + workerName + '? Their own PIN keeps working.')) return;
  btn.disabled = true;
  try {
    const res = await call('unblockWorker', { workerId: workerId });
    if (res.ok) { Admin.blockedIds = Admin.blockedIds.filter(x => x !== workerId); toast('✅ ' + workerName + ' unblocked'); renderWorkerTable(); }
    else { toast(res.error || 'Failed', true); btn.disabled = false; }
  } catch (_) { toast('Network error', true); btn.disabled = false; }
}

/* Team leader: choose the people (max 10) this worker may clock in/out from his phone */
function openTeamModal(i) {
  const w = Admin.workers[i];
  const max = Admin.policy.maxTeam || 10;
  const others = Admin.workers.filter(x => x.id !== w.id);
  openModal('👥 Team of ' + w.name, `
    <div class="mnote" style="margin:0 0 10px">Tick the people ${esc(w.name)} may clock in / out from his own phone (for workers without a phone). Max ${max}. Leave empty if he is not a team leader. Press <b>Save Workers</b> afterwards.</div>
    <div class="memo-pick" id="teamPick" style="max-height:340px">${others.map(x => `<label><input type="checkbox" data-id="${esc(x.id)}"${(w.team || []).indexOf(x.id) !== -1 ? ' checked' : ''}> ${esc(x.name)} <span class="wno">${esc(x.id)}</span></label>`).join('')}</div>
    <div class="mnote" id="teamCnt"></div>`, [
    { label: 'Done', cls: 'btn-green', fn: () => {
      const ids = Array.from($('teamPick').querySelectorAll('input:checked')).map(c => c.dataset.id);
      if (ids.length > max) { toast('A team can have at most ' + max + ' people', true); return; }
      w.team = ids; closeModal(); renderWorkerTable(); toast('Team set — press Save Workers to keep it');
    } },
    { label: 'Cancel', cls: 'btn-ghost', fn: closeModal },
  ]);
  const upd = () => { $('teamCnt').textContent = $('teamPick').querySelectorAll('input:checked').length + ' / ' + max + ' selected'; };
  $('teamPick').addEventListener('change', upd); upd();
}

function removeWorker(i) {
  const w = Admin.workers[i];
  if (!w || !confirm('Remove ' + w.name + '? (History is kept; press Save Workers to apply)')) return;
  Admin.workers.splice(i, 1);
  Admin.workers.forEach(x => { x.team = (x.team || []).filter(t => t !== w.id); });
  renderWorkerTable();
}

$('addWorkerBtn').addEventListener('click', () => {
  if (!Admin.workersLoaded) { toast('Load workers first (↻ Sync)', true); return; }
  let max = 0;
  Admin.workers.map(w => w.id).concat(Admin.retiredIds).forEach(id => {
    const m = /^EMP(\d+)$/.exec(String(id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  Admin.workers.push({ id: 'EMP' + String(max + 1).padStart(3, '0'), name: 'New Worker', salary: 2000, payType: 'daily', monthly: 0, team: [] });
  renderWorkerTable();
});

$('saveWorkersBtn').addEventListener('click', async function () {
  if (!Admin.workersLoaded) { toast('Workers not loaded — cannot save', true); return; }
  const btn = this;
  const bad = Admin.workers.find(w => !String(w.name || '').trim());
  if (bad) { toast('Name required for ' + bad.id, true); return; }
  const fx = Admin.workers.find(w => w.payType === 'fixed' && !(w.monthly > 0));
  if (fx) { toast('Enter the fixed monthly salary for ' + fx.name, true); return; }
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
    const rows = [['Emp No.', 'Name', 'Pay type', 'Days', 'Daily Rate', 'Monthly (fixed)', 'Basic', 'OT Hours', 'OT Pay', 'Short-day Pay', 'Bonus', 'Allowance', 'Gross', 'Advance', 'Net Pay', 'No-clockout shifts']];
    res.data.forEach(w => rows.push([w.id, w.name, w.payType, w.days, w.dailySalary, w.monthly || 0, w.basicPay, w.otHours, w.otPay, w.shortPay, w.bonus, w.allowance || 0, w.gross, w.advance, w.net, w.incomplete || 0]));
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
  if (!confirm('Clear remembered logins (names / PINs) on this device?')) return;
  try {
    const kill = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === PFX + 'known' || k === PFX + 'lastId' || k.indexOf(PFX + 'status_') === 0)) kill.push(k);
    }
    kill.forEach(k => localStorage.removeItem(k));
  } catch (_) {}
  toast('Remembered logins cleared on this device');
});

/* ── Init ── */
async function initAdmin() {
  initSelectors();
  loadPayroll();
  try {                                   // ONE call for roster + both badges
    const res = await call('adminInit');
    if (res && res.ok) {
      Admin.policy = res.policy || {};
      applyWorkers(res);
      setPendingBadge(res.pendingRequests || 0);
      setProfBadge(res.pendingBank || 0);
    }
  } catch (_) { loadWorkers(true); }
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
