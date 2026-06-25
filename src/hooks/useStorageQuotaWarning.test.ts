import { describe, it, expect } from 'vitest';
import { classifyStorageUsage } from './useStorageQuotaWarning';

describe('classifyStorageUsage (R-STORAGE-WARNING-FIX)', () => {
  it('< 90 → ok (no false-positive banner on healthy stores)', () => {
    expect(classifyStorageUsage(0)).toBe('ok');
    expect(classifyStorageUsage(80)).toBe('ok');
    expect(classifyStorageUsage(89.99)).toBe('ok');
  });

  it('[90, 95) → warn', () => {
    expect(classifyStorageUsage(90)).toBe('warn');
    expect(classifyStorageUsage(94.99)).toBe('warn');
  });

  it('>= 95 → critical', () => {
    expect(classifyStorageUsage(95)).toBe('critical');
    expect(classifyStorageUsage(100)).toBe('critical');
    expect(classifyStorageUsage(250)).toBe('critical');
  });

  it('non-finite input is fail-safe ok (guard runs before threshold checks)', () => {
    expect(classifyStorageUsage(NaN)).toBe('ok');
    expect(classifyStorageUsage(Infinity)).toBe('ok');
    expect(classifyStorageUsage(-Infinity)).toBe('ok');
  });

  it('is deterministic — same input → same output', () => {
    expect(classifyStorageUsage(90)).toBe(classifyStorageUsage(90));
    expect(classifyStorageUsage(95)).toBe(classifyStorageUsage(95));
  });
});
