// ============================================================
// CellHub Pro — Print Preview Modal
// Internal print UI: live PDF preview, printer picker, scale,
// margins, zoom. No dependency on Chrome or Windows print dialog.
// ============================================================

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n';
// LAN-PRINT-BRIDGE-UI-COVERAGE-FIX-V1: a Secondary doesn't own/scan printers.
import { useLanReadOnlyMode } from '@/hooks/useLanReadOnly';
// LAN-PRINT-BRIDGE-PRINTPREVIEW-BRIDGED-RECEIPT-FIX-V1: forward bridged receipts.
import { sendPrintReceipt, emitLanPrintResult } from '@/services/lan/lanService';
// R-POS-PAGESIZE-REBAKE-V1: type for the optional receipt re-bake callback.
import type { PrintPageSizeKey } from '@/hooks/usePrint';
// R-PRINT-MEDIA-GUARD-V1: media validation against the printer the user
// picked here. The confirm dialog is rendered by PrintMediaGuardHost at
// zIndex 10000 (this modal is 9999), so awaiting it works from inside.
import { checkPrintMediaJob, requestPrintMediaConfirmation, announcePrintRecovery } from '@/services/print/printMediaGuard';
// R-2.1.4-PRINT-PAGES: canonical page-range parser — single source shared
// with the tests; main re-normalizes the IPC payload defensively.
import { parsePageRanges, pagesBeyondCount } from '@/utils/pageRanges';
import type { PageRange, PageRangeError } from '@/utils/pageRanges';
// R-2.1.4-PREVIEW: exact-parity multi-page preview — the preview renders the
// REAL preview PDF (same options as print:run), so the page count/boundaries
// shown are the print engine's own. Pure decision logic lives in previewModel.
import { buildPreviewPdfRequest, currentPageFromScroll, rangesForPrint } from '@/services/print/previewModel';
import type { PagesMode } from '@/services/print/previewModel';

// pdf.js is loaded lazily (code-split) the first time a sheet-media preview
// opens; the worker ships as a bundled asset so the app stays offline-safe.
let pdfjsLibPromise: Promise<any> | null = null;
function loadPdfjs(): Promise<any> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.js?url'),
    ]).then(([lib, worker]) => {
      const pdfjs = (lib as { default?: unknown }).default ?? lib;
      (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
      return pdfjs;
    });
  }
  return pdfjsLibPromise;
}

// ── Page size presets (width × height in microns) ───────────
const PAGE_SIZES: Record<string, { label: string; width: number; height: number }> = {
  '4x6':    { label: '4×6 (Receipt)',    width: 101600, height: 152400 },
  '80mm':   { label: '80mm Thermal',     width: 80000,  height: 297000 },
  'letter': { label: 'Letter (8.5×11)',  width: 215900, height: 279400 },
  'legal':  { label: 'Legal (8.5×14)',   width: 215900, height: 355600 },
  'a4':     { label: 'A4',              width: 210000, height: 297000 },
  'label':  { label: 'Dymo Label (2¼×1¼")', width: 57150, height: 31750 },
  // R-CR80-ORIENTATION-V1: canonical PORTRAIT/base media (short side = width).
  // webContents.print() ignores the credential HTML @page, so the physical job
  // is driven by this pageSize + landscape. Defining CR80 portrait lets
  // landscape:true rotate it to the correct 85.6×54mm card output (the preview
  // swap logic already handles width/height when landscape is on).
  'cr80':   { label: 'Credential / ID Card (CR80)', width: 54000, height: 85600 },
};

// PRINT-PREVIEW-80MM-CLIP-FIX-V1 — preview-only CSS, injected into the PREVIEW
// srcDoc ONLY (never into the html sent to printRun). ROOT CAUSE: the dedicated
// 80mm receipt template renders two different geometries from the SAME html —
// @media print keeps the content ~58mm wide, LEFT-anchored inside the 80mm
// paper (so the right-aligned money column lands at ~61mm, leaving a wide right
// margin and never reaching the cut), but its @media screen rule stretches the
// content to width:100%, FLUSH against both edges. The preview iframe is exactly
// the paper width with overflow:hidden, so the right-aligned TOTAL / Cash /
// Change column — which print keeps clear via that right margin — sits on the
// iframe's clip edge and gets shaved. This re-adds symmetric horizontal gutters
// in the preview so those columns sit back inside the visible paper. Print
// output is unaffected (printRun never sees this style). Scoped to @media screen
// as a belt-and-suspenders so it can have no effect even if it ever leaked.
const THERMAL80_PREVIEW_CSS =
  '<style data-cellhub-preview-only="1">@media screen{'
  + 'html,body{overflow-x:visible !important;}'
  + 'body{padding-left:4mm !important;padding-right:4mm !important;box-sizing:border-box !important;}'
  + '}</style>';

// PRINT-MODAL-CONTROLS-HARDENING-V1: a single capability map describing which
// sidebar controls actually apply to each page size. Every visible control must
// be truthful — if a control can't be honored by the selected media, it is
// hidden (and, for fixed printer-safe sizes, replaced by a clear note). Keeping
// every pageSize-specific decision here avoids scattering `pageSize === '80mm'`
// checks through the JSX and the print path.
interface PrintControlCaps {
  /** Fixed printer-safe sizing (80mm thermal): the printer/template own the
   *  geometry, so no user scale / margins / orientation are exposed. */
  fixedPrinterSafeSizing: boolean;
  /** Print Scale field — manual % + slider + shrink-to-fit toggle. */
  showPrintScale: boolean;
  showMargins: boolean;
  showOrientation: boolean;
  showPages: boolean;
  showCopies: boolean;
  showPreviewZoom: boolean;
}

function getPrintControlCaps(pageSize: string): PrintControlCaps {
  // 80mm thermal prints from a dedicated template at fixed printer-safe sizing.
  // Scale / margins / orientation / page-range are meaningless for a single-page
  // continuous thermal receipt, so showing them would be untruthful.
  if (pageSize === '80mm') {
    return {
      fixedPrinterSafeSizing: true,
      showPrintScale: false,
      showMargins: false,
      showOrientation: false,
      showPages: false,
      showCopies: true,
      showPreviewZoom: true,
    };
  }
  // 4x6 / Letter / Legal / A4 / Dymo label / CR80 card: full controls. Label and
  // CR80 keep their existing behavior — scale/margins/orientation are meaningful
  // for fixed-dimension card/label stock (rotation, fit), so they stay available.
  return {
    fixedPrinterSafeSizing: false,
    showPrintScale: true,
    showMargins: true,
    showOrientation: true,
    showPages: true,
    showCopies: true,
    showPreviewZoom: true,
  };
}

