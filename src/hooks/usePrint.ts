import { useCallback, useState } from 'react';
// LAN-HARDWARE-BRIDGE-FOUNDATION-V1: on a read-only LAN Secondary, receipt
// prints are forwarded to the Primary (which owns the printer).
import { isLanSecondaryReadOnly } from '@/hooks/useLanReadOnly';
import { sendPrintReceipt, emitLanPrintResult } from '@/services/lan/lanService';
// R-PRINT-MEDIA-GUARD-V1: media validation for the SILENT path — the job's
// exact microns are compared to the target printer's configured media type
// (warn / auto-route labels). Fail-open when nothing is configured.
import {
  checkPrintMediaJob,
  requestPrintMediaConfirmation,
  announcePrintReroute,
  announcePrintRecovery,
} from '@/services/print/printMediaGuard';

/**
 * Print abstraction — routes to the best print path per environment.
 *
 * Electron:
 *   - silent + printer  → fires window.electronAPI.printRun() directly,
 *                         bypassing the modal entirely. This is the path
 *                         POS receipts, repair tickets, and labels take
 *                         when a default thermal printer is configured.
 *   - otherwise         → opens PrintPreviewModal with live PDF preview,
 *                         printer picker, scale, margins, zoom — fully
 *                         internal, no Chrome / Windows dialog.
 *
 * Browser:
 *   - silent            → window.open() + immediate window.print()
 *   - otherwise         → window.open() + native browser print dialog
 *
 * r-print-contract: previously the options arg was named `_options` and
 * silently dropped. Every caller (POS, repairs, unlocks, layaways, returns,
 * employees, tax, reports, barcode, notepad, estimate) was passing
 * `{ silent, printer }` and being ignored. This restores the contract.
 */

/** Page size keys understood by PrintPreviewModal — mirror of PAGE_SIZES */
export type PrintPageSizeKey = '4x6' | '80mm' | 'letter' | 'legal' | 'a4' | 'label' | 'cr80';

export interface PrintOptions {
  /** If true AND a printer is provided AND we're in Electron, skip the
   *  modal entirely and send straight to the printer. */
  silent?: boolean;
  /** Device name from window.electronAPI.getPrinters(). */
  printer?: string;
  /** Initial page size for the modal, or page size for silent print. */
  pageSize?: PrintPageSizeKey;
  /** LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1: exact page size in
   *  microns for the SILENT path — takes precedence over `pageSize`. Lets
   *  arbitrary label dimensions (e.g. 89×36mm) print exactly without adding
   *  a fixed key per size. Ignored by the modal path. */
  pageSizeMicrons?: { width: number; height: number };
  /** Number of copies (silent path uses this directly). */
  copies?: number;
  /** Landscape orientation. */
  landscape?: boolean;
  /** LAN-HARDWARE-BRIDGE-FOUNDATION-V1: when true AND this machine is a
   *  read-only LAN Secondary, the print is FORWARDED to the Primary (which owns
   *  the printer) instead of printing locally. Opt-in per receipt call site —
   *  default false keeps every other print (labels, reports, Primary) local. */
  bridgeReceipt?: boolean;
  /** Optional label for the forwarded receipt (e.g. 'pos_receipt'). */
  receiptType?: string;
  /** R-PRINT-MULTIPAGE-PREVIEW-V1: opt-in for multi-page sheet documents
   *  (e.g. the Tax Organizer Letter summary). When true, PrintPreviewModal
   *  lets the preview iframe grow to the full document height and scroll
   *  vertically instead of clamping to one fixed page (overflow:hidden).
   *  Default/undefined keeps the single-fixed-page receipt behavior. The
   *  actual print is unaffected — print:run already paginates the full HTML. */
  multiPage?: boolean;
  /** R-POS-PAGESIZE-REBAKE-V1: re-bake the receipt HTML for a different page
   *  size. When provided AND receiptType==='pos_receipt', PrintPreviewModal
   *  RE-ENABLES the page-size picker — changing the size calls this to
   *  regenerate the correctly-templated receipt (dedicated-80mm vs shared-4x6,
   *  with the matching skinny barcode) for BOTH preview and print, instead of
   *  resizing stale 4x6/80mm markup. Omit it → the picker stays locked and
   *  Settings → Paper Size remains the single source of truth (legacy behavior). */
  rebakeForPageSize?: (size: PrintPageSizeKey) => string;
}

/** State holder for the print modal — consumed by AppProvider or layout root */
export interface PrintModalState {
  open: boolean;
  html: string;
  options?: PrintOptions;
}

/** Microns for each page size — must match PrintPreviewModal's PAGE_SIZES */
const PAGE_SIZE_MICRONS: Record<PrintPageSizeKey, { width: number; height: number }> = {
  '4x6':    { width: 101600, height: 152400 },
  '80mm':   { width: 80000,  height: 297000 },
  'letter': { width: 215900, height: 279400 },
  'legal':  { width: 215900, height: 355600 },
  'a4':     { width: 210000, height: 297000 },
  'label':  { width: 57150,  height: 31750  },
  'cr80':   { width: 85600,  height: 54000  },
};

