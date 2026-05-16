// Companion — Store status (desktop side).
// Push current snapshot. Mobile polls; we never poll status ourselves.

import { apiPost } from './apiClient';
import type {
  CompanionDesktopSession,
  StoreStatusSnapshot,
} from '@/types/companion';

export async function pushStoreStatus(
  session: CompanionDesktopSession,
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
