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
  | 'MESSAGE_READ'              // R-COMPANION-MESSAGING-RUNTIME-V1
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
  | { type: 'MESSAGE_READ';               category: 'messaging';           payload: CompanionMessagePayload;           createdAt: number }
  | { type: 'STORE_OPENED';               category: 'store_status';        payload: CompanionStoreStatusPayload;       createdAt: number }
  | { type: 'STORE_CLOSED';               category: 'store_status';        payload: CompanionStoreStatusPayload;       createdAt: number }
  | { type: 'STORE_STATUS_UPDATED';       category: 'store_status';        payload: CompanionStoreStatusPayload;       createdAt: number }
  | { type: 'INTELLIGENCE_ALERT_CREATED'; category: 'intelligence_alerts'; payload: CompanionIntelligenceAlertPayload; createdAt: number };

/** Listener signature used by both typed subscribers and the wildcard channel. */
export type CompanionEventListener = (event: CompanionEvent) => void;

/** Mock connection lifecycle the bridge layer reports. */
export type CompanionConnectionState = 'disconnected' | 'connecting' | 'connected';

export type CompanionConnectionListener = (state: CompanionConnectionState) => void;

// ── Bridge connection shell (R-COMPANION-BRIDGE-CONNECTION-V1) ──
// Device-level state that the future mobile Companion will populate
// when it actually pairs. Today the service is in-memory only and
// driven by mock actions; future rounds wire a real transport behind
// the same snapshot subscription surface.

export type CompanionDevicePlatform = 'ios' | 'android' | 'web' | 'unknown';

/**
 * Pairing-session lifecycle. Distinct from CompanionConnectionState
 * — pairing is the transient handshake phase; connectionState
 * reports the steady-state link health.
 */
export type CompanionPairingPhase =
  | 'idle'
  | 'waiting'
  | 'pending'
  | 'connected'
  | 'cancelled'
  | 'timeout';

/** Which transport this bridge is plugged into. */
export type CompanionBridgeMode = 'mock' | 'local' | 'future';

export interface CompanionPairedDevice {
  deviceId: string;
  deviceName: string;
  platform: CompanionDevicePlatform;
  /** ms epoch when the bridge accepted the device. */
  connectedAt: number;
  /** ms epoch of the most-recent heartbeat / activity. */
  lastSeenAt: number;
  status: 'connected' | 'disconnected';
}

export interface CompanionPairingSession {
  sessionId: string;
  /** Short numeric PIN shown to the user during pairing. */
  pin: string;
  /** ms epoch when the session opened. */
  startedAt: number;
  phase: CompanionPairingPhase;
}

/** Read-only snapshot the dev panel + future consumers consume. */
export interface CompanionBridgeSnapshot {
  mode: CompanionBridgeMode;
  connectionState: CompanionConnectionState;
  pairingSession: CompanionPairingSession | null;
  pairedDevice: CompanionPairedDevice | null;
  lastConnectedAt: number | null;
}

export type CompanionBridgeSnapshotListener = (snapshot: CompanionBridgeSnapshot) => void;

// ── Device registry (R-COMPANION-DEVICE-REGISTRY-V1) ──────
// In-memory roster of every Companion device the desktop has seen.
// The bridge connection layer holds the single "currently paired"
// device; the registry holds the broader list (including remembered/
// trusted devices that are not currently connected). Future rounds
// wire persistence behind the same snapshot subscription surface.

export type CompanionDeviceHealth = 'good' | 'stale' | 'offline';

export interface CompanionRegisteredDevice {
  deviceId: string;
  deviceName: string;
  platform: CompanionDevicePlatform;
  status: 'connected' | 'disconnected';
  /** ms epoch — first time this device id was registered. */
  connectedAt: number;
  /** ms epoch — most-recent heartbeat / activity for this device. */
  lastSeenAt: number;
  /** True when the owner has explicitly trusted/remembered this device.
   *  Future UX: trusted devices reconnect without re-pairing. */
  trusted: boolean;
  health: CompanionDeviceHealth;
}

export interface CompanionDeviceRegistrySnapshot {
  /** Stable order: most-recently-active first. Copy — mutating it
   *  does not mutate registry state. */
  devices: CompanionRegisteredDevice[];
  /** Currently-active deviceId, or null when nothing is paired. */
  activeDeviceId: string | null;
}

export type CompanionDeviceRegistryListener = (snapshot: CompanionDeviceRegistrySnapshot) => void;

