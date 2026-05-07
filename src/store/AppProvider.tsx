import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
  type Dispatch,
} from 'react';
import type {
  AppState,
  AppAction,
  Lang,
  Employee,
  Customer,
  InventoryItem,
  Sale,
  Repair,
  Unlock,
  SpecialOrder,
  Layaway,
  CartItem,
  StoreSettings,
  PurchaseOrder,
  Expense,
  InventoryLoss,
  Appointment,
  CustomerReturn,
  VendorReturn,
} from './types';
import { DEFAULT_SETTINGS } from '@/config/constants';
import { normalizeCustomers } from '@/utils/customerNormalize';
import { normalizeEmployees } from '@/utils/employeeNormalize';

// ── Initial State ─────────────────────────────────────────

const initialState: AppState = {
  currentEmployee: null,
  isAdminMode: false,
  lang: (localStorage.getItem('cellhub_lang') as Lang) || 'en',
  activeTab: 'dashboard',
  customers: [],
  inventory: [],
  sales: [],
  repairs: [],
  unlocks: [],
  specialOrders: [],
  layaways: [],
  employees: [],
  purchaseOrders: [],
  expenses: [],
  inventoryLosses: [],
  appointments: [],
  customerReturns: [],
  vendorReturns: [],
  cart: [],
  settings: { ...DEFAULT_SETTINGS },
  loading: true,
  isFirstTimeSetup: false,
  showAIAssistant: false,
  currentStoreId: 'default',
  consolidatedView: false,
  customerSearchTerm: '',
  inventorySearchTerm: '',
  globalSearchTerm: '',
  pendingBarcodeInvoice: '',
  pendingPhonePaymentCustomerId: '',
  pendingPosCustomer: '',
  highlightRecordId: '',  // set by global scanner → consumed by ReturnsModule
};

