// ============================================================
// CellHub Pro — Secondary → Primary promotion (R-PROMOTE-TO-PRIMARY
//   hardened by R-FAILOVER-HARDENING)
//
// Converts a persisted failover snapshot (R-SECONDARY-FAILOVER-PERSIST, written
// to userData/mirror/primary-snapshot.json) into an operational Primary.
//
// HARD RULES enforced here:
//   • MANUAL ONLY — nothing here runs automatically (no timer / startup /
//     disconnect / heartbeat). The caller (button + Admin-PIN gate) invokes it.
//   • TRANSACTIONAL — promotion either fully completes OR the machine remains a
//     Secondary with its original data + connection intact. Never a partial role.
//   • SPLIT-BRAIN GUARD — refused while the old Primary is reachable; re-verified
//     immediately before the role flip.
//   • INTEGRITY — every required business collection must be present; incomplete
//     snapshots are refused (never silently restore partial business data).
//   • Restores BUSINESS collections only — never settings/employees (the
//     Secondary keeps its own admin PIN / printers / tax config).
//   • No Firebase, no money/tax math, no LAN discovery touched.
//
// Pure helpers (validate / metadata / order) + an injectable orchestrator make
// the whole pipeline deterministically unit-testable.
// ============================================================

import { saveLocal, loadLocal } from '@/services/storage';
import {
  fetchSnapshot,
  promoteToPrimaryRole,
  getConnection,
  restoreConnection,
  type LanConnection,
} from '@/services/lan/lanService';

const SUPPORTED_SCHEMA = 1;
export const PROMOTION_VERSION = 1;
const PROMOTION_AUDIT_KEY = 'promotion_audit'; // saveLocal → cellhub_promotion_audit

// ── Deterministic restore order ──────────────────────────
// Snapshot payload key → localStorage collection key. Order is FIXED (array,
// never Object-enumeration order). BUSINESS data only — settings/employees are
// intentionally NOT restored (kept local).
export const RESTORE_ORDER: ReadonlyArray<{ snapKey: string; storageKey: string }> = [
  { snapKey: 'customers', storageKey: 'customers' },
  { snapKey: 'inventory', storageKey: 'inventory' },
  { snapKey: 'sales', storageKey: 'sales' },
  { snapKey: 'repairs', storageKey: 'repairs' },
  { snapKey: 'layaways', storageKey: 'layaways' },
  { snapKey: 'unlocks', storageKey: 'unlocks' },
  { snapKey: 'specialOrders', storageKey: 'special_orders' },
  { snapKey: 'appointments', storageKey: 'appointments' },
];

/** Required collections that MUST exist in a valid snapshot. */
export const REQUIRED_COLLECTIONS: readonly string[] = RESTORE_ORDER.map((o) => o.snapKey);

// ── Diagnostics (renderer console style, deterministic event names) ──
export const FAILOVER_EVENTS = {
  INVALID_SNAPSHOT: 'invalid-snapshot',
  SCHEMA_MISMATCH: 'schema-mismatch',
  MISSING_COLLECTIONS: 'missing-collections',
  SPLIT_BRAIN_PREVENTED: 'split-brain-prevented',
  ROLLBACK_EXECUTED: 'rollback-executed',
  PROMOTION_CANCELLED: 'promotion-cancelled',
  PROMOTION_COMPLETED: 'promotion-completed',
} as const;

function logFailover(event: string, detail?: unknown): void {
  // eslint-disable-next-line no-console
  try { console.info(`[failover] ${event}`, detail === undefined ? '' : detail); } catch { /* noop */ }
}

// ── Types ────────────────────────────────────────────────
export interface FailoverEnvelope {
  schemaVersion?: number;
  savedAt?: string;
  sourceRole?: string;
  targetRole?: string;
  appVersion?: string;
  snapshot?: Record<string, unknown> | null;
}

export interface PromotionAudit {
  promotedAt: string;
  promotedBy: string;
  previousRole: string;
  snapshotSavedAt: string | null;
  snapshotAppVersion: string | null;
  promotionVersion: number;
  promotionResult: 'completed' | 'rolled-back' | 'aborted';
  rollbackPerformed: boolean;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  missing?: string[];
}

export interface HardwareStatus {
  printing: boolean;
  scanner: boolean;
  camera: boolean;
  forwardingDisabled: boolean;
}

export interface PromotionResult {
  ok: boolean;
  reason?: string;
  restored?: number;
  rollbackPerformed?: boolean;
  hardware?: HardwareStatus;
}

// ── Pure validation ──────────────────────────────────────
/**
 * Pure: is the failover envelope usable for promotion? Checks schema, snapshot
 * presence, metadata completeness, and that EVERY required business collection
 * exists as an array. Returns a controlled result — never throws.
 */