// ── Action inbox (R-COMPANION-ACTION-INBOX-V1) ────────────
// Reverse path: actions coming FROM the future Companion mobile app
// INTO the desktop. Shell only — no producer wires real mutations
// yet; the service exists so a future bridge can route incoming
// actions through one typed entry point.

export type CompanionInboxActionType =
  | 'approve_request'
  | 'deny_request'
  | 'send_message'
  | 'acknowledge_intelligence_alert';

export type CompanionInboxActionStatus = 'pending' | 'handled';

// Per-type payload shapes. IDs + minimal metadata only — cero PII.

export interface CompanionApproveRequestPayload {
  approvalId: string;
  approvedByEmployeeId?: string;
  reason?: string;
}

export interface CompanionDenyRequestPayload {
  approvalId: string;
  deniedByEmployeeId?: string;
  reason?: string;
}

export interface CompanionSendMessagePayload {
  messageId: string;
  fromEmployeeId?: string;
  channel?: string;
  /** Short non-sensitive preview only — never customer PII. */
  preview?: string;
}

export interface CompanionAcknowledgeAlertPayload {
  alertId: string;
  acknowledgedByEmployeeId?: string;
}

/**
 * Inbox-action envelope. Discriminated by `type` so consumers get
 * compile-time payload safety. actionId is generated locally on
 * submit; status starts 'pending' and flips to 'handled' once the
 * desktop side has applied (or chosen to ignore) the action.
 */
export type CompanionInboxAction =
  | {
      type: 'approve_request';
      actionId: string;
      receivedAt: number;
      status: CompanionInboxActionStatus;
      handledAt?: number;
      payload: CompanionApproveRequestPayload;
    }
  | {
      type: 'deny_request';
      actionId: string;
      receivedAt: number;
      status: CompanionInboxActionStatus;
      handledAt?: number;
      payload: CompanionDenyRequestPayload;
    }
  | {
      type: 'send_message';
      actionId: string;
      receivedAt: number;
      status: CompanionInboxActionStatus;
      handledAt?: number;
      payload: CompanionSendMessagePayload;
    }
  | {
      type: 'acknowledge_intelligence_alert';
      actionId: string;
      receivedAt: number;
      status: CompanionInboxActionStatus;
      handledAt?: number;
      payload: CompanionAcknowledgeAlertPayload;
    };

export interface CompanionActionInboxSnapshot {
  /** All actions, most-recent first. Copy — mutating it does not
   *  mutate inbox state. */
  actions: CompanionInboxAction[];
  /** Count of actions with status === 'pending'. */
  pendingCount: number;
}

export type CompanionActionInboxListener = (snapshot: CompanionActionInboxSnapshot) => void;

// ── Approval runtime store (R-COMPANION-APPROVAL-RUNTIME-V1) ──
// Aggregated view of every approval the desktop has produced, sourced
// from the APPROVAL_CREATED / APPROVAL_APPROVED / APPROVAL_DENIED
// events on the Companion Event Bus. Lets the Companion Center
// surface pending counts + latest decision without re-walking the
// event log.

export type CompanionApprovalRuntimeStatus = 'pending' | 'approved' | 'denied';

export interface CompanionApprovalRuntimeItem {
  approvalId: string;
  actionType?: string;
  source?: string;
  status: CompanionApprovalRuntimeStatus;
  requestedByEmployeeId?: string;
  approvedByEmployeeId?: string;
  reason?: string;
  /** ms epoch when the runtime first saw this approval. */
  createdAt: number;
  /** ms epoch of the most-recent status change. */
  updatedAt: number;
}

export interface CompanionApprovalRuntimeSnapshot {
  /** Most-recently-updated first. Shallow copies — mutating them
   *  does not mutate runtime state. */
  items: CompanionApprovalRuntimeItem[];
  pendingCount: number;
  /** Most-recently-updated item, or null when empty. */
  latest: CompanionApprovalRuntimeItem | null;
}

export type CompanionApprovalRuntimeListener = (snapshot: CompanionApprovalRuntimeSnapshot) => void;

// ── Messaging runtime store (R-COMPANION-MESSAGING-RUNTIME-V1) ──
// Aggregated view of every Companion message the desktop has seen,
// sourced from the MESSAGE_SENT / MESSAGE_RECEIVED / MESSAGE_READ
// events on the Companion Event Bus. Lets the Companion Center
// surface unread counts + latest thread activity without re-walking
// the bus log. Cero networking, cero persistence — in-memory only.

