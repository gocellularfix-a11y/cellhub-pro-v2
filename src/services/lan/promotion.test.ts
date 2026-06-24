import { describe, it, expect } from 'vitest';
import {
  validateFailoverEnvelope,
  buildPromotionMetadata,
  verifyPrimaryHardware,
  promoteToPrimary,
  RESTORE_ORDER,
  REQUIRED_COLLECTIONS,
  PROMOTION_VERSION,
  type FailoverEnvelope,
  type PromotionDeps,
} from './promotion';

const NOW = '2026-06-24T15:00:00.000Z';

function fullSnapshot(): Record<string, unknown> {
  const s: Record<string, unknown> = { settings: { taxRate: 0.0925 } };
  for (const k of REQUIRED_COLLECTIONS) s[k] = [{ id: `${k}-1` }];
  return s;
}
const goodEnvelope: FailoverEnvelope = {
  schemaVersion: 1,
  savedAt: '2026-06-24T12:00:00.000Z',
  sourceRole: 'primary',
  targetRole: 'secondary',
  appVersion: '2.1.0',
  snapshot: fullSnapshot(),
};

// ── Fake DI harness ──────────────────────────────────────
function makeDeps(
  over: Partial<PromotionDeps> & { reachableQueue?: boolean[]; failOnNthWrite?: number } = {},
) {
  let role = 'secondary';
  const store = new Map<string, unknown[]>();
  for (const { storageKey } of RESTORE_ORDER) store.set(storageKey, [{ id: `OLD-${storageKey}` }]);
  const writes: Array<{ key: string; value: unknown[] }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const logs: Array<{ event: string; detail: unknown }> = [];
  const reachableQueue = over.reachableQueue ? [...over.reachableQueue] : [];
  const failOnNthWrite = over.failOnNthWrite ?? 0;
  let writeN = 0;

  const deps: PromotionDeps = {
    isPrimaryReachable: async () => (reachableQueue.length ? !!reachableQueue.shift() : false),
    readEnvelope: async () => ({ ok: true, envelope: goodEnvelope }),
    getRole: () => role,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    captureConnection: () => ({ role, primaryUrl: 'http://p', token: 't', deviceId: 'd', deviceName: 'n' } as any),
    flipToPrimary: () => { role = 'primary'; },
    restoreConnection: (c) => { role = (c.role as string) || 'standalone'; },
    readLocal: (k) => store.get(k) ?? [],
    writeLocal: (k, v) => {
      writeN += 1;
      writes.push({ key: k, value: v });
      if (failOnNthWrite && writeN === failOnNthWrite) return false; // simulate quota failure
      store.set(k, v);
      return true;
    },
    writeAudit: (m) => { audits.push(m as unknown as Record<string, unknown>); },
    now: () => NOW,
    log: (event, detail) => { logs.push({ event, detail }); },
    ...over,
  };
  return { deps, getRole: () => role, store, writes, audits, logs };
}

describe('validateFailoverEnvelope (R-FAILOVER-HARDENING)', () => {
  it('accepts a complete envelope', () => {
    expect(validateFailoverEnvelope(goodEnvelope)).toEqual({ valid: true });
  });
  it('rejects null / unsupported schema / missing snapshot', () => {
    expect(validateFailoverEnvelope(null).reason).toBe('missing-envelope');
    expect(validateFailoverEnvelope({ ...goodEnvelope, schemaVersion: 2 }).reason).toBe('unsupported-schema');
    expect(validateFailoverEnvelope({ ...goodEnvelope, snapshot: null }).reason).toBe('missing-snapshot');
  });
  it('rejects incomplete metadata', () => {
    expect(validateFailoverEnvelope({ ...goodEnvelope, savedAt: undefined }).reason).toBe('incomplete-metadata');
    expect(validateFailoverEnvelope({ ...goodEnvelope, appVersion: '' }).reason).toBe('incomplete-metadata');
  });
  it('rejects missing required collections and reports which', () => {
    const snap = fullSnapshot(); delete snap.sales;
    const r = validateFailoverEnvelope({ ...goodEnvelope, snapshot: snap });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing-collections');
    expect(r.missing).toContain('sales');
  });
});

describe('buildPromotionMetadata (R-FAILOVER-HARDENING)', () => {
  it('captures expanded audit fields', () => {
    const m = buildPromotionMetadata(goodEnvelope, 'Jorge', 'secondary', NOW, 'completed', false);
    expect(m).toEqual({
      promotedAt: NOW, promotedBy: 'Jorge', previousRole: 'secondary',
      snapshotSavedAt: '2026-06-24T12:00:00.000Z', snapshotAppVersion: '2.1.0',
      promotionVersion: PROMOTION_VERSION, promotionResult: 'completed', rollbackPerformed: false,
    });
  });
});

