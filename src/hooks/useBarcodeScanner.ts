// ============================================================
// CellHub Pro — Global Barcode Scanner Hook
//
// Detects when a USB/Bluetooth barcode scanner fires by watching
// for rapid keystroke sequences (scanners type full strings in
// <100ms, humans can't type that fast).
//
// Routing priority:
//   1. Structured receipt (CHP|SALE|...) → unwrap → onInvoiceScan(saleRef)
//      [R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1]
//   2. Invoice (INV-xxxx)                → Returns module + auto-search
//   3. Customer (GC-xxxx or GCxxxx)      → onCustomerScan
//      [R-CREDENTIAL-BARCODE-SCAN-V2: accept with OR without hyphen so
//       physical credentials printed without the separator still resolve]
//   4. Anything else                     → POS search (inventory barcode)
//
// Input-focus behavior:
//   Scanner detection runs even when an input/textarea/select is focused,
//   but only routes when the buffered code matches a KNOWN barcode shape
//   (CH:, CHP|, INV-, GC-?digit). Anything else inside an input is treated
//   as fast human typing and ignored — so manual typing keeps its normal
//   search behavior. [R-CREDENTIAL-BARCODE-SCAN-V2]
//
// Usage: call once at AppShell level.
// ============================================================

import { useEffect, useRef } from 'react';
import {
  isStructuredReceiptBarcode,
  parseReceiptBarcodePayload,
  isChBarcode,
  parseChBarcode,
} from '@/services/barcode/receiptPayload';

interface Options {
  invoicePrefix: string;        // e.g. 'INV' — from settings.invoicePrefix
  customerPrefix: string;       // e.g. 'GC'  — from settings.customerNumberPrefix
  onInvoiceScan: (inv: string) => void;       // navigate to Returns + pre-fill
  onCustomerScan: (code: string) => void;     // open PhonePaymentModal pre-filled
  onInventoryScan: (code: string) => void;    // navigate to POS + pre-fill
  minLength?: number;           // min chars to be considered a real scan (default 4)
  maxInterval?: number;         // max ms between chars to count as scanner (default 80)
}

