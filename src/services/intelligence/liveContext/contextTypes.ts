// ============================================================
// CellHub Pro — Live Context Types (R-INTELLIGENCE-LIVE-CONTEXT-V1)
// Pure TypeScript types — no React, no DOM, no I/O.
// ============================================================

/** Matches AppState.activeTab values (pos, repairs, customers, …) */
export type LiveModule = string;

/** Minimal customer record — IDs + display info only, no financial data */
export interface LiveCustomer {
  id: string;
  name: string;
  phone?: string;
  /** ms epoch — when this customer was last set as active */
  lastInteractionAt: number;
}

/** Minimal product record — structural info only */
export interface LiveProduct {
  sku?: string;
  imei?: string;
  name: string;
  category?: string;
}

/**
 * Lightweight cart metadata — structural flags only.
 * Financial totals intentionally absent; POS module owns all math.
 */
export interface LiveCartMeta {
  itemCount: number;
  hasRepairItems: boolean;
  hasPhonePayments: boolean;
  hasAccessories: boolean;
}

export type LiveActionType =
  | 'customer_selected'
  | 'customer_searched'
  | 'repair_opened'
  | 'repair_completed'
  | 'layaway_opened'
  | 'layaway_payment_started'
  | 'payment_started'
  | 'item_added'
  | 'discount_attempted'
  | 'approval_requested'
  | 'approval_accepted'
  | 'approval_denied'
  | 'sale_completed'
  | 'unlock_submitted'
  | 'special_order_created'
  | 'return_processed'
  | 'appointment_booked'
  | 'module_changed'
  | 'phone_number_entered'
  | 'customer_history_opened'
  | 'inventory_lookup'
  | string; // forward-compat

export interface LiveAction {
  /** ms epoch */
  timestamp: number;
  type: LiveActionType;
  /** activeModule at the time of the action */
  module: string;
  /** Small identifiers and flags only — never full records */
  metadata?: Record<string, string | number | boolean>;
}

export interface LiveSessionTimeline {
  lastCustomerId: string | null;
  lastRepairId: string | null;
  lastSearchedPhone: string | null;
  lastViewedItemSku: string | null;
  /** ms epoch — reset to Date.now() on every app load */
  sessionStartAt: number;
}

export interface LiveContext {
  activeModule: string;
  activeCustomer: LiveCustomer | null;
  activeProduct: LiveProduct | null;
  /** null when cart is empty or POS is not the active module */
  cart: LiveCartMeta | null;
  /** Most-recent first. Capped at MAX_ACTIONS. */
  recentActions: LiveAction[];
  activeEmployeeId: string | null;
  activeEmployeeName: string | null;
  session: LiveSessionTimeline;
  /** ms epoch — last time any field was updated */
  updatedAt: number;
}

export type ContextSuggestionKind =
  | 'upsell'
  | 'follow_up'
  | 'collect'
  | 'retention'
  | 'operational';

export interface ContextSuggestion {
  id: string;
  text: string;
  detail?: string;
  kind: ContextSuggestionKind;
  /** 1–10, higher = rendered first */
  priority: number;
  /** If set, clicking the suggestion navigates to this tab */
  actionTab?: string;
  /** Machine-readable key for future extensibility */
  actionKey?: string;
}
