// ============================================================
// P0-C1b — pure helpers for exact phone-payment resume + sale-completion
// workflow cleanup. Framework-free (node-testable). The frozen workflow is the
// authority for a resumed attempt; the customer record is NOT re-derived when a
// valid workflow exists.
// ============================================================

import type { PendingWorkflow, ExternalPaymentMetadata } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';
import type { CartItem, StoreSettings } from '@/store/types';
import { normalizeCarrier, normalizePhone, formatPhone } from '@/utils/normalize';

/**
 * P0-C1c (F-E) — THE single canonical key for associating a line's workflowId
 * in lineWorkflowIds. Every read/write of that map MUST route through this so a
 * workflow stamped under one phone format is found under any equivalent format.
 *
 * Mirrors normalizePhone() semantics exactly (strip a leading US country code
 * from an 11-digit +1 number, otherwise take the last 10 digits) so it never
 * disagrees with the rest of the phone-payment pipeline:
 *   `(805) 555-1212` · `805-555-1212` · `8055551212` · `+1 805 555 1212`
 * all collapse to `8055551212`. The prior mix of sanitizePhone (FIRST 10 digits)
 * and normalizePhone (LAST 10 after stripping +1) diverged on 11-digit input,
 * so a resumed attempt could look up the wrong (or no) workflow.
 *
 * Safe for malformed input: empty / <10 digits → the raw digits (never a
 * partial key that could collide with a different valid line); >11 → last 10.
 */
export function phonePaymentLineKey(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const trimmed = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return trimmed.length > 10 ? trimmed.slice(-10) : trimmed;
}

/** The exact intent restored into the modal from a frozen workflow. */
export interface ResumeRestore {
  workflowId: string;
  phoneNumber: string;
  transactionCarrier: string;
  amountCents: number;
  portalId: string;
  portalUrl: string;
  lineIndex: number;
  totalLines: number;
  customerId: string;
}

export type ResumeResolution =
  | { ok: true; restore: ResumeRestore }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'expired' | 'invalid_metadata' };

/**
 * Decide whether a workflow can be resumed as an ACTIVE attempt, and extract
 * the exact frozen intent. A completed / cancelled / (status- or TTL-)expired
 * workflow is never restored as active. `nowMs` is injected for determinism.
 */
export function resolveResumeAttempt(w: PendingWorkflow | null, nowMs: number): ResumeResolution {
  if (!w) return { ok: false, reason: 'not_found' };
  if (w.type !== 'external_payment') return { ok: false, reason: 'invalid_metadata' };
  if (w.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (nowMs >= w.expiresAt) return { ok: false, reason: 'expired' };
  const m = w.metadata as ExternalPaymentMetadata;
  if (!m || !m.phone || !m.carrier) return { ok: false, reason: 'invalid_metadata' };
  return {
    ok: true,
    restore: {
      workflowId: w.id,
      phoneNumber: m.phone,
      transactionCarrier: m.carrier,
      amountCents: typeof m.amountCents === 'number' ? m.amountCents : 0,
      portalId: m.portalId ?? '',
      portalUrl: m.portalUrl ?? '',
      lineIndex: typeof m.lineIndex === 'number' ? m.lineIndex : 0,
      totalLines: typeof m.totalLines === 'number' ? m.totalLines : 1,
      customerId: m.customerId ?? '',
    },
  };
}

/**
 * P0-C1c (F-A/F-D) — build the SINGLE cart line for a frozen resumed attempt
 * from its FROZEN metadata (carrier, amount, portalId, workflowId), NEVER from
 * the current customer carrier / monthly amount / last payment / current portal
 * settings. Pure & deterministic (the caller stamps the `id`). The commission
 * rate uses the existing carrier→rate rule (frozen carrier drives the lookup);
 * no money/tax math changes. This is what lets a Known-Lines customer's resumed
 * attempt reach the cart instead of the empty known/multi branch.
 */
export function buildResumedCartItemFields(
  r: ResumeRestore,
  settings: Pick<StoreSettings, 'carrierCommissions' | 'defaultCommissionRate'>,
  note: string,
): Omit<CartItem, 'id'> {
  const phone = normalizePhone(r.phoneNumber);
  const normalizedCarrier = normalizeCarrier(r.transactionCarrier);
  const priceCents = r.amountCents;
  const commRate = (settings?.carrierCommissions?.[normalizedCarrier]
    ?? settings?.defaultCommissionRate
    ?? 0.07);
  return {
    name: `${normalizedCarrier} - ${formatPhone(phone)}`,
    category: 'phone_payment',
    price: priceCents,
    cost: Math.round(priceCents * (1 - commRate)),
    qty: 1,
    taxable: false,
    cbeEligible: false,
    carrier: normalizedCarrier,
    phoneNumber: phone,
    commissionRate: commRate,
    notes: note,
    // F-A: frozen portalId (never re-derived from current settings).
    ...(r.portalId ? { portal: r.portalId } : {}),
    // Frozen workflow identity → SaleItem → sale completion closes it.
    workflowId: r.workflowId,
  };
}

/**
 * The distinct workflowIds of SOLD phone-payment sale items — the exact set to
 * complete on sale completion. Only phone_payment lines with a stamped
 * workflowId; deduped so two lines of the same workflow complete it once.
 * Pure — the caller (POSModule) performs the completeWorkflow() side effects.
 */
export function collectPhonePaymentWorkflowIds(
  items: Array<{ category?: string; workflowId?: string }>,
): string[] {
  const ids = items
    .filter((i) => i.category === 'phone_payment' && !!i.workflowId)
    .map((i) => i.workflowId as string);
  return [...new Set(ids)];
}
