// ============================================================
// R-2.1.4-CLOSEOUT — canonical LAN print-bridge contract.
//
// ROOT CAUSE FIXED: the bridged Secondary→Primary print payload carried only
// { receiptType, html, copies, pageSize }, silently dropping pageRanges,
// margins, scale and landscape — so a Custom Range job forwarded from a
// Secondary printed the COMPLETE document on the Primary. Both directions of
// the contract now live here (single source): the Secondary serializes the
// full validated print job, the Primary defensively re-validates it and maps
// it onto the same `printRun` IPC payload a direct print uses — which routes
// ranged jobs through the canonical electron/printPages.js pipeline. There is
// deliberately NO second selected-page implementation.
//
// FAILURE CONTRACT: a bridged job whose pageRanges fail validation is
// REJECTED (`bad_page_ranges`) — it is never stripped down to an implicit
// "print all pages".
//
// R-2.1.4-LAN-PRINT: the Primary routes a bridged job to a printer by the
// job's MEDIA TYPE (derived from pageSize), using the store's existing
// printer→media assignments (settings.printerMediaTypes) — never the blind
// detectedPrinters[0]. A Letter report is NEVER sent to a receipt printer:
// with no explicit report-printer assignment the job is rejected with a
// clear error, keeping the Secondary's Print button available for retry.
// ============================================================
import { classifyMediaFromMicrons } from '@/services/print/printMediaGuard';
import type { PrinterMediaType } from '@/services/print/printMediaGuard';

/** 0-based inclusive page ranges — the same shape the printRun IPC uses. */
export interface ZeroBasedRange { from: number; to: number }

const MAX_RANGE_ENTRIES = 50;
const MAX_COPIES = 10;

/**
 * Strict shape validation for ranges crossing the LAN (both when building
 * the operation on the Secondary and when receiving it on the Primary).
 * Returns null when the input is not a valid non-empty range list.
 */
export function sanitizeZeroBasedRanges(input: unknown): ZeroBasedRange[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RANGE_ENTRIES) return null;
  const out: ZeroBasedRange[] = [];
  for (const r of input) {
    const from = Number((r as { from?: unknown })?.from);
    const to = Number((r as { to?: unknown })?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from < 0 || to < from) return null;
    out.push({ from, to });
  }
  return out;
}

export interface LanPrintJobInput {
  receiptType?: string;
  html: string;
  copies?: number;
  pageSize?: { width: number; height: number }; // microns
  pageRanges?: ZeroBasedRange[];                // 0-based, pre-validated by the modal
  margins?: { top: number; bottom: number; left: number; right: number }; // inches
  scaleFactor?: number;
  landscape?: boolean;
}

export interface LanPrintJob {
  receiptType: string;
  html: string;
  copies: number;
  pageSize?: { width: number; height: number };
  pageRanges?: ZeroBasedRange[];
  margins?: { top: number; bottom: number; left: number; right: number };
  scaleFactor?: number;
  landscape?: boolean;
}

/**
 * Secondary side: build the wire payload for LAN_PRINT_RECEIPT_REQUEST.
 * Invalid page ranges are BLOCKED here (before anything crosses the LAN).
 */
export function buildLanPrintJob(input: LanPrintJobInput): { ok: true; job: LanPrintJob } | { ok: false; error: string } {
  const html = String(input.html || '');
  if (!html) return { ok: false, error: 'bad_payload' };
  const job: LanPrintJob = {
    receiptType: String(input.receiptType || 'receipt').slice(0, 40),
    html,
    copies: Math.max(1, Math.min(MAX_COPIES, Math.round(input.copies || 1))),
  };
  if (input.pageSize) job.pageSize = { width: Number(input.pageSize.width), height: Number(input.pageSize.height) };
  if (input.pageRanges !== undefined) {
    const ranges = sanitizeZeroBasedRanges(input.pageRanges);
    if (!ranges) return { ok: false, error: 'bad_page_ranges' };
    job.pageRanges = ranges;
  }
  if (input.margins) {
    job.margins = {
      top: Math.max(0, Number(input.margins.top) || 0),
      bottom: Math.max(0, Number(input.margins.bottom) || 0),
      left: Math.max(0, Number(input.margins.left) || 0),
      right: Math.max(0, Number(input.margins.right) || 0),
    };
  }
  if (input.scaleFactor !== undefined) {
    const s = Math.round(Number(input.scaleFactor));
    if (Number.isFinite(s) && s >= 10 && s <= 200) job.scaleFactor = s;
  }
  if (input.landscape !== undefined) job.landscape = !!input.landscape;
  return { ok: true, job };
}

export interface BridgedPrintRunPayload {
  html: string;
  deviceName: string;
  copies: number;
  pageSize?: { width: number; height: number };
  pageRanges?: ZeroBasedRange[];
  margins?: { top: number; bottom: number; left: number; right: number };
  scaleFactor?: number;
  landscape?: boolean;
}

