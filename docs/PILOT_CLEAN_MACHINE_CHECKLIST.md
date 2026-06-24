# CellHub Pro — Clean-Machine / External Pilot Validation Checklist

> Run this end-to-end on a **fresh Windows machine** (not a dev box) before
> installing at an external store. Check each box; record PASS/FAIL in §14.

---

## 1. Purpose

Verify a fresh CellHub Pro install behaves correctly on a customer machine:
installs, launches, onboards, protects money/tax, rings a real sale, prints,
persists data, exposes diagnostics, writes logs, and auto-backs-up — with no
dev assumptions. This is the go/no-go gate for the external pilot.

---

## 2. Pre-test requirements

- [ ] A **clean Windows 10/11 machine** (or fresh VM) — no prior CellHub install, no `%APPDATA%\CellHub Pro` folder.
- [ ] The build to test: `dist-electron\CellHub Pro Setup <version>.exe` (built from current `main`).
- [ ] A receipt printer connected (or a configured Windows printer for the print test).
- [ ] Note the expected version from `package.json` (e.g. `2.1.0`).
- [ ] **Known limitation:** until B1 (code signing) is done, Windows SmartScreen will show **"Unknown Publisher"** — expected, not a failure of this checklist, but a **NO-GO for paid external sale** (see §15).
- [ ] Cloud sync **OFF** (Firebase disabled) for the pilot.

---

## 3. Fresh install checklist

- [ ] Run `CellHub Pro Setup <version>.exe`.
- [ ] If SmartScreen appears → "More info" → "Run anyway" (expected while unsigned).
- [ ] Installer lets you choose install directory (NSIS, not one-click).
- [ ] Desktop shortcut + Start Menu shortcut created.
- [ ] Install completes without error.

**Expected:** App installed; shortcuts present.

---

## 4. First launch checklist

- [ ] Launch from the desktop shortcut.
- [ ] App window opens (no white screen, no crash).
- [ ] No leftover data from a prior store (fresh state).

**Expected:** App boots to the Setup Wizard (first run) — see §5.

---

## 5. Setup wizard checklist

- [ ] Setup Wizard appears on first run.
- [ ] Enter store name / business info.
- [ ] Create the Admin PIN (weak-PIN blacklist should reject e.g. `1234`).
- [ ] Add the first employee.
- [ ] Complete the wizard.

**Expected:** Wizard finishes; app lands in the main UI; `cellhub_setup_complete` is set.

---

## 6. Tax confirmation gate checklist (B4)

- [ ] Go to **Settings → Taxes**.
- [ ] Confirm an **amber warning banner** is shown ("Review the tax rates… Taxable sales are blocked until confirmed").
- [ ] **Before confirming:** add a **taxable** item to the POS cart and attempt checkout.
  - [ ] Checkout is **BLOCKED** with a toast: *"Tax setup required before taxable sale."*
  - [ ] The app routes to the **Settings** tab.
- [ ] In Settings → Taxes, review/adjust the tax rate for the store's location (the CA defaults are starter values only), then click **"Confirm tax setup"**.
- [ ] Banner turns **green** ("Tax settings confirmed.").
- [ ] Retry the taxable checkout → now **ALLOWED**.
- [ ] (Optional) A **non-taxable / service-only** sale (0 tax) should be allowed even before confirming.

**Expected:** Fresh install blocks taxable sales until tax is explicitly confirmed; never silently rings CA defaults.

---

## 7. POS smoke test checklist

- [ ] Add inventory item(s) to the cart.
- [ ] Apply a payment (Cash / Card / Split — amounts recorded; note: no live card charge, terminal handles auth).
- [ ] Complete the sale.
- [ ] Sale total / tax look correct for the store's configured rate.
- [ ] Invoice number generated; sale appears in history/reports.

**Expected:** A complete sale rings, totals are correct, money math is in cents (no rounding drift).

---

## 8. Receipt / printing checklist

- [ ] After the sale, the receipt/print flow opens.
- [ ] Print preview renders correctly.
- [ ] Print to the connected printer (or PDF) succeeds.
- [ ] Receipt shows store info, items, tax, total, invoice #.

**Expected:** Printing works on the customer's printer; receipt content is correct.

---

## 9. Persistence close/reopen checklist

- [ ] Close the app. On close, the **"Save backup before closing?"** dialog appears → choose **"Save & Close"** (or "Close without backup" — both must close cleanly).
- [ ] Reopen the app.
- [ ] The sale, customer, and inventory changes from the smoke test are **still present**.
- [ ] Admin PIN still required for protected modules.