describe('verifyPrimaryHardware (R-FAILOVER-HARDENING)', () => {
  it('primary → all hardware on, forwarding disabled', () => {
    expect(verifyPrimaryHardware('primary')).toEqual({ printing: true, scanner: true, camera: true, forwardingDisabled: true });
  });
  it('secondary → forwarding still active, hardware off', () => {
    expect(verifyPrimaryHardware('secondary')).toEqual({ printing: false, scanner: false, camera: false, forwardingDisabled: false });
  });
});

describe('RESTORE_ORDER (R-FAILOVER-HARDENING)', () => {
  it('is a fixed array (deterministic order), never settings/employees', () => {
    expect(Array.isArray(RESTORE_ORDER)).toBe(true);
    const keys = RESTORE_ORDER.map((o) => o.snapKey);
    expect(keys).not.toContain('settings');
    expect(keys).not.toContain('employees');
    expect(RESTORE_ORDER.find((o) => o.snapKey === 'specialOrders')?.storageKey).toBe('special_orders');
  });
});

describe('promoteToPrimary — transactional (R-FAILOVER-HARDENING)', () => {
  it('successful promotion: flips role, restores in order, completed audit', async () => {
    const h = makeDeps();
    const res = await promoteToPrimary({ promotedBy: 'Jorge' }, h.deps);
    expect(res.ok).toBe(true);
    expect(res.restored).toBe(RESTORE_ORDER.length);
    expect(h.getRole()).toBe('primary');
    expect(h.writes.map((w) => w.key)).toEqual(RESTORE_ORDER.map((o) => o.storageKey));
    expect(h.audits[0].promotionResult).toBe('completed');
    expect(h.audits[0].rollbackPerformed).toBe(false);
    expect(res.hardware).toEqual({ printing: true, scanner: true, camera: true, forwardingDisabled: true });
  });

  it('corrupt/unreadable snapshot: remain Secondary, no writes', async () => {
    const h = makeDeps({ readEnvelope: async () => ({ ok: false, reason: 'error' }) });
    const res = await promoteToPrimary({}, h.deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('error');
    expect(h.getRole()).toBe('secondary');
    expect(h.writes).toHaveLength(0);
  });

  it('unsupported schema: remain Secondary, schema-mismatch logged', async () => {
    const h = makeDeps({ readEnvelope: async () => ({ ok: true, envelope: { ...goodEnvelope, schemaVersion: 2 } }) });
    const res = await promoteToPrimary({}, h.deps);
    expect(res.reason).toBe('unsupported-schema');
    expect(h.getRole()).toBe('secondary');
    expect(h.writes).toHaveLength(0);
    expect(h.logs.some((l) => l.event === 'schema-mismatch')).toBe(true);
  });

  it('missing collections: remain Secondary, never partial', async () => {
    const snap = fullSnapshot(); delete snap.repairs;
    const h = makeDeps({ readEnvelope: async () => ({ ok: true, envelope: { ...goodEnvelope, snapshot: snap } }) });
    const res = await promoteToPrimary({}, h.deps);
    expect(res.reason).toBe('missing-collections');
    expect(h.getRole()).toBe('secondary');
    expect(h.writes).toHaveLength(0);
  });

  it('Primary reachable up-front: blocked (split-brain), no changes', async () => {
    const h = makeDeps({ reachableQueue: [true] });
    const res = await promoteToPrimary({}, h.deps);
    expect(res.reason).toBe('primary-reachable');
    expect(h.getRole()).toBe('secondary');
    expect(h.writes).toHaveLength(0);
  });

  it('Primary reconnects during promotion (probe #2): aborts before flip', async () => {
    const h = makeDeps({ reachableQueue: [false, true] });
    const res = await promoteToPrimary({}, h.deps);
    expect(res.reason).toBe('primary-reachable');
    expect(h.getRole()).toBe('secondary');
    expect(h.writes).toHaveLength(0);
    expect(h.logs.some((l) => l.event === 'split-brain-prevented')).toBe(true);
  });

  it('rollback path + atomicity: write fails → role + original data restored', async () => {
    const h = makeDeps({ failOnNthWrite: 3 });
    const res = await promoteToPrimary({}, h.deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('restore-failed');
    expect(res.rollbackPerformed).toBe(true);
    expect(h.getRole()).toBe('secondary');
    expect(h.audits[0].promotionResult).toBe('rolled-back');
    expect(h.audits[0].rollbackPerformed).toBe(true);
    // every collection holds its ORIGINAL data again (atomic rollback)
    for (const { storageKey } of RESTORE_ORDER) {
      expect(h.store.get(storageKey)).toEqual([{ id: `OLD-${storageKey}` }]);
    }
    expect(h.logs.some((l) => l.event === 'rollback-executed')).toBe(true);
  });
});
