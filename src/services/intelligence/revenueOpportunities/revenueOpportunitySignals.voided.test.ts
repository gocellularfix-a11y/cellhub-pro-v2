// ============================================================
// R-INTEL-V2-PHASE0: voided-sale exclusion regression test.
// Canonical SaleStatus is 'voided' (store/types.ts). The detectors used to
// check only 'void', so voided sales leaked into VIP qualification and
// inflated the recovered-dollar figures shown to the owner. These tests
// pin the corrected behavior.
// ============================================================

import { describe, it, expect } from 'vitest';
import { detectVipRetention } from './revenueOpportunitySignals';
import type { Customer, Sale } from '@/store/types';

const DAY = 86_400_000;
const sixtyDaysAgo = new Date(Date.now() - 60 * DAY).toISOString();

// 5 sales, $150 each → $750 lifetime (≥ $500), last activity 60 days ago
// (> 30-day VIP inactivity window) → qualifies as an at-risk VIP.
function fiveSales(status: string): Sale[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    customerId: 'c1',
    status,
    total: 15_000, // cents
    createdAt: sixtyDaysAgo,
  })) as unknown as Sale[];
}

const customers = [{ id: 'c1', name: 'Vip Vera' }] as unknown as Customer[];

describe('detectVipRetention — voided-sale exclusion', () => {
  it('flags a genuine at-risk VIP when the qualifying sales are completed', () => {
    const res = detectVipRetention(customers, fiveSales('completed'));
    expect(res.length).toBe(1);
    expect(res[0].type).toBe('vip_retention');
    expect(res[0].relatedCustomerId).toBe('c1');
  });

  it('does NOT flag a VIP whose entire spend was voided (canonical status)', () => {
    const res = detectVipRetention(customers, fiveSales('voided'));
    expect(res.length).toBe(0);
  });

  it('still excludes legacy "void" spelling', () => {
    const res = detectVipRetention(customers, fiveSales('void'));
    expect(res.length).toBe(0);
  });
});
