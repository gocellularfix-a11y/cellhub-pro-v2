// ============================================================
// CellHub Pro — Multi-Store Provider
// Manages store profiles, computer registration, data scoping
// ============================================================

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { loadLocal, saveLocal } from '@/services/storage';
import { generateId } from '@/utils/dates';
import type { StoreProfile, StoreRegistration, MultiStoreState } from './multiStoreTypes';

// ── Generate a persistent computer ID ─────────────────────

function getComputerId(): string {
  let id = loadLocal<string>('computer_id', '');
  if (!id) {
    id = `PC-${generateId()}`;
    saveLocal('computer_id', id);
  }
  return id;
}

// ── Context ───────────────────────────────────────────────

interface MultiStoreContextValue {
  state: MultiStoreState;
  /** Add a new store profile */
  addStore: (store: Omit<StoreProfile, 'id' | 'createdAt' | 'active'>) => StoreProfile;
  /** Update a store profile */
  updateStore: (id: string, data: Partial<StoreProfile>) => void;
  /** Delete a store (soft — marks inactive) */
  deactivateStore: (id: string) => void;
  /** Register this computer to a store */
  registerComputer: (storeId: string, computerName?: string) => void;
  /** Switch consolidated view on/off */
  setConsolidatedView: (on: boolean) => void;
  /** Check if a data item belongs to the current store (for filtering) */
  belongsToCurrentStore: (storeId?: string) => boolean;
  /** Get the storeId to tag new data with */
  getStoreIdForNewData: () => string;
}

const MultiStoreContext = createContext<MultiStoreContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────

export function MultiStoreProvider({ children }: { children: ReactNode }) {
  const computerId = getComputerId();

  const [stores, setStores] = useState<StoreProfile[]>(() =>
    loadLocal('multi_stores', []),
  );
  const [registration, setRegistration] = useState<StoreRegistration | null>(() =>
    loadLocal('computer_registration', null),
  );
  const [consolidatedView, setConsolidatedView] = useState(false);

  // Persist stores
  useEffect(() => {
    saveLocal('multi_stores', stores);
  }, [stores]);

  // Persist registration
  useEffect(() => {
    if (registration) saveLocal('computer_registration', registration);
  }, [registration]);

  // Current store from registration
  const currentStore = stores.find((s) => s.id === registration?.storeId) || null;

  // Multi-store is enabled if there are 2+ stores
  const enabled = stores.filter((s) => s.active).length > 1;

  // ── Actions ─────────────────────────────────────────────

  const addStore = useCallback(
    (data: Omit<StoreProfile, 'id' | 'createdAt' | 'active'>): StoreProfile => {
      const newStore: StoreProfile = {
        ...data,
        id: `store-${generateId()}`,
        active: true,
        createdAt: new Date().toISOString(),
      };
      setStores((prev) => [...prev, newStore]);

      // If this is the first store, auto-register this computer
      if (stores.length === 0 && !registration) {
        setRegistration({
          computerId,
          storeId: newStore.id,
          computerName: 'Main Computer',
          registeredAt: new Date().toISOString(),
        });
      }

      return newStore;
    },
    [stores, registration, computerId],
  );

  const updateStore = useCallback(
    (id: string, data: Partial<StoreProfile>) => {
      setStores((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, ...data, updatedAt: new Date().toISOString() } : s,
        ),
      );
    },
    [],
  );

  const deactivateStore = useCallback(
    (id: string) => {
      setStores((prev) =>
        prev.map((s) => (s.id === id ? { ...s, active: false } : s)),
      );
    },
    [],
  );

  const registerComputer = useCallback(
    (storeId: string, computerName?: string) => {
      setRegistration({
        computerId,
        storeId,
        computerName: computerName || registration?.computerName || 'Computer',
        registeredAt: new Date().toISOString(),
      });
    },
    [computerId, registration],
  );

  const belongsToCurrentStore = useCallback(
    (storeId?: string): boolean => {
      // In consolidated view or single-store mode, show everything
      if (consolidatedView || !enabled) return true;
      // No store tag on the item = legacy data, show it
      if (!storeId) return true;
      // Match current store
      return storeId === currentStore?.id;
    },
    [consolidatedView, enabled, currentStore],
  );

  const getStoreIdForNewData = useCallback(
    (): string => {
      return currentStore?.id || 'default';
    },
    [currentStore],
  );

  const value: MultiStoreContextValue = {
    state: {
      stores,
      currentStore,
      registration,
      enabled,
      consolidatedView,
    },
    addStore,
    updateStore,
    deactivateStore,
    registerComputer,
    setConsolidatedView,
    belongsToCurrentStore,
    getStoreIdForNewData,
  };

  return (
    <MultiStoreContext.Provider value={value}>
      {children}
    </MultiStoreContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────

export function useMultiStore(): MultiStoreContextValue {
  const ctx = useContext(MultiStoreContext);
  if (!ctx) throw new Error('useMultiStore must be used within <MultiStoreProvider>');
  return ctx;
}
