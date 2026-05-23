// ============================================================
// CellHub Intelligence — Workflow Recommendations
// R-INTELLIGENCE-OPERATOR-WORKFLOW-CHAINING
//
// Deterministic operational sequencing. Maps each priority domain to
// the 1–3 NEXT operational steps the cashier should consider, drawn from
// a fixed rules table. NO autonomous execution, NO LLM, NO randomness —
// suggestions ONLY. Same domain → same next steps, always.
//
// Architecture: pure rules table + two tiny render helpers. Consumed by
// the existing multi-priority handlers (focusToday, whoNeedsAttention,
// nextBestAction, whatIsLosingMoney, whyDidSalesDrop) — each appends a
// "Suggested next steps" section using the TOP priority's domain.
// ============================================================

import type { ChatActionUI } from '../chat/handlers';

// ── Step definition (deterministic — no randomness) ───────

interface StepDef {
  /** Stable semantic id used for ChatActionUI.id construction. */
  id: string;
  /** i18n key for the human-facing label. */
  labelKey: string;
  /**
   * Optional executionTarget — must be a whitelisted target from the
   * existing operator-action pipeline so the button is actually clickable.
   * Omit to render the step as guidance only (no button).
   */
  executionTarget?:
    | 'open_repair'
    | 'open_customer'
    | 'open_layaway'
    | 'open_special_order'
    | 'open_inventory'
    | 'whatsapp_url'
    | 'queue_manager_review';
  confidence: 'high' | 'medium';
  /** Priority of this step within its domain. Higher = render first. */
  priorityScore: number;
}

// ── Rules table — domain → up to 3 next steps ────────────
//
// Keys mirror the FocusDomain string set used by the aggregator. Callers
// from other engines (AttentionDomain / LossCategory / DropSignalCategory)
// pass these same domain strings — see `getWorkflowSteps` arg below.
// Order within each array = render priority.

