// ═══════════════════════════════════════════════════
//  ATTENDANCE PWA — MASTER CONFIG  (shared/config.js)
//  ✏️  Edit per client: BACKEND_URL, COMPANY_NAME.
//  🔒 This file is PUBLIC. The Admin PIN is NOT here any more — it is the
//     ADMIN_PIN constant at the top of Code.gs (server side).
// ═══════════════════════════════════════════════════

const CONFIG = {
  // ✅ Paste your Apps Script Web App URL here (must start with https://script.google.com/ and end with /exec)
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbxqOrpnkUemnIFXKKNDBvogIWN8OASlOl2NKYAHC8eYuQjcCrgl8SQqJGTmJf4_J25q/exec',

  // Company name shown in the apps
  COMPANY_NAME: 'SP Home Interior',

  // Company location (printed on payslips; the bank-letter address comes from Code.gs)
  COMPANY_ADDRESS: 'Narammala, Sri Lanka',

  // Prefix for the data this app keeps on each phone — different for every client
  STORE_PREFIX: 'sphome',

  // Shown to the MD on the PIN-reset button (must equal DEFAULT_WORKER_PIN in Code.gs)
  DEFAULT_WORKER_PIN: '0000',

  // Worker app logs out after this many idle minutes (the server enforces its own SESSION_MINUTES too)
  IDLE_MINUTES: 10,

  // Currency
  CURRENCY: 'Rs.',
};
