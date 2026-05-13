/**
 * R-BRIDGE-SIGNED-TOKEN-V1
 *
 * Desktop-side STRICT bridge auth token minting.
 *
 * Replicates the bridge's mintBridgeAuthToken logic using the Web Crypto API
 * (available in Electron renderer + modern browsers — no Node.js required).
 *
 * Token format: <base64url(payload)>.<hex(hmac-sha256(payloadB64, secret))>
 * Payload:      { storeId, deviceId, role: 'pos', iat, exp }
 *
 * Secret source: import.meta.env.VITE_BRIDGE_AUTH_SECRET
 *   - Must match the BRIDGE_AUTH_SECRET set on the Railway bridge deployment.
 *   - If absent → warn once and return a DEV-prefix token (non-production).
 *   - Never hardcoded, never committed, never exposed in UI.
 */

const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000; // 90 days

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface MintDesktopTokenInput {
  storeId: string;
  deviceId: string;
}

/**
 * Mint a STRICT-format HMAC-SHA256 bridge auth token for the desktop POS
 * client. Returns a DEV-prefix token as a safe fallback when:
 *   - VITE_BRIDGE_AUTH_SECRET is not configured
 *   - crypto.subtle is unavailable or throws
 */
export async function mintDesktopBridgeToken(input: MintDesktopTokenInput): Promise<string> {
  const secret = import.meta.env.VITE_BRIDGE_AUTH_SECRET;

  if (!secret) {
    console.warn('[BridgeAuth] Missing VITE_BRIDGE_AUTH_SECRET — falling back to dev token');
    return `dev.${input.storeId}.${input.deviceId}.pos`;
  }

  const iat = Date.now();
  const exp = iat + TOKEN_LIFETIME_MS;
  const payload = {
    storeId: input.storeId,
    deviceId: input.deviceId,
    role: 'pos' as const,
    iat,
    exp,
  };

  try {
    const payloadB64 = b64urlEncode(JSON.stringify(payload));
    const sig = await hmacSha256Hex(secret, payloadB64);
    console.info('[BridgeAuth] Using STRICT signed token');
    return `${payloadB64}.${sig}`;
  } catch (err) {
    console.warn('[BridgeAuth] Token signing failed — falling back to DEV token', err);
    return `dev.${input.storeId}.${input.deviceId}.pos`;
  }
}
