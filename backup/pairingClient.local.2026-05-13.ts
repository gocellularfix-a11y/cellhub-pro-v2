// ============================================================
// CellHub Pro — Companion Pairing HTTP Client
// (R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1)
//
// Thin fetch wrappers around the bridge's /pair/* endpoints. Desktop
// CompanionCenter calls these:
//   - submitPairingOffer when the user opens the pairing modal
//   - pollPairingStatus repeatedly while the modal is open
//   - revokePairingOffer when the user cancels
//
// Cero approval logic, cero money, cero POS. Identity plumbing only.
// ============================================================

/** QR payload format the mobile Companion will parse. URL-style so a
 *  scanner can decode the string and pull params with URLSearchParams. */
export const QR_PAIRING_SCHEME = 'cellhub-pair://v1?';

export interface PairingOfferInput {
  bridgeUrl: string;
  code: string;
  storeId: string;
  role: 'manager';
  expiresAt: number;
  deviceName?: string;
}

export interface PairingOfferResult {
  ok: boolean;
  reason?: string;
  httpStatus?: number;
}

export type PairingStatus = 'pending' | 'claimed' | 'expired' | 'unknown';

export interface PairingStatusResult {
  status: PairingStatus;
  expiresAt?: string;
  claimedAt?: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
}

/** Construct the QR payload string from an active pairing offer. */
export function buildPairingQrPayload(input: {
  bridgeUrl: string;
  storeId: string;
  code: string;
  role: 'manager';
  expiresAt: number;
}): string {
  const params = new URLSearchParams({
    bridgeUrl: input.bridgeUrl,
    storeId: input.storeId,
    code: input.code,
    role: input.role,
    exp: String(input.expiresAt),
  });
  return QR_PAIRING_SCHEME + params.toString();
}

async function postJson(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try { data = await r.json(); } catch { /* keep null */ }
  return { status: r.status, data };
}

/** Publish a pairing offer to the bridge. Returns ok=true on 200, else
 *  carries the reason code from the bridge response. */
export async function submitPairingOffer(input: PairingOfferInput): Promise<PairingOfferResult> {
  try {
    const r = await postJson(`${input.bridgeUrl.replace(/\/$/, '')}/pair/offer`, {
      code: input.code,
      storeId: input.storeId,
      role: input.role,
      expiresAt: input.expiresAt,
      deviceName: input.deviceName,
    });
    if (r.status === 200) {
      return { ok: true, httpStatus: 200 };
    }
    const reason = (r.data as { reason?: string } | null)?.reason || 'http_' + r.status;
    return { ok: false, reason, httpStatus: r.status };
  } catch (err) {
    console.warn('[pairingClient] submitPairingOffer failed', err);
    return { ok: false, reason: 'network_error' };
  }
}

/** Poll the bridge for the current state of a pairing code. Safe to
 *  call repeatedly. Returns status='unknown' on network / bridge error
 *  so the caller can keep polling without flipping out. */
export async function pollPairingStatus(input: {
  bridgeUrl: string;
  code: string;
}): Promise<PairingStatusResult> {
  try {
    const url = `${input.bridgeUrl.replace(/\/$/, '')}/pair/status?code=${encodeURIComponent(input.code)}`;
    const r = await fetch(url);
    if (!r.ok) return { status: 'unknown' };
    const data = (await r.json()) as PairingStatusResult;
    return data;
  } catch (err) {
    console.warn('[pairingClient] pollPairingStatus failed', err);
    return { status: 'unknown' };
  }
}

/** Revoke a pairing offer so the bridge drops it from its store. */
export async function revokePairingOffer(input: {
  bridgeUrl: string;
  code: string;
  storeId: string;
}): Promise<{ ok: boolean }> {
  try {
    const r = await postJson(`${input.bridgeUrl.replace(/\/$/, '')}/pair/revoke`, {
      code: input.code,
      storeId: input.storeId,
    });
    return { ok: r.status === 200 };
  } catch (err) {
    console.warn('[pairingClient] revokePairingOffer failed', err);
    return { ok: false };
  }
}
