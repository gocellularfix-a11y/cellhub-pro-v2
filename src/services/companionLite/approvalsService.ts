// Companion Lite — Approvals (desktop side).
// Create approvals + poll for their current status (incl. mobile response).

import { apiGet, apiPost } from './apiClient';
import type {
  ApprovalRequest,
  CompanionLiteDesktopSession,
  CompanionLiteMessage,
  CreateApprovalRequest,
  ListApprovalMessagesResponse,
  ListApprovalsResponse,
  SendApprovalMessageRequest,
} from '@/types/companionLite';

interface CreateResponse {
  id: string;
  createdAt: string;
}

/**
 * Create a new approval request. Returns the assigned id once the bridge
 * acknowledges. Caller is expected to poll `listApprovals` for the
 * eventual response.
 */
export async function createApproval(
  session: CompanionLiteDesktopSession,
  req: CreateApprovalRequest,
): Promise<CreateResponse> {
  return apiPost<CreateResponse>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/store/${encodeURIComponent(session.storeId)}/approvals`,
    req,
  );
}

/** List approvals visible to this store. */
export async function listApprovals(
  session: CompanionLiteDesktopSession,
  since?: string,
): Promise<ApprovalRequest[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const result = await apiGet<ListApprovalsResponse>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/store/${encodeURIComponent(session.storeId)}/approvals${qs}`,
  );
  return result.approvals;
}

// ── Per-approval message thread ────────────────────────────────────

export async function listApprovalMessages(
  session: CompanionLiteDesktopSession,
  approvalId: string,
  since?: string,
): Promise<CompanionLiteMessage[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const result = await apiGet<ListApprovalMessagesResponse>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/approvals/${encodeURIComponent(approvalId)}/messages${qs}`,
  );
  return result.messages;
}

export async function sendApprovalMessage(
  session: CompanionLiteDesktopSession,
  approvalId: string,
  body: string,
  fromName?: string,
): Promise<{ id: string; createdAt: string }> {
  const req: SendApprovalMessageRequest = {
    body,
    fromRole: 'pos',
    fromName,
  };
  return apiPost<{ id: string; createdAt: string }>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/approvals/${encodeURIComponent(approvalId)}/messages`,
    req,
  );
}
