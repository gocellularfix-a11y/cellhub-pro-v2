// R-INTELLIGENCE-WHO-NEEDS-ATTENTION-RIGHT-NOW-V1
// Entity-level operator attention types.
//
// DISTINCT from attention/types.ts — that file models OPERATOR state
// (focused/busy/overloaded/idle/recovering). This file models ENTITY urgency:
// which specific repairs, customers, layaways, deals, or approvals require
// operator action right now.
//
// Ownership:
//   OWNS: entity urgency labels, top-N priority output shape, action metadata
//   MUST NOT: write execution logs, trigger actions, replace briefing/registry,
//             duplicate operator-state model, create new localStorage stores

export type AttentionUrgency = 'critical' | 'high' | 'medium' | 'low';

export type AttentionEntityType =
  | 'customer'
  | 'repair'
  | 'layaway'
  | 'deal'
  | 'approval';

export type AttentionSignalType =
  | 'stale_pickup'
  | 'delayed_repair'
  | 'unpaid_repair'
  | 'abandoned_layaway'
  | 'vip_inactive'
  | 'hot_deal'
  | 'critical_approval'
  | 'stale_approval';

/** Metadata-only action for UI rendering. Does NOT trigger execution. */
export interface AttentionAction {
  label: string;
  actionType: 'open_repair' | 'open_customer' | 'open_layaway' | 'whatsapp' | 'query';
  payload?: Record<string, unknown>;
}

export interface AttentionItem {
  /** Deterministic ID: `attn:{entityType}:{entityId}:{primarySignal}` */
  id: string;
  entityType: AttentionEntityType;
  entityId: string;
  entityName?: string;
  /** One-sentence reason, operator-facing, lang-aware. */
  reason: string;
  urgency: AttentionUrgency;
  /** 0–100 composite urgency score. Higher surfaces first. */
  urgencyScore: number;
  confidence: 'high' | 'medium' | 'low';
  estimatedValueCents?: number;
  /** One-sentence operator instruction. */
  recommendedAction: string;
  sourceSignals: AttentionSignalType[];
  /** Executable action metadata for UI rendering. No side effects. */
  actions?: AttentionAction[];
}

export interface EntityAttentionResult {
  generatedAt: number;
  /** Top-N items sorted by urgencyScore descending. Max 5. */
  items: AttentionItem[];
  topItem?: AttentionItem;
}
