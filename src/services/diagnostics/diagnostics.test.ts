import { describe, it, expect } from 'vitest';
// @ts-ignore — electron/diagnostics.js is a CommonJS runtime module (no .d.ts).
import { scrubDiagnosticText, formatDiagnosticLine, getDiagnosticsLogDir } from '../../../electron/diagnostics.js';

const TS = '2026-06-23T10:00:00.000Z';

describe('scrubDiagnosticText (R-PRODUCTION-B3.1)', () => {
  it('redacts CHPRO-style license keys', () => {
    const out = scrubDiagnosticText('failed for key CHPRO-PRO-20261231-AB12CD34 today');
    expect(out).not.toContain('CHPRO-PRO-20261231-AB12CD34');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts secret/token/password/apiKey/license key=value pairs', () => {
    const cases = [
      'secret=supersecretvalue',
      'token: abc123def456',
      'password=hunter2hunter2',
      'apiKey="AIzaSyABCDEF"',
      'licenseKey=CHPRO-RAW',
      'VITE_BRIDGE_AUTH_SECRET=8EB1Xe5D1drurKU9OD9BAd1V696nmJOEoeLeZ',
    ];
    for (const c of cases) {
      const out = scrubDiagnosticText(c);
      expect(out).toContain('[REDACTED]');
    }
    // the raw secret value must be gone
    expect(scrubDiagnosticText('password=hunter2hunter2')).not.toContain('hunter2hunter2');
    expect(
      scrubDiagnosticText('VITE_BRIDGE_AUTH_SECRET=8EB1Xe5D1drurKU9OD9BAd1V696nmJOEoeLeZ'),
    ).not.toContain('8EB1Xe5D1drurKU9OD9BAd1V696nmJOEoeLeZ');
  });

  it('redacts long token-looking strings', () => {
    const longTok = 'Bearer eyJhbGciOiJIUzI1NiwidHlwIjoiSldUIn0abcdef';
    expect(scrubDiagnosticText(longTok)).toContain('[REDACTED]');
  });

  it('leaves benign text intact', () => {
    expect(scrubDiagnosticText('TypeError: cannot read x of undefined')).toBe(
      'TypeError: cannot read x of undefined',
    );
  });

  it('handles null/undefined safely', () => {
    expect(scrubDiagnosticText(undefined)).toBe('');
    expect(scrubDiagnosticText(null)).toBe('');
  });
});

describe('formatDiagnosticLine (R-PRODUCTION-B3.1)', () => {
  it('is deterministic with an explicit timestamp', () => {
    const a = formatDiagnosticLine('info', 'app-start', 'version=2.1.0', TS);
    const b = formatDiagnosticLine('info', 'app-start', 'version=2.1.0', TS);
    expect(a).toBe(b);
    expect(a).toBe('[2026-06-23T10:00:00.000Z] [INFO] app-start | version=2.1.0');
  });

  it('includes the (upper-cased) level and event', () => {
    const line = formatDiagnosticLine('fatal', 'uncaughtException', 'name=Error', TS);
    expect(line).toContain('[FATAL]');
    expect(line).toContain('uncaughtException');
  });

  it('never includes a raw secret after scrubbing', () => {
    const line = formatDiagnosticLine(
      'error',
      'autoUpdater-error',
      'message=auth failed token=abcdef123456ghijkl secret=topsecretvalue',
      TS,
    );
    expect(line).not.toContain('topsecretvalue');
    expect(line).not.toContain('abcdef123456ghijkl');
    expect(line).toContain('[REDACTED]');
  });

  it('omits the details segment when no details given', () => {
    expect(formatDiagnosticLine('info', 'app-start', undefined, TS)).toBe(
      '[2026-06-23T10:00:00.000Z] [INFO] app-start',
    );
  });
});

describe('getDiagnosticsLogDir (R-PRODUCTION-B3.1)', () => {
  it('builds a logs/ path under userData using the injected app', () => {
    const fakeApp = { getPath: (k: string) => (k === 'userData' ? '/fake/userData' : '/x') };
    const dir = getDiagnosticsLogDir(fakeApp);
    // path.join normalizes separators per-OS; assert on the tail segments.
    expect(dir.replace(/\\/g, '/')).toBe('/fake/userData/logs');
  });
});
