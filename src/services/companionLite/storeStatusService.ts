// Companion Lite — Store status (desktop side).
// Push current snapshot. Mobile polls; we never poll status ourselves.

import { apiPost } from './apiClient';
import type {
  CompanionLiteDesktopSession,
  StoreStatusSnapshot,
} from '@/types/companionLite';

export async function pushStoreStatus(
  session: CompanionLiteDesktopSession,
  snapshot: Omit<StoreStatusSnapshot, 'storeId' | 'updatedAt'>,
): Promise<void> {
  await apiPost<{ ok: true }>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/store/${encodeURIComponent(session.storeId)}/status`,
    {
      ...snapshot,
      storeId: session.storeId,
      updatedAt: new Date().toISOString(),
    },
  );
}
