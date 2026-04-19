import { useCallback, useState } from 'react';

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
export type PrintPageSizeKey = '4x6' | '80mm' | 'letter' | 'legal' | 'a4' | 'label';

export interface PrintOptions {
  /** If true AND a printer is provided AND we're in Electron, skip the
   *  modal entirely and send straight to the printer. */
  silent?: boolean;
  /** Device name from window.electronAPI.getPrinters(). */
  printer?: string;
  /** Initial page size for the modal, or page size for silent print. */
  pageSize?: PrintPageSizeKey;
  /** Number of copies (silent path uses this directly). */
  copies?: number;
  /** Landscape orientation. */
  landscape?: boolean;
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

  // ── Path 1: Electron silent print (bypass modal) ──────────
  if (
    opts.silent &&
    opts.printer &&
    typeof window !== 'undefined' &&
    window.electronAPI?.printRun
  ) {
    try {
      const ps = PAGE_SIZE_MICRONS[opts.pageSize || '4x6'];
      await window.electronAPI.printRun({
        html,
        deviceName: opts.printer,
        pageSize: ps,
        landscape: opts.landscape || false,
        scaleFactor: 100,
        copies: opts.copies || 1,
      });
      return;
    } catch (err) {
      // Silent path failed — fall through to modal as a recovery surface
      // so the cashier still sees something instead of an invisible failure.
      console.error('[print] silent printRun failed, falling back to modal:', err);
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
