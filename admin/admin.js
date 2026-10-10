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
  seq: { payroll: 0, attendance: 0, requests: 0, proof: 0, memos: 0, profiles: 0 },
  slip: null,
  transfer: null,
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
      <div class="a-stat"><div class="sk">To Pay (Net)</div><div class="sv num">${fmtMoney(T.net)}</div></div>`;
    $('paySub').textContent = `${data.length} workers`;

    const thead = `<thead><tr>
      <th>Emp No.</th><th class="tc-name">Name</th><th>Days</th><th>Daily Rate</th><th>Basic</th>
      <th>OT hrs</th><th>OT Pay</th><th>Short-day Pay</th><th>Bonus</th><th>Gross</th><th>Advance</th><th>Net Pay</th><th>Payslip</th>
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
        <td><button class="slip-btn" data-act="slip" data-id="${esc(w.id)}" title="Payslip for ${esc(w.name)}">📄 Payslip</button></td>
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
      <td></td>
    </tr></tfoot>`;
    $('payTable').innerHTML = thead + tbody + tfoot;
  } catch (err) {
    if (my !== Admin.seq.payroll || !Admin.loggedIn) return;
    $('payTable').innerHTML = '<tbody><tr><td colspan="13" style="text-align:center;color:var(--muted);padding:40px">Unable to load payroll data</td></tr></tbody>';
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
  if (b) openSlip(b.dataset.id, b);
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
    const rows = [
      ['Full working days', esc(sh.days)], ['Day pay', fmtMoney(sh.basicPay)],
      ['OT (' + esc(sh.otHours) + ' hrs)', fmtMoney(sh.otPay)], ['Short-day pay', fmtMoney(sh.shortPay)],
      ['Attendance bonus', fmtMoney(sh.bonus)], ['Gross', fmtMoney(sh.gross)], ['Advances deducted', '− ' + fmtMoney(sh.advance)],
    ].map(r => `<div class="mrow"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
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
    const samp = res.lines.filter(l => /sampath/i.test(l.bankName)).length;
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
      <div class="mnote">Check this list before sending it to the bank. The CSV is a plain file; ask the branch whether Sampath's bulk-upload template needs different columns, and do not re-save the CSV in Excel (it drops leading zeros in account numbers).</div>
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
  refreshProfBadge();
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
