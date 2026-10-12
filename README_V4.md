# SP Home Interior — Attendance & Payroll  ·  v4

Same app for every company: only the company name, bank details, colours/logo and worker names differ.
(SP Home Interior: salary account: SP Home Construction (Pvt) Ltd · Sampath Bank, Narammala)

## 1. What is new in v4 (your list)

| # | Your point | What v4 does |
|---|---|---|
| 1 | App takes very long to load | App opens from the phone's saved copy if the network is slower than 2.5 s; fonts no longer block the screen; no more "download the whole worker list" at start; the server stops re-opening the Google Sheet on every step and caches the worker list; the server is "woken up" while the worker types the PIN. |
| 2 | Advance requests had to be approved as sent | Admin → Requests: the **amount is editable** before Approve/Reject; each card shows the worker's other advances this month and the limit; approved/rejected advances can be changed later (💾 Save change). The worker sees "changed by the office to Rs. …". |
| 3 | PIN reset slow | Backend is ~4× faster per call; the button shows "⏳ Resetting…". Reset also lifts a block. |
| 3b | More than 20 workers not shown in the drop-down | The drop-down is gone. Root cause: when the list could not load, the app showed the 20 sample names from `config.js`. Those sample names are removed. |
| 4 | Worker had to enter PIN for every action | **Log in once** with Emp No. (`EMP005`, `5`) **or full name** + PIN. No PIN for clock in/out, leave, advance, salary, notices. Change PIN still asks for the old PIN. |
| 5 | OT kept counting when nobody clocked out | A shift longer than **16 h** (`MAX_SHIFT_HOURS`) is NOT paid and is flagged ⚠; OT is capped at **6 h/day** (`MAX_OT_HOURS_PER_DAY`). Admin can fix it with **Force clock-out**. |
| New | Auto log-out | After **10 idle minutes** (phone + server) → back to login, Emp No. pre-filled, PIN again. A 60-second warning appears first. |
| New | Camera | Opens by itself after login → **Capture** (Flip if needed) → Clock In / Clock Out. |
| New | No phone / team leader | Every clock-in records which phone it came from (the first person who logs in on a phone is that phone's owner). If someone uses another person's phone it is marked 📱 in the grid and in Photo Proof. **Team leader mode**: Admin → Workers → 👥 Team (max 10). The leader logs in and clocks the team (photo of each member). Members' other functions (salary, leave, advance…) only work in their own login. |
| New | Advance limit | Rs. 25,000 per worker per month (pending + approved). The app shows the balance; the server blocks anything above it. |
| New | Misuse protection | 5 wrong PINs in a row → account **BLOCKED**. Only the admin can unblock (Admin → Workers → 🔓 Unblock, or 🔑 Reset PIN). Admin PIN lock is only 10 minutes so you can never lock yourself out. |
| New | Force clock-out | Admin → Attendance: red box lists every missing clock-out. Pick the out time (default 17:30) → **Force clock-out**, or **Force all** for shifts before today. Marked 🛠. |
| New | Attendance grid | Every day shows **in / out times**; green = full day, orange = short day, red = no clock-out; 👥 team leader, 🛠 office, 📱 other phone; Sundays shaded; "Compact view" button for the old ✓ view. |
| New | Fixed-salary staff | Admin → Workers → Pay type **Fixed monthly** + amount. Paid the monthly amount (no OT / short-day / bonus). |
| New | Special allowance | Admin → Payroll → **➕ Allowance** (amount, reason, date). Added to gross, shown on payslip and in the worker's salary view. |

## 2. Upgrade an app that is already running (data is kept)

1. Google Apps Script → open your project → replace ALL code with `BACKEND_PRIVATE_DO_NOT_UPLOAD/Code.gs` and **re-enter** `ADMIN_PIN` (and the bank account number) at the top.
   Do **not** change `PIN_SALT` — all existing worker PINs keep working.
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (the /exec URL stays the same).
3. Upload everything except the `BACKEND_PRIVATE_DO_NOT_UPLOAD` folder to GitHub (replace files). Put your `/exec` URL in `shared/config.js` → `BACKEND_URL`.
4. Open the Admin app once: the Google Sheet upgrades itself (new columns + 3 new tabs: Adjustments, Devices, Audit). Nothing is deleted.
5. Phones pick up the new version automatically (close and reopen the app once or twice).

New installation: follow `GITHUB_SETUP.md`; Code.gs creates its own Google Sheet with 20 sample workers — replace them in Admin → Workers → Save Workers.

## 3. Things you may want to edit

* `Code.gs` top: `COMPANY`, `COMPANY_ADDRESS`, `COMPANY_BANK`, `ADMIN_PIN`, `DEFAULT_ROSTER`.
* `Code.gs` policy block: `ADVANCE_MAX_PER_MONTH` (25000), `MAX_PIN_FAILS` (5), `SESSION_MINUTES` (10), `MAX_TEAM_SIZE` (10).
* `Code.gs` `PAY_RULES`: OT rules, `MAX_SHIFT_HOURS` (16), `MAX_OT_HOURS_PER_DAY` (6), bonus, standard out time (`WORK_END`).
* `shared/config.js`: `BACKEND_URL`, `COMPANY_NAME`, `COMPANY_ADDRESS`, `IDLE_MINUTES`.
After any `Code.gs` change: Deploy → Manage deployments → New version.

## 4. Good to know

* The worker list is no longer public: nobody can see the names without logging in.
* Online clock times always use the **server clock** (changing the phone date does nothing). Offline clock-ins keep their real time (max 3 days old) and sync later.
* Offline login works only on a phone that has logged in online before. The PIN is kept on the phone for that (as decided earlier).
* Device owner = first person who logged in on that phone. If it is wrong, edit the `Devices` tab in the Google Sheet.
* `Audit` tab in the Sheet logs blocks, unblocks, PIN resets, force clock-outs, advance edits and allowances.
* Worker's session is a server cache: if Google clears it early the worker just logs in again.

## 5. 5-minute test after deploying

1. Admin app → login → Workers: set a worker as team leader, save.
2. Worker app: log in with `5` + `0000` → change PIN → camera opens → Capture → Clock In.
3. Try 5 wrong PINs on a test worker → blocked → Admin → Unblock.
4. Send an advance above Rs. 25,000 → refused. Admin → Requests → change the amount → Approve.
5. Clock in without clocking out → next day Admin → Attendance → Force clock-out.
6. Payroll → ➕ Allowance → check the payslip PDF.
