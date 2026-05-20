# CLAUDE.md — CellHub Pro v2

Este archivo se carga automáticamente cada vez que Claude Code arranca en este
directorio. Define las rules canónicas del proyecto que siempre deben seguirse.

---

## Identidad del proyecto

CellHub Pro v2 es un POS/ERP comercial para cell phone repair shops y wireless
retail. Stack: Vite + React + TypeScript + Electron + Firebase. Owner: Jorge
Ochoa (Go Cellular, Santa Barbara CA). El producto se está preparando para
venta comercial pero primero va a correr en producción en Go Cellular como
dogfooding.

**Repo:** `https://github.com/gocellularfix-a11y/cellhub-pro-v2.git` (private)
**Branch:** `main` (all work lands here)

---

## DUAL-TOOL WORKFLOW

Jorge opera dos herramientas de IA simultáneamente:

- **Web-chat Claude (auditor):** diseña fixes, revisa reports, escribe prompts, audita diffs. NO ejecuta código.
- **Claude Code (reparador):** en-terminal agent en shop PC o laptop. Ejecuta los prompts del auditor.

**Flow:** Auditor escribe prompt → Jorge lo pega al reparador → reparador ejecuta → Jorge pega output al auditor → auditor verifica → siguiente step.

**Rule:** El reparador NUNCA procede al siguiente phase sin aprobación explícita del auditor.

---

## CANONICAL RULES — NO NEGOCIABLES

### Money handling
- **Money se almacena como cents (integer)**, NUNCA como float dollars
- Ejemplo: `price: 1999` es $19.99, NO `price: 19.99`
- Conversiones: `Math.round(dollars * 100)` para entrada, `(cents / 100).toFixed(2)` para display
- **Tax calculation:** SIEMPRE usar `forwardTaxFromBase()` de `@/utils/depositTax`. Nunca math manual.

### User interaction
- **NUNCA usar `alert()`, `confirm()`, o `prompt()`** — estos son browser APIs nativos que rompen la UX en Electron
- Siempre usar React modals, toast, ConfirmDialog
- `<Modal>` component en `@/components/ui`

### Firebase / persistence
- **Firebase actualmente DESHABILITADO** — asumir localStorage-only durante dogfooding
- **Writes:** `serverTimestamp()` (cuando Firebase esté activo)
- **Reads:** `toDate()` para convertir Timestamps a JS Dates
- **CRITICAL:** `localSaveRecord` OVERWRITES para non-settings collections. Callers DEBEN pasar el record completo: `persist.*(id, { ...entity, ...changes })`. NUNCA partial data.
- Solo `settings` collection hace merge (r26 fix)

### Protected modules
- **NUNCA tocar `src/store/`** sin permiso explícito de Jorge
- Excepción: `src/store/types.ts` puede extenderse para nuevos fields (con permiso del auditor)
- Si un fix requiere extender `StoreSettings` type, usar el **double-cast pattern**

### Admin PIN gate
- Módulos protegidos requieren Admin PIN gate
- Componente existente: `src/components/shared/AdminPinGate.tsx`
- Hook: `src/hooks/usePinGate.ts`
- PIN hashing: bcrypt via `@/utils/pinHash` (exports: `isHashed`, `hashPin`, `comparePin`, `migrateLegacyPins`)
- PIN storage: `settings.adminPin` (bcrypt hash)

### Bilingüal
- **Todo UI-facing text debe soportar EN/ES**
- Pattern: `lang === 'es' ? 'texto español' : 'english text'`
- Labels de buttons, headers, toast messages, error messages — todos bilingües

### Surgical edits only
- **NUNCA rewrite completo de módulos** — solo cambios quirúrgicos
- ASK antes de expandir scope
- Si encuentras bugs fuera del scope del round, reporta al final — no fixes inline

---

## PATTERNS CANÓNICOS

### Persist — full spread (CRITICAL)

