// ============================================================
// CellHub Pro — Payment Portal definitions
// Wireless retail payment processors used by Phone Payment modal.
// ============================================================
//
// Stored in settings.paymentPortals (extended via cast — not in
// StoreSettings type yet, to keep src/store/ untouched).
// PhonePaymentModal reads from settings with fallback to DEFAULTS.
// SettingsModule provides full CRUD.

export interface PaymentPortal {
  id: string;                  // unique identifier (used as key)
  label: string;               // display name (e.g. "WebPOS")
  emoji: string;               // visual icon
  color: string;               // brand hex color
  matchCarriers: string[];     // lowercase carrier name keywords for auto-highlight
  matchUrlSnippets: string[];  // lowercase URL fragments for auto-highlight via configured URL
}

// The 4 mainstream wireless retail portals — seeded as defaults.
// Same shape that PhonePaymentModal already used hardcoded.
export const DEFAULT_PAYMENT_PORTALS: PaymentPortal[] = [
  {
    id: 'WebPOS',
    label: 'WebPOS',
    emoji: '🌐',
    color: '#3b82f6',
    matchCarriers: ['t-mobile', 'tmobile', 'verizon', 'vzw'],
    matchUrlSnippets: ['paymasterwebpos', 'epayworldwide'],
  },
  {
    id: 'QPay',
    label: 'QPay',
    emoji: '📡',
    color: '#f59e0b',
    matchCarriers: ['att', 'at&t'],
    matchUrlSnippets: ['myrtpay', 'qpay', 'spid'],
  },
  {
    id: 'VidaPay',
    label: 'VidaPay',
    emoji: '💚',
    color: '#10b981',
    matchCarriers: ['simple', 'page plus', 'pageplus'],
    matchUrlSnippets: ['vidapay'],
  },
  {
    id: 'H2O',
    label: 'H2O',
    emoji: '💧',
    color: '#06b6d4',
    matchCarriers: ['h2o'],
    matchUrlSnippets: ['h2odirectnow', 'h2o'],
  },
];

/**
 * Resolve which portals to display: prefer settings, fall back to defaults.
 */
export function getActivePortals(settings: unknown): PaymentPortal[] {
  const fromSettings = (settings as { paymentPortals?: PaymentPortal[] })?.paymentPortals;
  if (Array.isArray(fromSettings) && fromSettings.length > 0) return fromSettings;
  return DEFAULT_PAYMENT_PORTALS;
}

/**
 * Pick the default portal id for a given carrier.
 * Match by carrier name first, then by configured URL signature.
 */
export function getDefaultPortalId(
  carrier: string,
  portals: PaymentPortal[],
  carrierPortalUrls: Record<string, string> = {},
): string {
  if (!carrier) return '';
  const c = carrier.toLowerCase();
  for (const p of portals) {
    if (p.matchCarriers.some((m) => c.includes(m.toLowerCase()))) return p.id;
  }
  const url = (carrierPortalUrls[carrier] || '').toLowerCase();
  if (url) {
    for (const p of portals) {
      if (p.matchUrlSnippets.some((s) => url.includes(s.toLowerCase()))) return p.id;
    }
  }
  return '';
}
