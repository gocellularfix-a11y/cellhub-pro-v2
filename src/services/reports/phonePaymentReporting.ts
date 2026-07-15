// ============================================================
// R-2.1.4-REPORTS-ACTIVATION-CLASSIFICATION-V1
// Pure phone-payment / activation reporting aggregation.
//
// Root cause fixed here: "Activations by Carrier" was built INSIDE the
// phone_payment item branch of ReportsModule's stats loop, so every bill
// payment (a phone_payment item that merely carries a carrier name) was
// counted as an activation. The two sections were the same dataset grouped
// two ways (by portal vs by carrier) and their totals matched exactly.
//
// Canonical semantics (matches ReceiptModal + IntelligenceModule detection):
//   - GENUINE ACTIVATION line = category 'activation' | category 'sim'
//     | isActivation === true (stamped by PhonePaymentModal's Activation tab).
//   - PHONE PAYMENT line = classifyItem() === 'phone_payment' AND NOT an
//     activation line. (The Activation tab's plan line uses category
//     'phone_payment' + isActivation:true — it belongs to Activations, not
//     to Phone Payments by Provider.)
//
// ALL money in CENTS (integer). No mutation of inputs.
// ============================================================

import type { Sale, SaleItem, StoreSettings } from '@/store/types';
import { normalizeCarrier } from '@/utils/normalize';
import { getDefaultPortalId } from '@/config/paymentPortals';
import type { PaymentPortal } from '@/config/paymentPortals';

// ── Item classification (moved verbatim from ReportsModule) ──

/** Item type detection — handles legacy `type` and v2 `category` fields. */
export type ItemKind = 'phone_payment' | 'topup' | 'repair' | 'unlock' | 'special_order' | 'cc_fee' | 'service' | 'product' | 'exchange_credit';

export function classifyItem(item: SaleItem): ItemKind {
  const cat = String(item.category || '').toLowerCase();
  // legacy `type` field on sale items (not in TS type, but lives in real data)
  const type = String((item as unknown as { type?: string }).type || '').toLowerCase();

  if (type === 'phone_payment' || cat === 'phone_payment') return 'phone_payment';
  if (type === 'topup' || cat === 'topup' || cat === 'top_up' || cat === 'top-up') return 'topup';
  if (type === 'repair' || item.repairId) return 'repair';
  if (type === 'unlock' || item.unlockId) return 'unlock';
  if (type === 'special_order' || item.specialOrderId) return 'special_order';
  if (cat === 'exchange_credit') return 'exchange_credit';
  if (type === 'service' || cat === 'service' || cat === 'services') {
    // legacy services that are actually repairs
    const n = (item.name || '').toLowerCase();
    if (n.includes('exchange credit') || n.includes('crédito cambio') || n.includes('crédito troca')) return 'exchange_credit';
    if (n.includes('repair') || n.includes('reparación')) return 'repair';
    // R-REPORTS-LAYAWAY-CATEGORY-FIX: "UNLOCKED" in a product name (e.g.
    // "SAMSUNG GALAXY S24 ULTRA UNLOCKED — Layaway") is a product attribute,
    // NOT a service-category signal. Skip name-based unlock detection when
    // the item carries an explicit layawayId — those are layaway payments
    // and must bucket under 'Layaway' (catName override below).
    if (!item.layawayId && (n.includes('unlock') || n.includes('desbloqueo'))) {
      // R-LAYAWAY-GUARD: prevent false unlock classification for layaway-related items
      if (n.includes('layaway') || n.includes('apartado')) return 'service';
      return 'unlock';
    }
    return 'service';
  }
  return 'product';
}

/**
 * A sale item that is part of a genuine activation flow. Same triple test the
 * receipt's NEW PHONE NUMBER block and IntelligenceModule use — the explicit
 * semantic type, never "contains a carrier name".
 */
export function isActivationSaleItem(item: SaleItem): boolean {
  const cat = String(item.category || '').toLowerCase();
  return cat === 'activation'
    || cat === 'sim'
    || (item as unknown as { isActivation?: boolean }).isActivation === true;
}

export function normalizeCarrierName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase().replace(/\s+/g, '');
  if (s === 'T' || lower === 'tmobile' || lower === 't-mobile') return 'T-Mobile';
  if (s === 'V' || lower === 'verizon' || lower === 'vzw') return 'Verizon';
  if (s === 'A' || lower === 'at&t' || lower === 'att') return 'AT&T';
  if (lower.includes('h2o')) return 'H2O';
  if (lower.includes('pageplus')) return 'Page Plus';
  if (lower.includes('simplemobile')) return 'Simple Mobile';
  if (lower.includes('cricket')) return 'Cricket';
  if (lower.includes('ultra')) return 'Ultra Mobile';
  if (lower.includes('tracfone')) return 'Tracfone';
  if (lower.includes('telcel')) return 'Telcel';
  return s;
}

