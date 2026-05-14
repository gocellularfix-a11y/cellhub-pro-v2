// Companion Lite — Messages (desktop side).
// Single thread per store. Poll inbox + send outbound.

import { apiGet, apiPost } from './apiClient';
import type {
  CompanionLiteDesktopSession,
  CompanionLiteMessage,
  ListMessagesResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@/types/companionLite';

export async function listMessages(
  session: CompanionLiteDesktopSession,
  since?: string,
): Promise<CompanionLiteMessage[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const result = await apiGet<ListMessagesResponse>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/store/${encodeURIComponent(session.storeId)}/messages${qs}`,
  );
  return result.messages;
}

export async function sendMessage(
  session: CompanionLiteDesktopSession,
  body: string,
  fromName?: string,
): Promise<SendMessageResponse> {
  const req: SendMessageRequest = {
    body,
    fromRole: 'pos',
    fromName,
  };
  return apiPost<SendMessageResponse>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/store/${encodeURIComponent(session.storeId)}/messages`,
    req,
  );
}
