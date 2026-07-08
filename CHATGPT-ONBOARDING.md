# CellHub Pro v2 — Onboarding Report for ChatGPT

> Paste this whole file into ChatGPT as context before asking it to write code.
> It is the ground truth for stack, architecture, conventions, and hard rules.

---

## 1. What this project is

**CellHub Pro v2** — a commercial **POS / ERP** for cell-phone repair shops and
wireless retail. Owner: Jorge Ochoa (Go Cellular, Santa Barbara CA). It is being
prepped for commercial sale, but first runs in production at Go Cellular as
dogfooding, so **stability > cleverness**.

- **Repo:** `https://github.com/gocellularfix-a11y/cellhub-pro-v2.git` (private)
- **Branch:** `main` — all work lands here. No feature branches in the workflow.
- **Version:** `2.1.0`
- **Local path:** `C:\cellhub-pro-v2`

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Build | **Vite 6** |
| UI | **React 18** + **TypeScript 5.5** (strict) |
| Styling | **Tailwind CSS 3.4** + PostCSS |
| Desktop | **Electron 31** (main process in `electron/`) + electron-builder |
| Data | **Firebase 10** (Firestore) — **currently DISABLED**, app runs **localStorage-only** during dogfooding |
| Realtime/Companion | socket.io-client (bridge to Companion mobile app via Railway) |
| Auth/PIN | bcryptjs |
| Codegen/print | jsbarcode, qrcode |
| Tests | **Vitest 2** |
| PWA | vite-plugin-pwa (also builds a web target) |

Toolchain: Node **v24**, npm **11**. TS is `strict`, path alias `@/* → ./src/*`.

---

## 3. How to run

```bash
cd C:\cellhub-pro-v2
npm install                 # first time / when deps change
npm run dev                 # Vite dev server, hot reload (http://localhost:5173)
npm run electron:dev        # Vite + Electron together
npm run typecheck           # tsc --noEmit  (see rule below: use local binary)
npm run test                # vitest run
npm run build               # production web build
npm run electron:build:win  # build Windows .exe (dist/)
```

**Env:** copy `.env.example` → `.env`. Key vars: `VITE_FIREBASE_*` (per-customer
Firebase project), `VITE_BRIDGE_AUTH_SECRET` (Companion bridge), and
`CELLHUB_LICENSE_SECRET` (license key signing). All secrets stay private.

---

## 4. Directory map

```
electron/            Electron main process (license, auto-update, LAN pairing,
                     diagnostics, auto-backup, mirror failover, thermal print)
  main.js  preload.js  license.js  lanPairing.js  autoBackup.js
  mirrorFailover.js  diagnostics.js  backupKeys.json
src/
  App.tsx            Root: boot, login gate, PIN gate, setup wizard, print host
  main.tsx           React entry
  store/             ⚠️ PROTECTED. Global state + core types. Don't touch w/o permission.
    AppProvider.tsx        app-wide reducer/context (useApp())
    MultiStoreProvider.tsx multi-store context (useMultiStore())
    types.ts               ALL core domain interfaces (money = cents)
  modules/           Feature areas (one folder each) — see table below
  services/          Non-UI logic: persist, print, tax, backup, license,
                     scanner, companion, lan, intelligence, returns, import…
  components/        Shared UI (ui/, shared/, layout/, cart/, print/, operator/…)
  hooks/             useApp-adjacent hooks (useGlobalCart, usePinGate, usePrint,
                     useFirestore, useBarcodeScanner, useApprovalGate…)
  contexts/          LicenseContext
  config/            firebase, paymentPortals
  i18n/              translations (EN/ES/PT)
  utils/             depositTax, pinHash, ids, escHtml, etc.
  types/  theme/  styles/  config/
scripts/             Node CLIs (license gen, i18n audit/migrate, data analysis)
docs/                Companion + intelligence + release runbooks
mockups/             HTML design explorations (not shipped)
```

### Modules (by size — rough activity signal)

| Module | Files | Module | Files |
|---|---|---|---|
| priceLabels | 35 | pos | 24 |
| intelligence | 13 | tax | 12 |
| companion | 6 | settings | 5 |
| layaways | 3 | repairs | 3 |
| employees / inventory / purchase-orders / returns / special-orders / unlocks | 1–2 | dashboard / customers / expenses / appointments / ai-assistant / help | 1–2 |

Core domain entities in `src/store/types.ts`: `StoreSettings`, `Customer`,
`InventoryItem`, `CartItem`, `Sale`/`SaleItem`, `Repair`, `Unlock`,
`SpecialOrder`, `Layaway`, `CustomerReturn`, `StoreCreditLedger`, `TaxData`,
plus edit-audit types (`EditAuditEntry`, `EditAuditSnapshot`).

---

## Current Major System Status

### Intelligence — Accounts Receivable

The `unpaid_balances` / AR capability (once listed as the outstanding
Intelligence gap) shipped in commit `aa896ad`. Router intent `unpaid_balances` →
`handleUnpaidBalances` in `src/services/intelligence/chat/unpaidBalances.ts`.
It aggregates the stored `balance` across repairs, layaways, special orders,
and unlocks — deterministic and read-only (no LLM), money stays integer cents,
balances read as-is (no tax/persistence changes). Tests:
`src/services/intelligence/chat/unpaidBalances.test.ts`. The Intelligence
handoff (`docs/INTELLIGENCE-HANDOFF.md`) was updated to match in commit
`4da70ab`.

---

## 5. HARD RULES — do not violate (from CLAUDE.md)

These are non-negotiable. Breaking one is a regression, not a style nit.