// R-2.1.4-CLOSEOUT: canonical Sales-by-Category bucket for activation-flow
// lines. A plan line (category 'phone_payment' + isActivation), an activation
// fee ('activation') and a SIM ('sim') all belong to the Activation sale
// flow — never to ordinary "Phone Payments" and never as raw lowercase
// category names. Single source: the reports loop and its drilldown both
// call this; money math is untouched (only the display bucket changes).
export const ACTIVATIONS_CATEGORY = 'Activations';

export function reportCategoryOverride(item: SaleItem): string | null {
  return isActivationSaleItem(item) ? ACTIVATIONS_CATEGORY : null;
}

/** Item line revenue in CENTS. Single source of truth. */
export function lineRevenueCents(item: SaleItem): number {
  return (item.price || 0) * (item.qty || (item as unknown as { quantity?: number }).quantity || 1);
}

/**
 * Known-carrier substring matcher shared by the commission fallback (BUG-3)
 * and the detail-row carrier resolution. Single source — extend HERE only.
 */
export const KNOWN_CARRIER_NAME_RE =
  /\b(h2o|t-?mobile|verizon|at&?t|cricket|tracfone|page\s*plus|simple\s*mobile|ultra(?:\s+mobile)?|telcel|boost|metro(?:\s*pcs)?|mint\s*mobile|visible)\b/i;

/**
 * Carrier for DISPLAY on a detail row: the carrier stored on the transaction,
 * else a KNOWN carrier found in the item name (legacy records). Never the
 * whole item name — an unrecognizable carrier renders "Not recorded" instead
 * of junk like "Bill payment". (Provider bucketing keeps its own legacy
 * name-prefix derivation unchanged — this is presentation-honesty only.)
 */
export function resolveDetailCarrier(item: SaleItem): string {
  const stored = (item.carrier || '').trim();
  if (stored) return normalizeCarrierName(stored);
  if (item.name) {
    const m = String(item.name).match(KNOWN_CARRIER_NAME_RE);
    if (m) return normalizeCarrierName(m[1]);
  }
  return '';
}

// ── Per-item economics (moved verbatim from the phone_payment branch) ──

export interface PhonePaymentEconomics {
  commRate: number;
  costCents: number;
  profitCents: number;
  revenueCents: number;
  normalizedCarrier: string;
}

type CommissionSettings = Pick<StoreSettings, 'carrierCommissions' | 'defaultCommissionRate'>;

export function computePhonePaymentEconomics(item: SaleItem, settings: CommissionSettings): PhonePaymentEconomics {
  const revenueCents = lineRevenueCents(item);
  // R-COMMISSION-FIX-WRITE-AND-READ: align with TaxReportsModule.
  // Trust stamped item.commissionRate first (transaction-time
  // accounting standard). Recompute only if missing or invalid.
  let commRate = (item as unknown as { commissionRate?: number }).commissionRate;
  if (commRate == null || commRate === 0) {
    let rawCarrier = ((item as unknown as { carrier?: string; carrierName?: string; provider?: string }).carrier
      || (item as unknown as { carrierName?: string }).carrierName
      || (item as unknown as { provider?: string }).provider
      || '').trim();
    if (!rawCarrier && item.name) {
      const match = String(item.name).match(/^([A-Za-z0-9\s&]+?)(?:\s*[-–]\s*|\s+Bill Payment)/i);
      if (match) rawCarrier = match[1].trim();
    }
    // BUG-3 (R-INV-BUGS): broader fallback for legacy phone_payment
    // sales whose carrier field is blank AND whose name doesn't fit
    // the "Carrier - phone" / "Carrier Bill Payment" prefix shape
    // (e.g. "H2O Wireless 25", "Verizon Refill"). Searches for any
    // known-carrier substring inside the item name; normalizeCarrier
    // below canonicalizes the match (h2o → 'H2O', etc.) so the
    // settings.carrierCommissions lookup hits.
    if (!rawCarrier && item.name) {
      const knownMatch = String(item.name).match(KNOWN_CARRIER_NAME_RE);
      if (knownMatch) rawCarrier = knownMatch[1].trim();
    }
    const normalized = normalizeCarrier(rawCarrier);
    const carrierRate = normalized
      ? settings.carrierCommissions?.[normalized]
      : undefined;
    commRate = carrierRate
      ?? settings.defaultCommissionRate
      ?? 0.07;
  }
  // Carrier name is still computed (kept for provider lookup downstream)
  let carrierName = item.carrier || '';
  if (!carrierName && item.name) carrierName = item.name.split('-')[0].trim();
  const normalizedCarrier = normalizeCarrierName(carrierName);
  const costCents = Math.round(revenueCents * (1 - commRate));
  const profitCents = revenueCents - costCents;
  return { commRate, costCents, profitCents, revenueCents, normalizedCarrier };
}

