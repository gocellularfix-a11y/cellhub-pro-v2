// ============================================================
// Round R-EMPLOYEE-DEDUPE — JORGE OCHOA owner cleanup
// ============================================================
//
// PURPOSE
//   Remove duplicate "JORGE OCHOA" employee records that ended up
//   in localStorage as 3 active owners. Keeps the canonical legacy
//   record (id `mlfnta9pdnj50h7gxkq`) — that ID is the one that
//   historical sales/repairs reference via `currentEmployee` /
//   `cashier` / `employeeId`.
//
// HOW TO RUN
//   1. Open the running CellHub Pro app (Electron window or Vite
//      dev server). Make sure your data is loaded.
//   2. Open DevTools (Ctrl+Shift+I in Electron, F12 in browser).
//   3. Switch to the "Console" tab.
//   4. Copy the IIFE between BEGIN and END markers below.
//   5. Paste into the console and press Enter.
//   6. Read the output:
//        [dedupe] Antes: N employees
//        [dedupe] Después: M employees
//        [dedupe] IDs eliminados: [...]
//   7. Reload the app (Ctrl+R) so React state re-hydrates from
//      the cleaned localStorage.
//
// IDEMPOTENT
//   - Safe to run multiple times. If only one JORGE OCHOA record
//     exists (or none), the script is a no-op and writes nothing.
//   - Backup is only written on the first mutating run. Subsequent
//     runs see an existing backup and do not overwrite it.
//
// SCOPE
//   Only employees whose `name === "JORGE OCHOA"` AND whose `id`
//   is NOT the keep-id are removed. All other employees (including
//   non-JORGE owners or other staff) are untouched.
//
// ROLLBACK
//   The pre-cleanup snapshot lives in
//     localStorage._dedupe_backup_employees
//   To restore manually, run in DevTools:
//     const b = localStorage.getItem('_dedupe_backup_employees');
//     if (b) localStorage.setItem('employees', b);
//
// NOTE on currentEmployee
//   `currentEmployee` is React-state-only in this codebase — it is
//   NOT persisted in localStorage. After running this script and
//   reloading, the user must re-login through the EmployeeLogin
//   gate, which selects the surviving employee record automatically.
//
// === BEGIN COPY-PASTE ======================================
(() => {
  const KEEP_ID = 'mlfnta9pdnj50h7gxkq';
  const TARGET_NAME = 'JORGE OCHOA';
  const BACKUP_KEY = '_dedupe_backup_employees';

  let raw: string | null;
  try {
    raw = localStorage.getItem('employees');
  } catch (err) {
    console.error('[dedupe] Cannot read localStorage:', err);
    return;
  }
  if (!raw) {
    console.warn('[dedupe] No `employees` key in localStorage. Nothing to do.');
    return;
  }

  let employees: any[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error('[dedupe] `employees` is not an array. Aborting.');
      return;
    }
    employees = parsed;
  } catch (err) {
    console.error('[dedupe] Failed to parse `employees` JSON:', err);
    return;
  }

  const before = employees.length;
  const dupes = employees.filter(
    (e) => e && e.name === TARGET_NAME && e.id !== KEEP_ID,
  );

  if (dupes.length === 0) {
    console.info(
      `[dedupe] No JORGE OCHOA duplicates found. ${before} employees in store. No changes.`,
    );
    return;
  }

  // First run that actually mutates: write backup. Do NOT overwrite an
  // existing backup on re-runs (would lose the original pre-cleanup state).
  if (!localStorage.getItem(BACKUP_KEY)) {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(employees));
    console.info(
      '[dedupe] Backup written to localStorage._dedupe_backup_employees',
    );
  } else {
    console.warn('[dedupe] Backup already exists; not overwriting.');
  }

  const next = employees.filter(
    (e) => !(e && e.name === TARGET_NAME && e.id !== KEEP_ID),
  );
  localStorage.setItem('employees', JSON.stringify(next));

  console.info(`[dedupe] Antes: ${before} employees`);
  console.info(`[dedupe] Después: ${next.length} employees`);
  console.info(
    '[dedupe] IDs eliminados:',
    dupes.map((d) => d.id),
  );

  // Confirm the canonical record is still present
  const survivor = next.find(
    (e) => e && e.name === TARGET_NAME && e.id === KEEP_ID,
  );
  if (survivor) {
    console.info(
      '[dedupe] Canonical JORGE OCHOA conservado:',
      survivor.id,
    );
  } else {
    console.warn(
      `[dedupe] WARNING: canonical id ${KEEP_ID} not found in surviving list. Verify the keep-id matches your data.`,
    );
  }

  console.info('[dedupe] Reload the app (Ctrl+R) to re-hydrate React state.');
})();
// === END COPY-PASTE ========================================

export {};