interface PrintPreviewModalProps {
  open: boolean;
  html: string;
  onClose: () => void;
  /** Optional initial page size key */
  initialPageSize?: string;
  /** r-print-contract: caller-provided defaults from usePrint options.
   *  These seed the modal state but the user can still change anything. */
  initialPrinter?: string;
  initialCopies?: number;
  initialLandscape?: boolean;
  // LAN-PRINT-BRIDGE-PRINTPREVIEW-BRIDGED-RECEIPT-FIX-V1: when a bridge-eligible
  // receipt reaches this modal on a Secondary, keep Print ENABLED and forward
  // it to the Primary (instead of a dead-end disabled state). Non-bridged prints
  // (e.g. Print Desk) stay disabled on a Secondary.
  bridgeReceipt?: boolean;
  receiptType?: string;
  /** R-PRINT-MULTIPAGE-PREVIEW-V1: multi-page Letter document (e.g. Tax
   *  Organizer). Lets the preview iframe grow to full document height and
   *  scroll, instead of clamping to one fixed page. Receipts leave this
   *  undefined → unchanged single-fixed-page preview. */
  multiPage?: boolean;
  /** R-POS-PAGESIZE-REBAKE-V1: when supplied for a pos_receipt, the page-size
   *  picker is re-enabled and this regenerates the receipt HTML for the chosen
   *  size (preview + print). Omit → picker stays locked (legacy behavior). */
  rebakeForPageSize?: (size: PrintPageSizeKey) => string;
}

interface PrinterInfo {
  name: string;
  displayName?: string;
  isDefault: boolean;
  status: number;
}