```ts
// CORRECTO — full entity spread
persist.repair(id, { ...entity, ...changes } as unknown as Record<string, unknown>);

// INCORRECTO — partial data = DATA LOSS
persist.repair(id, { status: 'picked_up', updatedAt: now });
// ↑ This overwrites the ENTIRE record with only status + updatedAt!
```

### Double-cast para new settings fields

```ts
// READ
const value = ((settings as any).newField as TargetType | undefined)?.[key];

// WRITE
setSettings({ newField: newValue } as any);
persistSettings({ newField: newValue } as Record<string, unknown>);
```

### Taxable field access

`taxable` is NOT in the Repair/Unlock/SpecialOrder interfaces. Always access via:

```ts
const taxable = (entity as any).taxable ?? false;
```

### Anti-stale-closure pattern

Use refs (`repairsRef.current`, `cartRef.current`) when mutating inside async/setState chains:

```ts
const fresh = repairsRef.current.find(r => r.id === id);
// NOT: const fresh = repairs.find(r => r.id === id);  ← stale closure
```

### H2 cancel guard

Before any mutation, re-read and check status:

```ts
const freshStatus = String(entity.status || '').toLowerCase();
if (freshStatus === 'cancelled' || freshStatus === 'refunded') {
  toast('Ticket cancelled/refunded. Cannot edit.', 'error');
  return;
}
```

### Delta-only settings updates (r26 C4)

```ts
// CORRECTO — solo el delta
setSettings({ foo: newValue });
persistSettings({ foo: newValue } as Record<string, unknown>);

// INCORRECTO — stale closure risk
setSettings({ ...settings, foo: newValue });
```

### forwardTaxFromBase — canonical tax helper

```ts
import { forwardTaxFromBase } from '@/utils/depositTax';

const fwd = forwardTaxFromBase(baseCents, taxRate, taxable);
// fwd.baseCents, fwd.taxCents, fwd.totalCents
```

NEVER do manual tax math. This helper is the single source of truth.

### usePrint hook

```ts
printHtml(html, {
  silent: true,
  printer: ((settings as any).detectedPrinters as string[] | undefined)?.[0],
});
```

### escHtml for print HTML

Any user data interpolated in print HTML strings (NOT React JSX) must pass through `escHtml()` to prevent XSS.

### ID generation

Pattern: `generateId()` from `@/utils/ids` — produces unique IDs.

---

## R-EDIT-AUDIT PATTERNS (April 2026)

Post-completion edit tracking for Repairs, Unlocks, SpecialOrders.

### Lock condition

```ts
const totalPaid = (entity.estimatedCost || entity.price || 0) - (entity.balance || 0);
const isLocked = !!entity && (
  (entity.balance === 0 && totalPaid > 0)
  || normalizeStatus(entity.status) === 'refunded'
);
```

### Audit save flow

1. PIN gate → unlock money fields
2. User edits → Save
3. Stale check (`String(fresh.updatedAt) !== String(entity.updatedAt)`)
4. H2 guard (cancelled/refunded abort)
5. Edit history cap check (100 max, warning at 80)
6. computeDiff (form vs fresh entity, NOT vs originalSnapshot)
7. If money changed → ReasonSelectorModal (additional_balance / absorbed / refund)
8. If info only → auto typo_correction
9. Side effects per reason (forwardTaxFromBase for recalc)
10. captureSnapshot on first edit (never overwrite)
11. appendEditEntry to editHistory
12. Persist full entity spread
13. Auto-reprint corrected receipt (money reasons only)

### Reason consequences

| Reason | Status change | Balance | Side effect |
|---|---|---|---|
| additional_balance | → active (received/pending/ordered) | recalculated | ticket reopens |
| absorbed | stays terminal | stays 0 | absorbedAmount logged |
| refund | → refund_pending | stays 0 | refundOwedAmount set |
| typo_correction | no change | no change | audit log only |

### Mark Refunded flow

Creates a negative-total sale with `status: 'completed'` so Reports subtracts from gross revenue. Original sales stay untouched (partial refund, not cancellation).

