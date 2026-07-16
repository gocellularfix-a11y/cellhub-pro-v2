// R-PRINT-SERVER-V1 — print-mode + Print-button gating tests.
// The Primary is the LAN print server: a connected Secondary prints EVERY
// document through the Primary's printers (explicitly picked — no opt-in
// flags), and falls back to Local Printing Mode when the Primary is offline.
import { describe, it, expect } from 'vitest';
import { resolvePrintMode, computePrintDisabled, classifySubmitFailure } from './printGating';

describe('resolvePrintMode', () => {
  it('standalone / primary machines always print locally', () => {
    expect(resolvePrintMode('standalone', 'connected')).toBe('local');
    expect(resolvePrintMode('primary', 'connected')).toBe('local');
    expect(resolvePrintMode('primary', 'offline')).toBe('local');
  });
  it('server mode ONLY with proof of reachability (connected/reconnected)', () => {
    expect(resolvePrintMode('secondary', 'connected')).toBe('server');
    expect(resolvePrintMode('secondary', 'reconnected')).toBe('server');
  });
  it('R-V1.1: a CONNECTING Secondary resolves to Local Printing Mode', () => {
    expect(resolvePrintMode('secondary', 'connecting')).toBe('local');
  });
  it('an OFFLINE Secondary resolves to Local Printing Mode', () => {
    expect(resolvePrintMode('secondary', 'offline')).toBe('local');
  });
});

describe('classifySubmitFailure — definite vs ambiguous disconnects', () => {
  it('definite pre-dispatch failures → unreachable (local fallback is SAFE)', () => {
    for (const e of ['not_paired', 'unreachable', 'network_error', 'not_electron', 'bad_url', 'no_renderer', 'dispatch_unavailable', 'unauthorized']) {
      expect(classifySubmitFailure(e)).toBe('unreachable');
    }
  });
  it('Primary-answered refusals → rejected (nothing printed; fix + retry in server mode)', () => {
    for (const e of ['printer_not_found', 'bad_page_ranges', 'no_report_printer', 'print_unavailable', 'unsupported_operation', 'bad_payload']) {
      expect(classifySubmitFailure(e)).toBe('rejected');
    }
  });
  it('timeouts and unknown outcomes → ambiguous (NEVER auto-print locally — duplicate risk)', () => {
    for (const e of ['timeout', 'dispatch_timeout', 'bad_response', '', undefined, 'some_future_code']) {
      expect(classifySubmitFailure(e as string | undefined)).toBe('ambiguous');
    }
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
