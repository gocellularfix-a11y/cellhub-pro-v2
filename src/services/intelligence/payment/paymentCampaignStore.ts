// ============================================================
// PAYMENT DATE FINDER — F4: campaign persistence (localStorage)
// ============================================================
//
// Versioned localStorage store for Payment Date Finder outreach campaigns.
// Mirrors the existing intelligence store pattern (outreachOutcomeStore.ts):
// a single versioned key, parse-guarded reads, best-effort quota-safe writes,
// and a hard cap. No backend, no external services.
//
// A campaign SNAPSHOTS the finder rows at save time (so reopening shows the
// same list without re-running the engine on possibly-changed data) plus a
// per-customer action map (contacted / skipped / note / follow-up). The action
// map is keyed by customerId ONLY — this store NEVER reads, creates, or mutates
// Customer records. It is pure workflow state layered beside the customer data.
// ============================================================

import type { PaymentFinderResult, PaymentFinderStatus } from './paymentDateFinder';

// Suggested key from the F4 spec.
const STORE_KEY = 'cellhub.paymentDateCampaigns.v1';
const MAX_CAMPAIGNS = 200;

export type CampaignType = 'vacation' | 'custom' | 'holiday' | 'closure' | 'days_off';
export type CampaignStatus = 'draft' | 'active' | 'completed';

export const CAMPAIGN_TYPES: CampaignType[] = ['vacation', 'custom', 'holiday', 'closure', 'days_off'];
export const CAMPAIGN_STATUSES: CampaignStatus[] = ['draft', 'active', 'completed'];

/** Static bilingual (EN/ES/PT) labels for the campaign types — single source
 *  shared by the finder panel and the campaign dashboard (no duplication). */
export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, { en: string; es: string; pt: string }> = {
  vacation: { en: 'Vacation', es: 'Vacaciones', pt: 'Férias' },
  custom: { en: 'Custom', es: 'Personalizada', pt: 'Personalizada' },
  holiday: { en: 'Holiday', es: 'Feriado', pt: 'Feriado' },
  closure: { en: 'Closure', es: 'Cierre', pt: 'Fechamento' },
  days_off: { en: 'Days Off', es: 'Días libres', pt: 'Folga' },
};

/** Per-customer workflow state within a campaign. Keyed by customerId. */
export interface CampaignCustomerState {
  customerId: string;
  contacted?: boolean;
  contactedAt?: number;
  skipped?: boolean;
  note?: string;
  /** ISO yyyy-mm-dd follow-up date. */
  followUpDate?: string;
  updatedAt: number;
}

/** Snapshot of a finder row — the minimal fields needed to re-render + message. */
export interface CampaignCustomer {
  customerId: string;
  customerName: string;
  phone: string;
  carrier: string;
  lineCount: number;
  effectiveDueDate: string | null;
  isEstimated: boolean;
  status: PaymentFinderStatus;
  averagePaymentAmountCents: number | null;
}

export interface PaymentCampaign {
  id: string;
  name: string;
  type: CampaignType;
  reason?: string;
  status: CampaignStatus;
  // Search context that produced the snapshot (also used to rebuild messages).
  rangeStart: string; // ISO
  rangeEnd: string;   // ISO
  lang: string;
  tone: string;
  createdAt: number;
  updatedAt: number;
  customers: CampaignCustomer[];
  actions: Record<string, CampaignCustomerState>;
}

// ── Storage primitives (parse-guarded / quota-safe) ─────────────────────────

function isCampaign(c: unknown): c is PaymentCampaign {
  return (
    c !== null &&
    typeof c === 'object' &&
    typeof (c as PaymentCampaign).id === 'string' &&
    typeof (c as PaymentCampaign).name === 'string' &&
    typeof (c as PaymentCampaign).type === 'string' &&
    typeof (c as PaymentCampaign).status === 'string' &&
    Array.isArray((c as PaymentCampaign).customers) &&
    typeof (c as PaymentCampaign).actions === 'object' &&
    (c as PaymentCampaign).actions !== null
  );
}

