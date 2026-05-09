// ============================================================
// CellHub Pro — Receipt Barcode Payload (R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1)
// Pure logic. Builds + parses the structured payload encoded into
// the receipt barcode so a scan can recover both the sale reference
// and (when present) the customer reference.
//
// Format:
//   CHP|SALE|{invoiceNumber}                    — walk-in sale
//   CHP|SALE|{invoiceNumber}|CUST|{customerId}  — sale linked to a customer
//
// Constraints:
//   - Privacy: only IDs travel in the barcode. Names, phones, emails,
//     addresses are NEVER included.
//   - Stability: the sale reference is the human-readable invoiceNumber
//     (e.g. "INV-20260509-1234"), matching the existing in-memory sale
//     lookup so the scan path needs no new index.
//   - Backward compat: parser accepts a bare legacy invoice number with
//     no pipes — old printed receipts keep working.
// ============================================================

import type { Sale } from '@/store/types';

const PREFIX = 'CHP';
const KIND_SALE = 'SALE';
const KIND_CUSTOMER = 'CUST';
const SEP = '|';

/**
 * Encode a sale into the canonical receipt barcode payload.
 * Falls back to the internal sale id if invoiceNumber is somehow
 * missing — the resulting payload still parses and looks up.
 */
export function buildReceiptBarcodePayload(sale: Pick<Sale, 'invoiceNumber' | 'id' | 'customerId'> | null | undefined): string {
  if (!sale) return '';
  const ref = (sale.invoiceNumber && sale.invoiceNumber.trim()) || sale.id || '';
  if (!ref) return '';
  if (sale.customerId && sale.customerId.trim()) {
    return [PREFIX, KIND_SALE, ref, KIND_CUSTOMER, sale.customerId.trim()].join(SEP);
  }
  return [PREFIX, KIND_SALE, ref].join(SEP);
}

export interface ParsedReceiptBarcode {
  /** Always present. Maps to Sale.invoiceNumber (or legacy raw value). */
  saleRef: string;
  /** Present only when the original sale was linked to a customer. */
  customerId?: string;
  /** Original scanned string. Useful for diagnostics + audit logging. */
  raw: string;
  /** True when payload uses the structured CHP|SALE|... format. */
  structured: boolean;
}

/**
 * Decode a scanned barcode value.
 *
 * Returns:
 *   - parsed payload when the value is the structured CHP|SALE|... format
 *   - parsed payload with structured=false when the value is a bare legacy
 *     invoice number (no pipes) — saleRef is the raw value as scanned
 *   - null when the value is empty or otherwise unparseable
 *
 * The parser is intentionally permissive on the legacy path so old
 * receipts printed before this round still resolve to a sale.
 */
export function parseReceiptBarcodePayload(value: string | null | undefined): ParsedReceiptBarcode | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Legacy (bare) format — the receipt barcode used to encode invoiceNumber
  // directly. No pipes => treat the whole string as saleRef.
  if (!raw.includes(SEP)) {
    return { saleRef: raw, raw, structured: false };
  }

  const parts = raw.split(SEP);
  if (parts.length < 3) return null;
  if (parts[0] !== PREFIX || parts[1] !== KIND_SALE) return null;
  const saleRef = (parts[2] || '').trim();
  if (!saleRef) return null;

  const out: ParsedReceiptBarcode = { saleRef, raw, structured: true };

  // Optional CUST segment. Order is fixed (CHP|SALE|ref[|CUST|id]) so
  // we look at parts[3]/[4] explicitly rather than scanning for the tag.
  if (parts[3] === KIND_CUSTOMER && parts[4]) {
    const cid = parts[4].trim();
    if (cid) out.customerId = cid;
  }

  return out;
}

/** Quick check used by the scanner router to short-circuit on the new format. */
export function isStructuredReceiptBarcode(value: string | null | undefined): boolean {
  if (!value) return false;
  return String(value).trim().startsWith(`${PREFIX}${SEP}${KIND_SALE}${SEP}`);
}
