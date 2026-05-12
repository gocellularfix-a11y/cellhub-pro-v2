// R-BRIDGE-V1 — Typed event payloads
// Shared between bridge server, desktop POS emitters, and mobile client.

export type ApprovalType =
  | 'discount'
  | 'price_override'
  | 'refund'
  | 'layaway_cancellation'
  | 'repair_cancellation'
  | 'unlock_cancellation'
  | 'special_order_cancellation'
  | 'inventory_adjustment';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'explanation_requested'
  | 'expired';

export type ApprovalPriority = 'low' | 'medium' | 'high' | 'urgent';

export type MessageSenderRole = 'manager' | 'employee' | 'system';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type ClientRole = 'pos' | 'manager';

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface RegisterPayload {
  role: ClientRole;
  storeId: string;
  deviceId: string;
  managerId?: string;
  authToken: string;
}

export interface RegisteredPayload {
  clientId: string;
  role: ClientRole;
  storeId: string;
  connectedAt: string;
}

export interface RejectedPayload {
  reason: string;
}

// ─── Approvals ─────────────────────────────────────────────────────────────

export interface ApprovalRequestPayload {
  id: string;
  type: ApprovalType;
  priority: ApprovalPriority;
  storeId: string;
  employeeId: string;
  employeeName: string;
  storeLocation: string;
  reason: string;
  notes?: string;
  affectedAmount: number;
  affectedItemName?: string;
  customerId?: string;
  customerName?: string;
  transactionRef?: string;
  requestedAt: string;
  expiresAt: string;
}

export interface ApprovalResponsePayload {
  requestId: string;
  storeId: string;
  action: 'approve' | 'deny' | 'request_explanation';
  managerId: string;
  managerName: string;
  managerNote?: string;
  respondedAt: string;
}

export interface ApprovalExpiredPayload {
  requestId: string;
  storeId: string;
  expiredAt: string;
}

export interface ApprovalUpdatedPayload extends ApprovalResponsePayload {
  newStatus: ApprovalStatus;
}

// ─── Messaging ─────────────────────────────────────────────────────────────

export interface NewMessagePayload {
  id: string;
  threadId: string;
  storeId: string;
  senderId: string;
  senderName: string;
  senderRole: MessageSenderRole;
  content: string;
  timestamp: string;
  quickReplyOptions?: string[];
}

export interface MessageReadPayload {
  threadId: string;
  storeId: string;
  readBy: string;
  readAt: string;
}

export interface TypingPayload {
  threadId: string;
  storeId: string;
  userId: string;
  userName: string;
}

// ─── Intelligence ──────────────────────────────────────────────────────────

export interface IntelligenceAlertPayload {
  id: string;
  storeId: string;
  severity: AlertSeverity;
  category: string;
  title: string;
  recommendation: string;
  suggestedAction: string;
  suggestedActionLabel: string;
  timestamp: string;
  affectedMetric?: string;
  affectedValue?: number;
}

export interface IntelligenceDismissedPayload {
  alertId: string;
  storeId: string;
  dismissedBy: string;
  dismissedAt: string;
}

// ─── Employee status ───────────────────────────────────────────────────────

export interface EmployeeStatusPayload {
  employeeId: string;
  employeeName: string;
  storeId: string;
  isOnline: boolean;
  currentActivity?: string;
  timestamp: string;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardStatsPayload {
  storeId: string;
  todaySales: number;
  todaySalesGrowth: number;
  repairsPending: number;
  layawaysPending: number;
  approvalRequests: number;
  intelligenceAlerts: number;
  employeesOnline: number;
  employeesTotal: number;
  updatedAt: string;
}

// ─── System ────────────────────────────────────────────────────────────────

export interface SystemErrorPayload {
  code: string;
  message: string;
  timestamp: string;
}

export interface HeartbeatPayload {
  timestamp: string;
  serverId: string;
}
