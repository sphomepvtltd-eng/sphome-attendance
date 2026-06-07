// ═══════════════════════════════════════════════════════════════════
//  SP HOME INTERIOR — Google Apps Script Backend  (Code.gs)
//  Deploy as: Web App | Execute as: Me | Access: Anyone
//
//  SHEET NAMES (auto-created on first run):
//    Workers     — worker roster
//    Attendance  — daily clock-in/out log
//    Photos      — photo metadata + Drive URLs
//    Requests    — leave & advance requests
//    Pins        — hashed worker PINs
// ═══════════════════════════════════════════════════════════════════

// ── CONFIG ──────────────────────────────────────────────────────────
// ↓ Pre-filled: the native Google Sheet "SP Home Interior — Attendance Data"
//   already created in your Drive. Leave as-is, or blank it to use a bound sheet.
const SPREADSHEET_ID = '1zQxNB-b7FlhLSnNlbWWFbPLLj7ISZUdLfQJp7mC0jGs';
const PHOTO_FOLDER_NAME = 'SP Home Interior — Photos';

// Sheet name constants
const SH = {
  WORKERS:    'Workers',
  ATTENDANCE: 'Attendance',
  PHOTOS:     'Photos',
  REQUESTS:   'Requests',
  PINS:       'Pins',
};

// Default starting roster (20 workers, daily salary 2000, all PIN 0000).
// Used both for first-run auto-seeding and the manual setupSheets().
const DEFAULT_ROSTER = [
  ['EMP001', 'Nimal Perera',       2000, true],
  ['EMP002', 'Kamal Silva',         2000, true],
  ['EMP003', 'Sunil Fernando',      2000, true],
  ['EMP004', 'Ruwan Jayasinghe',    2000, true],
  ['EMP005', 'Chamara Bandara',     2000, true],
  ['EMP006', 'Lasith Dissanayake',  2000, true],
  ['EMP007', 'Pradeep Kumara',      2000, true],
  ['EMP008', 'Asanka Rajapaksha',   2000, true],
  ['EMP009', 'Thilina Herath',      2000, true],
  ['EMP010', 'Mahesh Wickrama',     2000, true],
  ['EMP011', 'Sanjeewa Gunawardena',2000, true],
  ['EMP012', 'Dilshan Pathirana',   2000, true],
  ['EMP013', 'Nuwan Senanayake',    2000, true],
  ['EMP014', 'Janaka Liyanage',     2000, true],
  ['EMP015', 'Buddhika Madushanka', 2000, true],
  ['EMP016', 'Hasitha Wijeratne',   2000, true],
  ['EMP017', 'Sajith Premaratne',   2000, true],
  ['EMP018', 'Amila Gunasekara',    2000, true],
  ['EMP019', 'Chathura Madushanka', 2000, true],
  ['EMP020', 'Gayan Sampath',       2000, true],
];

// ── Entry Points ─────────────────────────────────────────────────────
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

// NOTE: Google Apps Script Web Apps deployed as "Execute as: Me" +
// "Who has access: Anyone" automatically include CORS headers.
// If you see CORS errors, re-deploy as a NEW deployment (not update).

