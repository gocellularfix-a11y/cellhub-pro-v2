// ============================================================
// Companion Lite — Type definitions (desktop side).
//
// MANUALLY DUPLICATED from bridge/src/companion-lite/types.ts.
// No shared package; keep in sync by hand. Mobile has its own copy.
//
// This file is the only place desktop reads Companion Lite types from.
// Do NOT import from legacy companion modules under src/services/companion
// or src/modules/companion.
// ============================================================

export type ManagerRole = 'pos' | 'manager';

export interface StoreStatusSnapshot {
  storeId: string;
  todayRevenueCents: number;
  todaySalesCount: number;
  openRepairsCount: number;
  pendingLayawaysCount: number;
  clockedInCount: number;
  clockedInNames: string[];
  pendingApprovalsCount: number;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  storeId: string;
  type: string;
  reason: string;
  employeeName: string;
  affectedAmountCents: number;
  affectedItem?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
  expiresAt: string;
  respondedAt?: string;
  respondedBy?: string;
  managerNote?: string;
  productContext?: ProductCostContext;
}

/** Optional cost/margin context surfaced to the manager. Money in cents. */
export interface ProductCostContext {
  name?: string;
  sku?: string;
  retailCents: number;
  costCents?: number;
  requestedDiscountCents?: number;
  requestedDiscountPercent?: number;
}

export interface CompanionLiteMessage {
  id: string;
  storeId: string;
  body: string;
  fromRole: ManagerRole;
  fromName?: string;
  createdAt: string;
  /** Present when the message belongs to a per-approval thread. */
  approvalId?: string;
}

// ── API request/response shapes ──────────────────────────────────────

export interface PairStartRequest {
  storeId: string;
  storeName: string;
}
export interface PairStartResponse {
  code: string;
  expiresAt: string;
  posToken: string;
}

export type PairStatusResponse =
  | { status: 'pending' }
  | { status: 'claimed'; deviceId: string; deviceName?: string; platform?: string }
  | { status: 'expired' };

export interface CreateApprovalRequest {
  type: string;
  reason: string;
  employeeName: string;
  affectedAmountCents: number;
  affectedItem?: string;
  expiresInMs?: number;
  productContext?: ProductCostContext;
}

export interface SendApprovalMessageRequest {
  body: string;
  fromRole: ManagerRole;
  fromName?: string;
}
export interface ListApprovalMessagesResponse {
  messages: CompanionLiteMessage[];
}
export interface CreateApprovalResponse {
  id: string;
  createdAt: string;
}

export interface ListApprovalsResponse {
  approvals: ApprovalRequest[];
}

export interface SendMessageRequest {
  body: string;
  fromRole: ManagerRole;
  fromName?: string;
}
export interface SendMessageResponse {
  id: string;
  createdAt: string;
}

export interface ListMessagesResponse {
  messages: CompanionLiteMessage[];
}

// ── Local desktop-side session record (persisted in localStorage) ────

export interface CompanionLiteDesktopSession {
  posToken: string;
  storeId: string;
  storeName: string;
  bridgeUrl: string;
  pairedAt: string;
}
