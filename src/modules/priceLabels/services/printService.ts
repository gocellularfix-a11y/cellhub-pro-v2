/**
 * Low-level print primitives.
 *
 * Isolated here so CellHub Pro can swap window.print() for
 * Electron's webContents.print() or a DYMO SDK call without
 * touching any React component.
 */

export const PRINT_CONTAINER_ID = 'price-label-print-root';

/** Returns the DOM node that hosts the React print portal. */
export function getPrintContainer(): HTMLElement | null {
  return document.getElementById(PRINT_CONTAINER_ID);
}

/** Triggers the browser/Electron native print dialog. */
export function triggerBrowserPrint(): void {
  window.print();
}
