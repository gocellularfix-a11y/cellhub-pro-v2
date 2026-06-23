import { describe, it, expect } from 'vitest';
import type { TopAction } from '@/services/intelligence/decision/ranking/topActionsRanking';
import { shouldShowImpact, formatImpact } from './TopActionRow';

function action(over: Partial<TopAction> = {}): TopAction {
  return {
    decisionId: 'd1',
    title: 'T',
    reason: 'R',
    domain: 'cash',
    confidence: 50,
    impactCents: 12_345,
    approvalRequired: false,
    approvalKind: 'none',
    financialSensitive: false,
    ...over,
  };
}

describe('shouldShowImpact — Policy C redaction', () => {
  it('hides when no/zero impact', () => {
    expect(shouldShowImpact(action({ impactCents: undefined }), true)).toBe(false);
    expect(shouldShowImpact(action({ impactCents: 0 }), true)).toBe(false);
  });

  it('shows non-sensitive impact regardless of viewer', () => {
    expect(shouldShowImpact(action({ financialSensitive: false }), false)).toBe(true);
    expect(shouldShowImpact(action({ financialSensitive: false }), true)).toBe(true);
  });

  it('shows financialSensitive impact only to owner', () => {
    expect(shouldShowImpact(action({ financialSensitive: true }), true)).toBe(true);
    expect(shouldShowImpact(action({ financialSensitive: true }), false)).toBe(false);
  });
});

describe('formatImpact', () => {
  it('formats whole dollars', () => {
    expect(formatImpact(12_345)).toBe('$123');
    expect(formatImpact(100)).toBe('$1');
    expect(formatImpact(50)).toBe('$1'); // rounds 0.5 → 1
    expect(formatImpact(0)).toBe('$0');
  });
});
