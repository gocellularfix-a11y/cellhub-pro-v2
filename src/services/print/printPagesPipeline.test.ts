// R-2.1.4-PRINT-PAGES — main-process selected-page pipeline unit tests.
// Exercises electron/printPages.js (the REAL production module) with injected
// fakes: verifies sizing math, defensive IPC normalization, and — critically —
// that NO failure path ever falls back to printing the complete document.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — CJS main-process module without type declarations.
import printPages from '../../../electron/printPages.js';

const {
  micronsToInches,
  normalizeZeroBasedRanges,
  pagesBeyondCount,
  countSelectedPages,
  toPdfRangeString,
  rasterDpiForPageSize,
  printSelectedPages,
} = printPages;

const LETTER = { width: 215900, height: 279400 };
const R80MM = { width: 80000, height: 297000 };
const R4X6 = { width: 101600, height: 152400 };

describe('sizing math (printToPDF takes INCHES — verified empirically)', () => {
  it('letter microns → 8.5 × 11 in exactly', () => {
    expect(micronsToInches(LETTER)).toEqual({ width: 8.5, height: 11 });
  });
  it('4×6 microns → 4 × 6 in exactly', () => {
    expect(micronsToInches(R4X6)).toEqual({ width: 4, height: 6 });
  });
  it('80mm microns → 80/25.4 × 297/25.4 in', () => {
    const r = micronsToInches(R80MM);
    expect(r.width).toBeCloseTo(80 / 25.4, 10);
    expect(r.height).toBeCloseTo(297 / 25.4, 10);
  });
  it('receipt-class media rasters at 300 dpi, sheets at 200 dpi', () => {
    expect(rasterDpiForPageSize(R80MM)).toBe(300);
    expect(rasterDpiForPageSize(R4X6)).toBe(300);
    expect(rasterDpiForPageSize(LETTER)).toBe(200);
  });
});

describe('defensive renderer→main range normalization (0-based IPC contract)', () => {
  it('converts, sorts, merges and dedupes', () => {
    expect(normalizeZeroBasedRanges([{ from: 0, to: 0 }])).toEqual([{ from: 1, to: 1 }]);
    expect(normalizeZeroBasedRanges([{ from: 2, to: 3 }, { from: 0, to: 0 }])).toEqual([{ from: 1, to: 1 }, { from: 3, to: 4 }]);
    expect(normalizeZeroBasedRanges([{ from: 0, to: 2 }, { from: 1, to: 3 }])).toEqual([{ from: 1, to: 4 }]);
  });
  it('rejects malformed payloads instead of guessing', () => {
    expect(normalizeZeroBasedRanges(null)).toBeNull();
    expect(normalizeZeroBasedRanges([])).toBeNull();
    expect(normalizeZeroBasedRanges([{ from: -1, to: 0 }])).toBeNull();
    expect(normalizeZeroBasedRanges([{ from: 2, to: 1 }])).toBeNull();
    expect(normalizeZeroBasedRanges([{ from: 0.5, to: 1 }])).toBeNull();
    expect(normalizeZeroBasedRanges([{ from: 'x', to: 1 }])).toBeNull();
  });
  it('the IPC payload is plain-JSON serializable end to end', () => {
    const payload = {
      html: '<h1>doc</h1>', deviceName: 'POS-80C',
      pageSize: R4X6, landscape: false, scaleFactor: 100, copies: 1,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageRanges: [{ from: 0, to: 0 }, { from: 2, to: 3 }],
    };
    const wire = JSON.parse(JSON.stringify(payload));
    expect(wire).toEqual(payload);
    expect(normalizeZeroBasedRanges(wire.pageRanges)).toEqual([{ from: 1, to: 1 }, { from: 3, to: 4 }]);
  });
});

describe('bounds helpers', () => {
  it('identifies pages beyond the document', () => {
    expect(pagesBeyondCount([{ from: 1, to: 1 }], 4)).toEqual([]);
    expect(pagesBeyondCount([{ from: 3, to: 6 }], 4)).toEqual([5, 6]);
  });
  it('range-string form matches printToPDF expectations', () => {
    expect(toPdfRangeString([{ from: 1, to: 1 }, { from: 3, to: 4 }])).toBe('1,3-4');
  });
  it('countSelectedPages is exact', () => {
    expect(countSelectedPages([{ from: 1, to: 1 }, { from: 3, to: 4 }])).toBe(3);
  });
});

// ── printSelectedPages orchestration with injected fakes ──────

function fakePage(n: number) {
  return { dataUrl: `data:image/png;base64,PAGE${n}`, widthPt: 612, heightPt: 792 };
}

function basePayload() {
  return {
    deviceName: 'Canon MF210 Series', copies: 1, landscape: false,
    scaleFactor: 100, pageSize: LETTER,
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
  };
}

