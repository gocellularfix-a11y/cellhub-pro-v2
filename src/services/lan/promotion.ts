// ============================================================
// CellHub Pro — Secondary → Primary promotion (R-PROMOTE-TO-PRIMARY)
//
// Converts a persisted failover snapshot (R-SECONDARY-FAILOVER-PERSIST, written
// to userData/mirror/primary-snapshot.json) into an operational Primary.
//
// HARD RULES enforced here:
//   • MANUAL ONLY — nothing in this module runs automatically. There is no
//     timer, no startup hook, no disconnect/heartbeat trigger. The caller (a
//     button + Admin-PIN gate in the UI) invokes promoteToPrimary().
//   • SPLIT-BRAIN GUARD — promotion is refused while the old Primary is
//     reachable (a live snapshot fetch succeeds).
//   • Restores BUSINESS collections only; it does NOT overwrite local settings
//     (the Secondary keeps its own admin PIN / printers / tax config).
//   • No Firebase, no money/tax math, no LAN discovery touched.
// ============================================================

import { saveLocal } from '@/services/storage';
import { fetchSnapshot, promoteToPrimaryRole, getConnection } from '@/services/lan/lanService';

const SUPPORTED_SCHEMA = 1;
const PROMOTION_AUDIT_KEY = 'promotion_audit'; // stored via saveLocal → cellhub_promotion_audit

/** Snapshot payload key → localStorage collection key. BUSINESS data only —
 *  settings/employees are intentionally NOT restored (kept local). */
export const RESTORE_KEY_MAP: Record<string, string> = {
  customers: 'customers',
  inventory: 'inventory',
  sales: 'sales',
  repairs: 'repairs',
  layaways: 'layaways',
  unlocks: 'unlocks',
  specialOrders: 'special_orders',
  appointments: 'appointments',
};

export interface FailoverEnvelope {
  schemaVersion?: number;
  savedAt?: string;
  sourceRole?: string;
  targetRole?: string;
  appVersion?: string;
  snapshot?: Record<string, unknown> | null;
}

export interface PromotionMetadata {
  promotedAt: string;
  promotedBy: string;
  previousRole: string;
  snapshotSavedAt: string | null;
  snapshotAppVersion: string | null;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** Pure: is the failover envelope usable for promotion? */
export function validateFailoverEnvelope(envelope: FailoverEnvelope | null | undefined): ValidationResult {
  if (!envelope || typeof envelope !== 'object') return { valid: false, reason: 'missing-envelope' };
  if (envelope.schemaVersion !== SUPPORTED_SCHEMA) return { valid: false, reason: 'unsupported-schema' };
  const snap = envelope.snapshot;
  if (!snap || typeof snap !== 'object') return { valid: false, reason: 'missing-snapshot' };
  return { valid: true };
}

/** Pure: build the recovery/audit metadata for a promotion. */
export function buildPromotionMetadata(
  envelope: FailoverEnvelope,
  promotedBy: string,
  previousRole: string,
  nowIso: string,
): PromotionMetadata {
  return {
    promotedAt: nowIso,
    promotedBy: promotedBy || 'admin',
    previousRole: previousRole || 'secondary',
    snapshotSavedAt: envelope.savedAt || null,
    snapshotAppVersion: envelope.appVersion || null,
  };
}

/**
 * Restore the business collections from the snapshot into localStorage. Returns
 * the count of collections restored. Does NOT touch settings/employees. Uses
 * the raw saveLocal primitive (clean overwrite) — not the persist layer.
 */
export function restoreSnapshotToLocal(snapshot: Record<string, unknown>): number {
  let restored = 0;
  for (const [snapKey, storageKey] of Object.entries(RESTORE_KEY_MAP)) {
    const value = snapshot[snapKey];
    if (Array.isArray(value)) {
      saveLocal(storageKey, value);
      restored += 1;
    }
  }
  return restored;
}

export interface PromotionResult {
  ok: boolean;
  reason?: string;
  restored?: number;
}

/**
 * Probe whether the old Primary is still reachable (split-brain guard). A live
 * snapshot fetch that succeeds means the Primary is up → promotion must be
 * refused. Pure I/O over the existing LAN client; no state change.
 */
export async function isPrimaryReachable(): Promise<boolean> {
  try {
    const res = await fetchSnapshot();
    return res.ok === true;
  } catch {
    return false;
  }
}

/**
 * MANUAL promotion. Caller MUST have already validated the Admin PIN. Steps:
 *   1. Split-brain guard — refuse if the Primary is still reachable.
 *   2. Read + validate the persisted failover envelope.
 *   3. Flip role → primary (disables forwarding + read-only guard).
 *   4. Restore business collections into localStorage.
 *   5. Write recovery metadata.
 * Returns a controlled result. The caller reloads the app on success so it
 * boots as a Primary (no wizard — setup is already complete).
 */
export async function promoteToPrimary(opts: { promotedBy?: string } = {}): Promise<PromotionResult> {
  // 1. Split-brain guard.
  if (await isPrimaryReachable()) {
    return { ok: false, reason: 'primary-reachable' };
  }

  // 2. Read + validate the persisted snapshot.
  const api = window.electronAPI;
  if (!api?.readMirrorFailover) return { ok: false, reason: 'not-electron' };
  const read = await api.readMirrorFailover();
  if (!read?.ok || !read.envelope) return { ok: false, reason: read?.reason || 'no-snapshot' };
  const envelope = read.envelope as FailoverEnvelope;
  const validation = validateFailoverEnvelope(envelope);
  if (!validation.valid) return { ok: false, reason: validation.reason };

  const previousRole = getConnection().role;

  // 3. Become Primary (severs old-Primary link; re-enables local persistence + hardware).
  promoteToPrimaryRole();

  // 4. Restore business collections.
  const restored = restoreSnapshotToLocal(envelope.snapshot as Record<string, unknown>);

  // 5. Recovery metadata.
  const meta = buildPromotionMetadata(envelope, opts.promotedBy || 'admin', previousRole, new Date().toISOString());
  saveLocal(PROMOTION_AUDIT_KEY, meta);

  return { ok: true, restored };
}