export function validateFailoverEnvelope(envelope: FailoverEnvelope | null | undefined): ValidationResult {
  if (!envelope || typeof envelope !== 'object') return { valid: false, reason: 'missing-envelope' };
  if (envelope.schemaVersion !== SUPPORTED_SCHEMA) return { valid: false, reason: 'unsupported-schema' };
  const snap = envelope.snapshot;
  if (!snap || typeof snap !== 'object') return { valid: false, reason: 'missing-snapshot' };
  if (!envelope.savedAt || !envelope.appVersion) return { valid: false, reason: 'incomplete-metadata' };
  const missing = REQUIRED_COLLECTIONS.filter((k) => !Array.isArray((snap as Record<string, unknown>)[k]));
  if (missing.length > 0) return { valid: false, reason: 'missing-collections', missing };
  return { valid: true };
}

/** Pure: build the recovery/audit metadata for a promotion attempt. */
export function buildPromotionMetadata(
  envelope: FailoverEnvelope,
  promotedBy: string,
  previousRole: string,
  nowIso: string,
  result: PromotionAudit['promotionResult'],
  rollbackPerformed: boolean,
): PromotionAudit {
  return {
    promotedAt: nowIso,
    promotedBy: promotedBy || 'admin',
    previousRole: previousRole || 'secondary',
    snapshotSavedAt: envelope.savedAt || null,
    snapshotAppVersion: envelope.appVersion || null,
    promotionVersion: PROMOTION_VERSION,
    promotionResult: result,
    rollbackPerformed,
  };
}

/**
 * Hardware ownership is not a togglable gate — it is structurally implied by the
 * role. As a Primary, printing/scanner/camera run locally and operation
 * forwarding (which keys off role === 'secondary') is disabled.
 */
export function verifyPrimaryHardware(role: string): HardwareStatus {
  const isPrimary = role === 'primary';
  return { printing: isPrimary, scanner: isPrimary, camera: isPrimary, forwardingDisabled: role !== 'secondary' };
}

// ── Split-brain probe ────────────────────────────────────
/** A successful live snapshot fetch means the old Primary is up → block. */
export async function isPrimaryReachable(): Promise<boolean> {
  try {
    const res = await fetchSnapshot();
    return res.ok === true;
  } catch {
    return false;
  }
}

// ── Injectable dependencies (default = real wiring) ──────
export interface PromotionDeps {
  isPrimaryReachable: () => Promise<boolean>;
  readEnvelope: () => Promise<{ ok: boolean; envelope?: FailoverEnvelope; reason?: string }>;
  getRole: () => string;
  captureConnection: () => LanConnection;
  flipToPrimary: () => void;
  restoreConnection: (c: Partial<LanConnection>) => void;
  readLocal: (storageKey: string) => unknown[];
  writeLocal: (storageKey: string, value: unknown[]) => boolean;
  writeAudit: (meta: PromotionAudit) => void;
  now: () => string;
  log: (event: string, detail?: unknown) => void;
}

function defaultDeps(): PromotionDeps {
  return {
    isPrimaryReachable,
    readEnvelope: async () => {
      const api = window.electronAPI;
      if (!api?.readMirrorFailover) return { ok: false, reason: 'not-electron' };
      return (await api.readMirrorFailover()) as { ok: boolean; envelope?: FailoverEnvelope; reason?: string };
    },
    getRole: () => getConnection().role,
    captureConnection: () => getConnection(),
    flipToPrimary: () => promoteToPrimaryRole(),
    restoreConnection: (c) => restoreConnection(c),
    readLocal: (storageKey) => loadLocal<unknown[]>(storageKey, []),
    writeLocal: (storageKey, value) => saveLocal(storageKey, value),
    writeAudit: (meta) => { saveLocal(PROMOTION_AUDIT_KEY, meta); },
    now: () => new Date().toISOString(),
    log: logFailover,
  };
}

// ── Transactional orchestrator ───────────────────────────
/**
 * MANUAL, TRANSACTIONAL promotion. The caller MUST have validated the Admin PIN.
 * Either the machine fully becomes a Primary with restored business data, OR it
 * remains a Secondary with original data + connection intact. Deterministic and
 * dependency-injected for testing; defaults wire to the real LAN/storage layer.
 *
 * Steps:
 *   1. Split-brain guard #1 (refuse if Primary reachable).
 *   2. Read + validate the persisted failover envelope (schema, snapshot,
 *      metadata, required collections). Any failure → remain Secondary, no changes.
 *   3. Capture rollback state: previous connection + a backup of every local
 *      collection that will be overwritten.
 *   4. Split-brain guard #2 — re-verify the Primary is still unreachable right
 *      before the flip. If it came back → abort, no changes.
 *   5. Flip role → primary (disables forwarding + read-only guard).
 *   6. Restore business collections in the FIXED order. If any write fails →
 *      ROLLBACK: restore role first, then restore the captured local backup,
 *      write a rolled-back audit, return failure. Never partially promote.
 *   7. Verify hardware ownership (role is primary). Write a completed audit.
 */
