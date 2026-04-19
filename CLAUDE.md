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

---

## CANONICAL RULES — NO NEGOCIABLES

### Money handling
- **Money se almacena como cents (integer)**, NUNCA como float dollars
- Ejemplo: `price: 1999` es $19.99, NO `price: 19.99`
- Conversiones: `Math.round(dollars * 100)` para entrada, `(cents / 100).toFixed(2)` para display

### User interaction
- **NUNCA usar `alert()`, `confirm()`, o `prompt()`** — estos son browser APIs nativos que rompen la UX en Electron
- Siempre usar React modals (hay un `<Modal>` component en `@/components/ui`)
- Confirmation modals deben replacear cualquier `confirm()` usage

### Firebase / persistence
- **Writes:** `serverTimestamp()`
- **Reads:** `toDate()` para convertir Timestamps a JS Dates
- Firebase es **opcional** — siempre debe haber localStorage fallback
- Multi-station deploys requieren consistency via Firestore

### Protected modules
- **NUNCA tocar `src/store/`** sin permiso explícito de Jorge
- Esto incluye: `src/store/types.ts`, `src/store/AppProvider.tsx`, reducers, etc.
- Si un fix requiere extender `StoreSettings` type, usar el **double-cast pattern**
  en su lugar (ver abajo)

### Admin PIN gate
- Módulos protegidos requieren Admin PIN gate (existing pattern)
- PIN hashing: bcrypt via `@/utils/pinHash`
- Weak PINs blacklist existe en `WEAK_PINS_LIST`, exported `isWeakPin()`

### Bilingüal
- **Todo UI-facing text debe soportar EN/ES**
- Pattern: `lang === 'es' ? 'texto español' : 'english text'`
- Labels de buttons, headers, toast messages, error messages — todos bilingües

---

## PATTERNS CANÓNICOS

### Double-cast para new settings fields (lección de Round 2A.5)

Cuando agregas un nuevo settings field que todavía no está en `StoreSettings` type,
usa este pattern para READS:

```ts
// CORRECTO
const value = ((settings as any).newField as TargetType | undefined)?.[key];

// INCORRECTO — TypeScript rechaza porque el field access falla antes del cast
const value = (settings.newField as TargetType | undefined)?.[key];
```

Para WRITES:

```ts
setSettings({ newField: newValue } as any);
persistSettings({ newField: newValue } as Record<string, unknown>);
```

Esto se usa actualmente para: `paymentPortals`, `topUpCommissions`, `detectedPrinters`.

### useCallback declaration order (lección de Round 2B.2)

**Los handlers que referencian `update` (o cualquier otra useCallback) deben
declararse DESPUÉS** en el componente. TypeScript strict mode rechaza
"use before declaration" incluso para closures.

```ts
// CORRECTO
const update = useCallback(..., [setSettings]);
const handleSomething = useCallback(() => { update(...); }, [update]);

// INCORRECTO — TS2448/TS2454
const handleSomething = useCallback(() => { update(...); }, [update]); // update no existe aún
const update = useCallback(..., [setSettings]);
```

### Delta-only updates (regla r26 C4)

Nunca hacer spread de todo `settings` para hacer un update:

```ts
// INCORRECTO — closure stale, puede clobbear concurrent updates
setSettings({ ...settings, foo: newValue });

// CORRECTO — solo el delta
setSettings({ foo: newValue });
persistSettings({ foo: newValue } as Record<string, unknown>);
```

### Hoisted helpers for field/toggle components

Los helpers como `<Field>`, `<Toggle>`, `<AdminPinField>`, `<UrlField>` viven
HOISTED a module scope (no inline dentro del componente padre). Esto evita
focus loss cuando el componente padre re-renderiza.

### ID generation

Pattern: `${prefix}-${timestamp8}-${random4}`

Ejemplo: `topup_abc12345_def0`

### escHtml para print HTML

Cualquier interpolación de user data en print HTML strings (NO React JSX) debe
pasar por `escHtml()` para evitar XSS en receipts/reports impresos.

### usePrint hook

```ts
printHtml(html, {
  silent: true,
  printer: ((settings as any).detectedPrinters as string[] | undefined)?.[0],
});
```

---

## WORKFLOW DE ROUNDS DE FIX

Cada round de fixes sigue esta estructura:

### 1. Baseline
- El starting point es siempre el último tar `_final` validado
- Por ejemplo: `cellhub-pro-v2_r-settings-2b1_final.tar.gz`
- **Nunca arrancar de un tar non-final** o de un midpoint

### 2. Pre-round verification
```bash
grep -c "patrón esperado del round anterior" path/to/file
# Verificar que el baseline tiene los fixes previos
```

### 3. Dry-run antes de escribir fix prompt
- Correr los str_replace en un working copy
- Ejecutar `npx tsc --noEmit` para validar typecheck
- Correr grep self-checks para validar cantidades esperadas
- **Corregir expected counts en el prompt basado en dry-run real**, no en guesswork

