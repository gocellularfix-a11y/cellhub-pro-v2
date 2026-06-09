// ============================================================
// CellHub Pro — Persistence Service
// Dual-mode: Firestore (cloud) OR localStorage (offline-only).
// Firebase is OPTIONAL. If not configured, all data stays
// local. The app works 100% without Firebase.
// ============================================================

import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS } from '@/config/constants';
import { saveLocal, loadLocal, removeLocal } from '@/services/storage';
// LOCAL-LAN-READONLY-GUARD-V1: read-only enforcement for LAN Secondary mirrors.
import { getConnection } from '@/services/lan/lanService';

// ── LOCAL-LAN-READONLY-GUARD-V1 ───────────────────────────
// When this machine is a paired LAN Secondary it is a READ-ONLY mirror of the
// Primary. Every persistence path funnels through saveRecord / deleteRecord /
// persistSettings / batchSave below, so blocking here blocks ALL writes
// globally with one guard — no per-module changes, no business-logic edits.
//
// Snapshot hydration does NOT touch this layer (it applies Primary data via
// in-memory AppProvider SET_* setters), so the mirror keeps refreshing. This
// guard's job is to stop a stray module write from overwriting the Secondary's
// own localStorage with mirrored Primary data, or pushing junk to Firebase.
export const READONLY_BLOCKED_EVENT = 'cellhub:lan-readonly-blocked';

function isReadOnlySecondary(): boolean {
  try { return getConnection().role === 'secondary'; }
  catch { return false; }
}

/** Emit a signal (→ friendly toast via <LanReadOnlyGuardListener>) that a write
 *  was blocked. Dependency-free so it is safe to call from this service. */
function signalReadOnlyBlock(action: string): void {
  try {
    window.dispatchEvent(new CustomEvent(READONLY_BLOCKED_EVENT, { detail: { action } }));
  } catch {
    /* non-browser context — ignore */
  }
}

// ── DB singleton ──────────────────────────────────────────
let _db: Firestore | null = null;

export function setFirestoreInstance(firestore: Firestore | null) {
  _db = firestore;
}

export function isCloudEnabled(): boolean {
  return _db !== null;
}

// R-FIREBASE-MULTIPC-SYNC: getter so the bulk push/pull buttons in
// Settings can access the same singleton without re-plumbing db down
// the AppShell → SettingsModule prop chain.
export function getFirestoreInstance(): Firestore | null {
  return _db;
}

// ── Multi-store: auto-tag storeId on writes ───────────────
// r-multi-m1: Instead of editing 42 persist call sites across 12 modules,
// we inject storeId at the persist layer. setCurrentStoreId() is called
// once by App.tsx on boot and whenever the active store changes.
// Collections in GLOBAL_COLLECTIONS are exempt (shared across all stores).
let _currentStoreId: string = 'default';

export function setCurrentStoreId(id: string) {
  _currentStoreId = id || 'default';
}

export function getCurrentStoreId(): string {
  return _currentStoreId;
}

// Collections that are GLOBAL (shared across all stores, no storeId tag).
// Everything else gets auto-tagged.
const GLOBAL_COLLECTIONS: Set<string> = new Set([
  COLLECTIONS.customers,      // customers are shared across stores
  COLLECTIONS.settings,       // global app settings (per-store settings come in M3)
]);

// ── Local storage collection keys ─────────────────────────
const LOCAL_KEYS: Record<string, string> = {
  [COLLECTIONS.customers]:     'customers',
  [COLLECTIONS.inventory]:     'inventory',
  [COLLECTIONS.sales]:         'sales',
  [COLLECTIONS.repairs]:       'repairs',
  [COLLECTIONS.unlocks]:       'unlocks',
  [COLLECTIONS.specialOrders]: 'special_orders',
  [COLLECTIONS.layaways]:      'layaways',
  [COLLECTIONS.employees]:     'employees',
  [COLLECTIONS.settings]:      'settings',
  [COLLECTIONS.purchaseOrders]: 'purchase_orders',
  [COLLECTIONS.appointments]:   'appointments',
  // r-batch-a (1b): expenses was being called as persist.expense() from
  // ExpensesModule but the collection wasn't registered here nor in the
  // persist/remove shortcut objects below, producing 3 TS errors and
  // silently dropping all expense saves. Now properly wired.
  [COLLECTIONS.expenses]:         'expenses',
  // r-pkg-b3: Returns foundation — dual-write to localStorage under same
  // keys that ReportsModule/Dashboard/AIAssistant already read from, so
  // those consumers keep working without modification.
  [COLLECTIONS.customerReturns]:  'customer_returns',
  [COLLECTIONS.vendorReturns]:    'vendor_returns',
  // R-LOSSES-SHRINKAGE-V1
  [COLLECTIONS.inventoryLosses]:  'inventory_losses',
  // R-STORE-CREDIT-REDEMPTION-SYSTEM
  [COLLECTIONS.storeCreditLedger]: 'store_credit_ledger',
};