// ── Aggregation ──────────────────────────────────────────────

/** One detail row per phone-payment transaction line (never merged). */
export interface PhonePaymentDetail {
  saleId: string;
  invoice: string;       // '' when not recorded
  timeISO: string;       // '' when the sale has no parseable createdAt
  phoneNumber: string;   // '' when not recorded (renderers show "Not recorded")
  carrier: string;       // '' when not recorded
  amountCents: number;
  profitCents: number;
}

export interface ProviderBucket {
  count: number;
  totalCents: number;
  profitCents: number;
  numbers: Set<string>;
  details: PhonePaymentDetail[];
}

export interface ActivationCarrierBucket {
  /** Activation EVENTS (one per activated line), not raw item lines. */
  count: number;
  totalCents: number;
  profitCents: number;
  numbers: Set<string>;
}

export interface PhoneActivityAggregation {
  phonePaymentsByProvider: Record<string, ProviderBucket>;
  activationsByCarrier: Record<string, ActivationCarrierBucket>;
}

// ── Printed "Activations by Carrier" model (R-2.1.4-PRINT-PAGES Phase 4) ──
// Pure projection of the SAME aggregation buckets the on-screen card uses,
// so the printed section can never drift from the interactive report.

export interface ActivationsPrintRow {
  carrier: string;
  count: number;
  totalCents: number;
  profitCents: number;
  marginPct: number;       // computed from exact integer cents
  uniqueNumbers: number;
}

export interface ActivationsPrintModel {
  rows: ActivationsPrintRow[]; // sorted by totalCents descending
  totals: { count: number; totalCents: number; profitCents: number; marginPct: number; uniqueNumbers: number };
}

