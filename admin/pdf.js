// ═══════════════════════════════════════════════════
//  SP HOME — PDF + bank-file builders (admin only)
//  Needs ../shared/jspdf.umd.min.js loaded first.
//  Exposes window.SPPDF
// ═══════════════════════════════════════════════════
(function () {
  'use strict';

  const M = 14, PW = 210, PH = 297, CW = PW - 2 * M;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON3 = MONTHS.map(m => m.slice(0, 3));
  const DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // jsPDF's built-in fonts only know Latin-1: anything else would print as garbage.
  function T(v) { return String(v === null || v === undefined ? '' : v).replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?'); }
  function num(v) { return Number(v) || 0; }
  function money(v) {
    return 'Rs. ' + (Math.round(num(v) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtDate(ymd) {                     // 'yyyy-mm-dd' → '10 Jul 2026' (pure string maths, no timezone)
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    return m ? (+m[3]) + ' ' + MON3[+m[2] - 1] + ' ' + m[1] : String(ymd || '');
  }
  function dayName(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    return m ? DAYS3[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : '';
  }
  function monthName(m) { return MONTHS[(m || 1) - 1] || ''; }
  function newDoc() {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF library not loaded');
    return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  }

  /* ── drawing helpers ── */
  function fit(doc, text, w) {
    let t = T(text);
    if (doc.getTextWidth(t) <= w) return t;
    while (t.length > 1 && doc.getTextWidth(t + '..') > w) t = t.slice(0, -1);
    return t + '..';
  }
  function ensure(S, h) {
    if (S.y + h > PH - 16) { S.doc.addPage(); S.y = M; return true; }
    return false;
  }
  function h2(S, text) {
    ensure(S, 16);
    const d = S.doc;
    S.y += 4;
    d.setFont('helvetica', 'bold'); d.setFontSize(10.5); d.setTextColor(35, 85, 28);
    d.text(T(text), M, S.y);
    d.setDrawColor(45, 102, 34); d.setLineWidth(0.4); d.line(M, S.y + 1.6, M + CW, S.y + 1.6);
    d.setTextColor(0); d.setLineWidth(0.2);
    S.y += 6;
  }
  function note(S, text, size) {
    const d = S.doc;
    d.setFont('helvetica', 'normal'); d.setFontSize(size || 9); d.setTextColor(90);
    d.splitTextToSize(T(text), CW).forEach(line => { ensure(S, 5); d.text(line, M, S.y + 3.5); S.y += 4.6; });
    d.setTextColor(0);
  }
  // cols: [{h, w, a:'l'|'r'|'c'}]   rows: array | { cells:[], bold, fill:[r,g,b] }
  function table(S, cols, rows) {
    const d = S.doc, rh = 6.2;
    function cell(c, txt, x, y) {
      const t = fit(d, txt, c.w - 3);
      if (c.a === 'r') d.text(t, x + c.w - 1.5, y + 4.4, { align: 'right' });
      else if (c.a === 'c') d.text(t, x + c.w / 2, y + 4.4, { align: 'center' });
      else d.text(t, x + 1.5, y + 4.4);
    }
    function head() {
      d.setFillColor(226, 238, 222); d.rect(M, S.y, CW, rh, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.setTextColor(30, 60, 25);
      let x = M; cols.forEach(c => { cell(c, c.h, x, S.y); x += c.w; });
      d.setTextColor(0); S.y += rh;
    }
    ensure(S, rh * 3); head();
    rows.forEach((r0, i) => {
      const r = Array.isArray(r0) ? { cells: r0 } : r0;
      if (S.y + rh > PH - 16) { d.addPage(); S.y = M; head(); }
      if (r.fill) { d.setFillColor(r.fill[0], r.fill[1], r.fill[2]); d.rect(M, S.y, CW, rh, 'F'); }
      else if (i % 2) { d.setFillColor(247, 249, 246); d.rect(M, S.y, CW, rh, 'F'); }
      d.setFont('helvetica', r.bold ? 'bold' : 'normal'); d.setFontSize(8.5);
      let x = M; cols.forEach((c, j) => { cell(c, r.cells[j], x, S.y); x += c.w; });
      d.setDrawColor(222); d.line(M, S.y + rh, M + CW, S.y + rh);
      S.y += rh;
    });
  }
  function kv(S, x, y, label, value) {
    const d = S.doc;
    d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(110); d.text(T(label), x, y);
    d.setFont('helvetica', 'bold'); d.setFontSize(9.5); d.setTextColor(20); d.text(fit(d, value || '-', 64), x + 27, y);
  }
  function footers(doc, label) {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(130);
      doc.text(T(label), M, PH - 7);
      doc.text('Page ' + i + ' of ' + n, PW - M, PH - 7, { align: 'right' });
      doc.setTextColor(0);
    }
  }

  /* ── payslip ── */
  function drawPayslip(S, sh, data) {
    const d = S.doc;
    d.setFillColor(45, 102, 34); d.rect(0, 0, PW, 26, 'F');
    d.setTextColor(255); d.setFont('helvetica', 'bold'); d.setFontSize(16); d.text(T(data.company), M, 12);
    d.setFontSize(10); d.setFont('helvetica', 'normal');
    if (data.companyAddress) { d.setFontSize(8.5); d.text(T(data.companyAddress), M, 16.2); d.setFontSize(10); }
    d.text('Salary period: ' + fmtDate(data.periodStart) + ' - ' + fmtDate(data.periodEnd), M, 22);
    d.setFont('helvetica', 'bold'); d.setFontSize(15); d.text('PAYSLIP', PW - M, 12, { align: 'right' });
    d.setFont('helvetica', 'normal'); d.setFontSize(10); d.text(monthName(data.month) + ' ' + data.year, PW - M, 22, { align: 'right' });
    d.setTextColor(0);

    S.y = 35;
    kv(S, M, S.y, 'Employee', sh.name);          kv(S, 112, S.y, 'Pay date', 'by ' + fmtDate(data.payDue));
    kv(S, M, S.y + 6.5, 'Emp No.', sh.id);       kv(S, 112, S.y + 6.5, 'Bank', sh.bankName || '-');
    kv(S, M, S.y + 13, 'ID number', sh.nic || '-'); kv(S, 112, S.y + 13, 'Account', sh.accountMasked || '-');
    S.y += 18;

    h2(S, 'Earnings and deductions');
    const bonusTxt = sh.bonus > 0 ? 'Earned (' + sh.days + ' full days)' : 'Needs ' + data.bonusMinDays + '+ full days';
    const earn = sh.payType === 'fixed'
      ? [['Fixed monthly salary', 'Agreed monthly amount', money(sh.basicPay)]]
      : [
        ['Day pay', sh.days + ' full day(s) x ' + money(sh.dailySalary), money(sh.basicPay)],
        ['Overtime (OT)', num(sh.otHours) + ' hour(s)', money(sh.otPay)],
        ['Short-day pay', 'Hours worked on part days', money(sh.shortPay)],
        ['Attendance bonus', bonusTxt, money(sh.bonus)],
      ];
    (sh.allowances || []).forEach(a => earn.push(['Special allowance', (a.note || 'Allowance') + ' (' + fmtDate(a.date) + ')', money(a.amount)]));
    table(S, [{ h: 'Description', w: 62 }, { h: 'Details', w: 80 }, { h: 'Amount', w: 40, a: 'r' }], earn.concat([
      { cells: ['Gross earnings', '', money(sh.gross)], bold: true, fill: [238, 244, 235] },
      ['Less: advances', 'Approved advances this month', '- ' + money(sh.advance)],
      { cells: ['NET PAY', 'Transfer to bank account', money(sh.net)], bold: true, fill: [208, 230, 200] },
    ]));

    const full = sh.detail.filter(x => x.kind === 'full').length;
    const shortN = sh.detail.filter(x => x.kind === 'short').length;
    S.y += 3;
    note(S, 'Days present: ' + sh.presentDays + '   |   Full days: ' + full + '   |   Short days: ' + shortN +
      '   |   OT hours: ' + num(sh.otHours) + '   |   Shifts with no clock-out: ' + (sh.incomplete || 0), 8.5);
    S.y += 2;

    h2(S, 'Attendance details');
    if (!sh.detail.length) note(S, 'No attendance recorded this month.');
    else {
      const kindTxt = { full: 'Full day', short: 'Short day', incomplete: 'No clock-out (not paid)' };
      table(S, [{ h: 'Date', w: 40 }, { h: 'In', w: 22 }, { h: 'Out', w: 30 }, { h: 'Net hours', w: 24, a: 'r' }, { h: 'Type', w: 44 }, { h: 'OT hrs', w: 22, a: 'r' }],
        sh.detail.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).map(x => [
          fmtDate(x.date) + ' ' + dayName(x.date), x.inTime, x.outTime || '-', x.kind === 'incomplete' ? '-' : x.hours,
          kindTxt[x.kind] || x.kind, x.otHours ? x.otHours : '-',
        ]));
    }

    h2(S, 'Advances');
    if (!sh.advances.length) note(S, 'No advances requested this month.');
    else table(S, [{ h: 'Date', w: 34 }, { h: 'Amount', w: 36, a: 'r' }, { h: 'Status', w: 30 }, { h: 'Reason', w: 82 }],
      sh.advances.map(a => [fmtDate(a.date), money(a.amount), a.status, a.reason || '-']));

    h2(S, 'Leave');
    if (!sh.leaves.length) note(S, 'No leave this month.');
    else table(S, [{ h: 'Type', w: 38 }, { h: 'From', w: 34 }, { h: 'To', w: 34 }, { h: 'Days', w: 20, a: 'r' }, { h: 'Status', w: 56 }],
      sh.leaves.map(l => [l.leaveType, fmtDate(l.from), fmtDate(l.to), l.days, l.status]));

    S.y += 4;
    note(S, 'This payslip is generated from the attendance records. Rounding is to the nearest rupee. Payment is made by bank transfer on or before ' + fmtDate(data.payDue) + '.', 8);
  }

  // data = response of getPaySheets (one or many sheets → one page-set per worker)
  function payslipsDoc(data) {
    const doc = newDoc();
    data.sheets.forEach((sh, i) => {
      if (i > 0) doc.addPage();
      drawPayslip({ doc: doc, y: M }, sh, data);
    });
    footers(doc, 'System generated payslip - ' + data.company + ' - ' + monthName(data.month) + ' ' + data.year);
    return doc;
  }

  // Short text version (WhatsApp message / in-app notice, max ~500 chars)
  function payslipText(sh, data) {
    return [
      'Payslip - ' + monthName(data.month) + ' ' + data.year + ' (' + sh.name + ')',
      'Days present: ' + sh.presentDays + ' (full ' + sh.days + ')',
      sh.payType === 'fixed' ? 'Fixed salary: ' + money(sh.basicPay) : 'Day pay: ' + money(sh.basicPay),
      sh.payType === 'fixed' ? '' : 'OT ' + num(sh.otHours) + ' hrs: ' + money(sh.otPay),
      sh.payType === 'fixed' ? '' : 'Short-day pay: ' + money(sh.shortPay),
      sh.payType === 'fixed' ? '' : 'Bonus: ' + money(sh.bonus),
      num(sh.allowance) > 0 ? 'Special allowance: ' + money(sh.allowance) : '',
      'Gross: ' + money(sh.gross),
      'Advances: - ' + money(sh.advance),
      'NET PAY: ' + money(sh.net),
      'Pay date: by ' + fmtDate(data.payDue),
    ].filter(Boolean).join('\n');
  }

  /* ── bank transfer letter + CSV ── */
  function narration(data) { return 'SALARY ' + MON3[data.month - 1].toUpperCase() + ' ' + data.year; }

  function transferDoc(data, today) {
    const doc = newDoc(), S = { doc: doc, y: M };
    const c = data.company;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(35, 85, 28); doc.text(T(c.name), M, S.y + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(T(c.address || ''), M, S.y + 10);
    doc.setTextColor(0); doc.setFontSize(10); doc.text(fmtDate(today), PW - M, S.y + 4, { align: 'right' });
    S.y += 20;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    ['The Manager,', T(c.bank) + ',', T(c.branch) + ' Branch.'].forEach(l => { doc.text(l, M, S.y); S.y += 5.5; });
    S.y += 3;
    doc.text('Dear Sir / Madam,', M, S.y); S.y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(T('Staff salary payment for ' + monthName(data.month) + ' ' + data.year + ' - fund transfer request'), M, S.y); S.y += 3;
    doc.setLineWidth(0.3); doc.line(M, S.y, M + CW, S.y); S.y += 6;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const body = 'Please debit our account number ' + c.account + ' (' + c.name + ') with a total of ' + money(data.total) +
      ' and credit the salary amounts below to the respective staff accounts, using the narration "' + narration(data) + '". ' +
      'The salary period is ' + fmtDate(data.periodStart) + ' to ' + fmtDate(data.periodEnd) + '. Payment is due on or before ' + fmtDate(data.payDue) + '.';
    doc.splitTextToSize(T(body), CW).forEach(l => { doc.text(l, M, S.y); S.y += 5.2; });
    S.y += 2;

    const rows = data.lines.map((l, i) => [i + 1, l.accountName, l.bankName, l.branch, l.accountNo, money(l.amount).replace('Rs. ', '')]);
    rows.push({ cells: ['', 'TOTAL (' + data.lines.length + ' beneficiaries)', '', '', '', money(data.total).replace('Rs. ', '')], bold: true, fill: [208, 230, 200] });
    table(S, [{ h: 'No', w: 10 }, { h: 'Beneficiary (account holder)', w: 54 }, { h: 'Bank', w: 34 }, { h: 'Branch', w: 28 }, { h: 'Account No.', w: 32 }, { h: 'Amount (LKR)', w: 24, a: 'r' }], rows);

    ensure(S, 52);
    S.y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Thank you.', M, S.y); S.y += 6;
    doc.text('Yours faithfully,', M, S.y); S.y += 20;
    doc.setDrawColor(60); doc.setLineWidth(0.3);
    doc.line(M, S.y, M + 62, S.y); doc.line(M + 80, S.y, M + 142, S.y);
    doc.setFontSize(9); doc.setTextColor(90);
    doc.text('Authorised signatory', M, S.y + 5); doc.text('Authorised signatory', M + 80, S.y + 5);
    doc.text('For ' + T(c.name), M, S.y + 10);
    doc.setDrawColor(150); doc.rect(M + 150, S.y - 17, 32, 22);
    doc.text('Company stamp', M + 166, S.y + 9, { align: 'center' });
    doc.setTextColor(0);

    footers(doc, T(c.name) + ' - salary transfer request - ' + monthName(data.month) + ' ' + data.year);
    return doc;
  }

  function csvCell(v) {
    let s = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;              // spreadsheet formula injection guard
    return '"' + s.replace(/"/g, '""') + '"';
  }
  // Plain CSV. Account numbers are quoted text; do NOT re-save it in Excel (it would drop leading zeros).
  function bankCsv(data) {
    const rows = [['No', 'Beneficiary Name', 'Bank', 'Branch', 'Account Number', 'Amount (LKR)', 'Reference']];
    data.lines.forEach((l, i) => rows.push([i + 1, l.accountName, l.bankName, l.branch, l.accountNo, (Math.round(l.amount * 100) / 100).toFixed(2), narration(data)]));
    return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  window.SPPDF = { payslipsDoc: payslipsDoc, payslipText: payslipText, transferDoc: transferDoc, bankCsv: bankCsv, fmtDate: fmtDate, money: money, monthName: monthName, narration: narration };
})();
