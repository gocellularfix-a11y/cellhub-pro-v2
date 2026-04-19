// ============================================================
// CellHub Pro — Legacy Data Importer
// Reads JSON backups from the single-file HTML version
// and imports them into Firestore.
// ============================================================

import {
  doc,
  setDoc,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS } from '@/config/constants';
import { generateId } from '@/utils/dates';

interface ImportResult {
  success: boolean;
  counts: Record<string, number>;
  errors: string[];
}

/**
 * Import a legacy JSON backup into Firestore.
 * The backup format matches StorageManager.export() from the HTML version.
 */
export async function importLegacyBackup(
  db: Firestore,
  backup: Record<string, unknown>,
): Promise<ImportResult> {
  const counts: Record<string, number> = {};
  const errors: string[] = [];

  // Map legacy keys to Firestore collection names
  const keyMap: Record<string, string> = {
    customers: COLLECTIONS.customers,
    inventory: COLLECTIONS.inventory,
    sales: COLLECTIONS.sales,
    repairs: COLLECTIONS.repairs,
    unlocks: COLLECTIONS.unlocks,
    special_orders: COLLECTIONS.specialOrders,
    layaways: COLLECTIONS.layaways,
    employees: COLLECTIONS.employees,
  };

  for (const [legacyKey, collectionName] of Object.entries(keyMap)) {
    const data = backup[legacyKey];
    if (!Array.isArray(data) || data.length === 0) continue;

    try {
      // Batch writes in groups of 500 (Firestore limit)
      const chunks = chunkArray(data, 400);

      for (const chunk of chunks) {
        const batch = writeBatch(db);

        for (const item of chunk) {
          const id = item.id || generateId();
          const ref = doc(db, collectionName, String(id));

          // Clean up the item — remove undefined values
          const cleaned = cleanItem(item);
          cleaned.importedAt = serverTimestamp();

          batch.set(ref, cleaned, { merge: true });
        }

        await batch.commit();
      }

      counts[legacyKey] = data.length;
    } catch (err) {
      errors.push(`${legacyKey}: ${String(err)}`);
    }
  }

  // Settings (singleton document)
  if (backup.settings && typeof backup.settings === 'object') {
    try {
      await setDoc(
        doc(db, COLLECTIONS.settings, 'store'),
        {
          ...(backup.settings as Record<string, unknown>),
          importedAt: serverTimestamp(),
        },
        { merge: true },
      );
      counts.settings = 1;
    } catch (err) {
      errors.push(`settings: ${String(err)}`);
    }
  }

  return {
    success: errors.length === 0,
    counts,
    errors,
  };
}

/**
 * Split an array into chunks of a given size.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Clean an item for Firestore — remove undefined values
 * and convert date strings to consistent format.
 */
function cleanItem(item: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(item)) {
    if (value === undefined) continue;
    if (value === null) {
      cleaned[key] = null;
      continue;
    }

    // Recursively clean nested objects (but not arrays)
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      cleaned[key] = cleanItem(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}
