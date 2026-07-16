// R-PRINT-SERVER-V1 — print-mode + Print-button gating tests.
// The Primary is the LAN print server: a connected Secondary prints EVERY
// document through the Primary's printers (explicitly picked — no opt-in
// flags), and falls back to Local Printing Mode when the Primary is offline.
import { describe, it, expect } from 'vitest';
import { resolvePrintMode, computePrintDisabled } from './printGating';

describe('resolvePrintMode', () => {
  it('standalone / primary machines always print locally', () => {
    expect(resolvePrintMode('standalone', 'connected')).toBe('local');
    expect(resolvePrintMode('primary', 'connected')).toBe('local');
    expect(resolvePrintMode('primary', 'offline')).toBe('local');
  });
  it('a connected Secondary uses the Primary print server', () => {
    expect(resolvePrintMode('secondary', 'connected')).toBe('server');
    expect(resolvePrintMode('secondary', 'reconnected')).toBe('server');
    expect(resolvePrintMode('secondary', 'connecting')).toBe('server');
  });
  it('a Secondary whose Primary is OFFLINE falls back to Local Printing Mode', () => {
    expect(resolvePrintMode('secondary', 'offline')).toBe('local');
  });
});

describe('computePrintDisabled', () => {
  const base = { printing: false, pageRangeInvalid: false } as const;

  it('local mode: no selected printer → disabled; selected → enabled', () => {
    expect(computePrintDisabled({ ...base, mode: 'local', selectedPrinter: '' })).toBe(true);
    expect(computePrintDisabled({ ...base, mode: 'local', selectedPrinter: undefined })).toBe(true);
    expect(computePrintDisabled({ ...base, mode: 'local', selectedPrinter: 'Canon MF210 Series' })).toBe(false);
  });
  it('server mode: requires picking one of the PRIMARY printers', () => {
    expect(computePrintDisabled({ ...base, mode: 'server', selectedPrinter: '' })).toBe(true);
    expect(computePrintDisabled({ ...base, mode: 'server', selectedPrinter: 'POS-80C' })).toBe(false);
  });
  it('always disabled while a job is being submitted/printing', () => {
    expect(computePrintDisabled({ ...base, printing: true, mode: 'server', selectedPrinter: 'POS-80C' })).toBe(true);
    expect(computePrintDisabled({ ...base, printing: true, mode: 'local', selectedPrinter: 'Canon MF210 Series' })).toBe(true);
  });
  it('always disabled while a custom range is invalid', () => {
    expect(computePrintDisabled({ ...base, pageRangeInvalid: true, mode: 'server', selectedPrinter: 'POS-80C' })).toBe(true);
    expect(computePrintDisabled({ ...base, pageRangeInvalid: true, mode: 'local', selectedPrinter: 'Canon MF210 Series' })).toBe(true);
  });
});
