// ============================================================
// R-2.1.4-PRINT-PAGES — real selected-page printing for Electron/Windows.
//
// WHY THIS EXISTS: on Electron 31.x under Windows, webContents.print() fails
// the ENTIRE job with a generic "Print job failed" whenever `pageRanges` is
// supplied — verified empirically against both a laser (Canon MF210) and a
// thermal (POS-80C) driver: identical jobs succeed without ranges and fail
// with ANY range. Loading the selected-page PDF into a hidden window and
// printing the PDF viewer is also unreliable (the print callback never fires
// and readiness is timing-dependent — verified empirically).
//
// ARCHITECTURE (each step verified empirically before adoption):
//   1. webContents.printToPDF DOES honor `pageRanges` (1-based string like
//      "1,3-4") exactly on this Electron — page counts and page order proven.
//   2. The selected-page PDF is rasterized IN-MEMORY with pdf.js (pdfjs-dist,
//      zero-dependency, injected into a hidden window via executeJavaScript —
//      no temp files, no nodeIntegration).
//   3. The page images are composed into a full-page-image HTML document and
//      printed through the PROVEN webContents.print() path WITHOUT ranges
//      (reliable callback, correct spooler page counts).
//
// FAILURE CONTRACT: any failure in this path REJECTS the job with a clear
// error. It never silently substitutes a full-document print for a
// selected-page job.
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');

// ── Pure helpers (unit-tested from Vitest) ───────────────────

/** Electron printToPDF pageSize object takes INCHES (verified: passing the
 *  renderer's micron values produced a 215,899-inch MediaBox). */
function micronsToInches(size) {
  return { width: size.width / 25400, height: size.height / 25400 };
}

/** Defensive re-normalization of the renderer's 0-based [{from,to}] payload
 *  into sorted, merged, 1-BASED ranges. Returns null when nothing valid. */
function normalizeZeroBasedRanges(ranges) {
  if (!Array.isArray(ranges)) return null;
  const raw = [];
  for (const r of ranges) {
    const from = Number(r && r.from);
    const to = Number(r && r.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from < 0 || to < from) return null;
    raw.push({ from: from + 1, to: to + 1 });
  }
  if (raw.length === 0) return null;
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to + 1) {
      if (r.to > last.to) last.to = r.to;
    } else {
      merged.push({ from: r.from, to: r.to });
    }
  }
  return merged;
}

/** 1-based pages beyond pageCount (empty array = fully in bounds). */
function pagesBeyondCount(ranges1, pageCount) {
  const out = [];
  for (const r of ranges1) {
    for (let p = Math.max(r.from, pageCount + 1); p <= r.to; p++) out.push(p);
  }
  return out;
}

function countSelectedPages(ranges1) {
  return ranges1.reduce((s, r) => s + (r.to - r.from + 1), 0);
}

/** printToPDF range string — 1-based, e.g. "1,3-4". */
function toPdfRangeString(ranges1) {
  return ranges1.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`)).join(',');
}

/** Raster DPI per media. CELLHUB-PRINT-REPORT-CONTRAST-REGRESSION: letter
 *  reports raster at 300 dpi too — 200 dpi visibly softened 7-8pt report
 *  text on selected-page prints (the only rasterizing path; full prints
 *  stay vector). A letter page at 300 dpi is a 2550×3300 canvas — in-memory
 *  cost is fine and the spool is one page image either way. */
function rasterDpiForPageSize(pageSizeMicrons) {
  void pageSizeMicrons;
  return 300;
}

// ── pdf.js source cache (read once per process) ──────────────

let pdfjsSourcesCache = null;
function loadPdfjsSources() {
  if (pdfjsSourcesCache) return pdfjsSourcesCache;
  const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
  pdfjsSourcesCache = {
    pdf: fs.readFileSync(path.join(base, 'legacy', 'build', 'pdf.js'), 'utf8'),
    worker: fs.readFileSync(path.join(base, 'legacy', 'build', 'pdf.worker.js'), 'utf8'),
  };
  return pdfjsSourcesCache;
}

// ── Impure pipeline (Electron required lazily) ───────────────

function createHiddenWindow() {
  const { BrowserWindow } = require('electron');
  return new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
}

/**
 * Rasterize every page of a PDF buffer to PNG data URLs using pdf.js inside
 * a hidden window. Entirely in-memory — no temp files. Throws on failure.
 */
async function rasterizePdfToPages(pdfBuffer, dpi, deps) {
  const d = deps || {};
  const makeWindow = d.createWindow || createHiddenWindow;
  const sources = d.pdfjsSources || loadPdfjsSources();
  const win = makeWindow();
  try {
    await win.loadURL('data:text/html;charset=utf-8,<!DOCTYPE html><html><body></body></html>');
    await win.webContents.executeJavaScript(sources.pdf + '\n;true', true);
    await win.webContents.executeJavaScript(sources.worker + '\n;true', true);
    const b64 = pdfBuffer.toString('base64');
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const lib = globalThis.pdfjsLib || globalThis['pdfjs-dist/build/pdf'];
        if (!lib) return { error: 'pdfjs library global not found' };
        try {
          const bytes = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0));
          const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
          const pages = [];
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const vp = page.getViewport({ scale: ${Number(dpi)} / 72 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(vp.width);
            canvas.height = Math.ceil(vp.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            const vp1 = page.getViewport({ scale: 1 });
            pages.push({ dataUrl: canvas.toDataURL('image/png'), widthPt: vp1.width, heightPt: vp1.height });
          }
          return { pages };
        } catch (e) {
          return { error: String((e && e.message) || e) };
        }
      })()
    `, true);
    if (!result || result.error || !Array.isArray(result.pages) || result.pages.length === 0) {
      throw new Error('PDF rasterization failed: ' + ((result && result.error) || 'no pages produced'));
    }
    return result.pages;
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

