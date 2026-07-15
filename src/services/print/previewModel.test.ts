// R-2.1.4-PREVIEW — pure preview-model tests.
// Locks: preview derives from the SAME html + print settings as the job,
// current-page tracking, and the Pages-mode → printRun range mapping
// ("Current page" prints the visible page, never always page 1).
import { describe, it, expect } from 'vitest';
import { buildPreviewPdfRequest, currentPageFromScroll, rangesForPrint } from './previewModel';
import { parsePageRanges, pagesBeyondCount } from '@/utils/pageRanges';

const LETTER = { width: 215900, height: 279400 };

describe('buildPreviewPdfRequest — preview and print share one canonical source', () => {
  it('passes the EXACT print html through untouched (same source document)', () => {
    const html = '<h1>SALES-PAGE-ONE</h1><div style="page-break-after:always"></div><h1>SALES-PAGE-TWO</h1>';
    const req = buildPreviewPdfRequest({ html, pageSizeMicrons: LETTER, landscape: false, scaleFactor: 80, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
    expect(req.html).toBe(html); // identity — no separate preview renderer
  });

  it('maps the same option values the print job uses (size, orientation, scale, margins)', () => {
    const req = buildPreviewPdfRequest({ html: 'x', pageSizeMicrons: LETTER, landscape: true, scaleFactor: 95, margins: { top: 0.25, bottom: 0.25, left: 0.1, right: 0.1 } });
    expect(req).toEqual({
      html: 'x',
      pageSize: { width: 215900, height: 279400 },
      landscape: true,
      scaleFactor: 95,
      margins: { top: 0.25, bottom: 0.25, left: 0.1, right: 0.1 },
    });
  });

  it('never emits negative margins', () => {
    const req = buildPreviewPdfRequest({ html: 'x', pageSizeMicrons: LETTER, landscape: false, scaleFactor: 100, margins: { top: -1, bottom: 0, left: -0.5, right: 0.2 } });
    expect(req.margins).toEqual({ top: 0, bottom: 0, left: 0, right: 0.2 });
  });
});

describe('currentPageFromScroll — visible-page tracking', () => {
  // 4 pages, each 1056px tall + 24px gap → tops at 0, 1080, 2160, 3240.
  const tops = [0, 1080, 2160, 3240];
  const viewport = 800;

  it('at the top the current page is 1', () => {
    expect(currentPageFromScroll(0, viewport, tops)).toBe(1);
  });

  it('scrolled into the page-2 band reports page 2', () => {
    expect(currentPageFromScroll(1100, viewport, tops)).toBe(2);
  });

  it('scrolled to the bottom reports the last page and clamps beyond it', () => {
    expect(currentPageFromScroll(3300, viewport, tops)).toBe(4);
    expect(currentPageFromScroll(99999, viewport, tops)).toBe(4);
  });

  it('degrades safely with no pages', () => {
    expect(currentPageFromScroll(500, viewport, [])).toBe(1);
  });
});

describe('rangesForPrint — Pages mode → printRun payload', () => {
  it('"all" prints the complete document (no ranges key)', () => {
    expect(rangesForPrint('all', 3, 4, null)).toBeUndefined();
  });

  it('"current" on preview page 2 prints ONLY page 2 (0-based {1,1}) — never always page 1', () => {
    expect(rangesForPrint('current', 2, 4, null)).toEqual([{ from: 1, to: 1 }]);
    expect(rangesForPrint('current', 4, 4, null)).toEqual([{ from: 3, to: 3 }]);
  });

  it('"current" on a 1-page document degrades to a full print (identical output)', () => {
    expect(rangesForPrint('current', 1, 1, null)).toBeUndefined();
  });

  it('"current" clamps an out-of-range tracked page', () => {
    expect(rangesForPrint('current', 99, 4, null)).toEqual([{ from: 3, to: 3 }]);
    expect(rangesForPrint('current', 0, 4, null)).toEqual([{ from: 0, to: 0 }]);
  });

  it('"custom" converts validated 1-based ranges to the 0-based contract (unchanged behavior)', () => {
    const parsed = parsePageRanges('1,3-4');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(rangesForPrint('custom', 1, 4, parsed.ranges)).toEqual([{ from: 0, to: 0 }, { from: 2, to: 3 }]);
  });

  it('"custom" bounds-checking uses the REAL preview page count', () => {
    const ok = parsePageRanges('2-3');
    const beyond = parsePageRanges('9');
    if (!ok.ok || !beyond.ok) throw new Error('fixture');
    expect(pagesBeyondCount(ok.ranges, 4)).toEqual([]);
    expect(pagesBeyondCount(beyond.ranges, 4)).toEqual([9]);
  });
});
