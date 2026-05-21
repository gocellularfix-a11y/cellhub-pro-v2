// ============================================================
// CellHub Pro — Receipt Barcode Payload
// Lineage:
//   R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1   — original CHP|SALE|... format
//   R-RECEIPT-BARCODE-PAGEWIDTH-FIX           — shortened to CHP|S|{invoiceNumber}
//   R-PHONE-PAYMENT-RECEIPT-BARCODE-SCAN-V1   — CH: format for phone-pay receipts
//     Phone-payment receipts encode customer ID directly so a scan opens
//     customer history immediately. Regular receipts keep CHP|S| unchanged.
//
// Emission rules:
//   Phone-pay sale + customerId    → CH:CUST:{customerId}
//   Phone-pay sale, no customerId  → CH:PHONEPAY:{invoiceNumber}
//   All other sales                → CHP|S|{invoiceNumber}  (unchanged)
//
// Parser still accepts (backward compatibility — old printed receipts):
//   CH:CUST:{customerId}                        — phone-pay, customer link
//   CH:PHONEPAY:{invoiceNumber}                 — phone-pay, no customer
//   CHP|S|{invoiceNumber}                       — standard short form
//   CHP|SALE|{invoiceNumber}                    — V1 long form
//   CHP|SALE|{invoiceNumber}|CUST|{customerId}  — V1 long with customer
//   {invoiceNumber}                             — pre-V1 raw form
//
// Constraints:
//   - Privacy: only IDs travel in the barcode. Names, phones, emails,
//     addresses are NEVER included.
// ============================================================

import type { Sale } from '@/store/types';

// ── Legacy CHP| format constants ─────────────────────────────────────────────
const PREFIX = 'CHP';
const KIND_SALE_SHORT = 'S';
const KIND_SALE = 'SALE';
const KIND_CUSTOMER = 'CUST';
const SEP = '|';

// ── CH: format constants (phone-pay receipts) ─────────────────────────────────
// Still exported because parsers + downstream UI (BarcodeActionModal, etc.)
// match on these prefixes when scanning legacy receipts. The receipt emitter
// no longer produces them (R-RECEIPT-BARCODE-MATCH-WORKING-V1).
export const CH_CUST_PREFIX     = 'CH:CUST:';
export const CH_PHONEPAY_PREFIX = 'CH:PHONEPAY:';
export const CH_PHONE_PREFIX    = 'CH:PHONE:';

/**
 * Encode a sale into the canonical receipt barcode payload.
 *
 * R-RECEIPT-BARCODE-MATCH-WORKING-V1: emission simplified to the bare
 * invoice number for every sale. The structured CHP|S| / CH:CUST: /
 * CH:PHONEPAY: prefixes were adding 6–8 extra CODE128 modules each,
 * which combined with the receipt's tight barcode column to compress
 * the bars below the shop scanner's read threshold. With the bars now
 * rendered at their natural SVG size, keeping the payload short is
 * what makes a 4in / 80mm thermal print fit without overflow.
 *
 * The parsers below still accept all legacy formats so previously
 * printed receipts keep scanning. The downside: new phone-pay receipts
 * lose the "scan opens customer history" shortcut — they now route
 * through the standard invoice lookup and the cashier reaches the
 * customer in one extra click via the sale screen.
 *
 * Used to emit:
 *   - Phone-pay + customerId → CH:CUST:{customerId}
 *   - Phone-pay, no customer → CH:PHONEPAY:{invoiceNumber}
 *   - All other sales        → CHP|S|{invoiceNumber}
 */
export function buildReceiptBarcodePayload(
  sale: (Pick<Sale, 'invoiceNumber' | 'id' | 'customerId'> & { items?: Sale['items'] }) | null | undefined,
): string {
  if (!sale) return '';
  const ref = (sale.invoiceNumber && sale.invoiceNumber.trim()) || sale.id || '';
  return ref;
}

// ── CH: barcode helpers ───────────────────────────────────────────────────────

export type ChBarcodeKind = 'cust' | 'phonepay' | 'phone';

export interface ParsedChBarcode {
  kind: ChBarcodeKind;
  value: string;
  raw: string;
}

export function isChBarcode(value: string | null | undefined): boolean {
  return !!value && String(value).trim().startsWith('CH:');
}

export function parseChBarcode(value: string | null | undefined): ParsedChBarcode | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (raw.startsWith(CH_CUST_PREFIX)) {
    const v = raw.slice(CH_CUST_PREFIX.length).trim();
    return v ? { kind: 'cust', value: v, raw } : null;
  }
  if (raw.startsWith(CH_PHONEPAY_PREFIX)) {
    const v = raw.slice(CH_PHONEPAY_PREFIX.length).trim();
    return v ? { kind: 'phonepay', value: v, raw } : null;
  }
  if (raw.startsWith(CH_PHONE_PREFIX)) {
    const v = raw.slice(CH_PHONE_PREFIX.length).trim();
    return v ? { kind: 'phone', value: v, raw } : null;
  }
  return null;
}

// ── Legacy CHP| format helpers ────────────────────────────────────────────────

export interface ParsedReceiptBarcode {
  saleRef: string;
  customerId?: string;
  raw: string;
  structured: boolean;
}

export function parseReceiptBarcodePayload(value: string | null | undefined): ParsedReceiptBarcode | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (!raw.includes(SEP)) {
    return { saleRef: raw, raw, structured: false };
  }

  const parts = raw.split(SEP);
  if (parts.length < 3) return null;
  if (parts[0] !== PREFIX) return null;

  const kind = parts[1];
  if (kind !== KIND_SALE_SHORT && kind !== KIND_SALE) return null;

  const saleRef = (parts[2] || '').trim();
  if (!saleRef) return null;

  const out: ParsedReceiptBarcode = { saleRef, raw, structured: true };
  if (kind === KIND_SALE && parts[3] === KIND_CUSTOMER && parts[4]) {
    const cid = parts[4].trim();
    if (cid) out.customerId = cid;
  }

  return out;
}

export function isStructuredReceiptBarcode(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = String(value).trim();
  return (
    trimmed.startsWith(`${PREFIX}${SEP}${KIND_SALE_SHORT}${SEP}`)
    || trimmed.startsWith(`${PREFIX}${SEP}${KIND_SALE}${SEP}`)
  );
}
