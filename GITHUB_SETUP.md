# 📤 GitHub Upload + Go-Live Guide (no command line needed)

Follow these in order. Total time ≈ 10 minutes.

---

## PART A — Deploy the backend (do this FIRST, to get your URL)

1. Open **https://script.google.com** → **New project**.
2. Delete everything in the editor. Open `Code.gs` from this package, copy
   **all** of it, paste it in.
3. Click **Deploy** (top-right) → **New deployment**.
4. Click the gear ⚙ next to "Select type" → choose **Web app**.
5. Set:
   - **Description:** SP Home Attendance
   - **Execute as:** Me
   - **Who has access:** Anyone
6. Click **Deploy** → **Authorize access** → pick your Google account →
   "Advanced" → "Go to … (unsafe)" → **Allow**. (This is normal for your own
   scripts.)
7. Copy the **Web app URL** that ends in **/exec**. Keep it handy.

> The Google Sheet "SP Home Interior — Attendance Data" is already in your Drive
> and already linked in `Code.gs`. Tabs + 20 workers + PIN 0000 fill in
> automatically the first time the app calls the backend — nothing else to do.

---

## PART B — Put your URL in the config

1. Open `shared/config.js` in any text editor (Notepad works).
2. Find the line `BACKEND_URL: '…'`.
3. Replace what's inside the quotes with your **/exec** URL from Part A.
4. Save the file.

---

## PART C — Create the GitHub repo and upload (web browser)

1. Go to **https://github.com** → sign in (or create a free account).
2. Click **+** (top-right) → **New repository**.
   - **Repository name:** e.g. `sphome-attendance`
   - **Public** (required for free GitHub Pages)
   - Do **not** add a README/.gitignore.
   - Click **Create repository**.
3. On the empty repo page, click **uploading an existing file**
   (the link in "…or upload an existing file").
4. **Unzip** this package on your computer first. Then drag **the contents**
   into the upload box — that means these items at the top level:
   ```
   index.html   Code.gs   README.md   GITHUB_SETUP.md
   worker/      admin/     shared/
   ```
   ⚠️ Drag the **inside** of the folder, NOT the outer `sphome` folder, so that
   `index.html` sits at the repository root (not inside a subfolder).
5. Scroll down → **Commit changes**.

> Tip: GitHub's web uploader keeps folder structure when you drag folders in.
> If it flattens them, upload `worker/`, `admin/`, and `shared/` one folder at
> a time using **Add file → Upload files** again.

---

## PART D — Turn on GitHub Pages

1. In the repo: **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/(root)** → **Save**.
4. Wait ~1 minute. The page shows: *Your site is live at*
   `https://YOUR-USERNAME.github.io/sphome-attendance/`

Your two apps:
- **Worker app:** `https://YOUR-USERNAME.github.io/sphome-attendance/worker/`
- **Admin app:**  `https://YOUR-USERNAME.github.io/sphome-attendance/admin/`

---

## PART E — Install on phones

- **Worker (Android/Chrome):** open the worker link → menu ⋮ → **Add to Home
  screen / Install app**.
- **Worker (iPhone/Safari):** open the worker link → Share → **Add to Home
  Screen**.
- **Admin:** same steps with the admin link (best on a tablet/laptop —
  it's a landscape layout).

Logins: **Admin PIN 1234** · **Worker PIN 0000** (each worker can change theirs;
MD can reset from Admin → Workers).

---

## If something doesn't work

| Symptom | Fix |
|---|---|
| Worker dropdown shows names but clock-in fails | Backend URL missing/wrong in `shared/config.js`. Re-check Part B, re-upload that one file. |
| "Authorization required" / nothing saves | Re-do Part A step 6 (Allow permissions). Make sure access = **Anyone**. |
| Changed a file but phone shows the old version | Bump `CACHE` (vN → vN+1) in `worker/sw.js` **and** `admin/sw.js`, re-upload, then close & reopen the app. |
| Photos don't show in Admin | They appear only after a real clock-in with a selfie; older test photos using the old URL won't render. |

After ANY code change: re-upload the changed files to the repo, and bump the
`CACHE` number in both `sw.js` files.
