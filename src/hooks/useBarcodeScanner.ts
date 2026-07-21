// ============================================================
// CellHub Pro — Global Barcode Scanner Hook
//
// Detects when a USB/Bluetooth barcode scanner fires by watching
// for rapid keystroke sequences (scanners type full strings in
// <100ms, humans can't type that fast).
//
// GSCAN-1: the timing state machine lives in the PURE module
// src/services/scanner/scannerSequence.ts (named thresholds, node-tested).
// This hook is a thin DOM adapter: focus guards + routing only.
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
// Input-focus behavior (GSCAN-1 root-cause fix):
//   Scanner detection runs even when an input/textarea/select is focused.
//   A buffered code routes from inside a focused input when EITHER:
//     a) it matches a KNOWN barcode shape (CH:, CHP|, INV-, GC-?digit) — the
//        historical rule, shape is proof enough at any speed; OR
//     b) the WHOLE sequence was scanner-fast (every inter-key gap AND the
//        Enter terminator within SCANNER_MAX_INTERKEY_MS) — this is what
//        lets plain UPC/EAN/SKU/IMEI codes scan from any screen even while
//        a search/form field has focus. The routed code is cleared from the
//        input so it never lingers as typed text.
//   Slow/normal human typing never satisfies (b), so manual search + normal
//   Enter keep working exactly as before.
//
// Security guard (GSCAN-1, centralized here — the ONLY exemption point):
//   No routing while focus is on a password input (Admin PIN gate, approval
//   PIN) or inside any element marked data-scanner-exempt. AppShell only
//   mounts after login/setup, so those screens are outside the listener
//   entirely.
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
import {
  createScannerSequenceTracker,
  SCANNER_AUTOFLUSH_MS,
  SCANNER_MAX_INTERKEY_MS,
  SCANNER_MIN_LENGTH,
} from '@/services/scanner/scannerSequence';

interface Options {
  invoicePrefix: string;        // e.g. 'INV' — from settings.invoicePrefix
  customerPrefix: string;       // e.g. 'GC'  — from settings.customerNumberPrefix
  onInvoiceScan: (inv: string) => void;       // navigate to Returns + pre-fill
  onCustomerScan: (code: string) => void;     // open PhonePaymentModal pre-filled
  onInventoryScan: (code: string) => void;    // navigate to POS + pre-fill
  minLength?: number;           // min chars to be considered a real scan
  maxInterval?: number;         // max ms between chars to count as scanner
}

/** GSCAN-1 centralized input-security guard: never execute a scan route
 *  while a protected field owns focus. */
function isScanExemptTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement && el.type === 'password') return true;
  return !!(el as HTMLElement).closest?.('[data-scanner-exempt]');
}

export function useBarcodeScanner({
  invoicePrefix,
  customerPrefix,
  onInvoiceScan,
  onCustomerScan,
  onInventoryScan,
  minLength = SCANNER_MIN_LENGTH,
  maxInterval = SCANNER_MAX_INTERKEY_MS,
}: Options): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tracker = createScannerSequenceTracker({ minLength, maxInterkeyMs: maxInterval });
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
    const matchesKnownBarcode = (raw: string): boolean => {
      if (isChBarcode(raw) || isStructuredReceiptBarcode(raw)) return true;
      const upper = raw.toUpperCase();
      return upper.startsWith(`${upperInv}-`) || custRe.test(upper) || genericCredRe.test(upper);
    };

    // Clear a scanned payload that landed in an input before routing so the
    // barcode never lingers as typed text in the focused field.
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

      // Enter = scanner finished — flush the buffer
      if (e.key === 'Enter') {
        const flush = tracker.flushEnter(now);
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (!flush) return;
        // GSCAN-1 security: protected fields never execute a scan route.
        if (isScanExemptTarget(target)) return;
        if (isInput) {
          // Inside a focused input: route on known shape (any speed) OR a
          // fully scanner-fast sequence (plain UPC/SKU/IMEI). Anything else
          // is human typing — the normal Enter/search flow proceeds.
          if (!matchesKnownBarcode(flush.code) && !flush.scannerFast) return;
          if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
            clearScannedFromInput(target, flush.code);
          }
          e.preventDefault();
        }
        routeScan(flush.code);
        return;
      }

      // Non-printable or meta keys — timing note only (mirrors historical
      // listener which stamped every keydown).
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
        tracker.noteKey(now);
        return;
      }

      tracker.feedChar(e.key, now);

      // Auto-flush after silence (some scanners don't send Enter)
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const flush = tracker.flushTimeout();
        if (!flush || !flush.scannerFast) return;
        // Auto-flush has no triggering event — use document.activeElement.
        const ae = document.activeElement;
        if (isScanExemptTarget(ae)) return;
        const aeTag = (ae as HTMLElement | null)?.tagName;
        const aeIsInput = aeTag === 'INPUT' || aeTag === 'TEXTAREA' || aeTag === 'SELECT';
        if (aeIsInput) {
          if (!matchesKnownBarcode(flush.code)) return;
          if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) {
            clearScannedFromInput(ae, flush.code);
          }
        }
        routeScan(flush.code);
      }, SCANNER_AUTOFLUSH_MS);
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
      // shortcut path it already implements.
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
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      tracker.reset();
    };
  }, [invoicePrefix, customerPrefix, onInvoiceScan, onCustomerScan, onInventoryScan, minLength, maxInterval]);
}
