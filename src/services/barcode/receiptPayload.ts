// ============================================================
// CellHub Pro — Receipt Barcode Payload
// Lineage:
//   R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1   — original CHP|SALE|... format
//   R-RECEIPT-BARCODE-PAGEWIDTH-FIX (this)    — payload shortened to
//     CHP|S|{invoiceNumber} so the printed CODE128 fits the 4×6 page
//     header without forcing horizontal overflow. Customer link is
//     resolved POST-scan via sale.customerId — no longer encoded.
//
// Active emission format (this round):
//   CHP|S|{invoiceNumber}                       — short, page-fits
//
// Parser still accepts (backward compatibility — old printed receipts):
//   CHP|S|{invoiceNumber}                       — current short form
//   CHP|SALE|{invoiceNumber}                    — V1 long form
//   CHP|SALE|{invoiceNumber}|CUST|{customerId}  — V1 long with customer
//   {invoiceNumber}                             — pre-V1 raw form
//
// Constraints:
//   - Privacy: only IDs travel in the barcode. Names, phones, emails,
//     addresses are NEVER included.
//   - Stability: the sale reference is the human-readable invoiceNumber
//     (e.g. "INV-20260509-1234"), matching the existing in-memory sale
//     lookup so the scan path needs no new index.
// ============================================================

import type { Sale } from '@/store/types';

const PREFIX = 'CHP';
const KIND_SALE_SHORT = 'S';      // emitted form
const KIND_SALE = 'SALE';         // legacy parser-accept
const KIND_CUSTOMER = 'CUST';     // legacy parser-accept
const SEP = '|';

/**
 * Encode a sale into the canonical receipt barcode payload.
 *
 * Active emission is the SHORT form CHP|S|{invoiceNumber} so the
 * printed CODE128 fits comfortably inside the 4×6 receipt header
 * column. Customer linkage is recovered post-scan via the looked-up
 * sale's customerId field — no need to encode it inside the barcode.
 *
 * Falls back to the internal sale id if invoiceNumber is somehow
 * missing — the resulting payload still parses and looks up.
 */
export function buildReceiptBarcodePayload(sale: Pick<Sale, 'invoiceNumber' | 'id' | 'customerId'> | null | undefined): string {
  if (!sale) return '';
  const ref = (sale.invoiceNumber && sale.invoiceNumber.trim()) || sale.id || '';
  if (!ref) return '';
  return [PREFIX, KIND_SALE_SHORT, ref].join(SEP);
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
 * Decode a scanned barcode value. Forward-compatible across all
 * historical receipt formats so reprints from older receipts keep
 * resolving to a sale:
 *
 *   CHP|S|{invoiceNumber}                       — current short form
 *   CHP|SALE|{invoiceNumber}                    — V1 long form
 *   CHP|SALE|{invoiceNumber}|CUST|{customerId}  — V1 with customer
 *   {invoiceNumber}                             — pre-V1 raw form
 *
 * Returns:
 *   - parsed payload with structured=true for any CHP|... format
 *   - parsed payload with structured=false for bare invoice values
 *   - null when the value is empty or otherwise unparseable
 */
export function parseReceiptBarcodePayload(value: string | null | undefined): ParsedReceiptBarcode | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Bare (pre-V1) format — no pipes, treat the whole string as saleRef.
  if (!raw.includes(SEP)) {
    return { saleRef: raw, raw, structured: false };
  }

  const parts = raw.split(SEP);
  if (parts.length < 3) return null;
  if (parts[0] !== PREFIX) return null;

  const kind = parts[1];
  // Accept both the current short kind ('S') and the legacy long kind ('SALE').
  if (kind !== KIND_SALE_SHORT && kind !== KIND_SALE) return null;

  const saleRef = (parts[2] || '').trim();
  if (!saleRef) return null;

  const out: ParsedReceiptBarcode = { saleRef, raw, structured: true };

  // Legacy CUST segment (V1 long with customer). Only meaningful when
  // kind is 'SALE'; we ignore it on 'S' since the short form never
  // emits it. Order is fixed: CHP|SALE|ref|CUST|id.
  if (kind === KIND_SALE && parts[3] === KIND_CUSTOMER && parts[4]) {
    const cid = parts[4].trim();
    if (cid) out.customerId = cid;
  }

  return out;
}

/** Quick check used by the scanner router to short-circuit on any
 *  structured CHP|S|... or CHP|SALE|... format. */
export function isStructuredReceiptBarcode(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = String(value).trim();
  return (
    trimmed.startsWith(`${PREFIX}${SEP}${KIND_SALE_SHORT}${SEP}`)
    || trimmed.startsWith(`${PREFIX}${SEP}${KIND_SALE}${SEP}`)
  );
}
