// ============================================================
// CellHub Pro — Companion Event Layer Types
// (R-COMPANION-EVENT-LAYER-V1)
//
// Desktop-side shell only. These types describe events the future
// Companion mobile app will consume — emitted today as in-memory
// pub/sub via companionEventBus, queued in companionMockBridge.
// Cero networking, cero persistence, cero mobile code.
// ============================================================

/** High-level grouping for filtering / UI surfaces. */
export type CompanionEventCategory =
  | 'approvals'
  | 'messaging'
  | 'store_status'
  | 'intelligence_alerts';

/** Specific event names. Append-only — new event types add here. */
export type CompanionEventType =
  | 'APPROVAL_CREATED'
  | 'APPROVAL_APPROVED'         // R-COMPANION-APPROVAL-EMITTERS-V1
  | 'APPROVAL_DENIED'           // R-COMPANION-APPROVAL-EMITTERS-V1
  | 'APPROVAL_UPDATED'
  | 'MESSAGE_SENT'
  | 'MESSAGE_RECEIVED'
  | 'STORE_OPENED'              // R-COMPANION-STORE-STATUS-EMITTERS-V1
  | 'STORE_CLOSED'              // R-COMPANION-STORE-STATUS-EMITTERS-V1
  | 'STORE_STATUS_UPDATED'
  | 'INTELLIGENCE_ALERT_CREATED';

// ── Payload shapes per category ───────────────────────────
// IDs only — cero PII (no names, no notes, no phone numbers). The
// future Companion mobile app will look records up from synced state.

export interface CompanionApprovalPayload {
  approvalId: string;
  /** matches ApprovalActionType union — CANCEL_LAYAWAY etc. */
  actionType?: string;
  requestedByEmployeeId?: string;
  /** R-COMPANION-APPROVAL-EMITTERS-V1: id of the approver on success
   *  (or 'approver:admin' for admin PIN fallback). */
  approvedByEmployeeId?: string;
  /** R-COMPANION-APPROVAL-EMITTERS-V1: terminal reason on DENIED
   *  events — 'cancelled' | 'timeout' | 'invalid_pin' |
   *  'self_approval_blocked'. Kept as a string union-of-strings so
   *  future denial reasons don't require a type rev. */
  reason?: string;
  /** R-COMPANION-APPROVAL-EMITTERS-V1: source module name derived
   *  from actionType ('layaways', 'repairs', 'unlocks',
   *  'specialOrders', 'pos', 'returns'). Cero PII. */
  source?: string;
  status?: 'pending' | 'approved' | 'denied';
}

export interface CompanionMessagePayload {
  messageId: string;
  /** R-COMPANION-MESSAGING-EMITTERS-V1: outbound = desktop sent it,
   *  inbound = desktop received it. Mirrors the MESSAGE_SENT /
   *  MESSAGE_RECEIVED event types but lives in the payload too so
   *  consumers filtering by direction don't have to switch on type. */
  direction?: 'outbound' | 'inbound';
  /** R-COMPANION-MESSAGING-EMITTERS-V1: transport class —
   *  'internal' for in-app companion chat, plus room for future
   *  channels (e.g. 'whatsapp', 'sms') without a type rev. */
  channel?: string;
  /** R-COMPANION-MESSAGING-EMITTERS-V1: source module name
   *  ('pos', 'repairs', 'layaways', 'companion', etc.) for filtering. */
  source?: string;
  fromEmployeeId?: string;
  toEmployeeId?: string;
  /** R-COMPANION-MESSAGING-EMITTERS-V1: sender's role at send time.
   *  Lets the Companion app surface owner/manager messages distinctly
   *  without an extra employee lookup. */
  senderRole?: 'owner' | 'manager' | 'technician' | 'sales' | 'cashier';
  preview?: string;                // short, sanitised preview only
}

