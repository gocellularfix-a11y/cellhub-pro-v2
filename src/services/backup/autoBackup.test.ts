import { describe, it, expect, vi } from 'vitest';
// @ts-ignore — electron/autoBackup.js is a CommonJS runtime module (no .d.ts).
import { buildAutoBackupFileName, shouldRunStartupBackup, pruneAutoBackups } from '../../../electron/autoBackup.js';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-06-23T12:00:00.000Z').getTime();

describe('shouldRunStartupBackup (R-PRODUCTION-B5.2)', () => {
  it('no prior backup → true', () => {
    expect(shouldRunStartupBackup(undefined, NOW)).toBe(true);
    expect(shouldRunStartupBackup('', NOW)).toBe(true);
  });

  it('last backup < 24h old → false', () => {
    const last = new Date(NOW - 5 * HOUR).toISOString();
    expect(shouldRunStartupBackup(last, NOW)).toBe(false);
  });

  it('last backup > 24h old → true', () => {
    const last = new Date(NOW - 25 * HOUR).toISOString();
    expect(shouldRunStartupBackup(last, NOW)).toBe(true);
  });

  it('exactly 24h old → true (>= boundary)', () => {
    const last = new Date(NOW - 24 * HOUR).toISOString();
    expect(shouldRunStartupBackup(last, NOW)).toBe(true);
  });

  it('unparseable timestamp → true (fail-safe)', () => {
    expect(shouldRunStartupBackup('not-a-date', NOW)).toBe(true);
  });

  it('respects a custom intervalHours', () => {
    const last = new Date(NOW - 10 * HOUR).toISOString();
    expect(shouldRunStartupBackup(last, NOW, 12)).toBe(false);
    expect(shouldRunStartupBackup(last, NOW, 6)).toBe(true);
  });
});

describe('buildAutoBackupFileName (R-PRODUCTION-B5.2)', () => {
  it('deterministic format cellhub-AUTO-BACKUP-YYYY-MM-DD-HHmmss.json', () => {
    // Local-time components — construct with explicit local fields.
    const d = new Date(2026, 5, 23, 9, 5, 7); // 2026-06-23 09:05:07 local
    expect(buildAutoBackupFileName(d)).toBe('cellhub-AUTO-BACKUP-2026-06-23-090507.json');
  });

  it('zero-pads month/day/time', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(buildAutoBackupFileName(d)).toBe('cellhub-AUTO-BACKUP-2026-01-02-030405.json');
  });

  it('same date → same name (deterministic)', () => {
    const d = new Date(2026, 5, 23, 9, 5, 7);
    expect(buildAutoBackupFileName(d)).toBe(buildAutoBackupFileName(new Date(d.getTime())));
  });
});

describe('pruneAutoBackups (R-PRODUCTION-B5.2)', () => {
  function fakeFs(files: string[]) {
    const deleted: string[] = [];
    return {
      readdirSync: () => files.slice(),
      unlinkSync: (p: string) => { deleted.push(p.replace(/\\/g, '/').split('/').pop() as string); },
      _deleted: deleted,
    };
  }

  it('keeps newest N AUTO backups, deletes oldest extras', () => {
    // 16 AUTO files, sortable by embedded timestamp.
    const files = Array.from({ length: 16 }, (_, i) =>
      `cellhub-AUTO-BACKUP-2026-06-${String(i + 1).padStart(2, '0')}-120000.json`,
    );
    const ff = fakeFs(files);
    const n = pruneAutoBackups('/dir', 14, ff);
    expect(n).toBe(2);
    // The two oldest (day 01, 02) are deleted.
    expect(ff._deleted).toEqual([
      'cellhub-AUTO-BACKUP-2026-06-01-120000.json',
      'cellhub-AUTO-BACKUP-2026-06-02-120000.json',
    ]);
  });

  it('does nothing when at or under keepCount', () => {
    const files = ['cellhub-AUTO-BACKUP-2026-06-01-120000.json'];
    const ff = fakeFs(files);
    expect(pruneAutoBackups('/dir', 14, ff)).toBe(0);
    expect(ff._deleted).toEqual([]);
  });

  it('ignores manual backups (cellhub-backup-*.json)', () => {
    const files = [
      'cellhub-backup-2020-01-01.json', // manual — must never be touched
      ...Array.from({ length: 15 }, (_, i) =>
        `cellhub-AUTO-BACKUP-2026-06-${String(i + 1).padStart(2, '0')}-120000.json`,
      ),
    ];
    const ff = fakeFs(files);
    const n = pruneAutoBackups('/dir', 14, ff);
    expect(n).toBe(1); // only 1 AUTO extra (15 - 14)
    expect(ff._deleted).toEqual(['cellhub-AUTO-BACKUP-2026-06-01-120000.json']);
    expect(ff._deleted).not.toContain('cellhub-backup-2020-01-01.json');
  });

  it('ignores non-AUTO / unrelated files', () => {
    const files = ['notes.txt', 'config.json', 'cellhub-AUTO-BACKUP-2026-06-01-120000.json'];
    const ff = fakeFs(files);
    expect(pruneAutoBackups('/dir', 1, ff)).toBe(0); // only 1 AUTO, keep 1
    expect(ff._deleted).toEqual([]);
  });

  it('returns 0 safely when readdir throws', () => {
    const ff = { readdirSync: () => { throw new Error('no dir'); }, unlinkSync: vi.fn() };
    expect(pruneAutoBackups('/dir', 14, ff)).toBe(0);
  });
});