### 4. Self-checks obligatorios
- Cada edit tiene grep counts esperados
- Los counts son POST-dry-run (confirmados), no pre-guess
- Patrón típico: 2 matches para "comment + element" de una misma feature

### 5. Typecheck obligatorio
```bash
npm install --ignore-scripts
npx tsc --noEmit
# Ambos deben exit 0 con zero output
```

### 6. Diff sanity
```bash
diff -rq baseline/cellhub-pro-v2 dryrun/cellhub-pro-v2 | grep -v node_modules
# Debe mostrar EXACTAMENTE los archivos esperados
# Cero colaterales
```

### 7. File-replace vs str_replace (criterio de decisión)

**Usa file-replace cuando:**
- Es un refactor move-only donde la lógica no cambia
- El diff literal sería >500 líneas de JSX en `str_replace` args
- El archivo cambiado es 1 solo (no cross-file)
- Ejemplo: Round 2B.1 carriers tab unification

**Usa str_replace (tradicional) cuando:**
- Hay lógica que cambia
- Cross-file edits
- <500 líneas de delta literal
- Default para todo lo demás

### 8. md5 verification para file-replace
```bash
md5sum path/to/replaced-file.tsx
# Debe matchear exactamente el md5 del auditor dry-run
```

### 9. Repackaging final
```bash
# Solo después de validation completa
tar -czf cellhub-pro-v2_r-XXX_final.tar.gz cellhub-pro-v2/
```

---

## BASELINE CHAIN

El baseline chain actual del proyecto (última versión al final):

1. `cellhub-pro-v2_r29d1_with_assets.tar.gz` — pre-PATH B + placeholder icons
2. `cellhub-pro-v2_r-pathB_final.tar.gz` — distribution unblockers
3. `cellhub-pro-v2_r-settings-1_final.tar.gz` — settings security/bugs (12 fixes)
4. `cellhub-pro-v2_r-settings-2a_final.tar.gz` — architecture/UX (5 fixes)
5. `cellhub-pro-v2_r-settings-2a5_final.tar.gz` — top-up commission tracking
6. `cellhub-pro-v2_r-settings-2b1_final.tar.gz` — carriers tab unification
7. **`cellhub-pro-v2_r-settings-2b2_final.tar.gz`** — detected printers (next, pending)

**Current working baseline: `cellhub-pro-v2_r-settings-2b1_final.tar.gz`**

---

## BACKLOG PRIORITIZADO (post-2B.2)

1. **Deposit Integrity bug** — CRÍTICO, revenue leak en 14 sites (Codex P1)
2. **Backup Completeness** — agregar returns/appointments/expenses a ALL_COLLECTIONS
3. **Auto-Updater completion** — listener leak + enable download flow
4. **Fake features hide** — autoBackup toggle, SMS twilio provider
5. **Returns r25 migration** — foundation work (requires Jorge OK para src/store/)
6. **Returns audit** — con ChatGPT 10-item checklist
7. **Returns hardening round**
8. **Printing hardening** — labels via IPC + bundle barcode/QR locally
9. **Electron security** — path allowlist + sandbox + remove unused IPC
10. **Final end-to-end sanity pass**
11. **Switch Go Cellular monolith → v2 producción** (milestone)
12. **Dogfooding phase**
13. **Multi-store phase** (separate project post-dogfooding)
14. **Commercial launch prep** (licensing, Windows packaging, data importers)

---

## JORGE COMMUNICATION PREFERENCES

- **Idioma:** Español mexicano, NUNCA voseo (no "vos", "tenés", "preferís")
- **Tono:** directo, action-oriented, minimal explanation unless asked
- **Casual:** "compa", "órale", "dale", "sale"
- Prefiere respuestas que vayan al grano sobre explicaciones largas
- Pushback decisivo si algo no tiene sentido o scope creep
- Tests todo el mismo

---

## ANTI-PATTERNS — NUNCA HACER

- ❌ Rewrite completo de módulos — solo surgical changes
- ❌ Cambiar src/store/ sin permiso explícito
- ❌ Usar alert/confirm/prompt
- ❌ Hardcodear money como float
- ❌ Instalar nuevas dependencies sin justificar
- ❌ Refactors "mientras estoy aquí" fuera del scope del round
- ❌ Fix prompts con expected grep counts no validados via dry-run
- ❌ Declarar un round como `_final` sin typecheck + diff sanity + self-checks pasing
- ❌ Delivery como archivos sueltos — siempre tar.gz completo del proyecto
- ❌ Tocar the inner widget code de un block que se está moving-only

---

## PROTIPS

- **Siempre correr `npx tsc --noEmit` pre-entrega**, incluso si "parece obvio"
- El dry-run catché 2 bugs reales en Rounds 2A.5 y 2B.2 que de otra forma hubieran llegado al reparador
- Para refactors grandes move-only, el file-replace approach es más seguro que str_replace con 500+ líneas literales
- md5 verification es bulletproof para file-replace — un solo check garantiza byte-identical
- Los grep counts de "comment + element" patterns típicamente son 2, no 1 (el comment marker y el JSX element son matches separados)