export type CompanionMessageDirection = 'outbound' | 'inbound';

export interface CompanionMessageRuntimeItem {
  messageId: string;
  /** Derived synthetic key — see companionMessagingRuntime for
   *  derivation rules. Used to group messages into threads when the
   *  emitter doesn't supply an explicit thread id. */
  threadKey: string;
  direction: CompanionMessageDirection;
  channel?: string;
  source?: string;
  fromEmployeeId?: string;
  toEmployeeId?: string;
  senderRole?: 'owner' | 'manager' | 'technician' | 'sales' | 'cashier';
  /** Short non-sensitive preview only — mirrors the bus payload. */
  preview?: string;
  /** Inbound messages start unread; outbound start read. MESSAGE_READ
   *  flips the inbound flag. */
  isRead: boolean;
  /** ms epoch when the runtime first saw this message. */
  createdAt: number;
  /** ms epoch of the most-recent state change (read flag flip etc.). */
  updatedAt: number;
}

export interface CompanionMessageThread {
  threadKey: string;
  /** Most-recent message id in the thread. */
  lastMessageId: string;
  lastDirection: CompanionMessageDirection;
  lastPreview?: string;
  lastChannel?: string;
  /** ms epoch of the thread's most-recent activity. */
  lastActivityAt: number;
  /** Total messages in this thread. */
  messageCount: number;
  /** Inbound, unread messages in this thread. */
  unreadCount: number;
}

export interface CompanionMessagingRuntimeSnapshot {
  /** Most-recently-active first. Shallow copies — mutating them
   *  does not mutate runtime state. */
  threads: CompanionMessageThread[];
  /** Sum of every thread.unreadCount. */
  totalUnread: number;
  /** Most-recent message across every thread, or null when empty. */
  latestMessage: CompanionMessageRuntimeItem | null;
  /** ms epoch of the most-recent activity across every thread, or null. */
  lastActivityAt: number | null;
}

export type CompanionMessagingRuntimeListener = (snapshot: CompanionMessagingRuntimeSnapshot) => void;

// ── Store status runtime store (R-COMPANION-STORE-STATUS-RUNTIME-V1) ──
// Aggregated view of the most-recent store-status emit on the
// Companion Event Bus, sourced from STORE_OPENED / STORE_CLOSED /
// STORE_STATUS_UPDATED events. Lets the Companion Center surface
// open/closed state + on-shift counts + the latest alert level
// without re-walking the bus log. Cero networking, cero persistence
// — in-memory only.

export type CompanionStoreOperatingMode = 'open' | 'closed' | 'unknown';

export type CompanionStoreAlertLevel = 'normal' | 'warning' | 'critical';

export interface CompanionStoreRuntimeEmployee {
  employeeId: string;
  role?: 'owner' | 'manager' | 'technician' | 'sales' | 'cashier';
  /** ms epoch — most-recent activity timestamp for this employee. */
  lastSeenAt: number;
}

export interface CompanionStoreStatusRuntimeSnapshot {
  /** Current operating mode derived from the most-recent emit. */
  status: CompanionStoreOperatingMode;
  /** Most-recent statusId from a status emit, or null when none yet. */
  statusId: string | null;
  /** Origin of the latest signal (e.g. 'desktop'). */
  source?: string;
  /** Latest emit's short diagnostic reason (e.g. 'manual_toggle'). */
  reason?: string;
  /** ms epoch of the most-recent status update, or null when empty. */
  lastUpdatedAt: number | null;
  /** Latest emit's cashiersOnShift count (0 when unknown). */
  cashiersOnShift: number;
  /** Latest emit's ringingPosCount (0 when unknown). */
  ringingPosCount: number;
  /** Roster slot for future emitter expansion — empty today since
   *  desktop emits only carry counts, not employee ids. */
  activeEmployees: CompanionStoreRuntimeEmployee[];
  /** Event type that produced the current state, or null when empty. */
  lastEventType: 'STORE_OPENED' | 'STORE_CLOSED' | 'STORE_STATUS_UPDATED' | null;
  /** Derived UX prominence — see derivation rules in the runtime. */
  alertLevel: CompanionStoreAlertLevel;
}

export type CompanionStoreStatusRuntimeListener = (snapshot: CompanionStoreStatusRuntimeSnapshot) => void;
