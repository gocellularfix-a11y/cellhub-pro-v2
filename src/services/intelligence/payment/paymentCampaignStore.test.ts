// ============================================================
// PAYMENT DATE FINDER — F4 campaign store tests.
// Exercises the pure builder + the localStorage roundtrip (create, upsert,
// status, per-customer actions, cap, parse guards) against jsdom localStorage.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCampaignFromFinder,
  saveCampaign,
  listCampaigns,
  getCampaign,
  deleteCampaign,
  setCampaignStatus,
  setCustomerAction,
  campaignProgress,
  CAMPAIGN_TYPES,
  type PaymentCampaign,
} from './paymentCampaignStore';
import type { PaymentFinderResult } from './paymentDateFinder';

const STORE_KEY = 'cellhub.paymentDateCampaigns.v1';

// Node test env (vitest environment: 'node') has no real localStorage — mirror
// the MockLocalStorage pattern used by sessionContext.test.ts.
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? (this.store.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  get length(): number { return this.store.size; }
}

function makeResult(rowCount = 2): PaymentFinderResult {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    customerId: `c${i + 1}`,
    customerName: `Customer ${i + 1}`,
    phone: `80500011${i}0`,
    carrier: 'T-Mobile',
    lineCount: 1,
    isMultiLine: false,
    lastPaymentDate: '2026-06-07T00:00:00.000Z',
    lastPaymentAmountCents: 5000,
    averagePaymentAmountCents: 5000,
    paymentCount: 1,
    estimatedNextDueDate: '2026-07-07T00:00:00.000Z',
    effectiveDueDate: '2026-07-07T00:00:00.000Z',
    isEstimated: true,
    status: 'estimated_due' as const,
    isHighValue: false,
  }));
  return {
    rows,
    generatedAt: '2026-07-01T00:00:00.000Z',
    rangeStart: '2026-07-05T00:00:00.000Z',
    rangeEnd: '2026-07-10T00:00:00.000Z',
    counts: { total: rowCount, dueInRange: 0, estimatedDue: rowCount, historicalMatch: 0, alreadyPaid: 0 },
  };
}

function makeCampaign(over: Partial<PaymentCampaign> & { id: string }): PaymentCampaign {
  return createCampaignFromFinder({
    id: over.id,
    now: over.createdAt ?? 1000,
    name: over.name ?? 'Vacation July',
    type: over.type ?? 'vacation',
    reason: over.reason,
    result: makeResult(2),
    lang: over.lang ?? 'en',
    tone: over.tone ?? 'friendly',
  });
}

beforeEach(() => {
  (globalThis as { localStorage: unknown }).localStorage = new MockLocalStorage();
});

describe('createCampaignFromFinder (pure)', () => {
  it('snapshots finder rows into a draft campaign', () => {
    const c = createCampaignFromFinder({
      id: 'camp1', now: 5000, name: 'Vacation', type: 'vacation',
      result: makeResult(3), lang: 'es', tone: 'professional',
    });
    expect(c.status).toBe('draft');
    expect(c.customers).toHaveLength(3);
    expect(c.customers[0].customerId).toBe('c1');
    expect(c.rangeStart).toBe('2026-07-05T00:00:00.000Z');
    expect(c.lang).toBe('es');
    expect(c.tone).toBe('professional');
    expect(c.createdAt).toBe(5000);
    expect(c.actions).toEqual({});
  });

  it('falls back to a default name when blank and drops empty reason', () => {
    const c = createCampaignFromFinder({
      id: 'x', now: 1, name: '   ', type: 'custom', reason: '  ',
      result: makeResult(1), lang: 'en', tone: 'direct',
    });
    expect(c.name).toBe('Campaign');
    expect(c.reason).toBeUndefined();
  });

  it('exposes all five campaign types', () => {
    expect(CAMPAIGN_TYPES).toEqual(['vacation', 'custom', 'holiday', 'closure', 'days_off']);
  });
});