/**
 * Compose the rasterized pages into a full-page-image document and print it
 * through the proven no-ranges webContents.print path. Resolves with the
 * printer callback result. Throws on composition failure.
 */
async function printComposedPages(pages, payload, deps) {
  const d = deps || {};
  const makeWindow = d.createWindow || createHiddenWindow;
  const win = makeWindow();
  try {
    const wIn = (pages[0].widthPt / 72).toFixed(4);
    const hIn = (pages[0].heightPt / 72).toFixed(4);
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>`
      + `@page{size:${wIn}in ${hIn}in;margin:0}`
      + `html,body{margin:0;padding:0}`
      + `img{display:block;width:${wIn}in;height:${hIn}in;page-break-after:always}`
      + `img:last-child{page-break-after:auto}`
      + `</style></head><body></body></html>`,
    ));
    for (const page of pages) {
      await win.webContents.executeJavaScript(
        `(() => { const i = document.createElement('img'); i.src = ${JSON.stringify(page.dataUrl)}; document.body.appendChild(i); return true; })()`,
        true,
      );
    }
    await win.webContents.executeJavaScript(
      'Promise.all(Array.from(document.images).map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))).then(() => true)',
      true,
    );
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ success: false, failureReason: 'Print callback timeout' }), 60000);
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: payload.deviceName,
          copies: payload.copies || 1,
          color: payload.color !== false,
          landscape: payload.landscape || false,
          scaleFactor: 100, // page images are already exact-size; source scale was baked into the PDF
          pageSize: payload.pageSize || { width: 101600, height: 152400 },
          margins: { marginType: 'none' }, // margins are baked into the rasterized pages
        },
        (success, failureReason) => { clearTimeout(timer); resolve({ success, failureReason }); },
      );
    });
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

/**
 * Full selected-page print pipeline. `sourceWebContents` must already have
 * the document loaded (main.js's print window). Returns
 * { success, error, printedPages } — NEVER falls back to printing all pages.
 */
async function printSelectedPages({ sourceWebContents, payload, ranges1, effectivePageSize, deps }) {
  const d = deps || {};
  const rangeString = toPdfRangeString(ranges1);
  const pdfOptions = {
    landscape: payload.landscape || false,
    printBackground: true,
    displayHeaderFooter: false,
    preferCSSPageSize: true,
    pageSize: micronsToInches(effectivePageSize),
    scale: (payload.scaleFactor || 100) / 100,
    margins: {
      top: (payload.margins && payload.margins.top) || 0,
      bottom: (payload.margins && payload.margins.bottom) || 0,
      left: (payload.margins && payload.margins.left) || 0,
      right: (payload.margins && payload.margins.right) || 0,
    },
    pageRanges: rangeString,
  };
  const makePdf = d.printToPdf || ((options) => sourceWebContents.printToPDF(options));
  let selectedPdf;
  try {
    selectedPdf = await makePdf(pdfOptions);
  } catch (err) {
    return { success: false, error: 'Selected-page PDF generation failed: ' + ((err && err.message) || err), printedPages: 0 };
  }

  let pages;
  try {
    pages = await (d.rasterize || rasterizePdfToPages)(selectedPdf, rasterDpiForPageSize(effectivePageSize), d);
  } catch (err) {
    return { success: false, error: (err && err.message) || String(err), printedPages: 0 };
  }

  const expected = countSelectedPages(ranges1);
  if (pages.length !== expected) {
    return { success: false, error: `Selected-page output mismatch: expected ${expected} pages, produced ${pages.length}`, printedPages: 0 };
  }

  try {
    const outcome = await (d.printComposed || printComposedPages)(pages, payload, d);
    return {
      success: !!outcome.success,
      error: outcome.success ? null : (outcome.failureReason || 'Print failed'),
      printedPages: outcome.success ? pages.length : 0,
    };
  } catch (err) {
    return { success: false, error: (err && err.message) || String(err), printedPages: 0 };
  }
}

module.exports = {
  micronsToInches,
  normalizeZeroBasedRanges,
  pagesBeyondCount,
  countSelectedPages,
  toPdfRangeString,
  rasterDpiForPageSize,
  rasterizePdfToPages,
  printComposedPages,
  printSelectedPages,
};
