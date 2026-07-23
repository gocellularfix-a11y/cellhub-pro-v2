// ============================================================
// Customer normalization — backfills legacy records with the
// canonical firstName/lastName/phones[]/carriers[] shape so the
// rest of the app can rely on typed fields instead of `as any`.
//
// Runs at load time (Firestore snapshot OR localStorage boot)
// and on every SET_CUSTOMERS dispatch. Idempotent — safe to
// call multiple times on the same record.
// ============================================================

import type { Customer } from '@/store/types';

/**
 * Split a full name into first/last. First token is first name,
 * the rest is last name. Handles empty strings and single-token
 * names gracefully.
 */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Build the canonical display name. Prefers firstName+lastName
 * if present, falls back to legacy `name` field.
 */
export function getCustomerFullName(c: Pick<Customer, 'firstName' | 'lastName' | 'name'>): string {
  const fn = (c.firstName || '').trim();
  const ln = (c.lastName || '').trim();
  const composed = `${fn} ${ln}`.trim();
  return composed || (c.name || '').trim();
}

/**
 * Normalize a single customer record — backfill all canonical
 * fields from legacy shapes. Runs on load so the rest of the
 * app never has to deal with `(c as any).firstName`.
 *
 * Accepts `unknown` to tolerate whatever shape came from
 * Firestore / localStorage / an old export.
 */
