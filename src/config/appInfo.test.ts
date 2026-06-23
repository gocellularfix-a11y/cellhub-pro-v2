import { describe, it, expect } from 'vitest';
import {
  getSafeDiagnosticsInfo,
  containsSensitiveDiagnosticText,
  LOGS_PATH_HINT,
} from './appInfo';

describe('getSafeDiagnosticsInfo (R-PRODUCTION-B6.1)', () => {
  it('assembles version/platform/logsHint', () => {
    const info = getSafeDiagnosticsInfo('2.1.0', 'Win32');
    expect(info.version).toBe('2.1.0');
    expect(info.platform).toBe('Win32');
    expect(info.logsHint).toBe(LOGS_PATH_HINT);
  });

  it('falls back to "unknown" on empty inputs', () => {
    const info = getSafeDiagnosticsInfo('', '');
    expect(info.version).toBe('unknown');
    expect(info.platform).toBe('unknown');
  });

  it('is deterministic', () => {
    expect(getSafeDiagnosticsInfo('2.1.0', 'Win32')).toEqual(
      getSafeDiagnosticsInfo('2.1.0', 'Win32'),
    );
  });

  it('assembled info never trips the sensitive guard (normal inputs)', () => {
    const info = getSafeDiagnosticsInfo('2.1.0', 'Win32');
    expect(containsSensitiveDiagnosticText(JSON.stringify(info))).toBe(false);
  });
});

describe('containsSensitiveDiagnosticText (R-PRODUCTION-B6.1)', () => {
  it('flags secrets / keys / fingerprints', () => {
    expect(containsSensitiveDiagnosticText('CHPRO-PRO-20261231-AB12')).toBe(true);
    expect(containsSensitiveDiagnosticText('secret=abc')).toBe(true);
    expect(containsSensitiveDiagnosticText('token: xyz')).toBe(true);
    expect(containsSensitiveDiagnosticText('apiKey=AIza')).toBe(true);
    expect(containsSensitiveDiagnosticText('fingerprint=deadbeef')).toBe(true);
    expect(containsSensitiveDiagnosticText('VITE_BRIDGE_AUTH_SECRET=zzz')).toBe(true);
    expect(
      containsSensitiveDiagnosticText('8EB1Xe5D1drurKU9OD9BAd1V696nmJOEoeLeZbHl1Aaaaa'),
    ).toBe(true); // long token-looking
  });

  it('does not flag benign diagnostics text', () => {
    expect(containsSensitiveDiagnosticText('2.1.0')).toBe(false);
    expect(containsSensitiveDiagnosticText('Win32')).toBe(false);
    expect(containsSensitiveDiagnosticText(LOGS_PATH_HINT)).toBe(false);
    expect(containsSensitiveDiagnosticText('')).toBe(false);
  });
});
