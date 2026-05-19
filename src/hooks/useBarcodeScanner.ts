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
//   3. Customer (GC-xxxx)                → PhonePaymentModal pre-filled
//   4. Anything else                     → POS search (inventory barcode)
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
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in an input, textarea, or select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const now = Date.now();
      const gap = now - lastKeyRef.current;
      lastKeyRef.current = now;

      // Enter = scanner finished — flush the buffer
      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (code.length >= minLength) {
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
      const invPrefix  = (invoicePrefix  || 'INV').toUpperCase();
      const custPrefix = (customerPrefix || 'GC').toUpperCase();
      // Priority: invoice → customer → inventory
      if (upper.startsWith(`${invPrefix}-`)) {
        onInvoiceScan(code);
      } else if (upper.startsWith(`${custPrefix}-`)) {
        onCustomerScan(code);
      } else {
        // Anything else → inventory barcode
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
