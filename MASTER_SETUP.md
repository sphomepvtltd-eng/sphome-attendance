# 🧩 MASTER TEMPLATE — How to deploy for a NEW client

This is a clean, reusable copy of the attendance system. Nothing is tied to a
specific company or Google account, so you can spin up a fresh deployment for
each new client. Each client gets their **own** Google account, Apps Script
deployment, Google Sheet, and GitHub repo.

Keep this zip safe as your master. **Copy it** for each new client and edit the
copy — never edit the master itself.

---

## Per-client checklist (≈10–15 min)

### 1. Rebrand (edit 1 file)
Open `shared/config.js` and set:
- `COMPANY_NAME` → the client's name (this updates the app titles + headings automatically)
- (Admin PIN is NOT in config.js any more — set `ADMIN_PIN` at the top of `Code.gs`, see step 2)
- `DEFAULT_WORKER_PIN` → usually keep `0000`
- `CURRENCY` → keep `Rs.` (or change)

Optional, in `Code.gs` (top): `COMPANY` controls the auto-created sheet name
(`<COMPANY> — Data`) and the Drive photo folder (`<COMPANY> — Photos`). Set it
to match the client.

> Full rebrand (optional): the names inside `worker/manifest.json` and
> `admin/manifest.json` (the installed-app label) and the small "WORKER
> ATTENDANCE" subtitle are static text. Find-replace them if you want the
> installed icon name to differ per client.

### 2. Backend (Apps Script) — sign in as the CLIENT's Google account
1. **script.google.com → New project** → paste **all** of `Code.gs`.
2. **Deploy → New deployment → Web app** → Execute as **Me**, Access **Anyone**
   → Authorize/Allow.
3. Copy the **/exec** URL.

> `SPREADSHEET_ID` is blank on purpose. On first use the script creates its own
> Google Sheet (`<COMPANY> — Data`) in that account's Drive and remembers it —
> tabs, 20 starter workers and PIN `0000` are seeded automatically. No manual
> sheet creation. (To reuse an existing sheet instead, paste its ID into
> `SPREADSHEET_ID`.)

### 3. Config
Paste the `/exec` URL into `BACKEND_URL` in `shared/config.js`. Save.

### 4. GitHub + Pages
New **public** repo → upload the **contents** (so `index.html` is at the root)
→ **Settings → Pages → main /(root)**.
- Worker: `…/REPO/worker/`  ·  Admin: `…/REPO/admin/`
(Full click-by-click is in `GITHUB_SETUP.md`.)

### 5. Hand over
- Workers install the worker link (Add to Home Screen).
- MD installs the admin link; logs in with the `ADMIN_PIN` you set in `Code.gs`.
- In Admin → Workers, replace the 20 starter workers with the real roster and
  **Save Workers**.

---

## What's already fixed/built into this master
- POST requests use `text/plain` (avoids the Apps Script CORS-preflight failure).
- Backend self-creates + auto-seeds its Google Sheet (no manual setup run).
- Attendance photos use Google's `thumbnail` URL (renders reliably in Admin).
- `config.js` is served network-first so a freshly pasted `BACKEND_URL` is never
  stale on installed phones.
- Worker + Admin PWAs install cleanly (icons + logo included).
- Company name is config-driven across both app UIs.

## Maintenance
After ANY code change to a deployed client: re-upload the changed files (phones pick them up
automatically). If `Code.gs` changed: Deploy → Manage deployments → ✏️ → New version → Deploy.

---

## Payroll rules built into this master (Admin → Payroll)

- **Full working day** (counts for daily rate + bonus): clock-IN before **09:00**,
  clock-OUT at/after **16:00**, AND at least **8 net hours** (lunch 13:00–14:00 excluded).
- **Short day** (any condition above not met): not a working day — paid for actual
  hours worked × OT rate.
- **OT rate** = daily salary ÷ **9** per hour.
- **OT qualifies** only with ≥ **45 min** extra: early = before 08:00, late = after 17:30.
  Late OT is measured from 17:30 and **spans past midnight** for overnight shifts.
- **Shift pairing** is by sequence (IN → next OUT), so a clock-out after midnight
  belongs to the day the worker clocked in; the next morning is a separate shift.
- **Attendance bonus** = full days × **LKR 500**, only when full days ≥ **23**.
- **Approved advances** are deducted from net pay.
- Shifts with **no clock-out** are flagged (⚠) for the MD to fix in the sheet.

To change any of these, edit the `PAY_RULES` block at the top of `getPayroll` in `Code.gs`.