function handleRequest(e) {
  try {
    ensureSeeded();   // create tabs + seed 20 workers on the very first call
    const params = getParams(e);
    const action = params.action || '';
    let result;

    switch (action) {
      // ── Worker App GET actions ──
      case 'getWorkers':       result = getWorkers();                    break;
      case 'getStatus':        result = getStatus(params);               break;
      case 'verifyPin':        result = verifyPin(params);               break;
      case 'getWorkerRecords': result = getWorkerRecords(params);        break;

      // ── Worker App POST actions ──
      case 'clockIn':          result = recordClock(params, 'in');       break;
      case 'clockOut':         result = recordClock(params, 'out');      break;
      case 'changePin':        result = changePin(params);               break;
      case 'leaveRequest':     result = submitRequest(params, 'leave');  break;
      case 'advanceRequest':   result = submitRequest(params, 'advance');break;

      // ── Admin App GET actions ──
      case 'getPayroll':       result = getPayroll(params);              break;
      case 'getAttendance':    result = getAttendance(params);           break;
      case 'getRequests':      result = getRequests(params);             break;
      case 'getPhotos':        result = getPhotos(params);               break;

      // ── Admin App POST actions ──
      case 'updateRequest':    result = updateRequest(params);           break;
      case 'saveWorkers':      result = saveWorkers(params);             break;
      case 'resetPin':         result = resetPin(params);                break;

      default:
        result = { ok: false, error: 'Unknown action: ' + action };
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Parameter parser (handles GET querystring + POST JSON body) ───────
function getParams(e) {
  let params = {};
  // GET params
  if (e && e.parameter) {
    Object.assign(params, e.parameter);
  }
  // POST JSON body
  if (e && e.postData && e.postData.contents) {
    try {
      Object.assign(params, JSON.parse(e.postData.contents));
    } catch (_) {}
  }
  return params;
}

function jsonResponse(data) {
  // CORS headers allow requests from any origin (GitHub Pages, etc.)
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Apps Script automatically handles CORS for Web Apps deployed with
// "Execute as: Me" and "Who has access: Anyone" — no extra headers needed.
// If workers still fail, ensure deployment settings are correct (see below).

// ── Spreadsheet helpers ───────────────────────────────────────────────
function getSpreadsheet() {
  // 1) Explicit ID wins
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);

  // 2) If the script is BOUND to a spreadsheet, use that
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  // 3) STANDALONE script (script.google.com → New project): no bound sheet.
  //    Create a dedicated data spreadsheet once and remember its ID so the
  //    same one is reused on every run. This removes the need to manually
  //    create a Google Sheet or convert an XLSX file.
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('SPREADSHEET_ID');
  if (savedId) {
    try { return SpreadsheetApp.openById(savedId); } catch (_) { /* recreate below */ }
  }
  const ss = SpreadsheetApp.create('SP Home Interior — Data');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    initSheet(sh, name);
  }
  return sh;
}

function initSheet(sh, name) {
  const headers = {
    [SH.WORKERS]:    ['id', 'name', 'salary', 'active'],
    [SH.ATTENDANCE]: ['id', 'workerId', 'workerName', 'type', 'timestamp', 'lat', 'lng', 'accuracy', 'photoUrl'],
    [SH.PHOTOS]:     ['id', 'workerId', 'workerName', 'type', 'timestamp', 'url', 'driveFileId'],
    [SH.REQUESTS]:   ['id', 'workerId', 'workerName', 'type', 'leaveType', 'from', 'to', 'amount', 'reason', 'status', 'ts'],
    [SH.PINS]:       ['workerId', 'pinHash'],
  };
  if (headers[name]) {
    sh.appendRow(headers[name]);
    sh.getRange(1, 1, 1, headers[name].length)
      .setFontWeight('bold')
      .setBackground('#2D6622')
      .setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
}

function sheetData(name) {
  const sh = getSheet(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function uniqueId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
}

// ── Simple PIN hashing (SHA-256 via Utilities) ────────────────────────
function hashPin(pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + 'sphome_salt');
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// ═══════════════════════════════════════════════════
//  WORKER ACTIONS
// ═══════════════════════════════════════════════════

// GET: getWorkers
function getWorkers() {
  const rows = sheetData(SH.WORKERS);
  const workers = rows
    .filter(r => r.active !== false && r.active !== 'false' && r.active !== 0)
    .map(r => ({ id: r.id, name: r.name, salary: Number(r.salary) || 0 }));
  return { ok: true, data: workers };
}

// GET: getStatus?workerId=W001
function getStatus(p) {
  const workerId = p.workerId;
  if (!workerId) return { ok: false, error: 'workerId required' };

  const rows = sheetData(SH.ATTENDANCE);
  // Find the last attendance record for this worker today
  const today = new Date();
  const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const todayRecords = rows.filter(r => {
    if (r.workerId !== workerId) return false;
    if (!r.timestamp) return false;
    const ts = new Date(r.timestamp);
    const tsStr = Utilities.formatDate(ts, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return tsStr === todayStr;
  });

  if (!todayRecords.length) {
    return { ok: true, clockedIn: false, clockInTime: null };
  }

  // Sort by timestamp descending to get last record
  todayRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const last = todayRecords[0];
  const clockedIn = last.type === 'in';
  const clockInTime = clockedIn ? last.timestamp : null;

  return { ok: true, clockedIn, clockInTime };
}

// GET: verifyPin?workerId=W001&pin=1234
// Default PIN is '0000' — valid until worker changes it
function verifyPin(p) {
  const { workerId, pin } = p;
  if (!workerId || !pin) return { ok: false, error: 'workerId and pin required' };

  const DEFAULT_PIN = '0000';
  const rows = sheetData(SH.PINS);
  const record = rows.find(r => r.workerId === workerId);

  if (!record) {
    // No PIN set yet — only accept the default PIN (0000)
    if (pin === DEFAULT_PIN) {
      // Auto-register default PIN
      const sh = getSheet(SH.PINS);
      sh.appendRow([workerId, hashPin(DEFAULT_PIN)]);
      return { ok: true, valid: true };
    }
    return { ok: true, valid: false };
  }

  return { ok: true, valid: record.pinHash === hashPin(pin) };
}

// POST: { action: 'clockIn' / 'clockOut', workerId, workerName, timestamp, photo, lat, lng, accuracy }
function recordClock(p, type) {
  const { workerId, workerName, timestamp, photo, lat, lng, accuracy } = p;
  if (!workerId) return { ok: false, error: 'workerId required' };

  let photoUrl = '';
  let photoFileId = '';

  // Save photo to Google Drive if provided
  if (photo) {
    try {
      const saved = savePhotoToDrive(photo, workerId, workerName, type, timestamp);
      photoUrl = saved.url;
      photoFileId = saved.fileId;
    } catch (err) {
      // Photo save failed — continue without photo
      photoUrl = '';
    }
  }

  // Log to Attendance sheet
  const sh = getSheet(SH.ATTENDANCE);
  sh.appendRow([
    uniqueId(),
    workerId,
    workerName || '',
    type,
    timestamp || new Date().toISOString(),
    lat || '',
    lng || '',
    accuracy || '',
    photoUrl,
  ]);

  // Log to Photos sheet if we have a photo
  if (photoUrl) {
    const psh = getSheet(SH.PHOTOS);
    psh.appendRow([
      uniqueId(),
      workerId,
      workerName || '',
      type === 'in' ? 'clockIn' : 'clockOut',
      timestamp || new Date().toISOString(),
      photoUrl,
      photoFileId,
    ]);
  }

  return { ok: true };
}

// POST: { action: 'changePin', workerId, oldPin, newPin }
function changePin(p) {
  const { workerId, oldPin, newPin } = p;
  if (!workerId || !oldPin || !newPin) return { ok: false, error: 'workerId, oldPin, newPin required' };

  const verify = verifyPin({ workerId, pin: oldPin });
  if (!verify.valid) return { ok: false, error: 'Current PIN is incorrect' };

  const sh = getSheet(SH.PINS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === workerId) {
      sh.getRange(i + 1, 2).setValue(hashPin(newPin));
      return { ok: true };
    }
  }
  // Not found — insert new
  sh.appendRow([workerId, hashPin(newPin)]);
  return { ok: true };
}

// POST: leaveRequest / advanceRequest
function submitRequest(p, type) {
  const sh = getSheet(SH.REQUESTS);
  sh.appendRow([
    uniqueId(),
    p.workerId || '',
    p.workerName || '',
    type,
    p.leaveType || '',
    p.from || '',
    p.to || '',
    p.amount || '',
    p.reason || '',
    'pending',
    p.ts || new Date().toISOString(),
  ]);
  return { ok: true };
}

// GET: getWorkerRecords?workerId=W001&tab=attendance
function getWorkerRecords(p) {
  const { workerId, tab } = p;
  if (!workerId) return { ok: false, error: 'workerId required' };

  if (tab === 'attendance') {
    const rows = sheetData(SH.ATTENDANCE).filter(r => r.workerId === workerId);
    const data = rows.map(r => ({
      title: r.type === 'in' ? '🟢 Clock In' : '🔴 Clock Out',
      date: r.timestamp,
      sub: r.timestamp ? new Date(r.timestamp).toLocaleString() : '',
      status: r.type === 'in' ? 'in' : 'out',
    }));
    return { ok: true, data };
  }

  if (tab === 'leaves') {
    const rows = sheetData(SH.REQUESTS).filter(r => r.workerId === workerId && r.type === 'leave');
    const data = rows.map(r => ({
      title: r.leaveType || 'Leave',
      date: r.ts,
      sub: r.from + ' → ' + r.to,
      note: r.reason,
      status: r.status,
    }));
    return { ok: true, data };
  }

  if (tab === 'advances') {
    const rows = sheetData(SH.REQUESTS).filter(r => r.workerId === workerId && r.type === 'advance');
    const data = rows.map(r => ({
      title: 'Rs. ' + (r.amount || 0),
      date: r.ts,
      sub: r.reason || '',
      status: r.status,
    }));
    return { ok: true, data };
  }

  return { ok: false, error: 'Unknown tab' };
}

// ═══════════════════════════════════════════════════
//  ADMIN ACTIONS
// ═══════════════════════════════════════════════════

// GET: getPayroll?month=5&year=2025
function getPayroll(p) {
  const month = parseInt(p.month);
  const year  = parseInt(p.year);
  if (!month || !year) return { ok: false, error: 'month and year required' };

  const workers  = sheetData(SH.WORKERS).filter(r => r.active !== false && r.active !== 'false' && r.active !== 0);
  const attRows  = sheetData(SH.ATTENDANCE);
  const reqRows  = sheetData(SH.REQUESTS);

  const tz = Session.getScriptTimeZone();

  const payroll = workers.map(w => {
    // Count days present (count unique dates with a clock-in)
    const presentDates = new Set();
    attRows.forEach(r => {
      if (r.workerId !== w.id || r.type !== 'in') return;
      if (!r.timestamp) return;
      const d = new Date(r.timestamp);
      if (d.getFullYear() !== year || (d.getMonth() + 1) !== month) return;
      const dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      presentDates.add(dateStr);
    });

    const days = presentDates.size;
    const dailySalary = Number(w.salary) || 0;
    const gross = days * dailySalary;

    // Sum approved advances for this month
    const advance = reqRows
      .filter(r => r.workerId === w.id && r.type === 'advance' && r.status === 'approved')
      .filter(r => {
        if (!r.ts) return false;
        const d = new Date(r.ts);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
      })
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    return {
      id: w.id,
      name: w.name,
      days,
      dailySalary,
      gross,
      advance,
      net: gross - advance,
    };
  });

  return { ok: true, data: payroll };
}

// GET: getAttendance?month=5&year=2025
function getAttendance(p) {
  const month = parseInt(p.month);
  const year  = parseInt(p.year);
  if (!month || !year) return { ok: false, error: 'month and year required' };

  const workers = sheetData(SH.WORKERS).filter(r => r.active !== false && r.active !== 'false' && r.active !== 0);
  const attRows = sheetData(SH.ATTENDANCE);
  const tz = Session.getScriptTimeZone();

  const data = {};
  workers.forEach(w => {
    data[w.id] = { id: w.id, name: w.name, days: {} };
  });

  attRows.forEach(r => {
    if (!r.timestamp || r.type !== 'in') return;
    const d = new Date(r.timestamp);
    if (d.getFullYear() !== year || (d.getMonth() + 1) !== month) return;
    if (!data[r.workerId]) return;
    const day = d.getDate();
    data[r.workerId].days[day] = 'P';
  });

  return { ok: true, data };
}

// GET: getRequests?filter=pending
function getRequests(p) {
  const filter = p.filter || 'all';
  let rows = sheetData(SH.REQUESTS);
  if (filter !== 'all') {
    rows = rows.filter(r => r.status === filter);
  }
  // Sort newest first
  rows.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return { ok: true, data: rows };
}

// GET: getPhotos?workerId=W001&date=2025-05-10
function getPhotos(p) {
  let rows = sheetData(SH.PHOTOS);
  if (p.workerId) rows = rows.filter(r => r.workerId === p.workerId);
  if (p.date) {
    rows = rows.filter(r => {
      if (!r.timestamp) return false;
      const tz = Session.getScriptTimeZone();
      const d = Utilities.formatDate(new Date(r.timestamp), tz, 'yyyy-MM-dd');
      return d === p.date;
    });
  }
  rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { ok: true, data: rows };
}

// POST: { action: 'updateRequest', requestId, status }
function updateRequest(p) {
  const { requestId, status } = p;
  if (!requestId || !status) return { ok: false, error: 'requestId and status required' };

  const sh = getSheet(SH.REQUESTS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol    = headers.indexOf('id');
  const statCol  = headers.indexOf('status');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === requestId) {
      sh.getRange(i + 1, statCol + 1).setValue(status);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Request not found' };
}

// POST: { action: 'saveWorkers', workers: [...] }
function saveWorkers(p) {
  const workers = p.workers;
  if (!Array.isArray(workers)) return { ok: false, error: 'workers array required' };

  const sh = getSheet(SH.WORKERS);
  // Clear existing data (keep header)
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, 4).clearContent();

  workers.forEach(w => {
    sh.appendRow([w.id, w.name, w.salary || 0, true]);
  });

  return { ok: true };
}

// ═══════════════════════════════════════════════════
//  PHOTO UPLOAD — Google Drive
// ═══════════════════════════════════════════════════
function savePhotoToDrive(base64Data, workerId, workerName, type, timestamp) {
  let folder;
  const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  }

  const tz = Session.getScriptTimeZone();
  const dateStr = timestamp
    ? Utilities.formatDate(new Date(timestamp), tz, 'yyyyMMdd_HHmmss')
    : Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');

  const filename = workerId + '_' + type + '_' + dateStr + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', filename);
  const file = folder.createFile(blob);

  // Make the file publicly viewable (for displaying in Admin panel)
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Use the thumbnail endpoint — the old "uc?export=view" URL no longer
  // renders inside <img> tags. thumbnail?id=...&sz=w1000 does, for any
  // link-viewable file.
  const fileId = file.getId();
  return {
    url: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000',
    fileId: fileId,
  };
}


// POST: { action: 'resetPin', workerId, newPin }
// Called by Admin to reset a worker's PIN back to default (0000)
function resetPin(p) {
  const { workerId, newPin } = p;
  if (!workerId) return { ok: false, error: 'workerId required' };
  const pin = newPin || '0000';

  const sh = getSheet(SH.PINS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === workerId) {
      sh.getRange(i + 1, 2).setValue(hashPin(pin));
      return { ok: true };
    }
  }
  // No existing record — insert new
  sh.appendRow([workerId, hashPin(pin)]);
  return { ok: true };
}

// ═══════════════════════════════════════════════════
//  AUTO-SEED — runs automatically on the first API call.
//  Creates all tabs and seeds the 20-worker roster + default
//  PINs if the Workers sheet is empty. Means you NEVER have to
//  run setupSheets manually. Guarded by a Script Property flag
//  so it only does the heavy check once.
// ═══════════════════════════════════════════════════
function ensureSeeded() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('SEEDED') === '1') return;

    Object.values(SH).forEach(name => getSheet(name)); // create any missing tabs

    const wsh = getSheet(SH.WORKERS);
    if (wsh.getLastRow() <= 1) {
      DEFAULT_ROSTER.forEach(row => wsh.appendRow(row));
      const psh = getSheet(SH.PINS);
      DEFAULT_ROSTER.forEach(row => psh.appendRow([row[0], hashPin('0000')]));
    }
    props.setProperty('SEEDED', '1');
  } catch (_) {
    // Never let seeding break a real request.
  }
}

