# SP Home Interior — Attendance PWA (Worker + Admin)

Two installable PWA apps + a Google Apps Script backend that stores everything
in a Google Sheet and saves selfie photos to Google Drive.

## Folder layout (upload to your GitHub repo root EXACTLY like this)
```
index.html        → root redirect to /worker/
Code.gs           → paste into Google Apps Script (the backend)
README.md
worker/           → yoursite.github.io/REPO/worker/   (Worker app)
  index.html
  app.js
  manifest.json
  sw.js
admin/            → yoursite.github.io/REPO/admin/    (MD Admin app)
  index.html
  admin.js
  manifest.json
  sw.js
shared/           → used by BOTH apps
  config.js       ← the ONLY website file you edit (BACKEND_URL, company name)
  logo.js
  logo.png
  icon-192.png  icon-512.png  maskable-192.png  maskable-512.png  apple-touch-icon.png
```

## QUICK START (3 steps)

### 1. Backend — Google Apps Script (gets your backend URL)
`SPREADSHEET_ID` is intentionally **blank**. On first use the script creates its
own Google Sheet (`<COMPANY> — Data`) in the signed-in account's Drive and
remembers it — no manual sheet creation or XLSX conversion.

1. Go to **script.google.com → New project**
2. Delete the default code, paste **ALL** of `Code.gs` (first set your own `ADMIN_PIN` near the top)
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - The first time, it will ask for permissions → **Allow**.
4. Copy the **/exec** URL it gives you.

The tabs (Workers, Attendance, Photos, Requests, Pins), the 20 starter workers
and their default PIN `0000` are created automatically on first contact.

### 2. Config
Open `shared/config.js` → paste your `/exec` URL into `BACKEND_URL`.
(You can also change the Admin PIN and default worker PIN here.)

### 3. Upload to GitHub
- Upload everything to the repo root, keeping the folder layout above.
- **Settings → Pages → Deploy from branch** `main` / `(root)`
- Worker app: `…/worker/`    Admin app: `…/admin/`

## Logins
- **Admin PIN:** `1234` — now set in **`Code.gs` → `ADMIN_PIN`** (top of the file; **change it to 6 digits before deploying**). It is checked by the backend and is no longer in any public file.
- **Worker PIN (all):** `0000` — each worker can change it in the Worker app,
  or the MD can reset it from the Admin → Workers tab.

## What was fixed in this version
- **POST CORS bug** — clock in/out, PIN change, leave & advance requests, and
  all admin saves were failing with a CORS error. The apps now send POST as
  `text/plain` (Apps Script can't answer the preflight that `application/json`
  triggers). This was the main reason nothing was saving.
- **Backend self-creates its Sheet** — if the script isn't bound to a sheet
  (a normal "New project"), it now creates and reuses its own data sheet
  automatically. No more XLSX→Google-Sheet conversion or Extensions-menu step.
- **`setupSheets` no longer crashes** in a standalone project and logs the
  sheet URL instead.
- **Worker app UI rebuilt** to match `app.js` and the Admin design.
- **Placeholder app icons + logo** added so both apps install cleanly.

## Notes
- The worker dropdown ALWAYS shows the 20 workers from `config.js`, even if the
  backend is offline. When the backend is live, it upgrades to the real list.
- The apps load their own files network-first, so a new upload reaches phones automatically
  (no more bumping `CACHE`). After editing `Code.gs`: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
- All payroll/date logic runs in `Asia/Colombo` (`TIMEZONE` in `Code.gs`), whatever the Apps Script project timezone is.
- Removing a worker in Admin keeps their history (they become inactive); their ID is never reused.
- Wrong PIN 5× locks that PIN (workers) or the Admin login for 10 minutes.
- Photos are stored in a Drive folder named **"SP Home Interior — Photos"**.
