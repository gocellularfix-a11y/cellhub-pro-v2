// Companion — Approvals (desktop side).
// Create approvals + poll for their current status (incl. mobile response).

import { apiGet, apiPost } from './apiClient';
import type {
  ApprovalRequest,
  CompanionDesktopSession,
  CompanionMessage,
  CreateApprovalRequest,
  ListApprovalMessagesResponse,
  ListApprovalsResponse,
  SendApprovalMessageRequest,
} from '@/types/companion';

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
  session: CompanionDesktopSession,
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
  session: CompanionDesktopSession,
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
  session: CompanionDesktopSession,
  approvalId: string,
  since?: string,
): Promise<CompanionMessage[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const result = await apiGet<ListApprovalMessagesResponse>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/approvals/${encodeURIComponent(approvalId)}/messages${qs}`,
  );
  return result.messages;
}

export async function sendApprovalMessage(
  session: CompanionDesktopSession,
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
