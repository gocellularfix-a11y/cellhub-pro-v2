import { useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { useApp } from '@/store/AppProvider';
import { COLLECTIONS } from '@/config/constants';
import { loadLocal, saveLocal } from '@/services/storage';

// ============================================================
// R-FIREBASE-MULTIPC-SYNC: helpers + manifest shared between
// the live snapshot subscriber and the bulk push/pull buttons.
// ============================================================

/** Convert any timestamp shape (Firestore Timestamp / Date / ISO
 *  string / undefined) into milliseconds since epoch. Used by the
 *  last-write-wins merge below. */
function tsToMs(v: unknown): number {
  if (!v) return 0;
  if (typeof (v as any)?.toDate === 'function') {
    try { return (v as any).toDate().getTime(); } catch { return 0; }
  }
  try { return new Date(v as string).getTime(); } catch { return 0; }
}

/** Merge two arrays of records by id with last-write-wins on
 *  `updatedAt`. Used for editable collections (customers, inventory,
 *  repairs, unlocks, etc.) on the FIRST cloud snapshot only — later
 *  snapshots authoritative-replace as before. */
function mergeByTimestamp<T extends { id: string; updatedAt?: unknown }>(
  localArr: T[],
  cloudArr: T[],
): T[] {
  const map = new Map<string, T>();
  for (const r of localArr) if (r && r.id) map.set(r.id, r);
  for (const r of cloudArr) {
    if (!r || !r.id) continue;
    const local = map.get(r.id);
    if (!local || tsToMs(r.updatedAt) >= tsToMs(local.updatedAt)) {
      map.set(r.id, r);
    }
  }
  return Array.from(map.values());
}

/** Union by id — used for append-only collections (sales, returns)
 *  where we just want both sets without comparing timestamps. Cloud
 *  wins on collisions (same id) since cloud is authoritative source. */
function mergeUnion<T extends { id: string }>(
  localArr: T[],
  cloudArr: T[],
): T[] {
  const map = new Map<string, T>();
  for (const r of localArr) if (r && r.id) map.set(r.id, r);
  for (const r of cloudArr) if (r && r.id) map.set(r.id, r);
  return Array.from(map.values());
}

type MergeMode = 'timestamp' | 'union';
interface SyncEntry {
  localKey: string;
  collectionName: string;
  actionType: string;
  /** timestamp = last-write-wins; union = both sets, cloud wins on collision */
  mergeMode: MergeMode;
}

const SYNC_MANIFEST: SyncEntry[] = [
  { localKey: 'customers',        collectionName: COLLECTIONS.customers,      actionType: 'SET_CUSTOMERS',         mergeMode: 'timestamp' },
  { localKey: 'inventory',        collectionName: COLLECTIONS.inventory,      actionType: 'SET_INVENTORY',         mergeMode: 'timestamp' },
  // R-FIREBASE-MULTIPC-SYNC: sales + returns are append-only by domain
  // contract (post-creation edits go through audit trail, not in-place
  // mutation). Union avoids re-stamping timestamps for stable records.
  { localKey: 'sales',            collectionName: COLLECTIONS.sales,          actionType: 'SET_SALES',             mergeMode: 'union' },
  { localKey: 'repairs',          collectionName: COLLECTIONS.repairs,        actionType: 'SET_REPAIRS',           mergeMode: 'timestamp' },
  { localKey: 'unlocks',          collectionName: COLLECTIONS.unlocks,        actionType: 'SET_UNLOCKS',           mergeMode: 'timestamp' },
  { localKey: 'special_orders',   collectionName: COLLECTIONS.specialOrders,  actionType: 'SET_SPECIAL_ORDERS',    mergeMode: 'timestamp' },
  { localKey: 'layaways',         collectionName: COLLECTIONS.layaways,       actionType: 'SET_LAYAWAYS',          mergeMode: 'timestamp' },
  { localKey: 'employees',        collectionName: COLLECTIONS.employees,      actionType: 'SET_EMPLOYEES',         mergeMode: 'timestamp' },
  { localKey: 'purchase_orders',  collectionName: COLLECTIONS.purchaseOrders, actionType: 'SET_PURCHASE_ORDERS',   mergeMode: 'timestamp' },
  { localKey: 'appointments',     collectionName: COLLECTIONS.appointments,   actionType: 'SET_APPOINTMENTS',      mergeMode: 'timestamp' },
  { localKey: 'expenses',         collectionName: COLLECTIONS.expenses,       actionType: 'SET_EXPENSES',          mergeMode: 'timestamp' },
  { localKey: 'customer_returns', collectionName: COLLECTIONS.customerReturns,actionType: 'SET_CUSTOMER_RETURNS',  mergeMode: 'union' },
  { localKey: 'vendor_returns',   collectionName: COLLECTIONS.vendorReturns,  actionType: 'SET_VENDOR_RETURNS',    mergeMode: 'union' },
  // R-LOSSES-SHRINKAGE-V1: append-only audit shape — losses are never
  // edited or hard-deleted in V1, so union merge mode mirrors sales/returns.
  { localKey: 'inventory_losses', collectionName: COLLECTIONS.inventoryLosses,actionType: 'SET_INVENTORY_LOSSES',  mergeMode: 'union' },
];

/**
 * Subscribe to Firestore collections (cloud mode) OR load from
 * localStorage (offline mode). Firebase is optional.
 * Call once in App.tsx after boot.
 */
export function useFirestoreSync(db: Firestore | null) {
  const { dispatch } = useApp();
  const unsubscribes = useRef<Unsubscribe[]>([]);
  const localBootDone = useRef(false);
  // R-FIREBASE-MULTIPC-SYNC: track which collections have already received
  // their first cloud snapshot. The first snapshot merges with localStorage
  // (so PC2 doesn't lose offline edits the moment it connects); later
  // snapshots replace authoritatively as before.
  const firstSnapshotKeys = useRef<Set<string>>(new Set());

  // ── Offline mode: load from localStorage ─────────────────
  useEffect(() => {
    if (db || localBootDone.current) return;
    localBootDone.current = true;

    for (const { localKey, actionType } of SYNC_MANIFEST) {
      const data = loadLocal<unknown[]>(localKey, []);
      dispatch({ type: actionType, payload: data } as never);
    }

    const settings = loadLocal<Record<string, unknown>>('settings', {});
    if (Object.keys(settings).length > 0) {
      dispatch({ type: 'SET_SETTINGS', payload: settings as never });
    }

    dispatch({ type: 'SET_LOADING', payload: false });
  }, [db, dispatch]);

  // ── Cloud mode: subscribe to Firestore ───────────────────
  useEffect(() => {
    if (!db) return;

    // Reset first-snapshot tracker on each (re)subscribe so a Firebase
    // re-init (config change) gets fresh merge semantics.
    firstSnapshotKeys.current = new Set();

    // Wait for all initial snapshots before marking loading=false
    const totalListeners = SYNC_MANIFEST.length + 1; // +1 for settings
    let received = 0;
    let done = false;
    const markDone = () => {
      received += 1;
      if (!done && received >= totalListeners) {
        done = true;
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    for (const { localKey, collectionName, actionType, mergeMode } of SYNC_MANIFEST) {
      let first = true;
      const unsub = onSnapshot(
        collection(db, collectionName),
        (snapshot) => {
          const cloudDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{ id: string; updatedAt?: unknown }>;

          let payload: unknown[];
          if (!firstSnapshotKeys.current.has(localKey)) {
            // R-FIREBASE-MULTIPC-SYNC: first snapshot — merge with localStorage.
            // This is the only path where we read local + cloud and write
            // the merged result back to localStorage (so the merged state
            // becomes the new local source of truth).
            const localArr = loadLocal<Array<{ id: string; updatedAt?: unknown }>>(localKey, []);
            const merged = mergeMode === 'union'
              ? mergeUnion(localArr, cloudDocs)
              : mergeByTimestamp(localArr, cloudDocs);
            saveLocal(localKey, merged);
            payload = merged;
            firstSnapshotKeys.current.add(localKey);
          } else {
            // Subsequent snapshots — authoritative replace from cloud.
            payload = cloudDocs;
          }

          dispatch({ type: actionType, payload } as never);
          if (first) { first = false; markDone(); }
        },
        (err) => {
          console.error(`🔴 Firestore [${collectionName}]:`, err);
          if (first) { first = false; markDone(); }
        },
      );
      unsubscribes.current.push(unsub);
    }

    // Settings singleton
    let firstSettings = true;
    const settingsUnsub = onSnapshot(
      doc(db, COLLECTIONS.settings, 'store'),
      (snapshot) => {
        if (snapshot.exists()) {
          dispatch({ type: 'SET_SETTINGS', payload: snapshot.data() as never });
        }
        if (firstSettings) { firstSettings = false; markDone(); }
      },
      (err) => {
        console.error('🔴 Firestore [settings]:', err);
        if (firstSettings) { firstSettings = false; markDone(); }
      },
    );
    unsubscribes.current.push(settingsUnsub);

    return () => {
      unsubscribes.current.forEach((unsub) => unsub());
      unsubscribes.current = [];
    };
  }, [db, dispatch]);
}

/**
 * CRUD operations for a Firestore collection.
 */
export function useFirestoreCrud(db: Firestore | null) {
  const saveDoc = useCallback(
    async (collectionName: string, id: string, data: Record<string, unknown>) => {
      if (!db) throw new Error('Firestore not initialized');
      await setDoc(doc(db, collectionName, id), {
        ...data,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    },
    [db],
  );

  const createDoc = useCallback(
    async (collectionName: string, id: string, data: Record<string, unknown>) => {
      if (!db) throw new Error('Firestore not initialized');
      await setDoc(doc(db, collectionName, id), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    [db],
  );

  const removeDoc = useCallback(
    async (collectionName: string, id: string) => {
      if (!db) throw new Error('Firestore not initialized');
      await deleteDoc(doc(db, collectionName, id));
    },
    [db],
  );

  const batchWrite = useCallback(
    async (
      operations: Array<{
        type: 'set' | 'update' | 'delete';
        collection: string;
        id: string;
        data?: Record<string, unknown>;
      }>,
    ) => {
      if (!db) throw new Error('Firestore not initialized');
      const batch = writeBatch(db);
      for (const op of operations) {
        const ref = doc(db, op.collection, op.id);
        if (op.type === 'delete') {
          batch.delete(ref);
        } else {
          batch.set(ref, {
            ...op.data,
            updatedAt: serverTimestamp(),
          }, { merge: op.type === 'update' });
        }
      }
      await batch.commit();
    },
    [db],
  );

  const saveSettings = useCallback(
    async (data: Record<string, unknown>) => {
      if (!db) throw new Error('Firestore not initialized');
      await setDoc(doc(db, COLLECTIONS.settings, 'store'), data, { merge: true });
    },
    [db],
  );

  return { saveDoc, createDoc, removeDoc, batchWrite, saveSettings };
}

// ============================================================
// R-FIREBASE-MULTIPC-SYNC: bulk push / pull operations.
// Called from SettingsModule (Backup tab) when the cashier wants
// to force-upload local data or replace local with cloud.
// ============================================================

/** Result shape returned by bulk operations. Counts are total
 *  records (not collections) for the toast UX. */
export interface BulkSyncResult {
  records: number;
  collections: number;
}

/** Push all localStorage data up to Firestore. Loops the manifest,
 *  chunks each collection into 400-op batches (Firestore commits
 *  cap at 500 ops; 400 leaves headroom for serverTimestamp
 *  metadata). Settings is a singleton doc — handled separately.
 *  Skips records without an id (legacy / corrupt entries). */
export async function pushAllToCloud(db: Firestore): Promise<BulkSyncResult> {
  let records = 0;
  let collectionsTouched = 0;
  const CHUNK_SIZE = 400;

  for (const { localKey, collectionName } of SYNC_MANIFEST) {
    const arr = loadLocal<Array<Record<string, unknown> & { id?: string }>>(localKey, []);
    if (!Array.isArray(arr) || arr.length === 0) continue;
    collectionsTouched++;

    for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
      const chunk = arr.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const record of chunk) {
        if (!record || !record.id) continue;
        const ref = doc(db, collectionName, record.id as string);
        // Use merge:true so existing cloud fields (e.g. createdAt) survive
        // a re-push. updatedAt always gets a fresh server-side timestamp.
        batch.set(
          ref,
          { ...record, updatedAt: serverTimestamp() },
          { merge: true },
        );
        records++;
      }
      await batch.commit();
    }
  }

  // Settings — singleton doc.
  const settings = loadLocal<Record<string, unknown>>('settings', {});
  if (Object.keys(settings).length > 0) {
    await setDoc(
      doc(db, COLLECTIONS.settings, 'store'),
      { ...settings, updatedAt: serverTimestamp() },
      { merge: true },
    );
    records++;
    collectionsTouched++;
  }

  return { records, collections: collectionsTouched };
}

/** Pull all data from Firestore one-shot (getDocs, NOT subscribe)
 *  and REPLACE localStorage. Caller is responsible for reloading
 *  the page so React state re-hydrates from the new local data —
 *  doing setX dispatches here would race the live snapshot
 *  subscriber that's still active. */
export async function pullAllFromCloud(db: Firestore): Promise<BulkSyncResult> {
  let records = 0;
  let collectionsTouched = 0;

  for (const { localKey, collectionName } of SYNC_MANIFEST) {
    const snap = await getDocs(collection(db, collectionName));
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    saveLocal(localKey, docs);
    records += docs.length;
    collectionsTouched++;
  }

  // Settings singleton.
  const settingsSnap = await getDoc(doc(db, COLLECTIONS.settings, 'store'));
  if (settingsSnap.exists()) {
    saveLocal('settings', settingsSnap.data());
    records++;
    collectionsTouched++;
  }

  return { records, collections: collectionsTouched };
}

/** Quick local record count for the "large dataset" warning in the
 *  Push confirm modal. Sums all manifest collections + settings (1). */
export function countLocalRecords(): number {
  let n = 0;
  for (const { localKey } of SYNC_MANIFEST) {
    const arr = loadLocal<unknown[]>(localKey, []);
    if (Array.isArray(arr)) n += arr.length;
  }
  const settings = loadLocal<Record<string, unknown>>('settings', {});
  if (Object.keys(settings).length > 0) n += 1;
  return n;
}