export async function promoteToPrimary(
  opts: { promotedBy?: string } = {},
  deps: PromotionDeps = defaultDeps(),
): Promise<PromotionResult> {
  const promotedBy = opts.promotedBy || 'admin';

  // 1. Split-brain guard #1.
  if (await deps.isPrimaryReachable()) {
    deps.log(FAILOVER_EVENTS.SPLIT_BRAIN_PREVENTED, { stage: 'pre-read' });
    return { ok: false, reason: 'primary-reachable' };
  }

  // 2. Read + validate.
  const read = await deps.readEnvelope();
  if (!read?.ok || !read.envelope) {
    deps.log(FAILOVER_EVENTS.INVALID_SNAPSHOT, { reason: read?.reason || 'no-snapshot' });
    return { ok: false, reason: read?.reason || 'no-snapshot' };
  }
  const envelope = read.envelope;
  const validation = validateFailoverEnvelope(envelope);
  if (!validation.valid) {
    const ev = validation.reason === 'unsupported-schema'
      ? FAILOVER_EVENTS.SCHEMA_MISMATCH
      : validation.reason === 'missing-collections'
        ? FAILOVER_EVENTS.MISSING_COLLECTIONS
        : FAILOVER_EVENTS.INVALID_SNAPSHOT;
    deps.log(ev, { reason: validation.reason, missing: validation.missing });
    return { ok: false, reason: validation.reason };
  }
  const snapshot = envelope.snapshot as Record<string, unknown>;

  // 3. Capture rollback state.
  const previousConnection = deps.captureConnection();
  const previousRole = previousConnection.role;
  const localBackup: Array<{ storageKey: string; value: unknown[] }> = RESTORE_ORDER.map((o) => ({
    storageKey: o.storageKey,
    value: deps.readLocal(o.storageKey),
  }));

  // 4. Split-brain guard #2 — re-verify right before the flip. No state changed yet.
  if (await deps.isPrimaryReachable()) {
    deps.log(FAILOVER_EVENTS.SPLIT_BRAIN_PREVENTED, { stage: 'pre-flip' });
    return { ok: false, reason: 'primary-reachable' };
  }

  // 5. Flip role → primary.
  deps.flipToPrimary();

  // 6. Restore business collections (fixed order). Roll back on ANY failure.
  try {
    for (const { snapKey, storageKey } of RESTORE_ORDER) {
      const value = snapshot[snapKey];
      if (!Array.isArray(value)) throw new Error(`missing-collection:${snapKey}`); // defense-in-depth
      const ok = deps.writeLocal(storageKey, value as unknown[]);
      if (!ok) throw new Error(`write-failed:${storageKey}`);
    }
  } catch (e) {
    // ── ROLLBACK ── role first (so it is a Secondary again), then local data.
    deps.restoreConnection(previousConnection);
    for (const { storageKey, value } of localBackup) {
      try { deps.writeLocal(storageKey, value); } catch { /* best-effort */ }
    }
    const meta = buildPromotionMetadata(envelope, promotedBy, previousRole, deps.now(), 'rolled-back', true);
    deps.writeAudit(meta);
    deps.log(FAILOVER_EVENTS.ROLLBACK_EXECUTED, { error: e instanceof Error ? e.message : 'unknown' });
    return { ok: false, reason: 'restore-failed', rollbackPerformed: true };
  }

  // 7. Verify hardware ownership; if the role didn't take, roll back.
  const hardware = verifyPrimaryHardware(deps.getRole());
  if (!hardware.forwardingDisabled || !hardware.printing) {
    deps.restoreConnection(previousConnection);
    for (const { storageKey, value } of localBackup) {
      try { deps.writeLocal(storageKey, value); } catch { /* best-effort */ }
    }
    const meta = buildPromotionMetadata(envelope, promotedBy, previousRole, deps.now(), 'rolled-back', true);
    deps.writeAudit(meta);
    deps.log(FAILOVER_EVENTS.ROLLBACK_EXECUTED, { error: 'hardware-verify-failed' });
    return { ok: false, reason: 'hardware-verify-failed', rollbackPerformed: true };
  }

  const meta = buildPromotionMetadata(envelope, promotedBy, previousRole, deps.now(), 'completed', false);
  deps.writeAudit(meta);
  deps.log(FAILOVER_EVENTS.PROMOTION_COMPLETED, { restored: RESTORE_ORDER.length });
  return { ok: true, restored: RESTORE_ORDER.length, rollbackPerformed: false, hardware };
}