// ── Reducer ───────────────────────────────────────────────

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_LANG':
      localStorage.setItem('cellhub_lang', action.payload);
      return { ...state, lang: action.payload };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
    case 'SET_CURRENT_EMPLOYEE':
      return { ...state, currentEmployee: action.payload };
    case 'SET_ADMIN_MODE':
      return { ...state, isAdminMode: action.payload };
    case 'SET_FIRST_TIME_SETUP':
      return { ...state, isFirstTimeSetup: action.payload };
    case 'SET_SHOW_AI_ASSISTANT':
      return { ...state, showAIAssistant: action.payload };
    case 'SET_CUSTOMERS':
      return { ...state, customers: normalizeCustomers(action.payload) };
    case 'SET_INVENTORY':
      return { ...state, inventory: action.payload };
    case 'SET_SALES':
      return { ...state, sales: action.payload };
    case 'SET_REPAIRS':
      return { ...state, repairs: action.payload };
    case 'SET_UNLOCKS':
      return { ...state, unlocks: action.payload };
    case 'SET_SPECIAL_ORDERS':
      return { ...state, specialOrders: action.payload };
    case 'SET_LAYAWAYS':
      return { ...state, layaways: action.payload };
    case 'SET_EMPLOYEES':
      return { ...state, employees: normalizeEmployees(action.payload) };
    case 'SET_PURCHASE_ORDERS':
      return { ...state, purchaseOrders: action.payload };
    case 'SET_EXPENSES':
      return { ...state, expenses: action.payload };
    case 'SET_INVENTORY_LOSSES':
      return { ...state, inventoryLosses: action.payload };
    case 'SET_APPOINTMENTS':
      return { ...state, appointments: action.payload };
    case 'SET_CUSTOMER_RETURNS':
      return { ...state, customerReturns: action.payload };
    case 'SET_VENDOR_RETURNS':
      return { ...state, vendorReturns: action.payload };
    case 'SET_CART':
      return { ...state, cart: action.payload };
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'REPLACE_SETTINGS':
      return { ...state, settings: action.payload };
    case 'SET_CUSTOMER_SEARCH':
      return { ...state, customerSearchTerm: action.payload };
    case 'SET_INVENTORY_SEARCH':
      return { ...state, inventorySearchTerm: action.payload };
    case 'SET_GLOBAL_SEARCH':
      return { ...state, globalSearchTerm: action.payload };
    case 'SET_PENDING_BARCODE_INVOICE':
      return { ...state, pendingBarcodeInvoice: action.payload };
    case 'SET_PENDING_PHONE_PAYMENT_CUSTOMER':
      return { ...state, pendingPhonePaymentCustomerId: action.payload };
    case 'SET_PENDING_POS_CUSTOMER':
      return { ...state, pendingPosCustomer: action.payload };
    case 'SET_HIGHLIGHT_RECORD':
      return { ...state, highlightRecordId: action.payload };
    case 'SET_CURRENT_STORE_ID':
      return { ...state, currentStoreId: action.payload };
    case 'SET_CONSOLIDATED_VIEW':
      return { ...state, consolidatedView: action.payload };
    case 'HYDRATE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  // Convenience setters (most common operations)
  setLang: (lang: Lang) => void;
  setActiveTab: (tab: string) => void;
  setCurrentEmployee: (emp: Employee | null) => void;
  setAdminMode: (mode: boolean) => void;
  setCustomers: (c: Customer[]) => void;
  setInventory: (i: InventoryItem[]) => void;
  setSales: (s: Sale[]) => void;
  setRepairs: (r: Repair[]) => void;
  setUnlocks: (u: Unlock[]) => void;
  setSpecialOrders: (so: SpecialOrder[]) => void;
  setLayaways: (l: Layaway[]) => void;
  setEmployees: (e: Employee[]) => void;
  setPurchaseOrders: (po: PurchaseOrder[]) => void;
  setExpenses: (e: Expense[]) => void;
  setInventoryLosses: (l: InventoryLoss[]) => void;
  setAppointments: (a: Appointment[]) => void;
  setCustomerReturns: (r: CustomerReturn[]) => void;
  setVendorReturns: (r: VendorReturn[]) => void;
  setCart: (c: CartItem[]) => void;
  setSettings: (s: Partial<StoreSettings>) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Convenience setters
  const setLang = useCallback((lang: Lang) => dispatch({ type: 'SET_LANG', payload: lang }), []);
  const setActiveTab = useCallback((tab: string) => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab }), []);
  const setCurrentEmployee = useCallback((emp: Employee | null) => dispatch({ type: 'SET_CURRENT_EMPLOYEE', payload: emp }), []);
  const setAdminMode = useCallback((mode: boolean) => dispatch({ type: 'SET_ADMIN_MODE', payload: mode }), []);
  const setCustomers = useCallback((c: Customer[]) => dispatch({ type: 'SET_CUSTOMERS', payload: c }), []);
  const setInventory = useCallback((i: InventoryItem[]) => dispatch({ type: 'SET_INVENTORY', payload: i }), []);
  const setSales = useCallback((s: Sale[]) => dispatch({ type: 'SET_SALES', payload: s }), []);
  const setRepairs = useCallback((r: Repair[]) => dispatch({ type: 'SET_REPAIRS', payload: r }), []);
  const setUnlocks = useCallback((u: Unlock[]) => dispatch({ type: 'SET_UNLOCKS', payload: u }), []);
  const setSpecialOrders = useCallback((so: SpecialOrder[]) => dispatch({ type: 'SET_SPECIAL_ORDERS', payload: so }), []);
  const setLayaways = useCallback((l: Layaway[]) => dispatch({ type: 'SET_LAYAWAYS', payload: l }), []);
  const setEmployees = useCallback((e: Employee[]) => dispatch({ type: 'SET_EMPLOYEES', payload: e }), []);
  const setPurchaseOrders = useCallback((po: PurchaseOrder[]) => dispatch({ type: 'SET_PURCHASE_ORDERS', payload: po }), []);
  const setExpenses = useCallback((e: Expense[]) => dispatch({ type: 'SET_EXPENSES', payload: e }), []);
  const setInventoryLosses = useCallback((l: InventoryLoss[]) => dispatch({ type: 'SET_INVENTORY_LOSSES', payload: l }), []);
  const setAppointments = useCallback((a: Appointment[]) => dispatch({ type: 'SET_APPOINTMENTS', payload: a }), []);
  const setCustomerReturns = useCallback((r: CustomerReturn[]) => dispatch({ type: 'SET_CUSTOMER_RETURNS', payload: r }), []);
  const setVendorReturns = useCallback((r: VendorReturn[]) => dispatch({ type: 'SET_VENDOR_RETURNS', payload: r }), []);
  const setCart = useCallback((c: CartItem[]) => dispatch({ type: 'SET_CART', payload: c }), []);
  const setSettings = useCallback((s: Partial<StoreSettings>) => dispatch({ type: 'SET_SETTINGS', payload: s }), []);

  // r-multi-m2: filtered state view — per-store collections are filtered
  // by currentStoreId unless consolidatedView is active or only 1 store exists.
  // Customers, employees, cart, and settings are GLOBAL (never filtered).
  // The raw `state` is preserved for setters (they write full arrays).
  const filteredState = useMemo((): AppState => {
    const { currentStoreId, consolidatedView } = state;
    // No filtering needed in consolidated view or single-store mode
    // BUG-1 (R-INVENTORY-SEARCH): treat null/undefined/'' currentStoreId as
    // single-store ('default'). A bad HYDRATE/import payload can leave it null,
    // and items tagged storeId='default' would otherwise fail belongs() and
    // disappear from every per-store collection (inventory, sales, repairs…).
    if (consolidatedView || !currentStoreId || currentStoreId === 'default') return state;

    const belongs = (storeId?: string) =>
      !storeId || storeId === currentStoreId;

    return {
      ...state,
      // Per-store filtered collections
      inventory: state.inventory.filter((i) => belongs(i.storeId)),
      sales: state.sales.filter((s) => belongs(s.storeId)),
      repairs: state.repairs.filter((r) => belongs(r.storeId)),
      unlocks: state.unlocks.filter((u) => belongs(u.storeId)),
      specialOrders: state.specialOrders.filter((o) => belongs(o.storeId)),
      layaways: state.layaways.filter((l) => belongs(l.storeId)),
      expenses: state.expenses.filter((e) => belongs(e.storeId)),
      inventoryLosses: state.inventoryLosses.filter((l) => belongs(l.storeId)),
      appointments: state.appointments.filter((a) => belongs(a.storeId)),
      purchaseOrders: state.purchaseOrders.filter((po) => belongs(po.storeId)),
      customerReturns: state.customerReturns.filter((r) => belongs(r.storeId)),
      vendorReturns: state.vendorReturns.filter((r) => belongs(r.storeId)),
      // Global collections — NOT filtered
      // customers: state.customers,     (inherited from ...state)
      // employees: state.employees,     (inherited from ...state)
    };
  }, [state]);

  const value: AppContextValue = {
    state: filteredState,
    dispatch,
    setLang,
    setActiveTab,
    setCurrentEmployee,
    setAdminMode,
    setCustomers,
    setInventory,
    setSales,
    setRepairs,
    setUnlocks,
    setSpecialOrders,
    setLayaways,
    setEmployees,
    setPurchaseOrders,
    setExpenses,
    setInventoryLosses,
    setAppointments,
    setCustomerReturns,
    setVendorReturns,
    setCart,
    setSettings,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
}
