# CellHub Pro — Release Artifact Workflow

How to cut a CellHub Pro release: build the (signed) Windows installer, publish a
GitHub Release to the **public** release repo, and verify auto-update works. No
source code and no secrets go to the release repo — only build artifacts.

Related docs: [`RELEASE_SIGNING.md`](../RELEASE_SIGNING.md) (B1 signing & env
vars) · [`PILOT_CLEAN_MACHINE_CHECKLIST.md`](./PILOT_CLEAN_MACHINE_CHECKLIST.md)
(clean-machine / update-flow test).

---

## 0. Update feed (verified — `electron-builder.config.js`)

```js
publish: {
  provider: 'github',
  owner:    'gocellularfix-a11y',
  repo:     'cellhub-pro-releases',   // PUBLIC — release artifacts only, NO source
  private:  false,
}
```

Packaged `files`: `electron/**`, `dist-renderer/**`, `assets/**`, `package.json`
— the renderer is the **compiled** Vite output (`dist-renderer`), never raw `src/`.

### Release repo expectations
- Repo: **`gocellularfix-a11y/cellhub-pro-releases`** — must exist and be **public**.
- Purpose: GitHub **Releases** for distribution + auto-update metadata only.
- **No source code** is pushed here (source lives in the private app repo).
- Public so `electron-updater` clients never embed a GitHub token.

> Pre-flight: confirm the repo exists and is public before the first publish
> (e.g. open `https://github.com/gocellularfix-a11y/cellhub-pro-releases`).

---

## 1. Build the (signed) installer

1. Bump `version` in `package.json` if needed (this drives the in-app version
   shown in Help → About and the release tag `v<version>`).
2. Set signing env vars on the build machine (see `RELEASE_SIGNING.md`) — **do not
   commit them**:
   ```powershell
   $env:WIN_CSC_LINK = "C:\secure\cellhub-codesign.pfx"   # or EV token, per RELEASE_SIGNING.md
   $env:WIN_CSC_KEY_PASSWORD = "<pfx password>"
   ```
3. Build:
   ```powershell
   npm run electron:build:win
   ```

Artifacts land in `dist-electron\`:
- `CellHub Pro Setup <version>.exe`  (NSIS installer — the file to distribute)
- `CellHub Pro <version>.exe`        (portable)
- `latest.yml`                       (auto-update metadata — REQUIRED)
- `CellHub Pro Setup <version>.exe.blockmap` (delta-update map)

> If the installer is unsigned, SmartScreen shows "Unknown Publisher". Sign it
> (B1) before any external/paid distribution.

---

## 2. Publish the GitHub Release

### Option A — electron-builder auto-publish (recommended)

Builds **and** uploads artifacts + generates/uploads `latest.yml` in one step.
Requires a `GH_TOKEN` (repo scope) on the build machine **only** — never in code:

```powershell
$env:GH_TOKEN = "<github token with repo scope on cellhub-pro-releases>"
$env:WIN_CSC_LINK = "..."          # signing, as above
$env:WIN_CSC_KEY_PASSWORD = "..."
npm run electron:publish           # vite build + electron-builder --publish always
```

This creates/updates the GitHub Release (tag `v<version>`) and uploads the
installer, `latest.yml`, and `.blockmap` automatically.

### Option B — manual upload

If publishing by hand, create a Release on `gocellularfix-a11y/cellhub-pro-releases`:

1. Tag: `v<version>` (must match `package.json` version).
2. Upload **all** of:
   - [ ] `CellHub Pro Setup <version>.exe`
   - [ ] `latest.yml`   ← **required** for auto-update; missing it breaks updates
   - [ ] `CellHub Pro Setup <version>.exe.blockmap`
3. Publish the Release (not draft).

> The tag and the `version` inside `latest.yml` must match `package.json`, or
> `electron-updater` will not detect the update correctly.

---

## 3. Verify update metadata

- [ ] The Release on `cellhub-pro-releases` is **published** (not draft) and **public**.
- [ ] `latest.yml` is attached and its `version` matches `package.json`.
- [ ] The Setup `.exe` and `.blockmap` are attached.
- [ ] `latest.yml` `path`/`sha512` reference the uploaded installer.
- [ ] No source files, certs, passwords, or tokens are attached to the Release.

---

## 4. Run the clean-machine / update-flow test

Use `PILOT_CLEAN_MACHINE_CHECKLIST.md` for the fresh-install pass, then verify
auto-update with two versions:

1. Install an **older** signed version on a clean Windows machine.
2. Publish a **newer** version to `cellhub-pro-releases` (steps 1–3 above).
3. In the installed app: **Check for Updates**.
   - [ ] Update is detected (update-available).
   - [ ] Download succeeds.
   - [ ] Install & restart succeeds.
4. Reopen the app:
   - [ ] Help → About shows the **new** version.
   - [ ] Local data (sales/customers/inventory/settings) is **preserved**.
   - [ ] Logs (`%APPDATA%\CellHub Pro\logs\`) contain updater success/error events.

---

## NO-GO (do not distribute if any are true)

- Release repo missing / private / contains source.
- Installer unsigned ("Unknown Publisher").
- `latest.yml` missing from the Release.
- Tag/`latest.yml` version ≠ `package.json` version.
- Update-flow test not run on a clean machine.
- Any cert / password / token attached to the Release or committed.
