import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXPECTED = [
  'sales', 'customers', 'inventory', 'repairs',
  'unlocks', 'special_orders', 'employees', 'settings', 'layaways',
  'purchase_orders', 'appointments', 'expenses',
  'customer_returns', 'vendor_returns',
];

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('canonical backupKeys.json (R-BACKUP-KEYS)', () => {
  const keys = JSON.parse(read('../../../electron/backupKeys.json')) as string[];

  it('has exactly 14 keys', () => {
    expect(keys).toHaveLength(14);
  });

  it('contains exactly the existing 14 keys, in order', () => {
    expect(keys).toEqual(EXPECTED);
  });
});

describe('Electron backup paths consume the canonical JSON (no duplicate lists)', () => {
  it('autoBackup.js requires backupKeys.json and dropped LOCALSTORAGE_BACKUP_KEYS', () => {
    const src = read('../../../electron/autoBackup.js');
    expect(src).toContain("require('./backupKeys.json')");
    expect(src).not.toContain('LOCALSTORAGE_BACKUP_KEYS');
  });

  it('main.js requires backupKeys.json and has no inline KEYS array literal', () => {
    const src = read('../../../electron/main.js');
    expect(src).toContain("require('./backupKeys.json')");
    expect(src).toContain('JSON.stringify(BACKUP_KEYS)');
    // The old inline list started with 'sales','customers','inventory' — must be gone.
    expect(src).not.toContain("'sales','customers','inventory'");
  });

  // NOTE: storage.ts (renderer manual export/import) is intentionally NOT yet
  // unified — importing the canonical file into the Vite renderer bundle needs a
  // build-config decision (resolveJsonModule). Deferred per the round report.
});
