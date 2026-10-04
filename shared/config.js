// ═══════════════════════════════════════════════════
//  ATTENDANCE PWA — MASTER CONFIG  (shared/config.js)
//  ✏️  Edit per client: BACKEND_URL, COMPANY_NAME.
//  🔒 This file is PUBLIC. The Admin PIN is NOT here any more — it is the
//     ADMIN_PIN constant at the top of Code.gs (server side).
// ═══════════════════════════════════════════════════

const CONFIG = {
  // ✅ Paste your Apps Script Web App URL here (must start with https://script.google.com/ and end with /exec)
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbxqOrpnkUemnIFXKKNDBvogIWN8OASlOl2NKYAHC8eYuQjcCrgl8SQqJGTmJf4_J25q/exec',

  // Worker default PIN — every worker starts with this (can change later)
  DEFAULT_WORKER_PIN: '0000',

  // Company name shown in UI
  COMPANY_NAME: 'SP Home Interior',

  // Currency
  CURRENCY: 'Rs.',

  // ── Offline fallback roster (names only — real roster & salaries live in the Sheet) ──
  DEFAULT_WORKERS: [
    { id: 'EMP001', name: 'Nimal Perera' },
    { id: 'EMP002', name: 'Kamal Silva' },
    { id: 'EMP003', name: 'Sunil Fernando' },
    { id: 'EMP004', name: 'Ruwan Jayasinghe' },
    { id: 'EMP005', name: 'Chamara Bandara' },
    { id: 'EMP006', name: 'Lasith Dissanayake' },
    { id: 'EMP007', name: 'Pradeep Kumara' },
    { id: 'EMP008', name: 'Asanka Rajapaksha' },
    { id: 'EMP009', name: 'Thilina Herath' },
    { id: 'EMP010', name: 'Mahesh Wickrama' },
    { id: 'EMP011', name: 'Sanjeewa Gunawardena' },
    { id: 'EMP012', name: 'Dilshan Pathirana' },
    { id: 'EMP013', name: 'Nuwan Senanayake' },
    { id: 'EMP014', name: 'Janaka Liyanage' },
    { id: 'EMP015', name: 'Buddhika Madushanka' },
    { id: 'EMP016', name: 'Hasitha Wijeratne' },
    { id: 'EMP017', name: 'Sajith Premaratne' },
    { id: 'EMP018', name: 'Amila Gunasekara' },
    { id: 'EMP019', name: 'Chathura Madushanka' },
    { id: 'EMP020', name: 'Gayan Sampath' },
  ],
};