// ── Local helpers ─────────────────────────────────────────

function localSaveRecord(collectionName: string, id: string, data: Record<string, unknown>): void {
  const key = LOCAL_KEYS[collectionName] || collectionName;
  if (collectionName === COLLECTIONS.settings) {
    // Settings is a singleton object, not an array.
    // CRITICAL r26: must MERGE with existing localStorage settings, not overwrite.
    // Overwriting destroys all other settings fields on every partial update,
    // breaking the offline-mode customer story (BYO-no-Firebase).
    const existing = loadLocal<Record<string, unknown>>(key, {});
    const ok = saveLocal(key, { ...existing, ...data, updatedAt: new Date().toISOString() });
    // r-stabilize-1 T3: surface a failed local write (e.g. quota exceeded) with
    // collection/id context. saveLocal already logs the raw error, but it has no
    // record context — this makes a dropped settings write traceable.
    if (!ok) console.error(`[persist] LOCAL SAVE FAILED — ${collectionName}/${id} NOT persisted (storage full?)`);
    return;
  }
  const arr = loadLocal<Record<string, unknown>[]>(key, []);
  const idx = arr.findIndex((r) => r.id === id);
  let ok: boolean;
  if (idx >= 0) {
    // r-stabilize-1 T1: MERGE existing record with incoming partial data so a
    // partial save can never silently erase fields not present in `data`.
    // Mirrors Firestore's { merge: true } semantics (see setDoc in saveRecord)
    // so local and cloud writes stay consistent. Keys present in `data` still
    // overwrite the old value; keys absent from `data` are preserved.
    arr[idx] = { ...arr[idx], ...data, id, updatedAt: new Date().toISOString() };
    ok = saveLocal(key, arr);
  } else {
    // New record — no existing fields to preserve.
    arr.push({ ...data, id, updatedAt: new Date().toISOString() });
    ok = saveLocal(key, arr);
  }
  // r-stabilize-1 T3: make a dropped write visible with record context.
  if (!ok) console.error(`[persist] LOCAL SAVE FAILED — ${collectionName}/${id} NOT persisted (storage full?)`);
}

function localDeleteRecord(collectionName: string, id: string): void {
  const key = LOCAL_KEYS[collectionName] || collectionName;
  const arr = loadLocal<Record<string, unknown>[]>(key, []);
  saveLocal(key, arr.filter((r) => r.id !== id));
}

// ── Core operations ───────────────────────────────────────