const STEPS_BY_DOMAIN: Record<string, StepDef[]> = {
  // ── Repair workflows ─────────────────────────────────
  repair_pickup: [
    { id: 'repair.contactCustomer', labelKey: 'workflow.repair.contactCustomer.label', executionTarget: 'whatsapp_url',     confidence: 'high',   priorityScore: 90 },
    { id: 'repair.confirmPickup',   labelKey: 'workflow.repair.confirmPickup.label',   executionTarget: 'open_repair',      confidence: 'high',   priorityScore: 80 },
    { id: 'repair.upsellAccessory', labelKey: 'workflow.repair.upsellAccessory.label', executionTarget: 'open_inventory',   confidence: 'medium', priorityScore: 55 },
  ],
  repair_intake: [
    { id: 'repair.promoteSpecial',  labelKey: 'workflow.repair.promoteSpecial.label',  executionTarget: 'queue_manager_review', confidence: 'medium', priorityScore: 70 },
    { id: 'repair.checkDropoffSrc', labelKey: 'workflow.repair.checkDropoffSrc.label', confidence: 'medium', priorityScore: 55 },
  ],

  // ── Customer retention workflows ─────────────────────
  customer_churn: [
    { id: 'customer.whatsappOutreach', labelKey: 'workflow.customer.whatsappOutreach.label', executionTarget: 'whatsapp_url',  confidence: 'high',   priorityScore: 95 },
    { id: 'customer.offerPromo',       labelKey: 'workflow.customer.offerPromo.label',       executionTarget: 'open_customer', confidence: 'medium', priorityScore: 70 },
    { id: 'customer.scheduleFollowup', labelKey: 'workflow.customer.scheduleFollowup.label', executionTarget: 'open_customer', confidence: 'medium', priorityScore: 60 },
  ],
  period_drop_customer: [
    { id: 'customer.whatsappOutreach', labelKey: 'workflow.customer.whatsappOutreach.label', executionTarget: 'whatsapp_url',  confidence: 'high',   priorityScore: 95 },
    { id: 'customer.offerPromo',       labelKey: 'workflow.customer.offerPromo.label',       executionTarget: 'open_customer', confidence: 'medium', priorityScore: 70 },
  ],

  // ── Inventory workflows ──────────────────────────────
  dead_stock: [
    { id: 'inventory.discount',  labelKey: 'workflow.inventory.discount.label',  executionTarget: 'open_inventory', confidence: 'high',   priorityScore: 85 },
    { id: 'inventory.bundle',    labelKey: 'workflow.inventory.bundle.label',    executionTarget: 'open_inventory', confidence: 'medium', priorityScore: 65 },
    { id: 'inventory.feature',   labelKey: 'workflow.inventory.feature.label',   executionTarget: 'open_inventory', confidence: 'medium', priorityScore: 55 },
  ],
  restock_opportunity: [
    { id: 'inventory.reorder',         labelKey: 'workflow.inventory.reorder.label',         executionTarget: 'open_inventory', confidence: 'high',   priorityScore: 95 },
    { id: 'inventory.verifySupplier',  labelKey: 'workflow.inventory.verifySupplier.label',  confidence: 'medium', priorityScore: 70 },
    { id: 'inventory.substituteSku',   labelKey: 'workflow.inventory.substituteSku.label',   executionTarget: 'open_inventory', confidence: 'medium', priorityScore: 55 },
  ],
  low_margin_items: [
    { id: 'inventory.reviewPricing',   labelKey: 'workflow.inventory.reviewPricing.label',   executionTarget: 'open_inventory', confidence: 'high',   priorityScore: 80 },
    { id: 'inventory.switchSupplier',  labelKey: 'workflow.inventory.switchSupplier.label',  confidence: 'medium', priorityScore: 60 },
  ],
  period_drop_product: [
    { id: 'inventory.reorder',         labelKey: 'workflow.inventory.reorder.label',         executionTarget: 'open_inventory', confidence: 'high',   priorityScore: 90 },
    { id: 'inventory.checkAvailability', labelKey: 'workflow.inventory.checkAvailability.label', executionTarget: 'open_inventory', confidence: 'medium', priorityScore: 65 },
  ],

  // ── Phone payment workflows ──────────────────────────
  ext_payment: [
    { id: 'phonePay.verifyPortal',   labelKey: 'workflow.phonePay.verifyPortal.label',   confidence: 'high',   priorityScore: 100 },
    { id: 'phonePay.confirmInBubble',labelKey: 'workflow.phonePay.confirmInBubble.label',confidence: 'high',   priorityScore: 90 },
    { id: 'phonePay.checkUnresolved',labelKey: 'workflow.phonePay.checkUnresolved.label',executionTarget: 'queue_manager_review', confidence: 'medium', priorityScore: 70 },
  ],
  activation_flow: [
    { id: 'phonePay.collectNextLine',  labelKey: 'workflow.phonePay.collectNextLine.label',  executionTarget: 'queue_manager_review', confidence: 'medium', priorityScore: 75 },
    { id: 'phonePay.offerAccessories', labelKey: 'workflow.phonePay.offerAccessories.label', executionTarget: 'open_inventory',       confidence: 'medium', priorityScore: 65 },
  ],

  // ── Attachment workflows ─────────────────────────────
  accessory_attach: [
    { id: 'attach.staffCoaching',  labelKey: 'workflow.attach.staffCoaching.label', confidence: 'high',   priorityScore: 85 },
    { id: 'attach.bundleReminder', labelKey: 'workflow.attach.bundleReminder.label', executionTarget: 'open_inventory', confidence: 'medium', priorityScore: 70 },
    { id: 'attach.promoteAccessories', labelKey: 'workflow.attach.promoteAccessories.label', executionTarget: 'open_inventory', confidence: 'medium', priorityScore: 60 },
  ],

  // ── Layaway / Special Order workflows ────────────────
  layaway_stale: [
    { id: 'layaway.balanceReminder',  labelKey: 'workflow.layaway.balanceReminder.label',  executionTarget: 'whatsapp_url',     confidence: 'high',   priorityScore: 85 },
    { id: 'layaway.confirmHold',      labelKey: 'workflow.layaway.confirmHold.label',      executionTarget: 'open_layaway',     confidence: 'medium', priorityScore: 65 },
  ],
  layaway_abandoned: [
    { id: 'layaway.reachActiveHolders', labelKey: 'workflow.layaway.reachActiveHolders.label', executionTarget: 'queue_manager_review', confidence: 'high',   priorityScore: 80 },
    { id: 'layaway.reviewPolicy',       labelKey: 'workflow.layaway.reviewPolicy.label',       confidence: 'medium', priorityScore: 55 },
  ],
  special_order: [
    { id: 'so.notifyCustomer',  labelKey: 'workflow.so.notifyCustomer.label',  executionTarget: 'whatsapp_url',         confidence: 'high',   priorityScore: 85 },
    { id: 'so.confirmPickup',   labelKey: 'workflow.so.confirmPickup.label',   executionTarget: 'open_special_order',   confidence: 'medium', priorityScore: 65 },
  ],

  // ── Store credit liability ───────────────────────────
  store_credit_liability: [
    { id: 'credit.reachHolders',  labelKey: 'workflow.credit.reachHolders.label',  executionTarget: 'whatsapp_url',  confidence: 'medium', priorityScore: 70 },
    { id: 'credit.reminderMsg',   labelKey: 'workflow.credit.reminderMsg.label',   executionTarget: 'open_customer', confidence: 'medium', priorityScore: 55 },
  ],

  // ── Generic / aggregate fallbacks ────────────────────
  period_drop_overall: [
    { id: 'reports.reviewBreakdown', labelKey: 'workflow.reports.reviewBreakdown.label', executionTarget: 'queue_manager_review', confidence: 'medium', priorityScore: 70 },
    { id: 'customer.whatsappOutreach', labelKey: 'workflow.customer.whatsappOutreach.label', executionTarget: 'whatsapp_url', confidence: 'medium', priorityScore: 60 },
  ],
  period_drop_category: [
    { id: 'reports.reviewBreakdown', labelKey: 'workflow.reports.reviewBreakdown.label', executionTarget: 'queue_manager_review', confidence: 'medium', priorityScore: 70 },
  ],
  period_drop_employee: [
    { id: 'employees.checkSchedule', labelKey: 'workflow.employees.checkSchedule.label', confidence: 'medium', priorityScore: 70 },
    { id: 'employees.coachUpsell',   labelKey: 'workflow.employees.coachUpsell.label',   confidence: 'medium', priorityScore: 60 },
  ],
  activity_gap: [
    { id: 'pos.checkFloor', labelKey: 'workflow.pos.checkFloor.label', confidence: 'medium', priorityScore: 60 },
  ],
};