export default function PrintPreviewModal({
  open,
  html,
  onClose,
  initialPageSize,
  initialPrinter,
  initialCopies,
  initialLandscape,
  bridgeReceipt,
  receiptType,
  multiPage,
  rebakeForPageSize,
}: PrintPreviewModalProps) {
  const { t, locale } = useTranslation();
  // LAN-PRINT-BRIDGE-UI-COVERAGE-FIX-V1: on a LAN Secondary, hide the printer
  // picker + skip the local printer scan (the Primary owns hardware).
  const lanReadOnly = useLanReadOnlyMode();
  // R-PAPERSIZE-DESYNC-LOCK-V1: a POS receipt's HTML is baked from
  // settings.paperSize BEFORE this modal opens (dedicated-80mm vs shared-4x6
  // template). Letting the user change the page size here only resized the
  // physical page — it never re-baked the template — so the printed layout and
  // the page size could silently diverge (Jorge's 80mm-on-4x6-template bug).
  // For POS receipts we LOCK the page size to the baked value and make Settings
  // → Hardware → Paper Size the single source of truth. Scoped to pos_receipt
  // only: labels, reports, repair/special-order tickets keep the full picker.
  // R-POS-PAGESIZE-REBAKE-V1: when the caller supplies a rebake callback, the
  // desync risk is gone — changing the size REGENERATES the receipt from the
  // correct template — so the POS picker is re-enabled. No callback → keep the
  // lock so a baked receipt can never silently diverge from its page size.
  const canRebake = receiptType === 'pos_receipt' && typeof rebakeForPageSize === 'function';
  const lockPageSize = receiptType === 'pos_receipt' && !canRebake;
  // The baked template size = what ReceiptModal passed as pageSize (settings.paperSize).
  const bakedPageSizeKey = initialPageSize || '4x6';
  // LAN-PRINT-BRIDGE-PRINTPREVIEW-BRIDGED-RECEIPT-FIX-V1: a Secondary CAN still
  // print a bridge-eligible receipt — it forwards to the Primary. Print Desk and
  // other non-bridged prints have no bridgeReceipt flag → stay disabled here.
  const canBridge = lanReadOnly && !!bridgeReceipt;
  // ── State ─────────────────────────────────────────────────
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState(() => {
    try { return localStorage.getItem('cellhub_lastPrinter') || initialPrinter || ''; }
    catch { return initialPrinter || ''; }
  });
  const [pageSize, setPageSize] = useState(initialPageSize || '4x6');
  // R-POS-PAGESIZE-REBAKE-V1: the receipt markup actually previewed/printed.
  // Starts as the caller's baked html; when the POS page-size picker changes AND
  // a rebake callback was supplied, it is replaced with freshly-regenerated HTML
  // for the chosen size so preview + print never reuse stale 4x6/80mm markup.
  const [currentHtml, setCurrentHtml] = useState(html);
  const [landscape, setLandscape] = useState(initialLandscape || false);
  const [scaleFactor, setScaleFactor] = useState(100);
  // R-PRINT-SHRINK-TO-FIT: default ON — auto-shrinks oversized content to fit page width.
  const [shrinkToFit, setShrinkToFit] = useState(true);
  const [margins, setMargins] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const [zoom, setZoom] = useState(100);
  const [copies, setCopies] = useState(initialCopies || 1);

  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<string | null>(null);
  // R-PRINT-INPUT-FIX-V1: shadow string states for the percent + copies
  // number inputs. The previous pattern parsed-and-clamped on every
  // keystroke, so typing "75" went "7" → clamp(7, [25,200]) = 25, and
  // the field snapped to 25 before the user could finish typing. With
  // the shadow string we accept whatever the user types, commit the
  // numeric state live only when the typed value is in range, and
  // apply the hard clamp on blur. Slider drags / external resets keep
  // working because the useEffects below mirror scaleFactor → scaleInput
  // and copies → copiesInput whenever the numeric state changes.
  const [scaleInput, setScaleInput] = useState<string>(String(scaleFactor));
  const [copiesInput, setCopiesInput] = useState<string>(String(copies));
  useEffect(() => { setScaleInput(String(scaleFactor)); }, [scaleFactor]);
  useEffect(() => { setCopiesInput(String(copies)); }, [copies]);
  // R-POS-PAGESIZE-REBAKE-V1: a freshly-opened print resets the working HTML to
  // the caller's baked markup. For POS receipts also snap the page-size picker
  // back to the Settings-derived default so a prior temporary override from a
  // previous receipt doesn't carry over. Other flows keep their picker as-is.
  useEffect(() => {
    setCurrentHtml(html);
    if (receiptType === 'pos_receipt') setPageSize(initialPageSize || '4x6');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  // R-2.1.4-PREVIEW: this modal is ALWAYS mounted in the App tree — only `open`
  // toggles visibility — so `useState(initialPageSize || '4x6')` captured the
  // FIRST-mount value (options undefined → '4x6') and never re-initialized when
  // a later caller opened the modal with a different pageSize. That pinned the
  // Sales Report (which asks for 'letter') to the 4×6 default. Re-sync the
  // page-size picker (and orientation/copies, which share the same latent
  // first-mount capture) from the caller's values each time the modal OPENS.
  // Fires only on the open transition, so a user's manual size change while the
  // modal is open is never clobbered.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setPageSize(initialPageSize || '4x6');
      setLandscape(initialLandscape || false);
      setCopies(initialCopies || 1);
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // R-PRINT-PAGE-RANGES-V1: page-range UI. 'all' is the default; 'custom'
  // exposes a free-text input where the owner enters "1", "2", "1-2",
  // "1,3", etc. Parsed into Electron pageRanges {from, to} on print.
  // R-2.1.4-PREVIEW: 'current' prints the page currently visible in the
  // multi-page preview (never "always page 1").
  const [pageRangeMode, setPageRangeMode] = useState<PagesMode>('all');
  const [pageRangeInput, setPageRangeInput] = useState<string>('');
  const [pageRangeError, setPageRangeError] = useState<string | null>(null);

  // ── Load printers on open ─────────────────────────────────
  useEffect(() => {
    if (!open) return;
    // LAN-PRINT-BRIDGE-UI-COVERAGE-FIX-V1: never scan local printers on a Secondary.
    if (lanReadOnly) return;
    if (!window.electronAPI?.getPrinters) return;
    window.electronAPI.getPrinters().then((list) => {
      setPrinters(list || []);
      const saved = (() => { try { return localStorage.getItem('cellhub_lastPrinter') || ''; } catch { return ''; } })();
      if (initialPrinter && list?.some((p) => p.name === initialPrinter)) {
        setSelectedPrinter(initialPrinter);
      } else if (saved && list?.some((p) => p.name === saved)) {
        setSelectedPrinter(saved);
      } else if (!selectedPrinter) {
        const def = list.find((p) => p.isDefault) || list[0];
        if (def) setSelectedPrinter(def.name);
      }
    }).catch(() => {});
  }, [open, html, lanReadOnly]);


  // R-2.1.4-PRINT-PAGES: canonical shared parser (see @/utils/pageRanges).
  // Every invalid input — INCLUDING an empty Custom Range — blocks the print
  // with a specific message; an invalid selection never falls back to
  // printing the complete document.
  const pageRangeErrorMessage = (error: PageRangeError): string => {
    switch (error) {
      case 'empty':    return t('print.rangeError.empty');
      case 'zero':     return t('print.rangeError.zero');
      case 'negative': return t('print.rangeError.negative');
      case 'reversed': return t('print.rangeError.reversed');
      default:         return t('print.rangeError.syntax');
    }
  };

  // ── Print ─────────────────────────────────────────────────
  const handlePrint = async () => {
    // R-2.1.4-PRINT-PAGES / R-2.1.4-CLOSEOUT: validate the custom page range
    // BEFORE anything is sent to a printer — local OR bridged. Empty/zero/
    // negative/reversed/garbage input blocks the job with a specific
    // EN/ES/PT message; the entered range stays in the input for correction.
    let customRanges: PageRange[] | null = null;
    if (pageRangeMode === 'custom') {
      const parsed = parsePageRanges(pageRangeInput);
      if (!parsed.ok) {
        setPageRangeError(pageRangeErrorMessage(parsed.error));
        return;
      }
      // R-2.1.4-PREVIEW: the preview knows the REAL page count (from the
      // preview PDF) — reject pages beyond it here with the actual count,
      // instead of the later generic main-process rejection.
      if (isSheetPreview && previewPages > 0) {
        const beyond = pagesBeyondCount(parsed.ranges, previewPages);
        if (beyond.length > 0) {
          setPageRangeError(t('print.rangeError.beyond').replace('{n}', String(previewPages)));
          return;
        }
      }
      setPageRangeError(null);
      customRanges = parsed.ranges;
    }
    // The IPC/LAN payload stays 0-based [{from,to}] (canonical contract).
    // 'current' prints the page currently visible in the preview; a 1-page
    // document degrades to a full print (identical output).
    const zeroBasedRanges = rangesForPrint(pageRangeMode, currentPage, previewPages, customRanges);
    // LAN-PRINT-BRIDGE-PRINTPREVIEW-BRIDGED-RECEIPT-FIX-V1: a bridge-eligible
    // receipt on a Secondary forwards to the Primary (which owns the printer)
    // instead of printing locally. Toast feedback via LanPrintBridgeListener.
    // R-2.1.4-CLOSEOUT: the FULL validated print contract crosses the LAN
    // (pageRanges, margins, scale, landscape) so the Primary routes the job
    // through the same canonical selected-page pipeline as a direct print.
    if (canBridge) {
      setPrinting(true);
      try {
        // R-PAPERSIZE-DESYNC-LOCK-V1: locked POS receipt always uses the baked size.
        const ps = PAGE_SIZES[lockPageSize ? bakedPageSizeKey : pageSize] || PAGE_SIZES['4x6'];
        const ack = await sendPrintReceipt({
          receiptType: receiptType || 'receipt',
          html: currentHtml,
          copies,
          pageSize: { width: ps.width, height: ps.height },
          pageRanges: zeroBasedRanges,
          margins: effectiveMargins,
          scaleFactor: effectiveScale,
          landscape: effectiveLandscape,
        });
        emitLanPrintResult({ ok: !!ack.ok, error: ack.ok ? undefined : (ack.error || 'print_failed') });
      } catch {
        emitLanPrintResult({ ok: false, error: 'bridge_error' });
      } finally {
        setPrinting(false);
        onClose();
      }
      return;
    }
    if (!window.electronAPI?.printRun || !selectedPrinter) return;
    // R-PRINT-MEDIA-GUARD-V1: the user explicitly picked this printer, so a
    // mismatch never auto-reroutes here — it asks (Cancel focused / Print
    // Anyway). Fail-open when printer types aren't configured in Settings.
    {
      const psCheck = PAGE_SIZES[lockPageSize ? bakedPageSizeKey : pageSize] || PAGE_SIZES['4x6'];
      const verdict = checkPrintMediaJob({ width: psCheck.width, height: psCheck.height }, selectedPrinter);
      // R-PRINT-MEDIA-GUARD-V1-FIX-1: instrumentation for diagnosis.
      // eslint-disable-next-line no-console
      console.info('[print] media guard (modal):', JSON.stringify({
        printer: selectedPrinter, pageSizeKey: lockPageSize ? bakedPageSizeKey : pageSize, verdict,
      }));
      if (verdict.action !== 'ok') {
        const proceed = await requestPrintMediaConfirmation({
          docMedia: verdict.docMedia,
          printerMedia: verdict.printerMedia,
          printerName: selectedPrinter,
        });
        if (!proceed) return;
      }
    }
    try { localStorage.setItem('cellhub_lastPrinter', selectedPrinter); } catch {}
    setPrinting(true);
    setPrintResult(null);
    try {
      // R-PAPERSIZE-DESYNC-LOCK-V1: locked POS receipt always uses the baked size.
      const ps = PAGE_SIZES[lockPageSize ? bakedPageSizeKey : pageSize] || PAGE_SIZES['4x6'];
      // R-PRINT-SHRINK-FIX-V1: pass the effective scale to Electron's
      // printRun. Previously this was hardcoded to 100 — the "Shrink to
      // fit" toggle scaled the PREVIEW iframe via CSS transform but never
      // affected the actual print, so multi-page reports kept printing
      // at 100% and spilling onto two pages. CSS transforms don't survive
      // the print pipeline; scaleFactor (passed to webContents.print) does.
      // R-2.1.4-PRINT-PAGES: the IPC payload stays 0-based [{from,to}]
      // (existing contract, shared with the LAN bridge above). Main
      // re-normalizes defensively, validates against the real page count and
      // prints ONLY the selected pages via the printToPDF → pdf.js raster
      // pipeline — never a full-document substitute.
      const pageRanges = zeroBasedRanges;
      const result = await window.electronAPI.printRun({
        html: currentHtml,
        deviceName: selectedPrinter,
        pageSize: { width: ps.width, height: ps.height },
        landscape: effectiveLandscape,
        scaleFactor: effectiveScale,
        copies,
        margins: effectiveMargins,
        pageRanges,
      });
      if (result.success) {
        setPrintResult('✅ Sent to printer');
        setTimeout(() => onClose(), 1200);
      } else {
        setPrintResult(`❌ ${result.error || 'Print failed'}`);
        // R-PRINT-MEDIA-GUARD-V1: a failed job often means jammed/stuck media —
        // surface the recovery guide (open cover, remove media, recalibrate).
        announcePrintRecovery();
      }
    } catch (err: any) {
      setPrintResult(`❌ ${err.message || 'Print failed'}`);
      announcePrintRecovery();
    } finally {
      setPrinting(false);
    }
  };

  // ── Margin input helper ───────────────────────────────────
  const setMargin = (side: 'top' | 'bottom' | 'left' | 'right', value: number) => {
    setMargins((prev) => ({ ...prev, [side]: Math.max(0, value) }));
  };

  // R-PRINT-SHRINK-FALLBACK-FIX: predictable page-size-based shrink.
  // Replaces the DOM-measurement helper, which couldn't see inside the
  // sandboxed iframe and effectively returned 100 on every flow.
  // R-PRINT-SHRINK-FIX-V1: bumped letter scale 90→80 — at 90% a typical
  // sales report still spilled to 2 pages. 80% reliably fits the
  // 4-card summary + 4 sections + net banner on one letter page.
  // Owner can override with manual scale if a specific report needs
  // different sizing.
  // R-PRINT-PREVIEW-PERF-V1: memoised so unrelated keystrokes (copies,
  // margins, zoom, page ranges) don't recompute the effective scale.
  // Hooks must run BEFORE the early-return below — Rules of Hooks.
  // R-PRINT-MULTIPAGE-PREVIEW-V1: multi-page sheet documents print at the
  // user's scale (100% by default) and must NOT be auto-shrunk — shrinking a
  // multi-page Letter doc to fit "one page" is exactly the wrong behavior.
  // Receipts/reports (multiPage falsy) keep the existing shrink-to-fit formula.
  // PRINT-PREVIEW-80MM-CONTROLS-V1: the 80mm thermal receipt has a dedicated
  // template that authors its own printer-safe content width (70mm body inside
  // 80mm paper). Print Scale / Shrink-to-fit / Margins are 4x6/Letter concerns
  // that never applied to it — and a manual scale left over from a prior Letter
  // print could silently leak into the 80mm job (effectiveScale = scaleFactor
  // when shrinkToFit was off). Pin 80mm to a single fixed printer-safe scale.
  // 95 is EXACTLY the value the default shrink-to-fit path already produced for
  // 80mm, so the physical receipt output is unchanged; this only removes the
  // leak path. PREVIEW/PRINT-SCALE ONLY — no template, payload, or money change.
  // PRINT-MODAL-CONTROLS-HARDENING-V1: single source of truth for which controls
  // apply to the selected page size — consumed by both the print path and the
  // sidebar render, so no scattered pageSize checks downstream.
  const caps = getPrintControlCaps(pageSize);
  const effectiveScale = useMemo(
    () => (
      caps.fixedPrinterSafeSizing
        ? 95
        : (multiPage ? scaleFactor : (shrinkToFit ? (pageSize === 'letter' ? 80 : 95) : scaleFactor))
    ),
    [caps.fixedPrinterSafeSizing, multiPage, shrinkToFit, pageSize, scaleFactor],
  );
  // Stale-state guards: a fixed printer-safe size (80mm) exposes no scale /
  // margins / orientation control, so a value left over from a prior Letter/4x6
  // print must never leak into its print job. For every other size these are the
  // raw user values verbatim → zero behavior change.
  const effectiveMargins = caps.fixedPrinterSafeSizing ? { top: 0, bottom: 0, left: 0, right: 0 } : margins;
  const effectiveLandscape = caps.fixedPrinterSafeSizing ? false : landscape;

  // R-PRINT-PREVIEW-PERF-V1: previously this regex-replace ran on every
  // render, so every keystroke (copies / page range / margin / zoom slider)
  // generated a new string identity, React passed a new srcDoc, and the
  // sandboxed iframe re-parsed the entire receipt HTML. Memoising on the
  // only two inputs that actually affect the output makes unrelated
  // sidebar interactions feel instant.
  // RECEIPT-PRINTER-PAGE-RANGE-FIX-V1: debounce the PREVIEW's scale (150ms)
  // so dragging the scale slider doesn't reload the iframe on every tick —
  // each srcDoc change re-parses the whole receipt document, which made the
  // module feel heavy on large reports. The actual print still uses the
  // live effectiveScale value — only preview latency changes.
  const [previewScale, setPreviewScale] = useState(100);
  useEffect(() => {
    const tid = window.setTimeout(() => setPreviewScale(effectiveScale), 150);
    return () => window.clearTimeout(tid);
  }, [effectiveScale]);
  // R-PRINT-MULTIPAGE-PREVIEW-V1: never apply the center-origin scale transform
  // for multi-page docs — it would shift/clip a tall scrolling document. The
  // preview shows the full document at 100% and scrolls; the user's zoom slider
  // still works (it transforms the outer #print-content wrapper).
  // R-PRINT-80MM-PREVIEW-FIT-V1: narrow thermal receipts (80mm / Dymo label /
  // CR80) are single-column documents already authored to their own page width
  // (the 80mm template even has a dedicated @media screen block). The shrink-to-
  // fit body transform — a 4x6/Letter concern — only shifted/clipped these in the
  // on-screen preview ("zoomed/clipped" look). Render them 1:1 in the preview so
  // they fit the panel with no right-edge clip. PREVIEW-ONLY: the physical print
  // still uses `effectiveScale` via printRun (unchanged), and the 80mm template
  // CSS is untouched.
  const isNarrowThermal = pageSize === '80mm' || pageSize === 'label' || pageSize === 'cr80';
  const scaledHtml = useMemo(
    () => {
      // PRINT-PREVIEW-80MM-CLIP-FIX-V1: the 80mm preview gets the gutter style
      // injected (right before </head> so it wins the cascade over the template's
      // @media screen rule) — this stops the iframe clip edge from shaving the
      // right-aligned money columns. PREVIEW ONLY: printRun uses `currentHtml`,
      // which is never modified here, so the physical receipt is byte-identical.
      if (caps.fixedPrinterSafeSizing) {
        return currentHtml.includes('</head>')
          ? currentHtml.replace('</head>', `${THERMAL80_PREVIEW_CSS}</head>`)
          : THERMAL80_PREVIEW_CSS + currentHtml;
      }
      // 4x6 / Letter / label / cr80 keep their existing preview behavior.
      if (multiPage || previewScale === 100 || isNarrowThermal) return currentHtml;
      return currentHtml.replace(/<body([^>]*)>/i, `<body$1 style="transform: scale(${previewScale / 100}); transform-origin: center center;">`);
    },
    [currentHtml, previewScale, multiPage, isNarrowThermal, caps.fixedPrinterSafeSizing],
  );

  // ── R-2.1.4-PREVIEW: exact-parity multi-page preview ────────────────────
  // ROOT CAUSE this replaces: sheet-media documents rendered in ONE iframe
  // whose height was hard-fixed to a single page (scrolling="no" +
  // overflow:hidden), so a 4-page Sales Report previewed as page 1 only.
  // The old multiPage sheet view (Tax Organizer) sliced GEOMETRICALLY
  // (scrollHeight / pageHeight), which drifts from the print engine's real
  // breaks. Now every sheet-media preview (letter/legal/a4/4x6) renders the
  // REAL preview PDF — generated via print:preview with the SAME html +
  // pageSize + orientation + margins + scale that print:run will use — with
  // pdf.js, page by page. Page count, order and boundaries are the print
  // engine's own. Narrow thermal/label/card media (80mm, Dymo, CR80) keep
  // their tuned 1:1 iframe preview — continuous 80mm has no page concept
  // and must never gain fake page breaks.
  const isSheetPreview = !caps.fixedPrinterSafeSizing && !isNarrowThermal
    && typeof window !== 'undefined' && !!window.electronAPI?.printPreview;
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewPages, setPreviewPages] = useState(0);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null); // PDF points
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const previewSeq = useRef(0);
  const pageImgCache = useRef<Map<number, string>>(new Map());
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const pageCardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const marginsSig = `${effectiveMargins.top}|${effectiveMargins.bottom}|${effectiveMargins.left}|${effectiveMargins.right}`;

  useEffect(() => {
    if (!open || !isSheetPreview) return;
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    setPreviewError(null);
    // Debounce: slider drags / rapid control changes coalesce into one
    // regeneration. Every print-affecting input is in the dep list, so any
    // page-size / orientation / margin / scale change re-renders ALL pages.
    const tid = window.setTimeout(async () => {
      try {
        const psNow = PAGE_SIZES[lockPageSize ? bakedPageSizeKey : pageSize] || PAGE_SIZES['4x6'];
        const req = buildPreviewPdfRequest({
          html: currentHtml,
          pageSizeMicrons: { width: psNow.width, height: psNow.height },
          landscape: effectiveLandscape,
          scaleFactor: effectiveScale,
          margins: effectiveMargins,
        });
        const res = await window.electronAPI!.printPreview(req);
        if (seq !== previewSeq.current) return;
        if (!res?.success || !res.url) {
          setPreviewError(res?.error || 'preview generation failed');
          setPreviewLoading(false);
          return;
        }
        const pdfjs = await loadPdfjs();
        const b64 = String(res.url).split(',')[1] || '';
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
        if (seq !== previewSeq.current) { try { doc.destroy(); } catch { /* ignore */ } return; }
        const firstPage = await doc.getPage(1);
        const vp = firstPage.getViewport({ scale: 1 });
        pageImgCache.current = new Map();
        pageCardRefs.current = [];
        setPreviewDims({ w: vp.width, h: vp.height });
        setPreviewDoc((prev: { destroy?: () => void } | null) => { try { prev?.destroy?.(); } catch { /* ignore */ } return doc; });
        setPreviewPages(doc.numPages);
        setCurrentPage(1);
        setPreviewLoading(false);
      } catch (err) {
        if (seq === previewSeq.current) {
          setPreviewError(String((err as Error)?.message || err));
          setPreviewLoading(false);
        }
      }
    }, 350);
    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isSheetPreview, currentHtml, pageSize, lockPageSize, bakedPageSizeKey, effectiveLandscape, effectiveScale, marginsSig]);

  // Release the PDF and reset preview state when the modal closes.
  useEffect(() => {
    if (open) return;
    previewSeq.current++;
    setPreviewDoc((prev: { destroy?: () => void } | null) => { try { prev?.destroy?.(); } catch { /* ignore */ } return null; });
    setPreviewPages(0);
    setPreviewDims(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setCurrentPage(1);
    pageImgCache.current = new Map();
    pageCardRefs.current = [];
  }, [open]);

  // Track the visible page while the operator scrolls (rAF-throttled;
  // rect-based so the zoom transform doesn't skew the math).
  const scrollRafPending = useRef(false);
  const handlePreviewScroll = () => {
    if (!isSheetPreview || previewPages < 1 || scrollRafPending.current) return;
    scrollRafPending.current = true;
    requestAnimationFrame(() => {
      scrollRafPending.current = false;
      const container = previewScrollRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      const tops = pageCardRefs.current
        .slice(0, previewPages)
        .map((el: HTMLDivElement | null) => (el ? el.getBoundingClientRect().top - containerTop + container.scrollTop : Number.POSITIVE_INFINITY));
      const page = currentPageFromScroll(container.scrollTop, container.clientHeight, tops);
      setCurrentPage((prev) => (prev === page ? prev : page));
    });
  };

  const goToPage = (page: number) => {
    const clamped = Math.min(Math.max(1, page), previewPages || 1);
    setCurrentPage(clamped);
    pageCardRefs.current[clamped - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 'current' only exists for a multi-page sheet preview — never let it leak
  // into a thermal/label job after a page-size switch.
  useEffect(() => {
    if (!isSheetPreview && pageRangeMode === 'current') setPageRangeMode('all');
  }, [isSheetPreview, pageRangeMode]);

  // R-PAPERSIZE-DESYNC-LOCK-V1 guard: a POS receipt's template is already baked
  // from the baked page size. If the size that will actually be sent to the
  // printer (`pageSize`) ever drifts from that baked value, the printed page
  // and the receipt layout would desync. With the picker locked this can't
  // happen via the UI, but the guard surfaces any future/regressed path.
  useEffect(() => {
    if (open && lockPageSize && pageSize !== bakedPageSizeKey) {
      console.warn(
        `[print:desync] POS receipt page size "${pageSize}" != baked template size "${bakedPageSizeKey}". ` +
        'Receipt template was generated from Settings → Paper Size; forcing the baked value to avoid layout/page desync.',
      );
    }
  }, [open, lockPageSize, pageSize, bakedPageSizeKey]);

  if (!open) return null;

  // R-PAPERSIZE-DESYNC-LOCK-V1: for a locked POS receipt, ALWAYS resolve the
  // physical page from the baked template size — never from a drifted `pageSize`.
  const ps = PAGE_SIZES[lockPageSize ? bakedPageSizeKey : pageSize] || PAGE_SIZES['4x6'];

  // R-2.1.4-PREVIEW: preview geometry. CSS renders 1in = 96px. When the real
  // preview PDF is loaded its own page dimensions win (they already include
  // orientation and any document @page override); the micron conversion is
  // only the loading-placeholder size. The old geometric numPages
  // (scrollHeight / pageHeight slicing) is gone — page count now comes from
  // the preview PDF itself, i.e. the print engine's pagination.
  const pageWidthPx = previewDims ? previewDims.w * (96 / 72) : (effectiveLandscape ? ps.height : ps.width) / 25400 * 96;
  const pageHeightPx = previewDims ? previewDims.h * (96 / 72) : (effectiveLandscape ? ps.width : ps.height) / 25400 * 96;
  const pageLabel = (n: number, total: number) =>
    locale === 'es' ? `Página ${n} de ${total}`
    : locale === 'pt' ? `Página ${n} de ${total}`
    : `Page ${n} of ${total}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '92vw', maxWidth: '1300px', height: '88vh',
        background: '#0f172a', borderRadius: '1rem',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', overflow: 'hidden',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>

        {/* ── Sidebar Controls ─────────────────────────────── */}
        <div style={{
          width: '280px', flexShrink: 0, padding: '1.25rem',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', flexDirection: 'column', gap: '1rem',
          overflowY: 'auto',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🖨️ Print
          </h2>

          {/* Printer — LAN-PRINT-BRIDGE-UI-COVERAGE-FIX-V1: a Secondary doesn't
              own/pick local printers. Show a managed-by-Primary card instead. */}
          {lanReadOnly ? (
            <div style={{
              fontSize: '0.8rem', color: '#93c5fd', padding: '0.6rem 0.75rem', borderRadius: '0.5rem',
              background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)',
            }}>
              🖥️ {canBridge ? t('print.willPrintOnPrimary') : t('print.managedByPrimary')}
            </div>
          ) : (
            <Field label="Printer">
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                style={selectStyle}
              >
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName || p.name}{p.isDefault ? ' ★' : ''}
                  </option>
                ))}
                {printers.length === 0 && <option value="">{t('print.noPrintersFound')}</option>}
              </select>
            </Field>
          )}

          {/* Page Size — R-PAPERSIZE-DESYNC-LOCK-V1: for POS receipts the size is
              read-only (the template is already baked from Settings → Paper Size).
              Every other print flow keeps the editable picker. */}
          <Field label={locale === 'es' ? 'Tamaño de Papel' : locale === 'pt' ? 'Tamanho do Papel' : 'Page Size'}>
            {lockPageSize ? (
              <div style={{
                padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderRadius: '0.4rem',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#e2e8f0',
              }}>
                <div style={{ fontWeight: 700 }}>
                  {PAGE_SIZES[bakedPageSizeKey]?.label || bakedPageSizeKey}
                </div>
                <div style={{ marginTop: '0.3rem', fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.35 }}>
                  {locale === 'es'
                    ? 'Cambiar en Ajustes → Hardware → Tamaño de Papel'
                    : locale === 'pt'
                    ? 'Alterar em Configurações → Hardware → Tamanho do Papel'
                    : 'Change in Settings → Hardware → Paper Size'}
                </div>
              </div>
            ) : (
              <select
                value={pageSize}
                onChange={(e) => {
                  const next = e.target.value;
                  setPageSize(next);
                  // R-POS-PAGESIZE-REBAKE-V1: regenerate the receipt for the chosen
                  // size so preview + print use the correct template (dedicated-80mm
                  // with skinny barcode vs shared-4x6) instead of resizing stale
                  // markup. Only fires when the caller supplied the callback.
                  if (canRebake && rebakeForPageSize) {
                    try { setCurrentHtml(rebakeForPageSize(next as PrintPageSizeKey)); }
                    catch { /* keep current html on rebake failure */ }
                  }
                }}
                style={selectStyle}
              >
                {Object.entries(PAGE_SIZES).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            )}
          </Field>

          {/* Orientation */}
          {caps.showOrientation && (
          <Field label="Orientation">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#cbd5e1', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              Landscape
            </label>
          </Field>
          )}

          {/* PRINT-MODAL-CONTROLS-HARDENING-V1: fixed printer-safe sizes (80mm)
              show a clear "Thermal Sizing" note instead of a Print Scale control
              the user can't actually change. Other sizes show the real controls. */}
          {caps.fixedPrinterSafeSizing && (
            <Field label={locale === 'es' ? 'Tamaño térmico' : locale === 'pt' ? 'Tamanho térmico' : 'Thermal Sizing'}>
              <div style={{
                fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.4,
                padding: '0.5rem 0.6rem', background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.4rem',
              }}>
                {locale === 'es'
                  ? 'Los recibos de 80mm usan tamaño fijo seguro para impresora.'
                  : locale === 'pt'
                  ? 'Recibos de 80mm usam tamanho fixo seguro para impressora.'
                  : '80mm receipts use fixed printer-safe sizing.'}
              </div>
            </Field>
          )}

          {/* Scale */}
          {caps.showPrintScale && (
          <Field label="Print Scale">
            {/* R-PRINT-SHRINK-TO-FIT: toggle disables manual scale and uses calculateAutoScale() */}
            <label
              title="Auto adjusts to fit page width"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#cbd5e1', fontSize: '0.8rem', cursor: 'pointer', marginBottom: '0.4rem' }}
            >
              <input
                type="checkbox"
                checked={shrinkToFit}
                onChange={(e) => setShrinkToFit(e.target.checked)}
                style={{ width: '15px', height: '15px', cursor: 'pointer' }}
              />
              Shrink to fit page
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: shrinkToFit ? 0.5 : 1 }}>
              <input
                type="number"
                min={25}
                max={200}
                step={1}
                value={shrinkToFit ? String(effectiveScale) : scaleInput}
                disabled={shrinkToFit}
                title={shrinkToFit ? 'Auto adjusts to fit page width' : ''}
                onChange={(e) => {
                  // R-PRINT-INPUT-FIX-V1: keep raw text for the user
                  // and only commit live to scaleFactor while it's a
                  // valid in-range number, so mid-typing "75" / "100"
                  // doesn't snap to the min bound.
                  const raw = e.target.value;
                  setScaleInput(raw);
                  const n = parseFloat(raw);
                  if (Number.isFinite(n) && n >= 25 && n <= 200) {
                    setScaleFactor(n);
                  }
                }}
                onBlur={() => {
                  // R-PRINT-INPUT-FIX-V1: hard clamp on blur. Empty /
                  // NaN falls back to 100 (the natural default).
                  const n = parseFloat(scaleInput);
                  const clamped = Number.isFinite(n) ? Math.min(200, Math.max(25, n)) : 100;
                  setScaleFactor(clamped);
                  setScaleInput(String(clamped));
                }}
                style={{ ...inputStyle, width: '60px', textAlign: 'right', cursor: shrinkToFit ? 'not-allowed' : 'text' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>%</span>
              <input
                type="range"
                min={25}
                max={200}
                step={5}
                value={shrinkToFit ? effectiveScale : scaleFactor}
                disabled={shrinkToFit}
                title={shrinkToFit ? 'Auto adjusts to fit page width' : ''}
                onChange={(e) => setScaleFactor(Number(e.target.value))}
                style={{ flex: 1, cursor: shrinkToFit ? 'not-allowed' : 'pointer' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b' }}>
              <span>25%</span><span>100%</span><span>200%</span>
            </div>
          </Field>
          )}

          {/* Margins */}
          {caps.showMargins && (
          <Field label="Margins (inches)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                <div key={side} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', width: '2.5rem', textTransform: 'capitalize' }}>{side}</span>
                  <input type="number" step={0.05} min={0} max={2}
                    value={margins[side]}
                    onChange={(e) => setMargin(side, parseFloat(e.target.value) || 0)}
                    style={{ ...inputStyle, width: '100%' }} />
                </div>
              ))}
            </div>
          </Field>
          )}

          {/* Copies */}
          {caps.showCopies && (
          <Field label="Copies">
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.4rem' }}>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => { setCopies(n); setCopiesInput(String(n)); }}
                  style={{
                    flex: 1, padding: '0.35rem 0', fontSize: '0.85rem', fontWeight: 700,
                    borderRadius: '0.4rem', cursor: 'pointer', border: 'none',
                    background: copies === n ? '#3b82f6' : 'rgba(255,255,255,0.08)',
                    color: copies === n ? '#fff' : '#94a3b8',
                    transition: 'background 0.1s',
                  }}
                >
                  ×{n}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <button
                onClick={() => { const n = Math.max(1, copies - 1); setCopies(n); setCopiesInput(String(n)); }}
                style={stepperBtnStyle}
              >−</button>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={copiesInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  setCopiesInput(raw);
                  const n = parseInt(raw, 10);
                  if (Number.isFinite(n) && n >= 1 && n <= 99) {
                    setCopies(n);
                  }
                }}
                onBlur={() => {
                  const n = parseInt(copiesInput, 10);
                  const clamped = Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1;
                  setCopies(clamped);
                  setCopiesInput(String(clamped));
                }}
                style={{ ...inputStyle, flex: 1, textAlign: 'center' }}
              />
              <button
                onClick={() => { const n = Math.min(99, copies + 1); setCopies(n); setCopiesInput(String(n)); }}
                style={stepperBtnStyle}
              >+</button>
            </div>
          </Field>
          )}

          {/* Page range picker */}
          {caps.showPages && (
          <Field label="Pages">
            <select
              value={pageRangeMode}
              onChange={(e) => {
                setPageRangeMode(e.target.value as PagesMode);
                setPageRangeError(null);
              }}
              style={selectStyle}
            >
              <option value="all">All pages</option>
              {/* R-2.1.4-PREVIEW: prints the page currently visible in the
                  multi-page preview (tracked by scrolling / Prev / Next). */}
              {isSheetPreview && previewPages > 1 && (
                <option value="current">{t('print.pagesCurrent')}</option>
              )}
              <option value="custom">Custom range…</option>
            </select>
            {pageRangeMode === 'current' && isSheetPreview && previewPages > 1 && (
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                {pageLabel(currentPage, previewPages)}
              </div>
            )}
            {pageRangeMode === 'custom' && (
              <>
                <input
                  type="text"
                  value={pageRangeInput}
                  onChange={(e) => { setPageRangeInput(e.target.value); setPageRangeError(null); }}
                  placeholder="e.g., 1  ·  1-2  ·  1,3  ·  1-2,4"
                  style={{
                    ...inputStyle, marginTop: '0.4rem', width: '100%',
                    borderColor: pageRangeError ? '#ef4444' : 'rgba(255,255,255,0.12)',
                  }}
                />
                {pageRangeError && (
                  <div style={{ fontSize: '0.72rem', color: '#f87171', marginTop: '0.25rem' }}>
                    ⚠ {pageRangeError}
                  </div>
                )}
              </>
            )}
          </Field>
          )}

          {/* Preview Zoom */}
          {caps.showPreviewZoom && (
          <Field label={`Preview Zoom: ${zoom}%`}>
            <input type="range" min={25} max={300} step={5} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }} />
          </Field>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Print result */}
          {printResult && (
            <div style={{
              padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: 600,
              // RECEIPT-PRINTER-RANGE-FALLBACK-V1: amber for the ⚠️ warning (not red — the print succeeded).
              background: printResult.startsWith('✅') ? 'rgba(34,197,94,0.15)' : printResult.startsWith('⚠️') ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
              color: printResult.startsWith('✅') ? '#22c55e' : printResult.startsWith('⚠️') ? '#f59e0b' : '#ef4444',
              textAlign: 'center',
            }}>
              {printResult}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onClose} style={{
              flex: 1, padding: '0.65rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
            }}>
              Cancel
            </button>
            <button
              onClick={handlePrint}
              // LAN-PRINT-BRIDGE-PRINTPREVIEW-BRIDGED-RECEIPT-FIX-V1: on a Secondary,
              // a bridge-eligible receipt (canBridge) keeps Print ENABLED and
              // forwards to the Primary. A non-bridged print (no bridgeReceipt) is
              // disabled. Primary/standalone require a selected printer as before.
              disabled={
                printing
                || (pageRangeMode === 'custom' && !!pageRangeError)
                || (lanReadOnly ? !canBridge : !selectedPrinter)
              }
              style={{
                flex: 2, padding: '0.65rem', borderRadius: '0.5rem', border: 'none',
                background: printing ? '#334155' : '#3b82f6', color: '#fff', cursor: printing ? 'wait' : 'pointer',
                fontSize: '0.9rem', fontWeight: 700,
                opacity: ((lanReadOnly ? !canBridge : !selectedPrinter) || (pageRangeMode === 'custom' && !!pageRangeError)) ? 0.5 : 1,
              }}
            >
              {printing ? '⏳ Printing...' : `🖨️ Print${copies > 1 ? ` (×${copies})` : ''}`}
            </button>
          </div>
        </div>

        {/* ── Preview Area ─────────────────────────────────── */}
        {/* R-2.1.4-PREVIEW: outer wrapper is the positioning context (close
            button + page navigation stay fixed) and the INNER div scrolls, so
            the operator can scroll through every page of the document. */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#1e293b' }}>
          {/* Close button */}
          <button onClick={onClose} style={{
            position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 10,
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#94a3b8',
            cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>

          {/* Page navigation — multi-page sheet documents only */}
          {isSheetPreview && previewPages > 1 && (
            <div style={{
              position: 'absolute', top: '0.75rem', left: '50%', transform: 'translateX(-50%)', zIndex: 10,
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: 'rgba(15,23,42,0.92)', border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: '999px', padding: '0.25rem 0.5rem',
              boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
            }}>
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                title={locale === 'es' ? 'Página anterior' : locale === 'pt' ? 'Página anterior' : 'Previous page'}
                style={{
                  width: '26px', height: '26px', borderRadius: '50%', border: 'none', cursor: currentPage <= 1 ? 'default' : 'pointer',
                  background: 'rgba(255,255,255,0.08)', color: currentPage <= 1 ? '#475569' : '#e2e8f0', fontSize: '0.95rem', fontWeight: 700,
                }}
              >‹</button>
              <span style={{ fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 700, minWidth: '96px', textAlign: 'center' }}>
                {pageLabel(currentPage, previewPages)}
              </span>
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= previewPages}
                title={locale === 'es' ? 'Página siguiente' : locale === 'pt' ? 'Próxima página' : 'Next page'}
                style={{
                  width: '26px', height: '26px', borderRadius: '50%', border: 'none', cursor: currentPage >= previewPages ? 'default' : 'pointer',
                  background: 'rgba(255,255,255,0.08)', color: currentPage >= previewPages ? '#475569' : '#e2e8f0', fontSize: '0.95rem', fontWeight: 700,
                }}
              >›</button>
            </div>
          )}

          <div
            ref={previewScrollRef}
            onScroll={handlePreviewScroll}
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              overflow: 'auto', padding: '1.5rem',
            }}
          >
            <div
              id="print-content"
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center',
                transition: 'transform 0.15s ease',
              }}
            >
              {isSheetPreview ? (
                // R-2.1.4-PREVIEW: every sheet-media document (letter/legal/
                // a4/4x6, single OR multi page) previews as the REAL preview
                // PDF pages — same page count, order and boundaries as the
                // print engine. Each page renders lazily near the viewport.
                previewError ? (
                  <div style={{
                    width: `${pageWidthPx}px`, minHeight: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px',
                    color: '#fca5a5', fontSize: '0.85rem', padding: '1rem', textAlign: 'center',
                  }}>
                    ⚠ {t('print.previewFailed')}<br />{previewError}
                  </div>
                ) : previewDoc && previewDims && previewPages > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', opacity: previewLoading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
                    {Array.from({ length: previewPages }).map((_, i) => (
                      <PreviewPdfPage
                        key={`${previewSeq.current}-${i + 1}`}
                        doc={previewDoc}
                        pageNumber={i + 1}
                        cssWidth={pageWidthPx}
                        cssHeight={pageHeightPx}
                        cache={pageImgCache.current}
                        label={pageLabel(i + 1, previewPages)}
                        refCb={(el) => { pageCardRefs.current[i] = el; }}
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{
                    width: `${pageWidthPx}px`, height: `${pageHeightPx}px`,
                    background: '#fff', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.18)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.85rem',
                  }}>
                    ⏳
                  </div>
                )
              ) : (
                <iframe
                  srcDoc={scaledHtml}
                  title="Print preview"
                  sandbox="allow-same-origin"
                  // R-PHONE-PAYMENT-ACTIVATION-RECEIPT-ZERO-FEE-FIX: suppress the
                  // iframe's own scrollbar/down-arrow. The outer Preview Area
                  // already scrolls (overflow:auto), so duplicate scroll
                  // controls on the iframe are pure noise on the receipt surface.
                  // R-2.1.4-PREVIEW: this iframe now serves ONLY continuous/
                  // narrow media (80mm thermal, Dymo label, CR80 card) — media
                  // with no page concept, where PDF page breaks would be fake.
                  scrolling="no"
                  style={{
                    width: effectiveLandscape ? `${ps.height / 25400}in` : `${ps.width / 25400}in`,
                    height: effectiveLandscape ? `${ps.width / 25400}in` : `${ps.height / 25400}in`,
                    minWidth: '300px',
                    minHeight: '400px',
                    background: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                    display: 'block',
                    overflow: 'hidden',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── R-2.1.4-PREVIEW: one lazily-rendered PDF page card ──────
// Renders the page to a PNG (2× CSS size for crispness) when the card nears
// the viewport; rendered pages are cached per document so scrolling back is
// instant and canvases are released immediately after rasterization.
function PreviewPdfPage({ doc, pageNumber, cssWidth, cssHeight, cache, label, refCb }: {
  doc: any;
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  cache: Map<number, string>;
  label: string;
  refCb: (el: HTMLDivElement | null) => void;
}) {
  const [src, setSrc] = useState<string | null>(cache.get(pageNumber) || null);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSrc(cache.get(pageNumber) || null);
    const el = holderRef.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const cached = cache.get(pageNumber);
      if (cached) { if (!cancelled) setSrc(cached); return; }
      try {
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.max(0.5, (cssWidth / base.width) * 2);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const url = canvas.toDataURL('image/png');
        canvas.width = 0; canvas.height = 0; // release backing store eagerly
        cache.set(pageNumber, url);
        if (!cancelled) setSrc(url);
      } catch { /* keep placeholder — the print path is unaffected */ }
    }, { rootMargin: '800px' });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, cssWidth]);

  return (
    <div
      ref={(el) => { holderRef.current = el; refCb(el); }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.45rem' }}
    >
      <div style={{
        width: `${cssWidth}px`, height: `${cssHeight}px`, overflow: 'hidden',
        background: '#fff', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.18)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
      }}>
        {src ? (
          <img src={src} alt={label} style={{ width: '100%', height: '100%', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            ⏳
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>{label}</div>
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 600 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem', fontSize: '0.85rem',
  background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.4rem', cursor: 'pointer', outline: 'none',
};

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem', fontSize: '0.85rem',
  background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.4rem', outline: 'none',
};

const stepperBtnStyle: React.CSSProperties = {
  width: '32px', height: '32px', flexShrink: 0, borderRadius: '0.4rem', border: 'none',
  background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', cursor: 'pointer',
  fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
