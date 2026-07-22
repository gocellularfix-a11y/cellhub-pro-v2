// ============================================================
// P0-C1b — pure helpers for exact phone-payment resume + sale-completion
// workflow cleanup. Framework-free (node-testable). The frozen workflow is the
// authority for a resumed attempt; the customer record is NOT re-derived when a
// valid workflow exists.
// ============================================================

import type { PendingWorkflow, ExternalPaymentMetadata } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';

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
