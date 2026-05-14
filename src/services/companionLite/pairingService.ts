// Companion Lite — Pairing flow (desktop side).
// POST /pair/start → receive code + posToken, persist session,
// then poll /pair/status until 'claimed' or 'expired'.

import { apiGet, apiPost } from './apiClient';
import { saveDesktopSession } from './identityStore';
import type {
  CompanionLiteDesktopSession,
  PairStartRequest,
  PairStartResponse,
  PairStatusResponse,
} from '@/types/companionLite';

export interface StartPairingInput {
  bridgeUrl: string;
  storeId: string;
  storeName: string;
}

export interface StartPairingResult {
  code: string;
  expiresAt: string;
  /** Session is already persisted at this point. */
  session: CompanionLiteDesktopSession;
}

export async function startPairing(input: StartPairingInput): Promise<StartPairingResult> {
  const body: PairStartRequest = {
    storeId: input.storeId,
    storeName: input.storeName,
  };
  const response = await apiPost<PairStartResponse>(
    { bridgeUrl: input.bridgeUrl },
    '/pair/start',
    body,
  );
  const session: CompanionLiteDesktopSession = {
    posToken: response.posToken,
    storeId: input.storeId,
    storeName: input.storeName,
    bridgeUrl: input.bridgeUrl,
    pairedAt: new Date().toISOString(),
  };
  saveDesktopSession(session);
  return { code: response.code, expiresAt: response.expiresAt, session };
}

export async function getPairStatus(bridgeUrl: string, code: string): Promise<PairStatusResponse> {
  return apiGet<PairStatusResponse>(
    { bridgeUrl },
    `/pair/status?code=${encodeURIComponent(code)}`,
  );
}
