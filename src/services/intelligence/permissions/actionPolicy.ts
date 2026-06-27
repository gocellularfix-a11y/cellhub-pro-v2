// ============================================================
// R-INTELLIGENCE-V2-F1 — Shadow Policy Engine.
//
// Pure, deterministic classifier that answers, for a given Intelligence
// executionTarget: may it auto-execute, does it need approval, or is it
// disabled — and what minimum role it would require, with a reason.
//
// SHADOW MODE: this module DECIDES NOTHING at runtime. It computes a policy
// and nothing in F1 enforces it (no execution is blocked, no UI changes, no
// queue/approval changes). Enforcement is a later phase (F2). Mirrors the
// established shadow pattern of routeIntelligenceRequest() and
// computeApprovalRequirement().
//
// No I/O, no Date.now(), no randomness, no store writes. Same inputs → same
// output. Money/tax/POS/LAN untouched — financial actions are CLASSIFIED here
// (owner_only) but the real money gate stays in approvalGuard.
// ============================================================

import type { StoreSettings } from '@/store/types';
import type { OperatorRole } from '@/services/intelligence/routing/roleIntelligenceRouting';

// ── Public contract ───────────────────────────────────────────────────────────

export type PolicyGate =
  | 'auto_execute'
  | 'approval_required'
  | 'disabled';

export type PolicyRole =
  | 'any'
  | 'manager_allowed'
  | 'owner_only';

/**
 * Reason vocabulary. `reason` is a free string by contract, but resolveActionPolicy
 * only ever emits one of these tokens:
 *   read_only        — navigation / clipboard / read; no side effect.
 *   communication    — outbound customer contact (WhatsApp / notify).
 *   operational      — internal state/queue change (repair status, queue, reorder).
 *   financial        — money / discount / pricing / collection / loyalty.
 *   strategic        — owner-level strategy (pricing/margin/vendor/tax guidance).
 *   disabled_by_store — turned off via settings.intelligenceDisabledActions.
 *   unknown_action    — unregistered target → fail-safe (most restrictive).
 */
export type PolicyReason =
  | 'read_only'
  | 'communication'
  | 'operational'
  | 'financial'
  | 'strategic'
  | 'disabled_by_store'
  | 'unknown_action';

export interface ActionPolicy {
  gate: PolicyGate;
  minimumRole: PolicyRole;
  reason: string;
}

/** Settings key (double-cast — not formally on StoreSettings) listing targets the
 *  store has turned off. Default empty. */
export const INTELLIGENCE_DISABLED_ACTIONS_KEY = 'intelligenceDisabledActions' as const;

// ── Intrinsic policy table ──────────────────────────────────────────────────────
// One entry per executable executionTarget (see actionExecutor.ts / the action
// registry). The policy is INTRINSIC to the action — it does not depend on who is
// asking; the caller compares operatorRole against minimumRole when (later) enforcing.

const AUTO_ANY = (reason: PolicyReason): ActionPolicy =>
  ({ gate: 'auto_execute', minimumRole: 'any', reason });
const APPROVAL_MANAGER = (reason: PolicyReason): ActionPolicy =>
  ({ gate: 'approval_required', minimumRole: 'manager_allowed', reason });
const APPROVAL_OWNER = (reason: PolicyReason): ActionPolicy =>
  ({ gate: 'approval_required', minimumRole: 'owner_only', reason });

