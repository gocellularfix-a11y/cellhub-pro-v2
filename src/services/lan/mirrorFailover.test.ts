import { describe, it, expect } from 'vitest';
// @ts-ignore — electron/mirrorFailover.js is a CommonJS runtime module (no .d.ts).
import { buildFailoverEnvelope, SCHEMA_VERSION } from '../../../electron/mirrorFailover.js';

const SAVED_AT = '2026-06-24T12:00:00.000Z';
const SNAP = { customers: [{ id: 'c1' }], inventory: [], settings: { taxRate: 0.0925 } };

describe('buildFailoverEnvelope (R-SECONDARY-FAILOVER-PERSIST)', () => {
  it('wraps the snapshot with the required metadata', () => {
    const env = buildFailoverEnvelope(SNAP, SAVED_AT, '2.1.0');
    expect(env.schemaVersion).toBe(SCHEMA_VERSION);
    expect(env.savedAt).toBe(SAVED_AT);
    expect(env.sourceRole).toBe('primary');
    expect(env.targetRole).toBe('secondary');
    expect(env.appVersion).toBe('2.1.0');
    expect(env.snapshot).toEqual(SNAP);
  });

  it('falls back to "unknown" appVersion when absent', () => {
    expect(buildFailoverEnvelope(SNAP, SAVED_AT, undefined).appVersion).toBe('unknown');
    expect(buildFailoverEnvelope(SNAP, SAVED_AT, '').appVersion).toBe('unknown');
  });

  it('normalizes undefined snapshot to null', () => {
    expect(buildFailoverEnvelope(undefined, SAVED_AT, '2.1.0').snapshot).toBe(null);
  });

  it('is deterministic with an explicit savedAt', () => {
    expect(buildFailoverEnvelope(SNAP, SAVED_AT, '2.1.0')).toEqual(
      buildFailoverEnvelope(SNAP, SAVED_AT, '2.1.0'),
    );
  });

  it('does not declare promotion/restore behavior (write-only envelope)', () => {
    const env = buildFailoverEnvelope(SNAP, SAVED_AT, '2.1.0');
    // Envelope is pure data — no functions, no restore/promote flags.
    expect(Object.keys(env).sort()).toEqual(
      ['appVersion', 'savedAt', 'schemaVersion', 'snapshot', 'sourceRole', 'targetRole'].sort(),
    );
  });
});