/** Global print state — set by usePrint, read by the modal host */
let _setPrintModal: ((state: PrintModalState) => void) | null = null;

/** Called once by the component that hosts PrintPreviewModal */
export function registerPrintModalSetter(setter: (state: PrintModalState) => void) {
  _setPrintModal = setter;
}

/**
 * Standalone print function — usable outside React hooks.
 *
 * Routing decision:
 *   1. Electron + silent + printer → call printRun directly (no modal)
 *   2. Electron + modal setter     → open PrintPreviewModal with options
 *   3. Browser + silent            → window.open + immediate print
 *   4. Browser fallback            → window.open + manual print dialog
 */
export async function openPrintWindow(html: string, options?: PrintOptions): Promise<void> {
  const opts = options || {};

  // ── LAN-HARDWARE-BRIDGE-FOUNDATION-V1: forward receipt prints to the Primary ──
  // On a read-only LAN Secondary, a receipt print is sent to the Primary, which
  // prints on its own hardware. Silent + toast-only feedback (no modal). NOT
  // retried (printing isn't idempotent). Any other print / role is unaffected.
  if (opts.bridgeReceipt && isLanSecondaryReadOnly()) {
    const pageSize = opts.pageSizeMicrons || PAGE_SIZE_MICRONS[opts.pageSize || '4x6'];
    try {
      const ack = await sendPrintReceipt({
        receiptType: opts.receiptType || 'receipt',
        html,
        copies: opts.copies || 1,
        pageSize,
      });
      emitLanPrintResult({ ok: !!ack.ok, error: ack.ok ? undefined : (ack.error || 'print_failed') });
    } catch {
      emitLanPrintResult({ ok: false, error: 'bridge_error' });
    }
    return;
  }

  // ── Path 1: Electron silent print (bypass modal) ──────────
  if (
    opts.silent &&
    opts.printer &&
    typeof window !== 'undefined' &&
    window.electronAPI?.printRun
  ) {
    const ps = opts.pageSizeMicrons || PAGE_SIZE_MICRONS[opts.pageSize || '4x6'];

    // R-PRINT-MEDIA-GUARD-V1: validate job media vs the configured printer
    // type BEFORE the job leaves. Silent prints are the dangerous path (no
    // human sees a preview) — a label sent to the 4×6 thermal jams mid-feed.
    let targetPrinter = opts.printer;
    const verdict = checkPrintMediaJob(ps, targetPrinter);
    // R-PRINT-MEDIA-GUARD-V1-FIX-1: instrumentation — always log what the
    // guard saw and decided so wrong-media incidents are diagnosable from
    // DevTools without re-instrumenting.
    // eslint-disable-next-line no-console
    console.info('[print] media guard (silent):', JSON.stringify({
      printer: targetPrinter, pageSize: ps, verdict,
    }));
    if (verdict.action === 'reroute') {
      // Smart mapping: labels auto-route to the dedicated label printer.
      console.info('[print] media guard: label job rerouted', verdict.printerName, '→', verdict.to);
      announcePrintReroute(verdict.printerName, verdict.to);
      targetPrinter = verdict.to;
    } else if (verdict.action === 'warn') {
      const proceed = await requestPrintMediaConfirmation(verdict);
      if (!proceed) return; // Cancel (default) — job never sent
    }

    try {
      await window.electronAPI.printRun({
        html,
        deviceName: targetPrinter,
        pageSize: ps,
        landscape: opts.landscape || false,
        scaleFactor: 100,
        copies: opts.copies || 1,
      });
      return;
    } catch (err) {
      // Silent path failed — fall through to modal as a recovery surface
      // so the cashier still sees something instead of an invisible failure.
      // R-PRINT-MEDIA-GUARD-V1: also surface the jam-recovery guide.
      console.error('[print] silent printRun failed, falling back to modal:', err);
      announcePrintRecovery();
    }
  }

  // ── Path 2: Electron modal (with caller's options as defaults) ──
  if (typeof window !== 'undefined' && window.electronAPI?.printPreview && _setPrintModal) {
    _setPrintModal({ open: true, html, options: opts });
    return;
  }

  // ── Path 3 & 4: Browser fallback ──────────────────────────
  const w = window.open('', '_blank', 'width=450,height=700');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    // For both silent and non-silent in the browser, fire window.print().
    // The browser shows its native dialog either way; "silent" in a browser
    // is not actually possible without printer driver hooks.
    setTimeout(() => { try { w.print(); } catch (_) {} }, 250);
  }
}

export function usePrint() {
  const printHtml = useCallback(async (html: string, options?: PrintOptions) => {
    await openPrintWindow(html, options);
  }, []);

  const printCurrentPage = useCallback(() => {
    window.print();
  }, []);

  return { printHtml, printCurrentPage };
}

/** Hook for the component hosting PrintPreviewModal */
export function usePrintModal() {
  const [printModal, setPrintModal] = useState<PrintModalState>({ open: false, html: '' });

  // Register the setter so openPrintWindow can trigger the modal
  registerPrintModalSetter(setPrintModal);

  const closePrintModal = useCallback(() => {
    setPrintModal({ open: false, html: '' });
  }, []);

  return { printModal, closePrintModal };
}