export function normalizeCustomer(raw: unknown): Customer {
  const c = (raw || {}) as Partial<Customer> & Record<string, unknown>;

  // ── Names ─────────────────────────────────────────────
  let firstName = typeof c.firstName === 'string' ? c.firstName.trim() : '';
  let lastName  = typeof c.lastName  === 'string' ? c.lastName.trim()  : '';
  const legacyName = typeof c.name === 'string' ? c.name.trim() : '';
  if ((!firstName && !lastName) && legacyName) {
    const split = splitName(legacyName);
    firstName = split.firstName;
    lastName  = split.lastName;
  }
  const name = `${firstName} ${lastName}`.trim() || legacyName;

  // ── Phones[] + carriers[] parallel arrays ─────────────
  const primaryPhone = typeof c.phone === 'string' ? c.phone : '';
  const rawPhones = Array.isArray(c.phones) ? c.phones.filter((p): p is string => typeof p === 'string') : [];
  const phones = rawPhones.length > 0
    ? rawPhones
    : (primaryPhone ? [primaryPhone] : ['']);

  const rawCarriers = Array.isArray(c.carriers) ? c.carriers.filter((x): x is string => typeof x === 'string') : [];
  const legacyCarrier  = typeof c.carrier  === 'string' ? c.carrier  : '';
  const legacyCarrier2 = typeof c.carrier2 === 'string' ? c.carrier2 : '';
  const carriers: string[] = [];
  for (let i = 0; i < phones.length; i++) {
    carriers[i] = rawCarriers[i] || (i === 0 ? legacyCarrier : i === 1 ? legacyCarrier2 : '') || '';
  }

  // ── Photo — unify `photo` and legacy `credentialPhoto` ─
  const photo = (typeof c.photo === 'string' && c.photo)
    || (typeof c.credentialPhoto === 'string' && c.credentialPhoto)
    || '';

  // ── R-COMMS-CONSENT-UNIFY: collapse legacy SMS opt-in fields to
  // unified communicationConsent. Lossless migration:
  //   - If new field present, use it
  //   - Else fold legacy: (smsConsent || smsOptIn) && !smsOptOut
  // legacyAdapter still preserves v1 SMS fields for backup imports.
  const newField = (c as any).communicationConsent;
  let communicationConsent: boolean;
  if (typeof newField === 'boolean') {
    communicationConsent = newField;
  } else {
    const consent = Boolean(c.smsConsent || (c as any).smsOptIn);
    const optOut = Boolean((c as any).smsOptOut);
    communicationConsent = consent && !optOut;
  }

  return {
    id: String(c.id || ''),
    storeId: typeof c.storeId === 'string' ? c.storeId : undefined,

    firstName,
    lastName,
    name,

    phone: phones[0] || '',
    phones,
    carriers,
    email: typeof c.email === 'string' ? c.email : '',

    address: typeof c.address === 'string' ? c.address : '',
    city:    typeof c.city    === 'string' ? c.city    : '',
    state:   typeof c.state   === 'string' ? c.state   : '',
    zip:     typeof c.zip     === 'string' ? c.zip     : '',

    carrier:        carriers[0] || legacyCarrier || '',
    carrier2:       carriers[1] || legacyCarrier2 || undefined,
    plan:           typeof c.plan === 'string' ? c.plan : '',
    monthlyPayment: typeof c.monthlyPayment === 'string'
      ? c.monthlyPayment
      : (typeof c.monthlyPayment === 'number' ? String(c.monthlyPayment) : ''),

    photo,
    credentialPhoto: photo, // keep both in sync for legacy readers

    loyaltyPoints:  typeof c.loyaltyPoints  === 'number' ? c.loyaltyPoints  : 0,
    storeCredit:    typeof c.storeCredit    === 'number' ? c.storeCredit    : 0,
    customerNumber: typeof c.customerNumber === 'string' ? c.customerNumber : '',
    referralCode:   typeof c.referralCode   === 'string' ? c.referralCode   : undefined,
    referredBy:     typeof c.referredBy     === 'string' ? c.referredBy     : undefined,

    notes:     typeof c.notes === 'string' ? c.notes : '',
    communicationConsent,

    // r28: preserve top-up history. Defensive — accept any shape coming
    // from Firestore/localStorage and filter to entries with a recipient.
    topUpHistory: Array.isArray(c.topUpHistory)
      ? (c.topUpHistory as unknown[])
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .map((e) => ({
            recipient: typeof e.recipient === 'string' ? e.recipient : '',
            provider:  typeof e.provider  === 'string' ? e.provider  : '',
            lastAmount: typeof e.lastAmount === 'number' ? e.lastAmount : 0,
            lastAt:    typeof e.lastAt    === 'string' ? e.lastAt    : '',
            count:     typeof e.count     === 'number' ? e.count     : 1,
          }))
          .filter((e) => e.recipient.length > 0)
      : undefined,

    // P0-SC-1.1: preserve legacy-tender redemption markers (financial
    // idempotency keys — dropping them would re-enable double debits after
    // any SET_CUSTOMERS normalize pass).
    storeCreditRedemptions: Array.isArray(c.storeCreditRedemptions)
      ? (c.storeCreditRedemptions as unknown[])
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .map((e) => ({
            saleId: typeof e.saleId === 'string' ? e.saleId : '',
            amountCents: typeof e.amountCents === 'number' ? e.amountCents : 0,
            redeemedAt: typeof e.redeemedAt === 'string' ? e.redeemedAt : '',
          }))
          .filter((e) => e.saleId.length > 0)
      : undefined,

    createdAt: (c.createdAt as Customer['createdAt']) || new Date().toISOString(),
    updatedAt: c.updatedAt as Customer['updatedAt'],
  };
}

/**
 * Batch helper — normalize an array of raw records.
 *
 * Accepts `unknown` (not `unknown[]`) so we can defensively handle
 * any garbage shape that might come from Firestore/localStorage:
 * - Array → normal path
 * - Object/dict keyed by id → converted to array of values
 * - null/undefined → empty array
 * - Anything else → empty array (and log)
 */
export function normalizeCustomers(raw: unknown): Customer[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(normalizeCustomer);
  if (typeof raw === 'object') {
    // Firestore/localStorage sometimes stores collections as dicts keyed by id
    const values = Object.values(raw as Record<string, unknown>);
    if (values.length > 0) return values.map(normalizeCustomer);
    return [];
  }
  // Anything else (string, number, function, etc.) → invalid shape
  console.warn('[normalizeCustomers] ignored non-array payload:', typeof raw, raw);
  return [];
}