### Money & tax
- **Money is stored as integer CENTS, never float dollars.** `price: 1999` = $19.99.
  In: `Math.round(dollars * 100)`. Out: `(cents / 100).toFixed(2)`.
- **Tax:** ALWAYS use `forwardTaxFromBase(baseCents, taxRate, taxable)` from
  `@/utils/depositTax`. **Never** do manual tax math.

### Persistence (localStorage-only right now)
- `persist.*` **OVERWRITES** the whole record for non-`settings` collections.
  Callers MUST pass the **full entity spread**:
  ```ts
  persist.repair(id, { ...entity, ...changes } as unknown as Record<string, unknown>); // ✅
  persist.repair(id, { status: 'picked_up', updatedAt: now });                          // ❌ DATA LOSS
  ```
- Only the `settings` collection merges.
- Fail safe on missing data: if an id/entity isn't found → **no-op + safe toast**.
  Never open a blank/default modal, never create a placeholder record.

### UI
- **Never use `alert()`, `confirm()`, or `prompt()`** (native browser dialogs break
  Electron UX). Use React modals / toast / `ConfirmDialog`. `<Modal>` lives in
  `@/components/ui`.
- **Bilingual (actually trilingual): every user-facing string needs EN/ES/PT.**
  Pattern: `lang === 'es' ? '…' : '…'` (project also supports `pt`; **no voseo** in ES).

### Protected / off-limits
- **Never edit `src/store/`** without explicit permission. `src/store/types.ts` may
  be *extended* with new fields (with approval); for new `StoreSettings` fields use
  the **double-cast pattern** (`(settings as any).newField` on read,
  `setSettings({ newField } as any)` on write).
- **Don't touch** money math, taxes, receipts, reports, inventory, payments,
  commissions, POS checkout, Companion, Firebase, bridge, sync, pairing, or `.omc`
  **unless the task explicitly targets that area.**

### Process
- **Surgical / additive only.** Smallest change that fixes the issue. No rewrites,
  no "while I'm here" cleanups, **no refactors unless explicitly requested.**
- **Reuse existing handlers/actions** — never build a parallel path for open/edit,
  navigation, persist, or print that a module already has.
- **Don't add dependencies** without justification.
- **No new dialogs from native APIs**, **no `git add -A`** (stage specific files),
  commit message format: `Round <MARKER>: <description>`.

---

## 6. Canonical patterns to copy

```ts
// IDs
import { generateId } from '@/utils/ids';

// Tax (single source of truth)
import { forwardTaxFromBase } from '@/utils/depositTax';
const fwd = forwardTaxFromBase(baseCents, taxRate, taxable); // .baseCents .taxCents .totalCents

// New StoreSettings field (double-cast)
const v = ((settings as any).newField as T | undefined)?.[key];      // read
setSettings({ newField } as any);                                    // write
persistSettings({ newField } as Record<string, unknown>);

// Delta-only settings update (avoid stale closure)
setSettings({ foo });  persistSettings({ foo } as Record<string, unknown>);  // ✅
setSettings({ ...settings, foo });                                           // ❌

// Anti-stale-closure in async/setState chains: use refs
const fresh = repairsRef.current.find(r => r.id === id);   // not repairs.find(...)

// Cancel/refund guard before mutating
const s = String(entity.status || '').toLowerCase();
if (s === 'cancelled' || s === 'refunded') { toast('…', 'error'); return; }

// taxable is not on the interfaces — access defensively
const taxable = (entity as any).taxable ?? false;

// Print
printHtml(html, { silent: true, printer: ((settings as any).detectedPrinters as string[]|undefined)?.[0] });
// escape any user data interpolated into print HTML strings:
escHtml(userValue);

// Admin-protected module: usePinGate + AdminPinGate; PIN is bcrypt in settings.adminPin
// (pinHash: isHashed, hashPin, comparePin, migrateLegacyPins)
```

**Edit-audit system** (Repairs / Unlocks / SpecialOrders): completed records lock;
editing money fields goes through a PIN gate → `ReasonSelectorModal`
(additional_balance / absorbed / refund / typo_correction) → snapshot + diff +
history (100 max) via `@/services/editAudit.ts`, then full-spread persist and
auto-reprint for money reasons. `depositAmount` is managed **only** by POS
checkout/cancellation — the edit flow never unlocks it.

---

## 7. Validation checklist (run before calling anything "done")

1. `./node_modules/.bin/tsc --noEmit` → **must exit 0**
   (⚠️ use the **local** binary, NOT `npx tsc` — global TS 6.x conflicts).
2. `npm run build` if runtime-critical paths changed (money / report / refund / POS).
3. `npx vitest run` when reasonable.
4. State the flow you exercised: expected result vs obtained result. If you
   couldn't test something, say so. **Never claim validated when only reasoned.**
5. Report: exact files changed, root cause, validation output, manual runtime
   checklist. Surface out-of-scope bugs at the end — don't fix them inline.

---

## 8. Working agreement for ChatGPT

- Before editing code, state: which rules apply, expected blast radius (files/flows),
  round classification (`investigation-only` | `surgical fix` | `additive feature`
  | `refactor`), and what you're intentionally **not** touching.
- **Extend, don't duplicate.** If a system already partly solves it, extend it.
- When you hand code back, produce a paste-ready prompt Jorge can drop into the
  in-terminal Claude Code agent (the "reparador"), including the files to touch and
  the validation commands above. ChatGPT is the auditor/designer; it does not run
  the code.

---

*Generated from repo state at commit `c29fb66` (clean, in sync with origin/main).*