describe('save / list / get / delete', () => {
  it('persists to the versioned localStorage key', () => {
    saveCampaign(makeCampaign({ id: 'camp1' }), 2000);
    expect(localStorage.getItem(STORE_KEY)).toBeTruthy();
    expect(listCampaigns()).toHaveLength(1);
    expect(getCampaign('camp1')?.id).toBe('camp1');
  });

  it('upserts by id (no duplicate)', () => {
    saveCampaign(makeCampaign({ id: 'camp1', name: 'First' }), 1000);
    saveCampaign({ ...makeCampaign({ id: 'camp1' }), name: 'Renamed' }, 2000);
    const list = listCampaigns();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Renamed');
  });

  it('lists most-recently-updated first', () => {
    saveCampaign(makeCampaign({ id: 'a' }), 1000);
    saveCampaign(makeCampaign({ id: 'b' }), 3000);
    saveCampaign(makeCampaign({ id: 'c' }), 2000);
    expect(listCampaigns().map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('deletes by id', () => {
    saveCampaign(makeCampaign({ id: 'camp1' }), 1000);
    deleteCampaign('camp1');
    expect(listCampaigns()).toHaveLength(0);
  });
});

describe('status lifecycle', () => {
  it('transitions draft → active → completed', () => {
    saveCampaign(makeCampaign({ id: 'camp1' }), 1000);
    expect(setCampaignStatus('camp1', 'active', 2000)?.status).toBe('active');
    expect(setCampaignStatus('camp1', 'completed', 3000)?.status).toBe('completed');
    expect(getCampaign('camp1')?.status).toBe('completed');
  });

  it('returns null for a missing campaign', () => {
    expect(setCampaignStatus('nope', 'active')).toBeNull();
  });
});

describe('per-customer actions (never touch Customer records)', () => {
  it('marks contacted and persists', () => {
    saveCampaign(makeCampaign({ id: 'camp1' }), 1000);
    setCustomerAction('camp1', 'c1', { contacted: true, contactedAt: 5000 }, 5000);
    const c = getCampaign('camp1')!;
    expect(c.actions.c1.contacted).toBe(true);
    expect(c.actions.c1.contactedAt).toBe(5000);
  });

  it('merges successive patches on the same customer', () => {
    saveCampaign(makeCampaign({ id: 'camp1' }), 1000);
    setCustomerAction('camp1', 'c1', { contacted: true }, 2000);
    setCustomerAction('camp1', 'c1', { note: 'called, no answer' }, 3000);
    setCustomerAction('camp1', 'c1', { followUpDate: '2026-07-12' }, 4000);
    const a = getCampaign('camp1')!.actions.c1;
    expect(a.contacted).toBe(true);
    expect(a.note).toBe('called, no answer');
    expect(a.followUpDate).toBe('2026-07-12');
  });

  it('skip is independent per customer', () => {
    saveCampaign(makeCampaign({ id: 'camp1' }), 1000);
    setCustomerAction('camp1', 'c2', { skipped: true }, 2000);
    const c = getCampaign('camp1')!;
    expect(c.actions.c2.skipped).toBe(true);
    expect(c.actions.c1).toBeUndefined();
  });

  it('does not write any customer key outside the campaign store', () => {
    saveCampaign(makeCampaign({ id: 'camp1' }), 1000);
    setCustomerAction('camp1', 'c1', { contacted: true }, 2000);
    // Only the campaign store key exists — no stray customer persistence.
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe(STORE_KEY);
  });
});

describe('campaignProgress', () => {
  it('counts contacted + skipped as handled', () => {
    let c = makeCampaign({ id: 'camp1' });
    saveCampaign(c, 1000);
    setCustomerAction('camp1', 'c1', { contacted: true }, 2000);
    setCustomerAction('camp1', 'c2', { skipped: true }, 2000);
    c = getCampaign('camp1')!;
    const p = campaignProgress(c);
    expect(p).toEqual({ handled: 2, total: 2, contacted: 1, skipped: 1 });
  });
});

describe('resilience', () => {
  it('returns [] on corrupt JSON', () => {
    localStorage.setItem(STORE_KEY, '{not valid json');
    expect(listCampaigns()).toEqual([]);
  });

  it('filters out malformed entries', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([{ id: 'ok', name: 'x', type: 'vacation', status: 'draft', customers: [], actions: {} }, { garbage: true }, null]));
    const list = listCampaigns();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('ok');
  });
});
