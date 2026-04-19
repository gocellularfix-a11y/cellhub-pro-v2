import { lazy, Suspense, useCallback } from 'react';
import Sidebar from './Sidebar';
import { LoadingSpinner, GlobalSearch, BarcodeActionModal } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import AutoUpdateNotifier from '@/components/shared/AutoUpdateNotifier';

// ── Lazy-load all modules ─────────────────────────────────
const Dashboard        = lazy(() => import('@/modules/dashboard/Dashboard'));
const POSModule        = lazy(() => import('@/modules/pos/POSModule'));
const InventoryModule  = lazy(() => import('@/modules/inventory/InventoryModule'));
const RepairModule     = lazy(() => import('@/modules/repairs/RepairModule'));
const UnlockModule     = lazy(() => import('@/modules/unlocks/UnlockModule'));
const SpecialOrdersModule = lazy(() => import('@/modules/special-orders/SpecialOrdersModule'));
const LayawayModule    = lazy(() => import('@/modules/layaways/LayawayModule'));
const ReturnsModule    = lazy(() => import('@/modules/returns/ReturnsModule'));
const CustomerModule   = lazy(() => import('@/modules/customers/CustomerModule'));
const ReportsModule    = lazy(() => import('@/modules/reports/ReportsModule'));
const TaxReportsModule = lazy(() => import('@/modules/tax/TaxReportsModule'));
const SettingsModule   = lazy(() => import('@/modules/settings/SettingsModule'));
const EmployeesModule  = lazy(() => import('@/modules/employees/EmployeesModule'));
const AIAssistantPanel = lazy(() => import('@/modules/ai-assistant/AIAssistantPanel'));
const AppointmentsModule = lazy(() => import('@/modules/appointments/AppointmentsModule'));
const IntelligenceModule = lazy(() => import('@/modules/intelligence/IntelligenceModule'));
const PurchaseOrdersModule = lazy(() => import('@/modules/purchase-orders/PurchaseOrdersModule'));

// ── Admin lock screen ─────────────────────────────────────
function AdminLockScreen({ onUnlock, lang }: { onUnlock: () => void; lang: string }) {
  const es = lang === 'es';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '70vh', gap: '1.25rem', cursor: 'pointer',
    }}
      onClick={onUnlock}
    >
      <div style={{ fontSize: '4rem' }}>🔐</div>
      <div style={{ fontSize: '1.15rem', color: '#94a3b8', fontWeight: 600 }}>
        {es ? 'Requiere PIN de Administrador' : 'Admin PIN Required'}
      </div>
      <p style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '280px', textAlign: 'center' }}>
        {es
          ? 'Esta sección solo es accesible para administradores y gerentes.'
          : 'This section is only accessible to admins and managers.'}
      </p>
      <button
        className="btn btn-primary"
        style={{ marginTop: '0.5rem', padding: '0.7rem 2rem', fontSize: '0.95rem' }}
        onClick={(e) => { e.stopPropagation(); onUnlock(); }}
      >
        🔑 {es ? 'Ingresar PIN' : 'Enter PIN'}
      </button>
    </div>
  );
}

// ── Main Shell ────────────────────────────────────────────
export default function AppShell() {
  const { state, dispatch } = useApp();
  const { activeTab, isAdminMode, lang, settings, customers } = state;

  // Trigger the admin pin modal — dispatches to App.tsx's AdminPinGate
  const requireAdmin = () => {
    window.dispatchEvent(new CustomEvent('cellhub_require_admin'));
  };

  // ── Global barcode scanner ───────────────────────────────
  // Detects USB/Bluetooth scanner input (fast keystrokes outside any input).
  // Invoice (INV-...) → Returns + auto-search.
  // Customer (GC-...) → POS + PhonePaymentModal pre-filled with customer data.
  // Inventory (anything else) → POS + pre-fill search.
  const handleInvoiceScan = useCallback((invoice: string) => {
    // Show the action modal — user chooses what to do with this invoice
    dispatch({ type: 'SET_PENDING_BARCODE_INVOICE', payload: invoice });
  }, [dispatch]);

  const handleCustomerScan = useCallback((code: string) => {
    // Look up customer by customerNumber (exact match, case-insensitive)
    const wanted = code.trim().toUpperCase();
    const match = customers.find(
      (c) => (c.customerNumber || '').toUpperCase() === wanted
    );
    if (!match) {
      // Customer code not found — fall through to inventory search
      dispatch({ type: 'SET_INVENTORY_SEARCH', payload: code });
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
      return;
    }
    // Stash customer ID for PhonePaymentModal to consume on mount
    dispatch({ type: 'SET_PENDING_PHONE_PAYMENT_CUSTOMER', payload: match.id });
    // Navigate to POS (PhonePaymentModal lives there)
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
  }, [customers, dispatch]);

  const handleInventoryScan = useCallback((code: string) => {
    dispatch({ type: 'SET_INVENTORY_SEARCH', payload: code });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
  }, [dispatch]);

  useBarcodeScanner({
    invoicePrefix: settings.invoicePrefix || 'INV',
    customerPrefix: settings.customerNumberPrefix || 'GC',
    onInvoiceScan: handleInvoiceScan,
    onCustomerScan: handleCustomerScan,
    onInventoryScan: handleInventoryScan,
  });

  // Admin-only tabs — show lock screen if not in admin mode
  const ADMIN_TABS = ['settings', 'reports', 'tax', 'employees', 'purchaseOrders', 'intelligence'];
  const needsAdmin = ADMIN_TABS.includes(activeTab) && !isAdminMode;

  return (
    <div className="flex h-screen max-h-screen overflow-hidden">
      {/* r-pkg-a2: auto-update banner — renders at top of screen when
          an update is available. No-op in browser (non-Electron). */}
      <AutoUpdateNotifier />
      <Sidebar />

      <main className="flex-1 overflow-y-auto overflow-x-hidden h-screen p-6">
        <Suspense fallback={<LoadingSpinner message="Loading module…" />}>

          {/* ── Public modules (no admin needed) ── */}
          {activeTab === 'dashboard'      && <Dashboard />}
          {activeTab === 'pos'            && <POSModule />}
          {activeTab === 'inventory'      && <InventoryModule />}
          {activeTab === 'repairs'        && <RepairModule />}
          {activeTab === 'unlocks'        && <UnlockModule />}
          {activeTab === 'specialOrders'  && <SpecialOrdersModule />}
          {activeTab === 'layaways'       && <LayawayModule />}
          {activeTab === 'returns'        && <ReturnsModule />}
          {activeTab === 'customers'      && <CustomerModule />}
          {activeTab === 'appointments'   && <AppointmentsModule />}

          {/* ── Admin-only modules ── */}
          {activeTab === 'intelligence'   && (isAdminMode ? <IntelligenceModule />      : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'settings'       && (isAdminMode ? <SettingsModule />         : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'reports'        && (isAdminMode ? <ReportsModule />          : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'tax'            && (isAdminMode ? <TaxReportsModule />       : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'employees'      && (isAdminMode ? <EmployeesModule />        : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'purchaseOrders' && (isAdminMode ? <PurchaseOrdersModule />   : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}

        </Suspense>
      </main>

      {/* AI Assistant — rendered globally */}
      <Suspense fallback={null}>
        <AIAssistantPanel />
      </Suspense>

      {/* Global Search (Cmd+K / Ctrl+K) */}
      <GlobalSearch />

      {/* Barcode Action Modal — shown when receipt barcode is scanned */}
      <BarcodeActionModal />
    </div>
  );
}
