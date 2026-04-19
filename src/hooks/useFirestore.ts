import { useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { useApp } from '@/store/AppProvider';
import { COLLECTIONS } from '@/config/constants';
import { loadLocal } from '@/services/storage';

/**
 * Subscribe to Firestore collections (cloud mode) OR load from
 * localStorage (offline mode). Firebase is optional.
 * Call once in App.tsx after boot.
 */
export function useFirestoreSync(db: Firestore | null) {
  const { dispatch } = useApp();
  const unsubscribes = useRef<Unsubscribe[]>([]);
  const localBootDone = useRef(false);

  // ── Offline mode: load from localStorage ─────────────────
  useEffect(() => {
    if (db || localBootDone.current) return;
    localBootDone.current = true;

    const localMap = [
      { key: 'customers',       actionType: 'SET_CUSTOMERS' },
      { key: 'inventory',       actionType: 'SET_INVENTORY' },
      { key: 'sales',           actionType: 'SET_SALES' },
      { key: 'repairs',         actionType: 'SET_REPAIRS' },
      { key: 'unlocks',         actionType: 'SET_UNLOCKS' },
      { key: 'special_orders',  actionType: 'SET_SPECIAL_ORDERS' },
      { key: 'layaways',        actionType: 'SET_LAYAWAYS' },
      { key: 'employees',       actionType: 'SET_EMPLOYEES' },
      { key: 'purchase_orders', actionType: 'SET_PURCHASE_ORDERS' },
      { key: 'appointments',    actionType: 'SET_APPOINTMENTS' },
      // r-batch-a (1b): expenses was missing from boot hydration, so
      // expenses state was always empty at startup even though items
      // existed in localStorage (written by ExpensesModule via persist).
      { key: 'expenses',        actionType: 'SET_EXPENSES' },
      // r-pkg-b3: Returns foundation — hydrate from localStorage
      { key: 'customer_returns', actionType: 'SET_CUSTOMER_RETURNS' },
      { key: 'vendor_returns',   actionType: 'SET_VENDOR_RETURNS' },
    ];

    for (const { key, actionType } of localMap) {
      const data = loadLocal<unknown[]>(key, []);
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

    const syncMap: Array<{ collectionName: string; actionType: string }> = [
      { collectionName: COLLECTIONS.customers,      actionType: 'SET_CUSTOMERS' },
      { collectionName: COLLECTIONS.inventory,      actionType: 'SET_INVENTORY' },
      { collectionName: COLLECTIONS.sales,          actionType: 'SET_SALES' },
      { collectionName: COLLECTIONS.repairs,        actionType: 'SET_REPAIRS' },
      { collectionName: COLLECTIONS.unlocks,        actionType: 'SET_UNLOCKS' },
      { collectionName: COLLECTIONS.specialOrders,  actionType: 'SET_SPECIAL_ORDERS' },
      { collectionName: COLLECTIONS.layaways,       actionType: 'SET_LAYAWAYS' },
      { collectionName: COLLECTIONS.employees,      actionType: 'SET_EMPLOYEES' },
      { collectionName: COLLECTIONS.purchaseOrders, actionType: 'SET_PURCHASE_ORDERS' },
      { collectionName: COLLECTIONS.appointments,   actionType: 'SET_APPOINTMENTS' },
      // r-batch-a (1b): expenses now syncs from Firestore the same way
      // other collections do. Previously writes went to persist.expense()
      // (which didn't exist) and reads got an empty array at boot.
      { collectionName: COLLECTIONS.expenses,       actionType: 'SET_EXPENSES' },
      // r-pkg-b3: Returns foundation
      { collectionName: COLLECTIONS.customerReturns, actionType: 'SET_CUSTOMER_RETURNS' },
      { collectionName: COLLECTIONS.vendorReturns,   actionType: 'SET_VENDOR_RETURNS' },
    ];

    // Wait for all initial snapshots before marking loading=false
    const totalListeners = syncMap.length + 1; // +1 for settings
    let received = 0;
    let done = false;
    const markDone = () => {
      received += 1;
      if (!done && received >= totalListeners) {
        done = true;
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    for (const { collectionName, actionType } of syncMap) {
      let first = true;
      const unsub = onSnapshot(
        collection(db, collectionName),
        (snapshot) => {
          const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          dispatch({ type: actionType, payload: data } as never);
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
