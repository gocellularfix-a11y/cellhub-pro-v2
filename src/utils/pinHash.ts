// ============================================================
// CellHub Pro — PIN hashing helper (r27)
// bcryptjs because pure-JS works in Electron renderer + Vite +
// browser without native compilation. compareSync is intentional
// for click handlers; async hash is for create/edit flows.
// ============================================================

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/** True if `s` looks like a bcrypt hash. Used for migration detection. */
export function isHashed(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^\$2[aby]\$\d{2}\$/.test(s);
}

/**
 * Hash a plaintext PIN. No-op if input is empty or already hashed.
 * Returns empty string for empty input (supports the no-PIN owner UX).
 */
export async function hashPin(plain: string): Promise<string> {
  if (!plain) return '';
  if (isHashed(plain)) return plain;
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Compare a plaintext PIN against a stored value.
 * - Empty stored PIN → only matches empty input (no-PIN owner UX, r27 OPCIÓN A)
 * - Hashed stored PIN → bcrypt compareSync
 * - Plaintext stored PIN → direct compare (legacy fallback during the
 *   migration window; the next boot will hash these on disk)
 */
export function comparePin(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return plain === '';
  if (isHashed(stored)) {
    try { return bcrypt.compareSync(plain, stored); }
    catch { return false; }
  }
  return plain === stored;
}

/**
 * One-time migration: walk employees + admin PIN, hash any plaintext entries
 * found, write them back. Idempotent — running twice is a no-op because
 * isHashed() short-circuits already-hashed entries. Tolerates missing/null
 * fields. Designed to be called once at app boot after initial data load.
 *
 * Returns the number of records that were migrated (for logging).
 */
export async function migrateLegacyPins(
  employees: Array<{ id: string; pin?: string | null }>,
  adminPin: string | null | undefined,
  persistEmployee: (id: string, data: Record<string, unknown>) => Promise<void> | void,
  persistSettings: (data: Record<string, unknown>) => Promise<void> | void,
): Promise<number> {
  let migratedCount = 0;

  for (const emp of employees) {
    const pin = emp.pin ?? '';
    if (!pin) continue;          // empty pin owners — leave as-is
    if (isHashed(pin)) continue; // already hashed — skip
    const hashed = await hashPin(pin);
    const updated = { ...emp, pin: hashed };
    try {
      await persistEmployee(emp.id, updated as Record<string, unknown>);
      migratedCount += 1;
    } catch (err) {
      console.warn('[pinHash] migrate employee failed:', emp.id, err);
    }
  }

  if (adminPin && !isHashed(adminPin)) {
    const hashed = await hashPin(adminPin);
    try {
      await persistSettings({ adminPin: hashed });
      migratedCount += 1;
    } catch (err) {
      console.warn('[pinHash] migrate adminPin failed:', err);
    }
  }

  return migratedCount;
}

// ── Weak PIN blacklist — r-settings-2a ─────────────────────
// Top public lists of weakest 4-digit PINs (2012 DataGenetics analysis,
// SplashData annual reports, several breach corpora). 30 entries cover the
// statistical worst offenders without being so long it nags users into
// fatigue. Used by SetupWizard.validatePin (strict-block) and by Settings
// AdminPinField (soft-warn).
//
// Migrated from inline constant in SetupWizard (r-settings-1 S-02) so that
// both code paths share the same source of truth.
const WEAK_PINS_LIST = new Set([
  '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
  '1234','4321','1212','2580','0852','1004','2000','2020','1990','1991',
  '1992','1993','1994','1995','1996','1997','1998','1999','0123','9876',
]);

/**
 * Returns true if `pin` is on the weak-PIN blacklist.
 * Empty string returns false (length validation lives elsewhere).
 * Non-numeric input returns false (numeric validation lives elsewhere).
 */
export function isWeakPin(pin: string | null | undefined): boolean {
  if (!pin) return false;
  return WEAK_PINS_LIST.has(pin);
}
