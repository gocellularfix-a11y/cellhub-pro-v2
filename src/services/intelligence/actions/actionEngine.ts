// R-INTEL-PHASE3-ACTION: Action Layer — maps ActionItem → structured payload.
// Pure function, no side effects, no UI. Callers decide how to execute.
import type { ActionItem } from '../types';

export interface ActionPayload {
  type: 'whatsapp' | 'discount' | 'bundle' | 'review' | 'reminder' | 'promote_product';
  messageKey?: string;
  // R-INTELLIGENCE-PENDING-DEAL-V1: optional dynamic message text for cases
  // where the static messageKey templates can't carry per-instance details
  // (e.g., a deal's product name + price). When present, executor uses this
  // verbatim; messageKey path remains the default for existing callers.
  customMessage?: string;
  customerName?: string;
  customerId?: string;
  customerPhone?: string;
  sku?: string;
  // R-OPERATOR-EXECUTABLE-ACTIONS-V1: real inventory references for the
  // open_promote_panel hand-off. Carries the exact product so the panel
  // auto-selects with no manual search step.
  productId?: string;
  productName?: string;
  // R-OPERATOR-PROMOTE-AUTO-PREPARE-V1: optional metadata so the producer
  // (handleProductOpportunities) can communicate WHICH strategy was
  // recommended and on what channel. Consumers may show this info or
  // gate UX paths off it; it's purely informational and never required
  // for execution. preparedMessage is reserved for future flows where
  // the producer pre-builds a message draft (today the chat re-runs the
  // product-push handler on panel open to produce per-customer drafts).
  strategy?: 'targeted_whatsapp' | 'broad_campaign' | 'in_store' | 'status_post';
  recommendedChannel?: 'whatsapp' | 'whatsapp_status' | 'in_store' | 'marketplace';
  preparedMessage?: string;
  // R-INTELLIGENCE-EXECUTABLE-ACTIONS-V1: entity reference for navigation targets
  entityId?: string;
  executable: boolean;
  executionTarget:
    | 'whatsapp_url'
    | 'pos_discount'
    | 'pos_bundle'
    | 'review_panel'
    | 'reminder_queue'
    | 'open_promote_panel'
    | 'open_repair'
    | 'open_customer'
    | 'open_layaway'
    | 'open_inventory'
    | 'queue_manager_review'
    // R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: browser clipboard copy.
    // Handled client-side before executeActionPayload — executor never sees it.
    | 'copy_to_clipboard'
    | 'none';
}

export interface ActionContext {
  customerName?: string;
  sku?: string;
}

export function buildActionPayload(
  action: ActionItem,
  context: ActionContext,
): ActionPayload {
  switch (action.actionType) {
    case 'whatsapp':
      return {
        type: 'whatsapp',
        messageKey: action.messageTemplateKey,
        customerName: context.customerName,
        customerId: action.customerId,
        executable: Boolean(action.messageTemplateKey && (action.customerId || context.customerName)),
        executionTarget: 'whatsapp_url',
      };
    case 'discount':
      return {
        type: 'discount',
        sku: action.sku ?? context.sku,
        executable: Boolean(action.sku ?? context.sku),
        executionTarget: 'pos_discount',
      };
    case 'bundle':
      return {
        type: 'bundle',
        sku: action.sku ?? context.sku,
        executable: Boolean(action.sku ?? context.sku),
        executionTarget: 'pos_bundle',
      };
    case 'review':
      return {
        type: 'review',
        executable: true,
        executionTarget: 'review_panel',
      };
    case 'reminder':
      return {
        type: 'reminder',
        customerId: action.customerId,
        customerName: context.customerName,
        executable: Boolean(action.customerId || context.customerName),
        executionTarget: 'reminder_queue',
      };
    default:
      return {
        type: 'review',
        executable: false,
        executionTarget: 'none',
      };
  }
}

export function isExecutableAction(action: ActionItem): boolean {
  return Boolean(action.actionType);
}

export function getExecutionLabel(action: ActionItem): string {
  return action.actionType ?? 'review';
}