/**
 * Primary side: map a received LAN print payload onto the printRun IPC
 * payload — the SAME contract a direct print uses, so ranged jobs flow
 * through the canonical selected-page pipeline in the main process.
 * Defensive: a present-but-invalid pageRanges REJECTS the job (never a
 * silent full-document print).
 */
export function buildBridgedPrintRunPayload(
  print: unknown,
  deviceName: string,
): { ok: true; payload: BridgedPrintRunPayload } | { ok: false; error: string } {
  const p = print as Partial<LanPrintJob> | null | undefined;
  const html = p && String(p.html || '');
  if (!p || !html) return { ok: false, error: 'bad_payload' };
  if (!deviceName) return { ok: false, error: 'no_printer' };
  const payload: BridgedPrintRunPayload = {
    html,
    deviceName,
    copies: Math.max(1, Math.min(MAX_COPIES, Math.round(Number(p.copies) || 1))),
  };
  if (p.pageSize && Number.isFinite(Number(p.pageSize.width)) && Number.isFinite(Number(p.pageSize.height))) {
    payload.pageSize = { width: Number(p.pageSize.width), height: Number(p.pageSize.height) };
  }
  if (p.pageRanges !== undefined) {
    const ranges = sanitizeZeroBasedRanges(p.pageRanges);
    if (!ranges) return { ok: false, error: 'bad_page_ranges' };
    payload.pageRanges = ranges;
  }
  if (p.margins) {
    payload.margins = {
      top: Math.max(0, Number(p.margins.top) || 0),
      bottom: Math.max(0, Number(p.margins.bottom) || 0),
      left: Math.max(0, Number(p.margins.left) || 0),
      right: Math.max(0, Number(p.margins.right) || 0),
    };
  }
  if (p.scaleFactor !== undefined) {
    const s = Math.round(Number(p.scaleFactor));
    if (Number.isFinite(s) && s >= 10 && s <= 200) payload.scaleFactor = s;
  }
  if (p.landscape !== undefined) payload.landscape = !!p.landscape;
  return { ok: true, payload };
}

// ── R-2.1.4-LAN-PRINT: Primary printer routing by media type ──

/** Receipt-class media that may safely keep the existing default-printer
 *  fallback when no explicit assignment exists. Sheet media (letter) never
 *  falls back — a report must be sent to a report printer or rejected. */
const RECEIPT_CLASS_MEDIA: PrinterMediaType[] = ['80mm', '4x6', 'label', 'cr80'];

export interface BridgePrinterResolution {
  ok: boolean;
  printer?: string;
  error?: string;                               // set when !ok
  media: PrinterMediaType | 'unknown';
  viaDefaultFallback?: boolean;                 // receipt routed to default printer
}

/**
 * Resolve which Primary printer prints a bridged job, by the job's MEDIA
 * TYPE (from pageSize) against the store's printer→media assignments.
 *   1. A printer explicitly assigned to the job's media wins (all media).
 *   2. Sheet media (letter/legal/a4) with NO assignment → reject
 *      ('no_report_printer'); never fall back to the default printer, which
 *      could be the receipt printer.
 *   3. Receipt-class media with no assignment → the Primary's default/
 *      selected printer (detectedPrinters[0]) — preserves the existing
 *      receipt bridge for shops that haven't set printer media types yet.
 *   4. Unknown media → reject ('unclassified_media').
 * Pure — the dispatcher passes settings.printerMediaTypes + detectedPrinters.
 */
export function resolveBridgePrinter(
  pageSizeMicrons: { width: number; height: number } | undefined | null,
  mediaMap: Record<string, string> | undefined | null,
  detectedPrinters: string[] | undefined | null,
): BridgePrinterResolution {
  const media = classifyMediaFromMicrons(pageSizeMicrons || undefined);
  const map = (mediaMap && typeof mediaMap === 'object') ? mediaMap : {};
  const printers = Array.isArray(detectedPrinters) ? detectedPrinters : [];

  if (media === 'unknown') return { ok: false, media, error: 'unclassified_media' };

  // 1. Explicit media assignment wins for every media type.
  const assigned = Object.keys(map).find((name) => map[name] === media);
  if (assigned) return { ok: true, printer: assigned, media };

  // 2. Sheet media with no assignment → never default-fallback (that printer
  //    could be a receipt printer). Require an explicit report-printer.
  if (!RECEIPT_CLASS_MEDIA.includes(media)) {
    return { ok: false, media, error: 'no_report_printer' };
  }

  // 3. Receipt-class media, no assignment → existing default-printer route.
  if (printers[0]) return { ok: true, printer: printers[0], media, viaDefaultFallback: true };
  return { ok: false, media, error: 'no_receipt_printer' };
}
