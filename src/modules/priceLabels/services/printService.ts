/**
 * Low-level print primitives.
 *
 * Isolated here so CellHub Pro can swap window.print() for
 * Electron's webContents.print() or a DYMO SDK call without
 * touching any React component.
 *
 * LABEL-STUDIO-DIRECT-PRINT-AND-DYMO-LIKE-TEXT-V1: that swap happened —
 * printLabelDirect routes label jobs through the EXISTING app print bridge
 * (openPrintWindow → electronAPI.printRun → hidden BrowserWindow →
 * webContents.print silent). No Chrome/Windows dialog in Electron.
 * triggerBrowserPrint stays only as the explicit browser-dev fallback.
 */

import { openPrintWindow } from '@/hooks/usePrint';

export const PRINT_CONTAINER_ID = 'price-label-print-root';

/** Returns the DOM node that hosts the React print portal. */
export function getPrintContainer(): HTMLElement | null {
  return document.getElementById(PRINT_CONTAINER_ID);
}

/** Triggers the browser/Electron native print dialog.
 *  DEV-ONLY fallback — production Electron label printing goes through
 *  printLabelDirect below. */
export function triggerBrowserPrint(): void {
  window.print();
}

/** localStorage key for the per-machine Label Studio printer selection.
 *  Stored locally (NOT in settings) because the connected label printer is
 *  a property of the physical station, not of the store. */
export const LABEL_PRINTER_STORAGE_KEY = 'cellhub:labelStudio:printer:v1';

export function readLabelPrinter(): string {
  try { return localStorage.getItem(LABEL_PRINTER_STORAGE_KEY) || ''; } catch { return ''; }
}

export function saveLabelPrinter(name: string): void {
  try { localStorage.setItem(LABEL_PRINTER_STORAGE_KEY, name); } catch { /* best-effort */ }
}

/**
 * Wrap already-rendered label markup (the portal's innerHTML — barcodes/QRs
 * fully painted) in a deterministic, label-only print document:
 * exact mm page size, zero margins, white surface, overflow hidden.
 * Inner content is px-sized at 96dpi (mmToPx) so px ≡ mm at print time.
 */
export function buildLabelPrintHtml(innerHtml: string, widthMm: number, heightMm: number): string {
  const w = widthMm.toFixed(2);
  const h = heightMm.toFixed(2);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Label</title>
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${w}mm; background: #fff; }
  .print-label-page {
    position: relative;
    width: ${w}mm;
    height: ${h}mm;
    background: #fff;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .print-label-page:last-child { page-break-after: auto; break-after: auto; }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>${innerHtml}</body></html>`;
}

export type LabelPrintMode = 'electron-silent' | 'electron-modal' | 'browser-dev';

/**
 * Direct label print. Routing:
 *  - Electron + printer selected → silent printRun (hidden window, exact
 *    mm page size, zero margins). NO Chrome/Windows dialog.
 *  - Electron, no printer selected → internal PrintPreviewModal (still no
 *    Chrome dialog) so the operator can pick a device once.
 *  - Browser (npm run dev) → window.open + window.print — DEV-ONLY fallback,
 *    silent printing is impossible without the Electron bridge.
 *
 * Copies are pre-expanded as .print-label-page divs in `innerHtml` (one page
 * each), so printRun copies stays 1 and the dev fallback prints all copies
 * too — identical output on both paths.
 */
export async function printLabelDirect(
  innerHtml: string,
  widthMm: number,
  heightMm: number,
  printer: string,
): Promise<LabelPrintMode> {
  const html = buildLabelPrintHtml(innerHtml, widthMm, heightMm);
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.printRun;
  const mode: LabelPrintMode = isElectron
    ? (printer ? 'electron-silent' : 'electron-modal')
    : 'browser-dev';
  await openPrintWindow(html, {
    silent: !!printer,
    printer: printer || undefined,
    pageSizeMicrons: {
      width: Math.round(widthMm * 1000),
      height: Math.round(heightMm * 1000),
    },
    // R-PRINT-MEDIA-GUARD-V1-FIX-1: seed the PrintPreviewModal (no-printer
    // path) with the label page size instead of its 4×6 default, so the
    // preview AND the media guard see a label job. The silent path is
    // unaffected — pageSizeMicrons above takes precedence there (exact mm).
    pageSize: 'label',
    copies: 1,
  });
  return mode;
}
