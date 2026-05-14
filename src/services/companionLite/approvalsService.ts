// Companion Lite — Approvals (desktop side).
// Create approvals + poll for their current status (incl. mobile response).

import { apiGet, apiPost } from './apiClient';
import type {
  ApprovalRequest,
  CompanionLiteDesktopSession,
  CreateApprovalRequest,
  ListApprovalsResponse,
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
