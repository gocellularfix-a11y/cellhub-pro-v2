# CellHub Pro — Release Signing & Update Feed

Operational reference for producing a **signed** Windows installer and publishing
**auto-update** releases. No secrets live in this repo — certificates, passwords,
and GitHub tokens are supplied via environment variables at build time only.

---

## B2 — Update feed (DONE, in `electron-builder.config.js`)

```js
publish: {
  provider: 'github',
  owner:    'gocellularfix-a11y',
  repo:     'cellhub-pro-releases',   // public release repo (artifacts only)
  private:  false,
}
```

- The release repo is **public** so auto-update clients never embed a GitHub token.
- Published artifacts per release: `CellHub Pro Setup <version>.exe`, `latest.yml`, `*.blockmap`.
- Publishing requires a `GH_TOKEN` env var **on the build machine / CI only** (never in app code or committed):

```bash
# Windows PowerShell (build machine only)
$env:GH_TOKEN = "<github personal access token with repo scope>"
npm run electron:publish    # vite build + electron-builder --publish always
```

> Verify the repo `gocellularfix-a11y/cellhub-pro-releases` exists and is public before the first publish.

---

## B1 — Windows code signing (env-var driven; NO cert in repo)

The app version shown in-app comes from `package.json` (B6.1). The installer is
**unsigned** until one of the two options below is configured at build time.

### Option A — OV / standard PFX certificate (no config change needed)

electron-builder auto-detects these env vars — set them on the build machine, then
run the normal Windows build:

```bash
# Windows PowerShell (build machine only — do NOT commit these)
$env:WIN_CSC_LINK = "C:\secure\cellhub-codesign.pfx"   # path, https URL, or base64
$env:WIN_CSC_KEY_PASSWORD = "<pfx password>"
npm run electron:build:win
```

(`CSC_LINK` / `CSC_KEY_PASSWORD` also work as cross-platform fallbacks.)

### Option B — EV certificate / hardware token

EV signing uses a token on the build machine; the password is entered via the
token middleware, not env vars. Add the exact certificate subject to
`electron-builder.config.js` under `win`:

```js
win: {
  // ...existing...
  certificateSubjectName: '<EXACT LEGAL PUBLISHER NAME ON THE CERT>',
}
```

Requirements: EV token plugged in, provider middleware installed, token available
during the build. **Never** store the token PIN/password in the repo.

### Owner inputs still required to finish B1

| Input | Needed for |
|-------|-----------|
| Certificate type (OV/PFX vs EV/token) | Choosing Option A vs B |
| Exact legal publisher name | EV `certificateSubjectName`; also confirm `win.publisherName` matches the cert CN |
| The certificate / token itself | Actually signing |

Until these are provided, do not claim builds are signed.

---

## Verify a build is signed (Windows)

- Right-click the `.exe` → **Properties → Digital Signatures** (a signature must be listed), **or**

```powershell
& "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe" verify /pa /v "dist-electron\CellHub Pro Setup <version>.exe"
```

A clean install on a fresh Windows machine should show a **verified publisher**
(not "Unknown Publisher" / SmartScreen).

---

## NO-GO (do not ship to an external store if any are true)

- Installer is unsigned / shows "Unknown Publisher".
- Update feed still points to a placeholder owner/repo.
- Release repo is private and the app would need an embedded token.
- `latest.yml` missing from the release.
- In-app version (Help → About) ≠ `package.json` version.
- Update test not run on a clean Windows machine.
- Any cert / password / token committed to the repo.
