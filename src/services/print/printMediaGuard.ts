// ============================================================
// CellHub Pro — Printer Media Guard (R-PRINT-MEDIA-GUARD-V1)
//
// Problem: printer names are opaque strings — nothing in the print pipeline
// knows what MEDIA each device holds. A label job silently routed to the
// 4×6 thermal (via detectedPrinters[0] / cellhub_lastPrinter) starts feeding
// 4×6 stock for a 1¼" label, jams mid-feed, and forces lid-open + media
// removal + recalibration + restart.
//
// This service adds a validation layer:
//   • classifyMediaFromMicrons — what media does THIS JOB physically need,
//     derived from the exact pageSize microns the print path already sends
//     (truthful: classifies what will actually print, incl. the silent-path
//     4×6 default and Label Studio's arbitrary mm sizes).
//   • checkPrintMediaJob — compares job media vs the printer's CONFIGURED
//     media type (Settings → Hardware → per-printer media type, stored as
//     settings.printerMediaTypes via the double-cast pattern).
//       - unconfigured printer or unclassifiable job → 'ok' (FAIL-OPEN:
//         zero behavior change until the owner configures printer types)
//       - label job + a configured dedicated label printer → 'reroute'
//         (smart mapping — labels auto-route to the label printer)
//       - any other mismatch → 'warn' (Cancel / Print Anyway dialog)
//   • A tiny host registry so the non-React openPrintWindow() can ask the
//     React host (PrintMediaGuardHost) to show the confirm dialog, the
//     reroute toast, and the jam-recovery guide.
//
// No print geometry is changed here: pageSize/margins stay exactly what the
// existing paths send. This layer only decides WHETHER/WHERE a job goes.
// ============================================================

export type PrinterMediaType = '80mm' | 'label' | '4x6' | 'cr80' | 'letter';

/** Printer name → configured media type. Stored in settings.printerMediaTypes. */
export type PrinterMediaMap = Record<string, PrinterMediaType>;

export interface PageSizeMicrons { width: number; height: number }

// ── Media map sync (host keeps this fresh from settings) ────

let _mediaMap: PrinterMediaMap = {};

export function syncPrinterMediaMap(map: PrinterMediaMap | undefined | null): void {
  _mediaMap = map && typeof map === 'object' ? map : {};
}

export function getPrinterMediaMap(): PrinterMediaMap {
  return _mediaMap;
}

// ── Job media classification (orientation-agnostic, mm buckets) ──

export function classifyMediaFromMicrons(ps: PageSizeMicrons | undefined | null): PrinterMediaType | 'unknown' {
  if (!ps || !ps.width || !ps.height) return 'unknown';
  const wMm = ps.width / 1000;
  const hMm = ps.height / 1000;
  const minD = Math.min(wMm, hMm);
  const maxD = Math.max(wMm, hMm);
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

  // CR80 credential card (54 × 85.6 mm, printed portrait or landscape)
  if (near(minD, 54, 4) && near(maxD, 85.6, 5)) return 'cr80';
  // 4×6 thermal media (101.6 × 152.4 mm) — shipping labels / 4x6 receipts
  if (near(minD, 101.6, 3) && near(maxD, 152.4, 5)) return '4x6';
  // 80mm continuous thermal receipt (80 mm wide, long/continuous)
  if (near(minD, 80, 4) && maxD >= 180) return '80mm';
  // Dymo-class small labels (57×32, 89×36, …): short side ≤ 62mm, long ≤ 120mm
  if (minD <= 62 && maxD <= 120) return 'label';
  // Sheet media (letter / legal / A4): short side ≥ 200mm
  if (minD >= 200) return 'letter';
  return 'unknown';
}

// ── Mismatch verdict ────────────────────────────────────────

export type MediaGuardVerdict =
  | { action: 'ok' }
  | { action: 'warn'; docMedia: PrinterMediaType; printerMedia: PrinterMediaType; printerName: string }
  | { action: 'reroute'; to: string; docMedia: PrinterMediaType; printerMedia: PrinterMediaType; printerName: string };

export function checkPrintMediaJob(
  psMicrons: PageSizeMicrons | undefined | null,
  printerName: string | undefined | null,
  mediaMap: PrinterMediaMap = _mediaMap,
): MediaGuardVerdict {
  if (!printerName) return { action: 'ok' };
  const printerMedia = mediaMap[printerName];
  if (!printerMedia) return { action: 'ok' };              // fail-open: unconfigured printer
  const docMedia = classifyMediaFromMicrons(psMicrons);
  if (docMedia === 'unknown') return { action: 'ok' };     // fail-open: unclassifiable job
  if (docMedia === printerMedia) return { action: 'ok' };

  // Smart mapping: a label job headed to a non-label printer auto-routes to
  // the dedicated label printer when one is configured.
  if (docMedia === 'label') {
    const dedicated = Object.keys(mediaMap).find(
      (name) => name !== printerName && mediaMap[name] === 'label',
    );
    if (dedicated) return { action: 'reroute', to: dedicated, docMedia, printerMedia, printerName };
  }

  return { action: 'warn', docMedia, printerMedia, printerName };
}

// ── Guard UI host registry ──────────────────────────────────
// openPrintWindow() is a plain function (no React context). The host
// component registers itself here; when no host is registered every
// request fail-opens so tests / browser-dev keep printing normally.

export interface MediaGuardMismatchRequest {
  kind: 'mismatch';
  docMedia: PrinterMediaType;
  printerMedia: PrinterMediaType;
  printerName: string;
  resolve: (proceed: boolean) => void;
}

export interface MediaGuardRerouteNotice {
  kind: 'reroute';
  to: string;
  printerName: string;
}

export interface MediaGuardRecoveryNotice {
  kind: 'recovery';
}

export type MediaGuardHostRequest =
  | MediaGuardMismatchRequest
  | MediaGuardRerouteNotice
  | MediaGuardRecoveryNotice;

let _host: ((req: MediaGuardHostRequest) => void) | null = null;

export function registerPrintMediaGuardHost(host: ((req: MediaGuardHostRequest) => void) | null): void {
  _host = host;
}

/** Ask the host to show the Cancel / Print Anyway dialog. Resolves true to
 *  proceed. No host registered → true (fail-open). */
export function requestPrintMediaConfirmation(
  info: { docMedia: PrinterMediaType; printerMedia: PrinterMediaType; printerName: string },
): Promise<boolean> {
  if (!_host) return Promise.resolve(true);
  const host = _host;
  return new Promise<boolean>((resolve) => {
    host({ kind: 'mismatch', ...info, resolve });
  });
}

/** Toast-level notice that a label job was auto-routed to the label printer. */
export function announcePrintReroute(printerName: string, to: string): void {
  _host?.({ kind: 'reroute', printerName, to });
}

/** Show the jam-recovery guide (called when a print job fails). */
export function announcePrintRecovery(): void {
  _host?.({ kind: 'recovery' });
}