// ── Public input/output types ────────────────────────────

export interface WorkflowContext {
  sourceIntent?: string;
  /** Domain key matching a row in STEPS_BY_DOMAIN. */
  priorityDomain?: string;
  operationalContext?: { type: string; value: string };
  executedAction?: string;
}

/**
 * Whitelist of executionTarget values this engine emits. Mirrors the
 * subset of ActionPayload.executionTarget that the workflow rules table
 * actually uses — narrowing here lets the ChatActionUI conversion site
 * pass the value through without an `as` cast.
 */
export type WorkflowExecutionTarget =
  | 'open_repair'
  | 'open_customer'
  | 'open_layaway'
  | 'open_special_order'
  | 'open_inventory'
  | 'whatsapp_url'
  | 'queue_manager_review';

export interface RecommendedWorkflowAction {
  id: string;
  label: string;
  executionTarget?: WorkflowExecutionTarget;
  confidence: 'high' | 'medium';
  priorityScore: number;
}

// ── Public helpers ───────────────────────────────────────

const MAX_STEPS = 3;

/**
 * Look up the next 1–3 deterministic operational steps for a domain.
 * Returns an empty array when:
 *   - the domain is unrecognized
 *   - the domain has no rules entry
 * Pure — no side effects, no engine reads.
 */
export function getWorkflowSteps(
  ctx: WorkflowContext,
  t: (key: string, ...args: unknown[]) => string,
): RecommendedWorkflowAction[] {
  const key = ctx.priorityDomain || '';
  const steps = STEPS_BY_DOMAIN[key] || [];
  return steps.slice(0, MAX_STEPS).map((s) => ({
    id: `wf-${key}-${s.id}`,
    label: t(s.labelKey),
    executionTarget: s.executionTarget,
    confidence: s.confidence,
    priorityScore: s.priorityScore,
  }));
}

/**
 * Render the "Suggested next steps" markdown section. Returns empty string
 * when no steps exist for the domain, so callers can append unconditionally.
 */
export function renderWorkflowChainText(
  recs: RecommendedWorkflowAction[],
  t: (key: string, ...args: unknown[]) => string,
): string {
  if (recs.length === 0) return '';
  const lines: string[] = ['', `**${t('workflow.suggestedNextSteps')}**`];
  for (let i = 0; i < recs.length; i++) {
    lines.push(`${i + 1}. ${recs[i].label}`);
  }
  return lines.join('\n');
}

/**
 * Build ChatActionUI buttons from the recommendations. Steps without an
 * executionTarget render as text-only guidance (no button). Buttons inherit
 * the optional entityId from the operational context so "open it" routes
 * through the existing entity_operational_command pipeline correctly.
 */
export function getWorkflowChatActions(
  recs: RecommendedWorkflowAction[],
  contextEntityRef?: { type: string; value: string },
): ChatActionUI[] {
  const out: ChatActionUI[] = [];
  for (const r of recs) {
    if (!r.executionTarget) continue;
    out.push({
      id: r.id,
      label: r.label,
      payload: {
        type: 'review',
        executable: true,
        executionTarget: r.executionTarget,
        ...(contextEntityRef?.value ? { entityId: contextEntityRef.value } : {}),
      },
    });
  }
  return out;
}