export async function saveRecord(
  collectionName: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  // LOCAL-LAN-READONLY-GUARD-V1: block writes on a read-only Secondary.
  if (isReadOnlySecondary()) {
    console.info(`[persist] read-only Secondary — blocked save ${collectionName}/${id}`);
    signalReadOnlyBlock('save');
    return;
  }
  // r-multi-m1: auto-tag storeId on per-store collections.
  // Global collections (customers, settings) are exempt.
  const tagged = GLOBAL_COLLECTIONS.has(collectionName)
    ? data
    : { ...data, storeId: data.storeId ?? _currentStoreId };

  // Always save locally first (instant, works offline)
  localSaveRecord(collectionName, id, tagged);

  // Then sync to Firestore if available
  if (!_db) return;
  try {
    await setDoc(
      doc(_db, collectionName, id),
      { ...tagged, id, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.warn(`[persist] cloud save ${collectionName}/${id}:`, err);
  }
}

export async function deleteRecord(
  collectionName: string,
  id: string,
): Promise<void> {
  // LOCAL-LAN-READONLY-GUARD-V1: block deletes on a read-only Secondary.
  if (isReadOnlySecondary()) {
    console.info(`[persist] read-only Secondary — blocked delete ${collectionName}/${id}`);
    signalReadOnlyBlock('delete');
    return;
  }
  // Always delete locally first
  localDeleteRecord(collectionName, id);

  // Then sync to Firestore if available
  if (!_db) return;
  try {
    await deleteDoc(doc(_db, collectionName, id));
  } catch (err) {
    console.warn(`[persist] cloud delete ${collectionName}/${id}:`, err);
  }
}

export async function persistSettings(data: Record<string, unknown>): Promise<void> {
  // LOCAL-LAN-READONLY-GUARD-V1: block settings writes on a read-only Secondary.
  if (isReadOnlySecondary()) {
    console.info('[persist] read-only Secondary — blocked settings write');
    signalReadOnlyBlock('settings');
    return;
  }
  // Save locally — MUST MERGE, not overwrite (r26 BLOCKER fix).
  // `data` is typically a delta (e.g. just { storeName }). Without merging,
  // every update wipes the entire settings blob in localStorage, breaking
  // offline-mode customers on the very first edit.
  const existing = loadLocal<Record<string, unknown>>('settings', {});
  saveLocal('settings', { ...existing, ...data, updatedAt: new Date().toISOString() });

  // Sync to Firestore if available
  if (!_db) return;
  try {
    await setDoc(
      doc(_db, COLLECTIONS.settings, 'store'),
      { ...data, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.warn('[persist] cloud saveSettings:', err);
  }
}

export async function batchSave(
  ops: Array<{ collection: string; id: string; data: Record<string, unknown> }>,
): Promise<void> {
  // LOCAL-LAN-READONLY-GUARD-V1: block batch writes on a read-only Secondary.
  if (isReadOnlySecondary()) {
    console.info(`[persist] read-only Secondary — blocked batchSave (${ops.length} ops)`);
    signalReadOnlyBlock('save');
    return;
  }
  // r-multi-m1: auto-tag storeId on per-store collections
  const taggedOps = ops.map((op) => ({
    ...op,
    data: GLOBAL_COLLECTIONS.has(op.collection)
      ? op.data
      : { ...op.data, storeId: op.data.storeId ?? _currentStoreId },
  }));

  // Save all locally first
  for (const op of taggedOps) {
    localSaveRecord(op.collection, op.id, op.data);
  }

  // Then batch to Firestore if available
  if (!_db) return;
  try {
    const batch = writeBatch(_db);
    for (const op of taggedOps) {
      batch.set(
        doc(_db, op.collection, op.id),
        { ...op.data, id: op.id, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
    await batch.commit();
  } catch (err) {
    console.warn('[persist] cloud batchSave:', err);
  }
}

// ── Per-collection shortcuts ──────────────────────────────

export const persist = {
  customer:      (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.customers,      id, data),
  inventory:     (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.inventory,      id, data),
  sale:          (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.sales,          id, data),
  repair:        (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.repairs,        id, data),
  unlock:        (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.unlocks,        id, data),
  specialOrder:  (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.specialOrders,  id, data),
  layaway:       (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.layaways,       id, data),
  employee:      (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.employees,      id, data),
  purchaseOrder: (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.purchaseOrders, id, data),
  appointment:   (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.appointments,   id, data),
  // r-batch-a (1b): expense was missing — ExpensesModule called persist.expense()
  // which didn't exist, producing TS errors and silently dropping writes.
  expense:       (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.expenses,      id, data),
  // r-pkg-b3: Returns foundation
  customerReturn:(id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.customerReturns, id, data),
  vendorReturn:  (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.vendorReturns,   id, data),
  // R-LOSSES-SHRINKAGE-V1
  inventoryLoss: (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.inventoryLosses, id, data),
  // R-STORE-CREDIT-REDEMPTION-SYSTEM
  storeCreditLedger: (id: string, data: Record<string, unknown>) => saveRecord(COLLECTIONS.storeCreditLedger, id, data),
};

export const remove = {
  customer:      (id: string) => deleteRecord(COLLECTIONS.customers,      id),
  inventory:     (id: string) => deleteRecord(COLLECTIONS.inventory,      id),
  sale:          (id: string) => deleteRecord(COLLECTIONS.sales,          id),
  repair:        (id: string) => deleteRecord(COLLECTIONS.repairs,        id),
  unlock:        (id: string) => deleteRecord(COLLECTIONS.unlocks,        id),
  specialOrder:  (id: string) => deleteRecord(COLLECTIONS.specialOrders,  id),
  layaway:       (id: string) => deleteRecord(COLLECTIONS.layaways,       id),
  employee:      (id: string) => deleteRecord(COLLECTIONS.employees,      id),
  purchaseOrder: (id: string) => deleteRecord(COLLECTIONS.purchaseOrders, id),
  appointment:   (id: string) => deleteRecord(COLLECTIONS.appointments,   id),
  // r-batch-a (1b): expense delete shortcut added alongside persist.expense
  expense:       (id: string) => deleteRecord(COLLECTIONS.expenses,      id),
  // r-pkg-b3: Returns foundation
  customerReturn:(id: string) => deleteRecord(COLLECTIONS.customerReturns, id),
  vendorReturn:  (id: string) => deleteRecord(COLLECTIONS.vendorReturns,   id),
};
