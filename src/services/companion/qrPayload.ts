// Companion — QR pairing payload format (desktop encode side).
//
// Wire format mirrors mobile's parser at
//   cellhub-companion/src/services/companion/qrParser.ts
//   cellhub-lite://pair?u=<encoded bridgeUrl>&c=<6-digit code>

export const QR_PREFIX = 'cellhub-lite://pair?';

export function buildPairingQrPayload(bridgeUrl: string, code: string): string {
  const params = new URLSearchParams();
  params.set('u', bridgeUrl);
  params.set('c', code);
  return `${QR_PREFIX}${params.toString()}`;
}
