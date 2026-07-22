// ============================================================
// P0-C1 — canonical portal resolver tests (deterministic, node env).
// Locks exact carrier→portal routing, collision safety, display==launch
// parity (one structured object drives both), and the idempotency key.
// ============================================================

import { describe, it, expect } from 'vitest';
import { DEFAULT_PAYMENT_PORTALS } from '@/config/paymentPortals';
import { resolvePaymentPortal, matchPortalId, paymentAttemptKey, runExternalPaymentLaunch } from './phonePaymentPortal';

const PORTALS = DEFAULT_PAYMENT_PORTALS;
const URLS: Record<string, string> = {
  H2O: 'https://h2odirectnow.example/pay',
  Verizon: 'https://paymasterwebpos.example/vzw',
  'T-Mobile': 'https://paymasterwebpos.example/tmo',
  'AT&T': 'https://myrtpay.example/att',
  'Simple Mobile': 'https://vidapay.example/simple',
};

describe('portal id mapping (exact routing)', () => {
  const cases: Array<[string, string]> = [
    ['H2O', 'H2O'],
    ['Verizon', 'WebPOS'],
    ['vzw', 'WebPOS'],
    ['T-Mobile', 'WebPOS'],
    ['tmobile', 'WebPOS'],
    ['AT&T', 'QPay'],
    ['att', 'QPay'],
    ['Simple Mobile', 'VidaPay'],
    ['Page Plus', 'VidaPay'],
    ['pageplus', 'VidaPay'],
  ];
  it.each(cases)('carrier %s → portal %s', (carrier, expected) => {
    expect(matchPortalId(carrier, PORTALS, URLS)).toBe(expected);
  });

  it('Cricket has no configured portal → empty', () => {
    expect(matchPortalId('Cricket', PORTALS, URLS)).toBe('');
  });
  it('unknown carrier → empty', () => {
    expect(matchPortalId('Nonexistent Carrier', PORTALS, URLS)).toBe('');
  });
  it('blank carrier → empty (no throw)', () => {
    expect(matchPortalId('', PORTALS, URLS)).toBe('');
    expect(matchPortalId('   ', PORTALS, URLS)).toBe('');
  });
});

describe('substring collision safety', () => {
  it('a carrier embedding another keyword resolves to the longest/most specific match', () => {
    // "Verizon Prepaid" embeds 'verizon' → WebPOS (never mis-routed by a short fragment).
    expect(matchPortalId('Verizon Prepaid', PORTALS, URLS)).toBe('WebPOS');
  });
  it('exact equality beats a shorter accidental fragment', () => {
    // 'h2o' is short; ensure a carrier that IS h2o maps to H2O and nothing else.
    expect(matchPortalId('H2O', PORTALS, URLS)).toBe('H2O');
  });
});

describe('resolvePaymentPortal — one object drives display AND launch', () => {
  it('returns a structured result with matching portal + url for a known carrier', () => {
    const r = resolvePaymentPortal('verizon', PORTALS, URLS)!;
    expect(r.portalId).toBe('WebPOS');
    expect(r.label).toBe('WebPOS');
    expect(r.carrier).toBe('Verizon');       // normalized
    expect(r.url).toBe(URLS.Verizon);         // resolved via normalized key
  });

  it('vzw alias still resolves the WebPOS portal id (carrier normalizer keeps vzw as-is)', () => {
    const r = resolvePaymentPortal('vzw', PORTALS, URLS)!;
    expect(r.portalId).toBe('WebPOS');       // portal id is alias-aware
    expect(r.carrier).toBe('vzw');           // normalizeCarrier does not remap vzw (frozen util)
  });
  it('display portal and launch url come from the SAME resolution (parity)', () => {
    const r = resolvePaymentPortal('H2O', PORTALS, URLS)!;
    // If the resolved portal is H2O, the URL must be the H2O url — never Verizon's.
    expect(r.portalId).toBe('H2O');
    expect(r.url).toBe(URLS.H2O);
    expect(r.url).not.toBe(URLS.Verizon);
  });
  it('carrier with no configured portal still resolves (portalId empty, carrier kept)', () => {
    const r = resolvePaymentPortal('Cricket', PORTALS, URLS)!;
    expect(r.portalId).toBe('');
    expect(r.carrier).toBe('Cricket');
  });
  it('blank carrier → null', () => {
    expect(resolvePaymentPortal('', PORTALS, URLS)).toBeNull();
  });
  it('resolves url under the raw key when settings are keyed non-normalized', () => {
    const r = resolvePaymentPortal('verizon', PORTALS, { verizon: 'https://raw.example' })!;
    expect(r.url).toBe('https://raw.example');
  });
});

describe('payment attempt idempotency key', () => {
  it('is stable for the same (customer, phone, amount, portal)', () => {
    const a = { customerId: 'c1', phoneNumber: '(805) 570-5895', amountCents: 3000, portalId: 'H2O' };
    const b = { customerId: 'c1', phoneNumber: '8055705895', amountCents: 3000, portalId: 'H2O' };
    expect(paymentAttemptKey(a)).toBe(paymentAttemptKey(b));
  });
  it('differs when portal or amount differs (distinct attempts)', () => {
    const base = { customerId: 'c1', phoneNumber: '8055705895', amountCents: 3000, portalId: 'H2O' };
    expect(paymentAttemptKey(base)).not.toBe(paymentAttemptKey({ ...base, portalId: 'WebPOS' }));
    expect(paymentAttemptKey(base)).not.toBe(paymentAttemptKey({ ...base, amountCents: 5000 }));
  });
  it('walk-in (no customerId) still produces a stable key', () => {
    const k = paymentAttemptKey({ phoneNumber: '8055705895', amountCents: 3000, portalId: 'H2O' });
    expect(k).toContain('walkin');
  });
});

describe('runExternalPaymentLaunch — launch-first, no workflow on failure', () => {
  const resolved = { portalId: 'H2O', label: 'H2O', url: 'https://h2o.example', carrier: 'H2O' };

  it('opens the portal then begins exactly one workflow on success', () => {
    let began = 0; let openedUrl = '';
    const ok = runExternalPaymentLaunch({
      resolved, open: (u) => { openedUrl = u; return true; }, begin: () => { began += 1; }, onError: () => {},
    });
    expect(ok).toBe(true);
    expect(openedUrl).toBe('https://h2o.example');
    expect(began).toBe(1);
  });

  it('does NOT begin a workflow when the launch fails (blocked popup)', () => {
    let began = 0; let err = '';
    const ok = runExternalPaymentLaunch({
      resolved, open: () => false, begin: () => { began += 1; }, onError: (r) => { err = r; },
    });
    expect(ok).toBe(false);
    expect(began).toBe(0);
    expect(err).toBe('launch_failed');
  });

  it('does NOT begin when there is no carrier or no url', () => {
    let began = 0;
    runExternalPaymentLaunch({ resolved: null, open: () => true, begin: () => { began += 1; }, onError: () => {} });
    runExternalPaymentLaunch({ resolved: { ...resolved, url: '' }, open: () => true, begin: () => { began += 1; }, onError: () => {} });
    expect(began).toBe(0);
  });

  it('begin receives the exact launched url (frozen for resume)', () => {
    let seen = '';
    runExternalPaymentLaunch({ resolved, open: () => true, begin: (u) => { seen = u; }, onError: () => {} });
    expect(seen).toBe('https://h2o.example');
  });
});
