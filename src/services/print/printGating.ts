// ============================================================
// R-PRINT-SERVER-V1 — pure print-mode + Print-button gating logic.
//
// The Primary is the print server for the LAN. Which pipeline a print uses
// is a pure function of the machine's role and the live connection state:
//
//   'server' — this machine is a paired Secondary and the Primary is
//              reachable → the modal lists the PRIMARY's printers and the
//              job is submitted to the Primary's queue. EVERY document
//              (receipts, reports, tickets, labels, barcodes) prints this
//              way — no per-document opt-in flags anymore.
//   'local'  — standalone / Primary, OR a Secondary whose Primary is
//              offline (automatic Local Printing Mode) → local printer
//              scan + direct printRun, exactly as before.
//
// Extracted so the enable rules are unit-testable without rendering
// PrintPreviewModal. (Replaces the R-2.1.4-LAN-PRINT computeCanBridge
// opt-in gating — bridgeReceipt/bridgeEligible no longer gate the modal.)
// ============================================================

export type PrintTargetMode = 'server' | 'local';

/**
 * Resolve which print pipeline this machine uses right now.
 * `connState` is the Secondary mirror state ('connected' | 'reconnected' |
 * 'connecting' | 'offline'). A Secondary that is offline falls back to
 * Local Printing Mode automatically and returns to server mode when the
 * mirror reconnects (the caller re-evaluates on mirror updates).
 */
export function resolvePrintMode(
  role: 'standalone' | 'primary' | 'secondary',
  connState: 'connecting' | 'connected' | 'offline' | 'reconnected',
): PrintTargetMode {
  if (role !== 'secondary') return 'local';
  return connState === 'offline' ? 'local' : 'server';
}

export interface PrintDisabledInput {
  printing: boolean;
  pageRangeInvalid: boolean;      // custom range typed but invalid
  mode: PrintTargetMode;          // resolved print pipeline
  selectedPrinter: string | undefined | null; // picked printer (local OR remote)
}

/**
 * The Print button is disabled while a job is being submitted, while a
 * custom page range is invalid, and when no printer is selected — in BOTH
 * modes: server mode requires picking one of the Primary's printers, local
 * mode one of the local printers. (No more printer-less bridge sends: the
 * user always chooses the destination, like any network print server.)
 */
export function computePrintDisabled(input: PrintDisabledInput): boolean {
  if (input.printing) return true;
  if (input.pageRangeInvalid) return true;
  return !input.selectedPrinter;
}