// ═══════════════════════════════════════════════════
//  FIRST-TIME SETUP — optional; auto-seed already covers this.
//  Run manually from Apps Script → Run → setupSheets if you want
//  to (re)create the sheets immediately and get the sheet link.
// ═══════════════════════════════════════════════════
function setupSheets() {
  Object.values(SH).forEach(name => getSheet(name));

  // Add the default 20 workers if Workers sheet is empty
  const wsh = getSheet(SH.WORKERS);
  if (wsh.getLastRow() <= 1) {
    DEFAULT_ROSTER.forEach(row => wsh.appendRow(row));
    // Set default PIN (0000) for all workers
    const psh = getSheet(SH.PINS);
    DEFAULT_ROSTER.forEach(row => psh.appendRow([row[0], hashPin('0000')]));
  }
  PropertiesService.getScriptProperties().setProperty('SEEDED', '1');

  // Show / log the spreadsheet location so you can find it in Drive.
  const ss = getSpreadsheet();
  const url = ss.getUrl();
  Logger.log('✅ SP Home Interior sheets ready: ' + url);
  try {
    // getUi() only works when the script is bound to a sheet; ignore otherwise.
    SpreadsheetApp.getUi().alert('✅ SP Home Interior sheets created successfully!\n\n' + url);
  } catch (_) {
    // Standalone script — no UI. The URL is in the execution log (View → Logs).
  }
  return url;
}
