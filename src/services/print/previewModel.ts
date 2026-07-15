// ============================================================
// R-2.1.4-PREVIEW — pure logic for the multi-page print preview.
//
// The preview renders the REAL preview PDF (print:preview → printToPDF with
// the same options print:run uses), so page count and page boundaries are
// the print engine's own — never a geometric approximation. These helpers
// keep the modal's decisions pure and unit-testable.
// ============================================================

export interface PreviewPdfRequest {
  html: string;                                   // the EXACT document printRun will receive
  pageSize: { width: number; height: number };    // microns (main converts to inches)
  landscape: boolean;
  scaleFactor: number;                            // percent — same value printRun sends
  margins: { top: number; bottom: number; left: number; right: number }; // inches
}

/**
 * Build the print:preview payload from the SAME values the print job will
 * use. Guarantees the preview and the printed document derive from one
 * canonical HTML + settings set (no separate preview renderer).
 */
export function buildPreviewPdfRequest(args: {
  html: string;
  pageSizeMicrons: { width: number; height: number };
  landscape: boolean;
  scaleFactor: number;
  margins: { top: number; bottom: number; left: number; right: number };
}): PreviewPdfRequest {
  return {
    html: args.html,
    pageSize: { width: args.pageSizeMicrons.width, height: args.pageSizeMicrons.height },
    landscape: !!args.landscape,
    scaleFactor: args.scaleFactor,
    margins: {
      top: Math.max(0, args.margins.top || 0),
      bottom: Math.max(0, args.margins.bottom || 0),
      left: Math.max(0, args.margins.left || 0),
      right: Math.max(0, args.margins.right || 0),
    },
  };
}

/**
 * 1-based page whose vertical band contains the viewport center.
 * `pageTops` are the page tops relative to the scroll content (ascending);
 * works with the zoom transform because callers derive tops from
 * getBoundingClientRect deltas. Clamped to [1, pageCount].
 */
export function currentPageFromScroll(scrollTop: number, viewportHeight: number, pageTops: number[]): number {
  if (pageTops.length === 0) return 1;
  const center = scrollTop + viewportHeight / 2;
  let current = 1;
  for (let i = 0; i < pageTops.length; i++) {
    if (pageTops[i] <= center) current = i + 1;
  }
  return Math.min(Math.max(1, current), pageTops.length);
}

export type PagesMode = 'all' | 'current' | 'custom';

/**
 * Map the Pages selection onto the printRun 0-based pageRanges payload.
 *   - 'all'      → undefined (full document)
 *   - 'current'  → the page currently visible in the preview (NOT always 1);
 *                  a 1-page document degrades to 'all' (identical output)
 *   - 'custom'   → the validated 1-based ranges, converted to 0-based
 */
export function rangesForPrint(
  mode: PagesMode,
  currentPage: number,
  pageCount: number,
  customRanges1: Array<{ from: number; to: number }> | null,
): Array<{ from: number; to: number }> | undefined {
  if (mode === 'custom' && customRanges1 && customRanges1.length > 0) {
    return customRanges1.map((r) => ({ from: r.from - 1, to: r.to - 1 }));
  }
  if (mode === 'current' && pageCount > 1) {
    const page = Math.min(Math.max(1, currentPage), pageCount);
    return [{ from: page - 1, to: page - 1 }];
  }
  return undefined;
}
