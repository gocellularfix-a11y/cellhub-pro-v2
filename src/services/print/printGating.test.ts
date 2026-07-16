// R-2.1.4-LAN-PRINT — Print-button gating tests.
// Locks the Secondary blocker fix: a connected read-only Secondary can print
// a bridged job WITHOUT a local printer, while local/Primary printing still
// requires a selected printer.
import { describe, it, expect } from 'vitest';
import { computeCanBridge, computePrintDisabled } from './printGating';

describe('computeCanBridge', () => {
  it('is false on a non-Secondary regardless of opt-in flags', () => {
    expect(computeCanBridge(false, true, true)).toBe(false);
    expect(computeCanBridge(false, false, false)).toBe(false);
  });
  it('is true on a Secondary for a bridge-eligible document (Sales Report)', () => {
    expect(computeCanBridge(true, undefined, true)).toBe(true);
  });
  it('is true on a Secondary for a bridge-eligible receipt', () => {
    expect(computeCanBridge(true, true, undefined)).toBe(true);
  });
  it('is false on a Secondary when the print opts into neither bridge path', () => {
    expect(computeCanBridge(true, false, false)).toBe(false);
    expect(computeCanBridge(true, undefined, undefined)).toBe(false);
  });
});

describe('computePrintDisabled — LOCAL / Primary', () => {
  const base = { printing: false, pageRangeInvalid: false, lanReadOnly: false, canBridge: false };

  it('Primary + no selected printer → disabled', () => {
    expect(computePrintDisabled({ ...base, selectedPrinter: '' })).toBe(true);
    expect(computePrintDisabled({ ...base, selectedPrinter: undefined })).toBe(true);
  });
  it('Primary + selected printer → enabled', () => {
    expect(computePrintDisabled({ ...base, selectedPrinter: 'Canon MF210 Series' })).toBe(false);
  });
  it('always disabled while a job is printing', () => {
    expect(computePrintDisabled({ ...base, printing: true, selectedPrinter: 'Canon MF210 Series' })).toBe(true);
  });
  it('always disabled while a custom range is invalid', () => {
    expect(computePrintDisabled({ ...base, pageRangeInvalid: true, selectedPrinter: 'Canon MF210 Series' })).toBe(true);
  });
});

describe('computePrintDisabled — SECONDARY / bridged', () => {
  const sec = { printing: false, pageRangeInvalid: false, lanReadOnly: true };

  it('connected Secondary + bridge-eligible + NO local printer → ENABLED (the blocker fix)', () => {
    expect(computePrintDisabled({ ...sec, canBridge: true, selectedPrinter: '' })).toBe(false);
    expect(computePrintDisabled({ ...sec, canBridge: true, selectedPrinter: undefined })).toBe(false);
  });
  it('Secondary not bridge-capable (disconnected / no opt-in) → disabled', () => {
    expect(computePrintDisabled({ ...sec, canBridge: false, selectedPrinter: '' })).toBe(true);
  });
  it('Secondary still blocked while printing or on an invalid range', () => {
    expect(computePrintDisabled({ ...sec, printing: true, canBridge: true, selectedPrinter: '' })).toBe(true);
    expect(computePrintDisabled({ ...sec, pageRangeInvalid: true, canBridge: true, selectedPrinter: '' })).toBe(true);
  });
  it('a local printer being absent never disables a bridging Secondary', () => {
    // The exact regression: local-print guard must not apply when canBridge.
    expect(computePrintDisabled({ ...sec, canBridge: true, selectedPrinter: null as unknown as string })).toBe(false);
  });
});
