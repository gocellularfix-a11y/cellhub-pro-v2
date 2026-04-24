// ============================================================
// CellHub Pro — Storage Service
// Adapts the legacy StorageManager pattern to Firestore.
// Falls back to localStorage when Firestore is unavailable.
// ============================================================

import {
  isLegacyBackup,
  normalizeLegacyBackup,
  NormalizationResult,
} from './import/legacyAdapter';

const STORAGE_PREFIX = 'cellhub_';

export interface ImportBackupResult {
  success: boolean;
  error?: string;
  /** Non-null when the backup was detected as legacy v1 and converted. */
  normalization?: NormalizationResult;
}

/**
 * Save data to localStorage (fallback / cache layer).
 */
export function saveLocal(key: string, data: unknown): boolean {
  try {
    const json = JSON.stringify(data);
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, json);
    return true;
  } catch (e) {
    console.error(`[Storage] Failed to save ${key}:`, e);
    return false;
  }
}

/**
 * Load data from localStorage.
 */
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Remove a key from localStorage.
 */
export function removeLocal(key: string): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
}

/**
 * Get localStorage usage stats.
 */
export function getStorageUsage(): { usedKB: number; limitKB: number; percent: number } {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) {
      total += (localStorage.getItem(k) || '').length * 2; // UTF-16
    }
  }
  const usedKB = Math.round(total / 1024);
  const limitKB = 5120; // ~5MB
  return { usedKB, limitKB, percent: Math.round((usedKB / limitKB) * 100) };
}

/**
 * r-batch-a (1a): single source of truth for backup keys — shared by
 * exportBackup and importBackup so they can never drift apart again.
 * Previously each function had its own hardcoded list which had already
 * drifted and was missing: appointments, customer_returns, vendor_returns,
 * expenses. All of these are real persisted arrays touched by running
 * modules in the app.
 *
 * `settings` is special-cased inside exportBackup because it's a
 * singleton object, not an array (see the `key === 'settings' ? {} : []`
 * default in the loop below).
 */
const BACKUP_KEYS = [
  'sales', 'customers', 'inventory', 'repairs',
  'unlocks', 'special_orders', 'employees', 'settings', 'layaways',
  'purchase_orders', 'appointments', 'expenses',
  'customer_returns', 'vendor_returns',
] as const;

/**
 * Export all CellHub data from localStorage as a JSON backup.
 */
export function exportBackup(): Record<string, unknown> {
  const backup: Record<string, unknown> = {};

  for (const key of BACKUP_KEYS) {
    backup[key] = loadLocal(key, key === 'settings' ? {} : []);
  }

  backup._exportedAt = new Date().toISOString();
  backup._version = '2.1.0';
  return backup;
}

/**
 * Import a JSON backup into localStorage.
 */
export async function importBackup(
  backup: Record<string, unknown>,
): Promise<ImportBackupResult> {
  let normalization: NormalizationResult | undefined;
  try {
    const source = (backup.data && typeof backup.data === 'object' && !Array.isArray(backup.data))
      ? backup.data as Record<string, unknown>
      : backup;

    // R-IMPORT-LEGACY-ADAPTER: detect v1 shape and normalize BEFORE merging.
    // Owns zero mapping logic here — delegates entirely to legacyAdapter.
    let effectiveSource = source;
    if (isLegacyBackup(source)) {
      normalization = normalizeLegacyBackup(source);
      effectiveSource = normalization.normalized;
      console.log(`[importBackup] Legacy v1 shape detected — normalized ${Object.keys(normalization.stats).length} collections`);
    }

    // MERGE strategy: only ADD records that don't already exist by ID
    for (const key of BACKUP_KEYS) {
      const value = effectiveSource[key];
      if (value === undefined) continue;

      if (key === 'settings' && typeof value === 'object' && !Array.isArray(value)) {
        const existing = loadLocal<Record<string, unknown>>(key, {});
        saveLocal(key, { ...value, ...existing });
      } else if (Array.isArray(value)) {
        const existing = loadLocal<Array<Record<string, unknown>>>(key, []);
        const existingIds = new Set(existing.map((r) => r.id).filter(Boolean));
        const newRecords = value.filter((r: any) => r.id && !existingIds.has(r.id));
        if (newRecords.length > 0) {
          saveLocal(key, [...existing, ...newRecords]);
        }
        console.log(`[importBackup] ${key}: ${existingIds.size} existing, ${newRecords.length} new added, ${value.length - newRecords.length} skipped`);
      }
    }

    const { saveRecord } = await import('./persist');
    const { COLLECTIONS } = await import('@/config/constants');

    const COLLECTION_MAP: Record<string, string> = {
      sales: COLLECTIONS.sales,
      customers: COLLECTIONS.customers,
      inventory: COLLECTIONS.inventory,
      repairs: COLLECTIONS.repairs,
      unlocks: COLLECTIONS.unlocks,
      special_orders: COLLECTIONS.specialOrders,
      layaways: COLLECTIONS.layaways,
      employees: COLLECTIONS.employees,
      appointments: COLLECTIONS.appointments,
      expenses: COLLECTIONS.expenses,
      purchase_orders: COLLECTIONS.purchaseOrders,
      customer_returns: COLLECTIONS.customerReturns,
      vendor_returns: COLLECTIONS.vendorReturns,
    };

    let written = 0;
    let skipped = 0;
    for (const [backupKey, collectionName] of Object.entries(COLLECTION_MAP)) {
      const records = effectiveSource[backupKey];
      if (!Array.isArray(records) || records.length === 0) continue;
      const existing = loadLocal<Array<Record<string, unknown>>>(backupKey, []);
      const existingIds = new Set(existing.map((r) => r.id).filter(Boolean));
      for (const record of records as any[]) {
        const id = record.id;
        if (!id) continue;
        if (existingIds.has(id)) { skipped++; continue; }
        try {
          await saveRecord(collectionName, id, record as Record<string, unknown>);
          written++;
        } catch { /* continue */ }
      }
    }
    console.log(`[importBackup] ${written} written, ${skipped} skipped (already exist)`);
    return { success: true, normalization };
  } catch (e) {
    return { success: false, error: String(e), normalization };
  }
}
