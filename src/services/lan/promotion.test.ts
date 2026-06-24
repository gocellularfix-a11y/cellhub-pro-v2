import { describe, it, expect } from 'vitest';
import {
  validateFailoverEnvelope,
  buildPromotionMetadata,
  RESTORE_KEY_MAP,
  type FailoverEnvelope,
} from './promotion';

const NOW = '2026-06-24T15:00:00.000Z';
const goodEnvelope: FailoverEnvelope = {
  schemaVersion: 1,
  savedAt: '2026-06-24T12:00:00.000Z',
  sourceRole: 'primary',
  targetRole: 'secondary',
  appVersion: '2.1.0',
  snapshot: { customers: [], inventory: [] },
};

describe('validateFailoverEnvelope (R-PROMOTE-TO-PRIMARY)', () => {
  it('accepts a well-formed envelope', () => {
    expect(validateFailoverEnvelope(goodEnvelope)).toEqual({ valid: true });
  });
  it('rejects null/undefined', () => {
    expect(validateFailoverEnvelope(null).valid).toBe(false);
    expect(validateFailoverEnvelope(undefined).valid).toBe(false);
  });
  it('rejects unsupported schema', () => {
    expect(validateFailoverEnvelope({ ...goodEnvelope, schemaVersion: 2 })).toEqual({
      valid: false, reason: 'unsupported-schema',
    });
  });
  it('rejects a missing snapshot payload', () => {
    expect(validateFailoverEnvelope({ ...goodEnvelope, snapshot: null })).toEqual({
      valid: false, reason: 'missing-snapshot',
    });
  });
});

describe('buildPromotionMetadata (R-PROMOTE-TO-PRIMARY)', () => {
  it('captures all recovery fields', () => {
    const meta = buildPromotionMetadata(goodEnvelope, 'Jorge', 'secondary', NOW);
    expect(meta).toEqual({
      promotedAt: NOW,
      promotedBy: 'Jorge',
      previousRole: 'secondary',
      snapshotSavedAt: '2026-06-24T12:00:00.000Z',
      snapshotAppVersion: '2.1.0',
    });
  });
  it('falls back to admin/secondary and null snapshot fields', () => {
    const meta = buildPromotionMetadata({ schemaVersion: 1, snapshot: {} }, '', '', NOW);
    expect(meta.promotedBy).toBe('admin');
    expect(meta.previousRole).toBe('secondary');
    expect(meta.snapshotSavedAt).toBe(null);
    expect(meta.snapshotAppVersion).toBe(null);
  });
  it('is deterministic with an explicit timestamp', () => {
    expect(buildPromotionMetadata(goodEnvelope, 'Jorge', 'secondary', NOW)).toEqual(
      buildPromotionMetadata(goodEnvelope, 'Jorge', 'secondary', NOW),
    );
  });
});

describe('RESTORE_KEY_MAP (R-PROMOTE-TO-PRIMARY)', () => {
  it('restores business collections only — NEVER settings or employees', () => {
    expect(RESTORE_KEY_MAP).not.toHaveProperty('settings');
    expect(RESTORE_KEY_MAP).not.toHaveProperty('employees');
  });
  it('maps camelCase snapshot keys to snake_case storage keys', () => {
    expect(RESTORE_KEY_MAP.specialOrders).toBe('special_orders');
    expect(RESTORE_KEY_MAP.customers).toBe('customers');
  });
});
