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
 * 'connecting' | 'offline').
 *
 * R-PRINT-SERVER-V1.1: server mode requires PROOF the Primary is reachable
 * — only 'connected' / 'reconnected' qualify. 'connecting' (no successful
 * sync yet) and 'offline' both resolve to Local Printing Mode; the caller
 * re-evaluates on mirror updates, so the machine returns to server mode
 * automatically (and refreshes the printer inventory) on reconnect.
 */
export function resolvePrintMode(
  role: 'standalone' | 'primary' | 'secondary',
  connState: 'connecting' | 'connected' | 'offline' | 'reconnected',
): PrintTargetMode {
  if (role !== 'secondary') return 'local';
  return (connState === 'connected' || connState === 'reconnected') ? 'server' : 'local';
}

// ── R-PRINT-SERVER-V1.1: submit-failure classification ──────
// When a LAN print submit fails, WHAT failed decides the recovery:
//   'unreachable' — the request definitively never reached a working Primary
//                   (pre-dispatch). Safe to fall back to Local Printing Mode;
//                   no duplicate is possible.
//   'rejected'    — the Primary answered and REFUSED the job (validation,
//                   unknown printer, unsupported op). Nothing printed; show
//                   the error and let the user fix + retry in server mode.
//   'ambiguous'   — the outcome is unknown (timeout after the request may
//                   have been accepted). The job may already be printing on
//                   the Primary — NEVER auto-print locally (duplicate risk);
//                   surface "status unknown, check the printer".

export type SubmitFailureKind = 'unreachable' | 'rejected' | 'ambiguous';

const UNREACHABLE_ERRORS = new Set([
  'not_paired', 'unreachable', 'network_error', 'not_electron', 'bad_url',
  'no_renderer', 'dispatch_unavailable', 'unauthorized',
]);
const REJECTED_ERRORS = new Set([
  'printer_not_found', 'no_printer_selected', 'bad_job_id', 'bad_payload',
  'bad_page_ranges', 'print_unavailable', 'printer_scan_failed',
  'queue_submit_failed', 'unsupported_operation', 'dispatch_failed',
  'dispatch_exception', 'no_report_printer', 'no_receipt_printer', 'no_printer',
]);

export function classifySubmitFailure(error: string | undefined | null): SubmitFailureKind {
  const e = String(error || '');
  if (UNREACHABLE_ERRORS.has(e)) return 'unreachable';
  if (REJECTED_ERRORS.has(e)) return 'rejected';
  // timeout / dispatch_timeout / bad_response / anything unknown: the job may
  // have been accepted before the ACK was lost — treat as ambiguous.
  return 'ambiguous';
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
