// ============================================================
// R-2.1.4-LAN-PRINT — pure Print-button gating logic.
//
// Extracted so the Secondary/Primary enable rules are unit-testable without
// rendering PrintPreviewModal. The modal consumes these; behavior is
// unchanged from the inline expressions it replaces.
// ============================================================

/**
 * A print can be bridged to the Primary from a read-only LAN Secondary when
 * it opts in — either a POS receipt (bridgeReceipt) or a document such as the
 * Sales Report (bridgeEligible). On a non-Secondary this is always false.
 */
export function computeCanBridge(
  lanReadOnly: boolean,
  bridgeReceipt: boolean | undefined,
  bridgeEligible: boolean | undefined,
): boolean {
  return !!lanReadOnly && (!!bridgeReceipt || !!bridgeEligible);
}

export interface PrintDisabledInput {
  printing: boolean;
  pageRangeInvalid: boolean;      // custom range typed but invalid
  lanReadOnly: boolean;           // this machine is a read-only LAN Secondary
  canBridge: boolean;             // the job can be forwarded to the Primary
  selectedPrinter: string | undefined | null; // local printer choice
}

/**
 * The Print button is disabled when a job is already running, when a custom
 * page range is invalid, and — for LOCAL printing — when no printer is
 * selected. On a bridging Secondary a local printer is NOT required: the
 * button enables so the click can reach the LAN bridge.
 */
export function computePrintDisabled(input: PrintDisabledInput): boolean {
  if (input.printing) return true;
  if (input.pageRangeInvalid) return true;
  // Secondary (read-only): gate on bridge capability, not a local printer.
  // Primary/standalone: require a selected local printer as before.
  return input.lanReadOnly ? !input.canBridge : !input.selectedPrinter;
}