### depositAmount invariant (r-deposit-integrity-1)

`depositAmount` is managed EXCLUSIVELY by POS checkout and cancellation paths. The edit audit flow does NOT unlock depositAmount — it stays disabled with visual 🔒 only (no PIN override). This prevents bypassing the POS reconcile contract.

### Shared infrastructure

- `src/hooks/usePinGate.ts` — PIN gate state management
- `src/services/editAudit.ts` — snapshot, diff, history helpers
- `src/components/ReasonSelectorModal.tsx` — 3-option reason picker
- `src/components/EditHistoryModal.tsx` — scrollable edit history viewer
- `src/components/shared/AdminPinGate.tsx` — PIN entry modal (reused)

---

## REPARADOR CLOSURE RULE

Every round MUST include before delivery:

1. **`./node_modules/.bin/tsc --noEmit`** output (MUST be EXIT=0)
2. **`npm run build`** if the change touches runtime-critical paths (money/report/refund/POS)
3. **grep validations** specific to the round
4. **Flow verification** describing:
   - What flow was tested
   - What result was expected
   - What result was obtained
5. If something couldn't be tested, **state it explicitly**
6. **NEVER present as validated if only reasoned**

**Typecheck command:** Always use `./node_modules/.bin/tsc --noEmit` (local binary). NEVER use `npx tsc` — global TS 6.x conflicts.

---

## GIT WORKFLOW

```powershell
# Dev/test (home laptop or shop PC):
cd cellhub-pro-v2
git pull origin main
npm install  # only if deps changed
npm run dev  # Vite dev server, hot reload

# Build .exe for production:
npm run build
npm run electron:build  # generates dist/

# Commit pattern:
git add <specific files>  # NEVER git add -A
git commit -m "Round <MARKER>: <description>"
git push origin main
```

### Commit naming convention

```
Round R-EDIT-AUDIT F1: shared infrastructure
Round R-EDIT-AUDIT F2: type extensions
Round R-EDIT-AUDIT F3.1-3: RepairModal lock UI
Round R-EDIT-AUDIT F7-FIX-v2: partial refund
```

Preserve all existing markers. No retroactive renaming.

---

## JORGE COMMUNICATION PREFERENCES

- **Idioma:** Español mexicano / Spanglish, NUNCA voseo (no "vos", "tenés")
- **Tono:** directo, action-oriented, minimal explanation unless asked
- **Casual:** "compa", "órale", "dale", "sale", "simon", "wey"
- Prefiere respuestas que vayan al grano
- Pushback decisivo si algo no tiene sentido o scope creep
- Tests todo él mismo en runtime

---

## ANTI-PATTERNS — NUNCA HACER

- ❌ Rewrite completo de módulos — solo surgical changes
- ❌ Cambiar src/store/ sin permiso explícito
- ❌ Usar alert/confirm/prompt
- ❌ Hardcodear money como float
- ❌ Persist con partial data (full spread obligatorio)
- ❌ Math de tax manual (usar forwardTaxFromBase)
- ❌ Instalar nuevas dependencies sin justificar
- ❌ Refactors "mientras estoy aquí" fuera del scope del round
- ❌ Presentar como validado si solo fue razonado
- ❌ Usar `npx tsc` (global TS 6.x conflict — usar `./node_modules/.bin/tsc`)
- ❌ `git add -A` (siempre archivos específicos)
- ❌ Proceder al siguiente phase sin aprobación del auditor
- ❌ Asumir que uploads son de un source específico — siempre preguntar

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cellhub-pro-v2** (15034 symbols, 25447 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/cellhub-pro-v2/context` | Codebase overview, check index freshness |
| `gitnexus://repo/cellhub-pro-v2/clusters` | All functional areas |
| `gitnexus://repo/cellhub-pro-v2/processes` | All execution flows |
| `gitnexus://repo/cellhub-pro-v2/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