const POLICY_BY_TARGET: Readonly<Record<string, ActionPolicy>> = {
  // ── read-only / navigation / clipboard → auto, any ──
  open_customer:       AUTO_ANY('read_only'),
  open_repair:         AUTO_ANY('read_only'),
  open_layaway:        AUTO_ANY('read_only'),
  open_unlock:         AUTO_ANY('read_only'),
  open_special_order:  AUTO_ANY('read_only'),
  open_inventory:      AUTO_ANY('read_only'),
  open_sale:           AUTO_ANY('read_only'),
  view_receipt:        AUTO_ANY('read_only'),
  open_promote_panel:  AUTO_ANY('read_only'),
  copy_to_clipboard:   AUTO_ANY('read_only'),
  review_panel:        AUTO_ANY('read_only'),
  none:                AUTO_ANY('read_only'),

  // ── internal operational (queue/log only, no customer contact, no money) → auto, any ──
  add_to_operator_queue:   AUTO_ANY('operational'),
  queue_manager_review:    AUTO_ANY('operational'),
  reminder_queue:          AUTO_ANY('operational'),
  record_outreach_outcome: AUTO_ANY('operational'),

  // ── communication (outbound customer contact) → approval, manager ──
  whatsapp_url:    APPROVAL_MANAGER('communication'),
  notify_customer: APPROVAL_MANAGER('communication'),

  // ── operational mutation / marketing / purchasing → approval, manager ──
  mark_repair_ready: APPROVAL_MANAGER('operational'),
  escalate_repair:   APPROVAL_MANAGER('operational'),
  promote_product:   APPROVAL_MANAGER('operational'),
  reorder_product:   APPROVAL_MANAGER('operational'),

  // ── financial (money / discount / pricing / collection / loyalty) → approval, owner ──
  pos_discount:           APPROVAL_OWNER('financial'),
  pos_bundle:             APPROVAL_OWNER('financial'),
  discount_product:       APPROVAL_OWNER('financial'),
  collect_payment:        APPROVAL_OWNER('financial'),
  collect_layaway_payment:APPROVAL_OWNER('financial'),
  customer_loyalty_reward:APPROVAL_OWNER('financial'),
};

/** All targets that carry an intrinsic policy (excludes the unknown fallback). */
export const POLICY_KNOWN_TARGETS: readonly string[] = Object.keys(POLICY_BY_TARGET);

// ── Store kill-switch ──────────────────────────────────────────────────────────

function readDisabledTargets(
  settings: StoreSettings | Record<string, unknown> | null | undefined,
): Set<string> {
  if (!settings) return new Set();
  const raw = (settings as Record<string, unknown>)[INTELLIGENCE_DISABLED_ACTIONS_KEY];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x): x is string => typeof x === 'string'));
}

// ── Resolver ────────────────────────────────────────────────────────────────────

/**
 * Resolve the (shadow) policy for an executionTarget.
 *
 * @param executionTarget action target string (e.g. 'whatsapp_url', 'pos_discount').
 * @param operatorRole    the acting operator's role. Accepted for API stability with
 *                        the future enforcement caller / shadow-log context; the
 *                        returned policy is INTRINSIC to the target and is NEVER used
 *                        to deny here (F1 is shadow — nothing is blocked).
 * @param settings        store settings; only intelligenceDisabledActions is read.
 *
 * Precedence: store-disabled > intrinsic table > unknown fail-safe.
 */
export function resolveActionPolicy(
  executionTarget: string,
  operatorRole: OperatorRole,
  settings?: StoreSettings | Record<string, unknown> | null,
): ActionPolicy {
  // operatorRole is intentionally not consulted in F1 — the policy is intrinsic
  // and shadow-only. Referencing it keeps it a used parameter and documents intent.
  void operatorRole;

  const target = String(executionTarget || '').trim();

  // 1. Store kill-switch wins — an explicitly disabled target is disabled
  //    regardless of its intrinsic classification.
  if (target && readDisabledTargets(settings).has(target)) {
    return { gate: 'disabled', minimumRole: 'owner_only', reason: 'disabled_by_store' };
  }

  // 2. Intrinsic policy.
  const base = POLICY_BY_TARGET[target];
  if (base) return { ...base };

  // 3. Unknown / unregistered target → fail-safe (most restrictive). Shadow only;
  //    nothing is denied in F1, but if a later phase enforces, an unknown action
  //    defaults to owner approval rather than silent auto-execute.
  return { gate: 'approval_required', minimumRole: 'owner_only', reason: 'unknown_action' };
}

/**
 * Dev-only shadow log of a resolved policy. Observation only — never blocks,
 * mirrors routeIntelligenceRequest()/logApprovalRequirementShadow(). No-op
 * outside dev builds. Ready for F2 to call at the execution boundary.
 */
export function logActionPolicyShadow(executionTarget: string, policy: ActionPolicy): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.debug('[IntelligencePolicy:shadow]', executionTarget, policy.gate, policy.minimumRole, policy.reason);
}
