// ============================================================
// CellHub Pro — Multi-Store Types
// ============================================================

export interface StoreProfile {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  taxRate: number;
  utilityUsersTax?: number;
  mobileSurcharge?: number;
  timezone: string;
  active: boolean;
  /** Inventory mode: 'per_store' = each store has own inventory, 'shared' = all stores share */
  inventoryMode: 'per_store' | 'shared';
  createdAt: string;
  updatedAt?: string;
}

export interface StoreRegistration {
  /** This computer's unique ID */
  computerId: string;
  /** Which store this computer belongs to */
  storeId: string;
  /** Display name for this computer */
  computerName: string;
  registeredAt: string;
}

export interface MultiStoreState {
  /** All stores in this account */
  stores: StoreProfile[];
  /** Current store this computer is registered to */
  currentStore: StoreProfile | null;
  /** This computer's registration */
  registration: StoreRegistration | null;
  /** Whether multi-store is enabled (Pro tier only) */
  enabled: boolean;
  /** Whether user is viewing consolidated (all stores) mode */
  consolidatedView: boolean;
}
