/**
 * R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1
 *
 * Desktop-side HTTP client for the bridge pairing offer/poll/revoke flow.
 * The mobile companion scans the QR built by buildPairingQrPayload and
 * claims the offer via POST /pair/claim on the bridge. The desktop polls
 * GET /pair/status?code=... until 'claimed' or 'expired'.
 */

export interface SubmitPairingOfferInput {
  bridgeUrl: string;
  code: string;
  storeId: string;
  role: string;
  expiresAt: number;
}

export interface SubmitPairingOfferResult {
  ok: boolean;
  reason?: string;
}

export async function submitPairingOffer(
  input: SubmitPairingOfferInput,
): Promise<SubmitPairingOfferResult> {
  try {
    const res = await fetch(`${input.bridgeUrl}/pair/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        storeId: input.storeId,
        role: input.role,
        expiresAt: input.expiresAt,
      }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, reason: (body as { reason?: string }).reason ?? `http_${res.status}` };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

export interface PollPairingStatusInput {
  bridgeUrl: string;
  code: string;
}

export interface PollPairingStatusResult {
  status: 'pending' | 'claimed' | 'expired';
  deviceId?: string;
  deviceName?: string;
  platform?: string;
}

export async function pollPairingStatus(
  input: PollPairingStatusInput,
): Promise<PollPairingStatusResult> {
  try {
    const url = `${input.bridgeUrl}/pair/status?code=${encodeURIComponent(input.code)}`;
    const res = await fetch(url);
    if (!res.ok) return { status: 'pending' };
    const body = await res.json().catch(() => ({})) as PollPairingStatusResult;
    return body;
  } catch {
    return { status: 'pending' };
  }
}

export interface RevokePairingOfferInput {
  bridgeUrl: string;
  code: string;
  storeId: string;
}

export async function revokePairingOffer(input: RevokePairingOfferInput): Promise<void> {
  try {
    await fetch(`${input.bridgeUrl}/pair/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: input.code, storeId: input.storeId }),
    });
  } catch {
    // fire-and-forget — caller uses void
  }
}

export interface BuildPairingQrPayloadInput {
  bridgeUrl: string;
  storeId: string;
  code: string;
  role: string;
  expiresAt: number;
}

/**
 * Build the URL-style string encoded into the pairing QR code.
 * The mobile companion app parses bridgeUrl, storeId, code, role, exp
 * from this payload to initiate the claim flow.
 */
export function buildPairingQrPayload(input: BuildPairingQrPayloadInput): string {
  const params = new URLSearchParams({
    bridge: input.bridgeUrl,
    store: input.storeId,
    code: input.code,
    role: input.role,
    exp: String(input.expiresAt),
  });
  return `cellhub://pair?${params.toString()}`;
}