**Expected:** All data persists across close/reopen (localStorage); no data loss.

---

## 10. Help / About + version checklist (B6.1)

- [ ] Open **Help**.
- [ ] Find the **🛟 About / Diagnostics** panel.
- [ ] **Version** shows `CellHub Pro <version>` and matches `package.json` exactly.
- [ ] **Platform** is shown.
- [ ] **Logs location** hint is shown (`%APPDATA%\CellHub Pro\logs\cellhub-YYYY-MM-DD.log`).
- [ ] The **Sidebar footer** also shows `v<version>` (same version, no stale "Build 2026.04.01").
- [ ] No secrets shown (no license key, no hardware fingerprint).

**Expected:** Real, dynamic version visible in two places; support can confirm the build remotely.

---

## 11. Open Logs Folder checklist (B3.2)

- [ ] In Help → About / Diagnostics, click **"📂 Open Logs Folder"**.
- [ ] Windows Explorer opens at `%APPDATA%\CellHub Pro\logs\`.
- [ ] Inline status shows success (✓).
- [ ] No log **contents** are displayed in-app; no upload/email/network action occurs.

**Expected:** The fixed logs folder opens; nothing is read/sent.

---

## 12. Logs + auto-backup verification checklist (B3.1 + B5.2)

### Logs (B3.1)
- [ ] In `%APPDATA%\CellHub Pro\logs\`, a file `cellhub-YYYY-MM-DD.log` exists.
- [ ] It contains an `[INFO] app-start` line with version / platform / electron / node.
- [ ] The file contains **no** customer/payment/tax data and **no** secrets (license key / fingerprint).

### Auto-backup (B5.2)
- [ ] After launch + creating some data, a backups folder exists at `%APPDATA%\CellHub Pro\backups\` (or the configured backup folder).
- [ ] It contains a file `cellhub-AUTO-BACKUP-YYYY-MM-DD-HHmmss.json`.
- [ ] The backup JSON contains the store's collections (sales/customers/inventory/etc.).
- [ ] Relaunch the **same day** → **no duplicate** auto-backup is created (24h gate).
  > Note: on a truly empty first launch (before any data exists) the auto-backup is correctly **skipped** (empty-snapshot guard); it should appear once real data is present and the app is relaunched.

**Expected:** Crash/diagnostic logs are written and accessible; a startup auto-backup is created (once per 24h) and never restores automatically.

---

## 13. Quota warning expected behavior (B5.1)

- [ ] On a fresh install (storage near-empty, well under 80%), **no** storage warning banner appears.
- [ ] (Reference only — not expected during the pilot) The amber banner appears at **≥80%** usage and the red banner at **≥95%**, prompting an export. It never blocks sales/saves.

**Expected:** No quota banner on a fresh/low-usage install.

---

## 14. Pass / fail table

| # | Area | Result (PASS/FAIL) | Notes |
|---|------|--------------------|-------|
| 3 | Fresh install | | |
| 4 | First launch | | |
| 5 | Setup wizard | | |
| 6 | Tax gate blocks until confirmed | | |
| 7 | POS sale | | |
| 8 | Receipt / printing | | |
| 9 | Persistence (close/reopen) | | |
| 10 | Help → About version | | |
| 11 | Open Logs Folder | | |
| 12a | Logs exist + app-start line | | |
| 12b | Auto-backup file created | | |
| 13 | No quota banner on fresh install | | |

---

## 15. Pilot go/no-go notes

**GO** for a controlled pilot (friendly store, cloud OFF, Jorge reachable for support) only if **all** §14 rows PASS.

**NO-GO for paid external sale / broad rollout if any of these are true** (from the production audit):
- Installer is **unsigned** / shows "Unknown Publisher" — **B1 code signing pending** (needs cert + legal publisher name).
- Update feed repo `gocellularfix-a11y/cellhub-pro-releases` does not exist / is not public, or `latest.yml` is missing from the release — **B2 config done; repo + first release still required**.
- In-app version (Help → About) ≠ `package.json` version.
- Any tax row fails (taxable sale rings without confirmation, or wrong rate for the store's state).
- Data does not persist across close/reopen.
- Logs or auto-backup folder are not created after real use.
- Any cert / password / token is found in the installer or repo.

**Outstanding before external sale:** B1 (sign the installer) and B2 (create the public release repo + publish a release), then re-run the update flow (install older version → Check for Updates → download/install → confirm version changed and local data preserved).