export function useBarcodeScanner({
  invoicePrefix,
  customerPrefix,
  onInvoiceScan,
  onCustomerScan,
  onInventoryScan,
  minLength = 4,
  maxInterval = 80,
}: Options): void {
  const bufferRef  = useRef<string>('');
  const lastKeyRef = useRef<number>(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // R-CREDENTIAL-BARCODE-SCAN-V3: classifier-first router.
    //
    // Two regexes — configured + generic. Codes that match EITHER are
    // routed to onCustomerScan; AppShell's handleCustomerScan does the
    // actual lookup (and only falls back to inventory search when no
    // customer can be resolved). This separates classification from
    // resolution so the scanner can't silently misroute a credential
    // just because the store's customerNumberPrefix setting was
    // changed/cleared.
    const upperCust = (customerPrefix || 'GC').toUpperCase();
    const upperInv  = (invoicePrefix  || 'INV').toUpperCase();
    const custRe = new RegExp(`^${upperCust.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-?\\d`);
    // Generic credential shape: 1–4 uppercase letters + optional hyphen
    // + 3+ digits. Catches "GC480055", "CH-1234", "GOC480055" regardless
    // of the configured prefix. Won't match pure-digit UPC barcodes or
    // structured CHP|/CH: receipts (those are handled before this check).
    const genericCredRe = /^[A-Z]{1,4}-?\d{3,}/;

    // Recognises any payload that the router would intentionally consume.
    // Used to gate routing when an input/textarea/select is focused so we
    // never grab arbitrary fast-typed search text.
    const matchesKnownBarcode = (raw: string): boolean => {
      if (isChBarcode(raw) || isStructuredReceiptBarcode(raw)) return true;
      const upper = raw.toUpperCase();
      return upper.startsWith(`${upperInv}-`) || custRe.test(upper) || genericCredRe.test(upper);
    };

    // Clear a scanned payload that landed in an input before opening the
    // action modal so the search/results UI doesn't linger underneath.
    const clearScannedFromInput = (input: HTMLInputElement | HTMLTextAreaElement, code: string) => {
      try {
        const val = input.value;
        if (typeof val !== 'string' || !val.endsWith(code)) return;
        const next = val.slice(0, val.length - code.length);
        const proto = input instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(input, next);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch { /* best-effort cleanup; ignore */ }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      const now = Date.now();
      const gap = now - lastKeyRef.current;
      lastKeyRef.current = now;

      // Enter = scanner finished — flush the buffer
      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (code.length >= minLength) {
          // Inside a focused input, only route if the code looks like a real
          // barcode payload. Otherwise it's a fast human typing — let the
          // normal Enter/search flow proceed.
          if (isInput && !matchesKnownBarcode(code)) return;
          if (isInput && target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
            clearScannedFromInput(target, code);
            e.preventDefault();
          }
          routeScan(code);
        }
        return;
      }

      // Non-printable or meta keys — ignore
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

      // Gap too large → human typing, reset buffer
      if (gap > maxInterval && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      bufferRef.current += e.key;

      // Auto-flush after 200ms silence (some scanners don't send Enter)
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (code.length >= minLength && gap <= maxInterval) {
          // Auto-flush has no triggering event — use document.activeElement
          // to detect a focused input.
          const ae = document.activeElement as HTMLElement | null;
          const aeTag = ae?.tagName;
          const aeIsInput = aeTag === 'INPUT' || aeTag === 'TEXTAREA' || aeTag === 'SELECT';
          if (aeIsInput && !matchesKnownBarcode(code)) return;
          if (aeIsInput && ae && (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement)) {
            clearScannedFromInput(ae, code);
          }
          routeScan(code);
        }
      }, 200);
    };

    const routeScan = (code: string) => {
      // R-PHONE-PAYMENT-RECEIPT-BARCODE-SCAN-V1: CH: prefixed barcodes from
      // phone-payment receipts are checked first.
      //   CH:CUST:{id}           → pass full value; BarcodeActionModal detects
      //                            prefix and opens customer-history mode.
      //   CH:PHONEPAY:{invoiceRef}→ unwrap to invoiceRef → standard invoice path.
      //   CH:PHONE:{number}      → fall through to inventory search.
      if (isChBarcode(code)) {
        const ch = parseChBarcode(code);
        if (ch) {
          if (ch.kind === 'cust') { onInvoiceScan(code); return; }
          if (ch.kind === 'phonepay') { onInvoiceScan(ch.value); return; }
          // phone — no dedicated route, treat as inventory/search
        }
        onInventoryScan(code);
        return;
      }

      // R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1: structured receipt
      // payload (CHP|SALE|{invoiceNumber}[|CUST|{customerId}]) takes
      // precedence. We unwrap to the saleRef and reuse onInvoiceScan
      // so BarcodeActionModal handles the lookup + customer-history
      // shortcut path it already implements. The customer link in the
      // payload is informational redundancy — the in-memory sale's
      // sale.customerId drives the existing UI buttons.
      if (isStructuredReceiptBarcode(code)) {
        const parsed = parseReceiptBarcodePayload(code);
        if (parsed && parsed.saleRef) {
          onInvoiceScan(parsed.saleRef);
          return;
        }
        // Malformed structured payload — fall through to inventory so
        // the cashier still sees something happen.
        onInventoryScan(code);
        return;
      }

      const upper = code.toUpperCase();
      // Priority: invoice → customer → inventory.
      // R-CREDENTIAL-BARCODE-SCAN-V3: customer detection accepts the
      // configured prefix OR the generic letters-then-digits credential
      // shape, so a misconfigured/stale customerNumberPrefix setting
      // can't silently demote a credential scan to inventory search.
      if (upper.startsWith(`${upperInv}-`)) {
        // eslint-disable-next-line no-console
        console.info('[cellhub] scanner: invoice route ←', code);
        onInvoiceScan(code);
      } else if (custRe.test(upper) || genericCredRe.test(upper)) {
        // eslint-disable-next-line no-console
        console.info('[cellhub] scanner: customer credential route ←', code,
          custRe.test(upper) ? '(prefix match)' : '(generic match)');
        onCustomerScan(code);
      } else {
        // eslint-disable-next-line no-console
        console.info('[cellhub] scanner: inventory route ←', code);
        onInventoryScan(code);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [invoicePrefix, customerPrefix, onInvoiceScan, onCustomerScan, onInventoryScan, minLength, maxInterval]);
}
