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
  config.js       ← the ONLY file you edit for settings
  logo.js
  logo.png
  icon-192.png  icon-512.png  maskable-192.png  maskable-512.png  apple-touch-icon.png
```

## QUICK START (3 steps)

### 1. Backend — Google Apps Script (gets your backend URL)
A native Google Sheet **"SP Home Interior — Attendance Data"** has already been
created in your Drive, and its ID is already filled into `Code.gs`
(`SPREADSHEET_ID`). You do **not** need to create or convert any sheet.

1. Go to **script.google.com → New project**
2. Delete the default code, paste **ALL** of `Code.gs`
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - The first time, it will ask for permissions → **Allow**.
4. Copy the **/exec** URL it gives you.

That's it — the tabs (Workers, Attendance, Photos, Requests, Pins), the 20
workers (EMP001–EMP020) and their default PIN `0000` are created automatically
the first time the app talks to the backend. (You can still run `setupSheets`
manually if you ever want to reset them.)

### 2. Config
Open `shared/config.js` → paste your `/exec` URL into `BACKEND_URL`.
(You can also change the Admin PIN and default worker PIN here.)

### 3. Upload to GitHub
- Upload everything to the repo root, keeping the folder layout above.
- **Settings → Pages → Deploy from branch** `main` / `(root)`
- Worker app: `…/worker/`    Admin app: `…/admin/`

## Logins
- **Admin PIN:** `1234` (change in `shared/config.js`)
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
- After ANY code change, bump the `CACHE` value in BOTH `worker/sw.js` and
  `admin/sw.js` (e.g. v2 → v3) so phones pull the new version.
- Photos are stored in a Drive folder named **"SP Home Interior — Photos"**.