export function buildActivationsByCarrierPrintModel(
  activationsByCarrier: Record<string, ActivationCarrierBucket>,
): ActivationsPrintModel {
  const rows: ActivationsPrintRow[] = Object.entries(activationsByCarrier)
    .map(([carrier, b]) => ({
      carrier,
      count: b.count,
      totalCents: b.totalCents,
      profitCents: b.profitCents,
      marginPct: b.totalCents > 0 ? (b.profitCents / b.totalCents) * 100 : 0,
      uniqueNumbers: b.numbers.size,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
  const allNumbers = new Set<string>();
  for (const b of Object.values(activationsByCarrier)) {
    for (const n of b.numbers) allNumbers.add(n);
  }
  const totals = {
    count: rows.reduce((s, r) => s + r.count, 0),
    totalCents: rows.reduce((s, r) => s + r.totalCents, 0),
    profitCents: rows.reduce((s, r) => s + r.profitCents, 0),
    marginPct: 0,
    uniqueNumbers: allNumbers.size,
  };
  totals.marginPct = totals.totalCents > 0 ? (totals.profitCents / totals.totalCents) * 100 : 0;
  return { rows, totals };
}

function saleTimeISO(createdAt: unknown): string {
  if (!createdAt) return '';
  try {
    if (createdAt instanceof Date) return isNaN(createdAt.getTime()) ? '' : createdAt.toISOString();
    if (typeof createdAt === 'object' && 'toDate' in (createdAt as object)
        && typeof (createdAt as { toDate: unknown }).toDate === 'function') {
      const d = (createdAt as { toDate: () => Date }).toDate();
      return isNaN(d.getTime()) ? '' : d.toISOString();
    }
    if (typeof createdAt === 'string' || typeof createdAt === 'number') {
      const d = new Date(createdAt);
      return isNaN(d.getTime()) ? '' : d.toISOString();
    }
  } catch { /* fall through */ }
  return '';
}

/**
 * Aggregate phone payments (by portal/provider) and genuine activations
 * (by carrier) from an already-filtered, countable sales list.
 *
 * Guarantees:
 *   - A transaction line lands in EXACTLY one of the two buckets — never both.
 *   - Provider bucket count === details.length; totalCents/profitCents are the
 *     exact integer-cent sums of the detail rows (reconciliation invariant).
 *   - Activation count = distinct activation events. Multi-line items of one
 *     activation (plan + fee + SIM sharing a phoneNumber within one sale)
 *     count ONCE; each activated phone line counts once per sale. Items with
 *     no phone number can't be linked, so each counts as its own event.
 */
export function aggregatePhoneActivity(
  sales: Sale[],
  settings: CommissionSettings,
  activePortals: PaymentPortal[],
  carrierPortalUrls: Record<string, string>,
  labels: { noProvider: string; noCarrier: string },
): PhoneActivityAggregation {
  const phonePaymentsByProvider: Record<string, ProviderBucket> = {};
  const activationsByCarrier: Record<string, ActivationCarrierBucket> = {};
  // Activation event dedup, keyed per carrier bucket:
  const activationEvents: Record<string, Set<string>> = {};

  for (const sale of sales) {
    for (const item of (sale.items || [])) {
      const kind = classifyItem(item);
      const isActivation = isActivationSaleItem(item);
      if (kind !== 'phone_payment' && !isActivation) continue;

      const qty = item.qty || (item as unknown as { quantity?: number }).quantity || 1;

      let revenueCents: number;
      let profitCents: number;
      let carrier: string;
      if (kind === 'phone_payment') {
        const eco = computePhonePaymentEconomics(item, settings);
        revenueCents = eco.revenueCents;
        profitCents = eco.profitCents;
        carrier = eco.normalizedCarrier;
      } else {
        // Activation fee ('activation') / SIM ('sim') lines. Cost comes from
        // the stamped item.cost when present (fee lines are 100% owner profit
        // — no cost is stamped, so profit === revenue, matching the POS
        // contract "Activation / SIM / setup fee — 100% profit for the owner").
        revenueCents = lineRevenueCents(item);
        profitCents = revenueCents - ((item.cost || 0) * qty);
        // Activation lines get their carrier stamped by PhonePaymentModal.
        // No name-guessing here: a missing carrier is reported as missing,
        // never inferred from free text.
        carrier = normalizeCarrierName(item.carrier || '');
      }

      if (isActivation) {
        const carrierKey = carrier || labels.noCarrier;
        if (!activationsByCarrier[carrierKey]) {
          activationsByCarrier[carrierKey] = { count: 0, totalCents: 0, profitCents: 0, numbers: new Set() };
          activationEvents[carrierKey] = new Set();
        }
        const bucket = activationsByCarrier[carrierKey];
        // One event per activated line: sale + phone number. Lines without a
        // phone number can't be linked to a sibling line — count individually.
        const eventKey = `${sale.id}|${item.phoneNumber || `item:${item.id}`}`;
        if (!activationEvents[carrierKey].has(eventKey)) {
          activationEvents[carrierKey].add(eventKey);
          bucket.count += 1;
        }
        bucket.totalCents += revenueCents;
        bucket.profitCents += profitCents;
        if (item.phoneNumber) bucket.numbers.add(item.phoneNumber);
        continue;
      }

      // Genuine phone payment → provider bucket.
      // Resolve provider: prefer item.portal (set by PhonePaymentModal
      // on new sales). For legacy sales without portal, derive it
      // from the carrier via the same matching logic the modal uses.
      let provider = (item.portal || '').trim();
      if (!provider && carrier) {
        provider = getDefaultPortalId(carrier, activePortals, carrierPortalUrls);
      }
      if (!provider) provider = labels.noProvider;

      if (!phonePaymentsByProvider[provider]) {
        phonePaymentsByProvider[provider] = { count: 0, totalCents: 0, profitCents: 0, numbers: new Set(), details: [] };
      }
      const bucket = phonePaymentsByProvider[provider];
      bucket.count += qty;
      bucket.totalCents += revenueCents;
      bucket.profitCents += profitCents;
      if (item.phoneNumber) bucket.numbers.add(item.phoneNumber);
      bucket.details.push({
        saleId: sale.id,
        invoice: sale.invoiceNumber || '',
        timeISO: saleTimeISO(sale.createdAt),
        phoneNumber: item.phoneNumber || '',
        carrier: resolveDetailCarrier(item),
        amountCents: revenueCents,
        profitCents,
      });
    }
  }

  return { phonePaymentsByProvider, activationsByCarrier };
}