function readStore(): PaymentCampaign[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCampaign);
  } catch { return []; }
}

function writeStore(list: PaymentCampaign[]): void {
  try {
    const trimmed = list.length > MAX_CAMPAIGNS
      ? list.slice(list.length - MAX_CAMPAIGNS)
      : list;
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch { /* quota / incognito — best-effort */ }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** All campaigns, most-recently-updated first. */
export function listCampaigns(): PaymentCampaign[] {
  return readStore().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getCampaign(id: string): PaymentCampaign | null {
  return readStore().find((c) => c.id === id) ?? null;
}

/** Upsert by id. Refreshes updatedAt. */
export function saveCampaign(campaign: PaymentCampaign, now: number = Date.now()): void {
  const list = readStore();
  const idx = list.findIndex((c) => c.id === campaign.id);
  const withTs = { ...campaign, updatedAt: now };
  if (idx >= 0) list[idx] = withTs;
  else list.push(withTs);
  writeStore(list);
}

export function deleteCampaign(id: string): void {
  writeStore(readStore().filter((c) => c.id !== id));
}

export function setCampaignStatus(
  id: string,
  status: CampaignStatus,
  now: number = Date.now(),
): PaymentCampaign | null {
  const list = readStore();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], status, updatedAt: now };
  writeStore(list);
  return list[idx];
}

/**
 * Patch a single customer's workflow state inside a campaign. Keyed by
 * customerId — NEVER touches the Customer record. Returns the updated campaign
 * (or null if the campaign is gone).
 */
export function setCustomerAction(
  campaignId: string,
  customerId: string,
  patch: Partial<Omit<CampaignCustomerState, 'customerId' | 'updatedAt'>>,
  now: number = Date.now(),
): PaymentCampaign | null {
  const list = readStore();
  const idx = list.findIndex((c) => c.id === campaignId);
  if (idx < 0) return null;
  const camp = list[idx];
  const prev = camp.actions[customerId] || { customerId, updatedAt: 0 };
  const next: CampaignCustomerState = { ...prev, ...patch, customerId, updatedAt: now };
  const updated: PaymentCampaign = {
    ...camp,
    actions: { ...camp.actions, [customerId]: next },
    updatedAt: now,
  };
  list[idx] = updated;
  writeStore(list);
  return updated;
}

/**
 * Pure builder — snapshot the current finder result into a Draft campaign.
 * `now` and `id` are injected so this is deterministic and unit-testable.
 */
export function createCampaignFromFinder(input: {
  id: string;
  now: number;
  name: string;
  type: CampaignType;
  reason?: string;
  result: PaymentFinderResult;
  lang: string;
  tone: string;
}): PaymentCampaign {
  const { id, now, name, type, reason, result, lang, tone } = input;
  const customers: CampaignCustomer[] = result.rows.map((r) => ({
    customerId: r.customerId,
    customerName: r.customerName,
    phone: r.phone,
    carrier: r.carrier,
    lineCount: r.lineCount,
    effectiveDueDate: r.effectiveDueDate,
    isEstimated: r.isEstimated,
    status: r.status,
    averagePaymentAmountCents: r.averagePaymentAmountCents,
  }));
  return {
    id,
    name: name.trim() || 'Campaign',
    type,
    reason: reason?.trim() || undefined,
    status: 'draft',
    rangeStart: result.rangeStart,
    rangeEnd: result.rangeEnd,
    lang,
    tone,
    createdAt: now,
    updatedAt: now,
    customers,
    actions: {},
  };
}

/** Progress helper — how many customers are "handled" (contacted or skipped). */
export function campaignProgress(c: PaymentCampaign): { handled: number; total: number; contacted: number; skipped: number } {
  const total = c.customers.length;
  let contacted = 0;
  let skipped = 0;
  for (const cust of c.customers) {
    const a = c.actions[cust.customerId];
    if (a?.contacted) contacted++;
    else if (a?.skipped) skipped++;
  }
  return { handled: contacted + skipped, total, contacted, skipped };
}