export interface CompanionStoreStatusPayload {
  /** R-COMPANION-STORE-STATUS-EMITTERS-V1: stable id for this status
   *  change. Consumers can dedupe / order events by it. */
  statusId?: string;
  /** R-COMPANION-STORE-STATUS-EMITTERS-V1: operational state — the
   *  primary discriminator on the receiving Companion side. */
  status?: 'open' | 'closed' | 'unknown';
  /** R-COMPANION-STORE-STATUS-EMITTERS-V1: origin of the signal.
   *  Defaults to 'desktop' in the shell helpers. */
  source?: string;
  /** R-COMPANION-STORE-STATUS-EMITTERS-V1: ms epoch of the status
   *  change. Redundant with envelope createdAt but explicit per spec
   *  so consumers don't reach into the envelope. */
  updatedAt?: number;
  /** R-COMPANION-STORE-STATUS-EMITTERS-V1: short optional reason
   *  string for diagnostics (e.g. 'manual_toggle', 'after_hours').
   *  Never customer / employee PII. */
  reason?: string;
  storeId?: string;
  /** Optional operational counter — count only, no PII / no money. */
  cashiersOnShift?: number;
  /** Optional operational counter — count only, no PII / no money. */
  ringingPosCount?: number;
}

export interface CompanionIntelligenceAlertPayload {
  alertId: string;
  /** R-COMPANION-INTELLIGENCE-EMITTERS-V1: expanded with 'opportunity'
   *  to match the AlertEngine's AlertSeverity union. Cero breaking —
   *  existing callers passing 'info'/'warning'/'critical' still typecheck. */
  severity?: 'info' | 'warning' | 'critical' | 'opportunity';
  /** Specific analyzer/config key — e.g. 'alert-inventory-low-stock'. */
  kind?: string;
  /** R-COMPANION-INTELLIGENCE-EMITTERS-V1: higher-level grouping —
   *  matches AlertCategory ('sales' | 'inventory' | 'repairs' |
   *  'customers' | 'financial' | 'system'). Future analyzers can
   *  add new values without a type rev. */
  insightType?: string;
  /** R-COMPANION-INTELLIGENCE-EMITTERS-V1: UX prominence hint that
   *  defaults to mirror severity but can diverge later (e.g. a
   *  'critical' alert with priority 'warning' during low-traffic). */
  priority?: 'info' | 'warning' | 'critical' | 'opportunity';
  /** R-COMPANION-INTELLIGENCE-EMITTERS-V1: origin module. Defaults to
   *  'intelligence' in the shell emitter. */
  source?: string;
  /** R-COMPANION-INTELLIGENCE-EMITTERS-V1: optional entity context —
   *  'customer' | 'inventory_item' | 'repair' | etc. Strings to allow
   *  future entity types. Cero PII attached — only the ID below. */
  relatedEntityType?: string;
  /** R-COMPANION-INTELLIGENCE-EMITTERS-V1: optional entity id. Caller
   *  is responsible for confirming it carries no PII (it shouldn't —
   *  app entity ids are opaque). */
  relatedEntityId?: string;
}

// ── Discriminated union of all events ─────────────────────

export type CompanionEvent =
  | { type: 'APPROVAL_CREATED';           category: 'approvals';           payload: CompanionApprovalPayload;          createdAt: number }
  | { type: 'APPROVAL_APPROVED';          category: 'approvals';           payload: CompanionApprovalPayload;          createdAt: number }
  | { type: 'APPROVAL_DENIED';            category: 'approvals';           payload: CompanionApprovalPayload;          createdAt: number }
  | { type: 'APPROVAL_UPDATED';           category: 'approvals';           payload: CompanionApprovalPayload;          createdAt: number }
  | { type: 'MESSAGE_SENT';               category: 'messaging';           payload: CompanionMessagePayload;           createdAt: number }
  | { type: 'MESSAGE_RECEIVED';           category: 'messaging';           payload: CompanionMessagePayload;           createdAt: number }
  | { type: 'STORE_OPENED';               category: 'store_status';        payload: CompanionStoreStatusPayload;       createdAt: number }
  | { type: 'STORE_CLOSED';               category: 'store_status';        payload: CompanionStoreStatusPayload;       createdAt: number }
  | { type: 'STORE_STATUS_UPDATED';       category: 'store_status';        payload: CompanionStoreStatusPayload;       createdAt: number }
  | { type: 'INTELLIGENCE_ALERT_CREATED'; category: 'intelligence_alerts'; payload: CompanionIntelligenceAlertPayload; createdAt: number };

/** Listener signature used by both typed subscribers and the wildcard channel. */
export type CompanionEventListener = (event: CompanionEvent) => void;

/** Mock connection lifecycle the bridge layer reports. */
export type CompanionConnectionState = 'disconnected' | 'connecting' | 'connected';

export type CompanionConnectionListener = (state: CompanionConnectionState) => void;