describe('printSelectedPages — success path', () => {
  it('slices with a 1-based range string, inches page size, and prints the composed pages once', async () => {
    const calls: Record<string, unknown[]> = { pdf: [], raster: [], print: [] };
    const result = await printSelectedPages({
      sourceWebContents: null,
      payload: basePayload(),
      ranges1: [{ from: 1, to: 1 }, { from: 3, to: 4 }],
      effectivePageSize: LETTER,
      deps: {
        printToPdf: async (opts: unknown) => { calls.pdf.push(opts); return Buffer.from('pdf'); },
        rasterize: async () => { calls.raster.push(1); return [fakePage(1), fakePage(3), fakePage(4)]; },
        printComposed: async (pages: unknown[], payload: unknown) => { calls.print.push({ pages, payload }); return { success: true }; },
      },
    });
    expect(result).toEqual({ success: true, error: null, printedPages: 3 });
    expect(calls.pdf).toHaveLength(1);
    const pdfOpts = calls.pdf[0] as { pageRanges: string; pageSize: { width: number; height: number }; preferCSSPageSize: boolean };
    expect(pdfOpts.pageRanges).toBe('1,3-4');
    expect(pdfOpts.pageSize).toEqual({ width: 8.5, height: 11 });
    expect(pdfOpts.preferCSSPageSize).toBe(true);
    expect(calls.print).toHaveLength(1);
    const printed = calls.print[0] as { pages: unknown[] };
    expect(printed.pages).toHaveLength(3);
  });

  it('one selected page produces a one-page composed job; contiguous ranges match counts', async () => {
    for (const [ranges, pages] of [
      [[{ from: 1, to: 1 }], [fakePage(1)]],
      [[{ from: 2, to: 3 }], [fakePage(2), fakePage(3)]],
    ] as const) {
      const result = await printSelectedPages({
        sourceWebContents: null, payload: basePayload(), ranges1: ranges as never, effectivePageSize: LETTER,
        deps: {
          printToPdf: async () => Buffer.from('pdf'),
          rasterize: async () => [...pages],
          printComposed: async () => ({ success: true }),
        },
      });
      expect(result.success).toBe(true);
      expect(result.printedPages).toBe(pages.length);
    }
  });

  it('selected-page order is preserved through composition', async () => {
    let composedOrder: string[] = [];
    await printSelectedPages({
      sourceWebContents: null, payload: basePayload(), ranges1: [{ from: 1, to: 1 }, { from: 3, to: 4 }], effectivePageSize: LETTER,
      deps: {
        printToPdf: async () => Buffer.from('pdf'),
        rasterize: async () => [fakePage(1), fakePage(3), fakePage(4)],
        printComposed: async (pages: Array<{ dataUrl: string }>) => { composedOrder = pages.map((p) => p.dataUrl); return { success: true }; },
      },
    });
    expect(composedOrder).toEqual(['data:image/png;base64,PAGE1', 'data:image/png;base64,PAGE3', 'data:image/png;base64,PAGE4']);
  });
});

describe('printSelectedPages — failures NEVER print the full document', () => {
  it('PDF slicing failure → job fails, nothing is printed', async () => {
    let printCalls = 0;
    const result = await printSelectedPages({
      sourceWebContents: null, payload: basePayload(), ranges1: [{ from: 2, to: 3 }], effectivePageSize: LETTER,
      deps: {
        printToPdf: async () => { throw new Error('printToPDF exploded'); },
        rasterize: async () => { throw new Error('should not be reached'); },
        printComposed: async () => { printCalls++; return { success: true }; },
      },
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('printToPDF exploded');
    expect(printCalls).toBe(0);
  });

  it('rasterization failure → job fails, nothing is printed', async () => {
    let printCalls = 0;
    const result = await printSelectedPages({
      sourceWebContents: null, payload: basePayload(), ranges1: [{ from: 2, to: 3 }], effectivePageSize: LETTER,
      deps: {
        printToPdf: async () => Buffer.from('pdf'),
        rasterize: async () => { throw new Error('raster died'); },
        printComposed: async () => { printCalls++; return { success: true }; },
      },
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('raster died');
    expect(printCalls).toBe(0);
  });

  it('page-count mismatch between selection and output → job fails', async () => {
    let printCalls = 0;
    const result = await printSelectedPages({
      sourceWebContents: null, payload: basePayload(), ranges1: [{ from: 2, to: 3 }], effectivePageSize: LETTER,
      deps: {
        printToPdf: async () => Buffer.from('pdf'),
        rasterize: async () => [fakePage(2)], // produced 1, expected 2
        printComposed: async () => { printCalls++; return { success: true }; },
      },
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('expected 2 pages');
    expect(printCalls).toBe(0);
  });

  it('composed print failure → reported as failure, exactly ONE print attempt, no retry-all', async () => {
    let printCalls = 0;
    const result = await printSelectedPages({
      sourceWebContents: null, payload: basePayload(), ranges1: [{ from: 2, to: 3 }], effectivePageSize: LETTER,
      deps: {
        printToPdf: async () => Buffer.from('pdf'),
        rasterize: async () => [fakePage(2), fakePage(3)],
        printComposed: async () => { printCalls++; return { success: false, failureReason: 'Printer on fire' }; },
      },
    });
    expect(result).toEqual({ success: false, error: 'Printer on fire', printedPages: 0 });
    expect(printCalls).toBe(1);
  });

  it('pipeline uses no temporary files (fully in-memory contract)', async () => {
    // The production pipeline passes buffers/data URLs only; printPages.js
    // touches fs solely to READ the pdf.js sources. Assert the module has no
    // temp-file API surface to misuse.
    const keys = Object.keys(printPages);
    expect(keys).not.toContain('writeTempFile');
    const src = String(printSelectedPages);
    expect(src).not.toMatch(/writeFile|tmpdir|mkdtemp/);
  });
});
