import { lazy, Suspense, useCallback } from 'react';
import Sidebar from './Sidebar';
import SidebarList from './SidebarList';
import { LoadingSpinner, GlobalSearch, BarcodeActionModal } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import AutoUpdateNotifier from '@/components/shared/AutoUpdateNotifier';
import UpgradePrompt from '@/components/shared/UpgradePrompt';
import { useLicense } from '@/contexts/LicenseContext';
import { readDashboardTheme } from '@/theme/dashboardTheme';

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
// R-COMPANION-CENTER-V1: UI shell for the future mobile-companion app.
const CompanionCenter = lazy(() => import('@/modules/companion/CompanionCenter'));
const PurchaseOrdersModule = lazy(() => import('@/modules/purchase-orders/PurchaseOrdersModule'));
// R-OPERATOR-FLOATING-BUBBLE-V1: globally-mounted Intelligence shortcut.
const FloatingOperatorBubble = lazy(() => import('@/components/operator/FloatingOperatorBubble'));

// ── Admin lock screen ─────────────────────────────────────
function AdminLockScreen({ onUnlock, lang }: { onUnlock: () => void; lang: string }) {
  const { t } = useTranslation();
  void lang; // kept for prop-API parity; useTranslation drives locale
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '70vh', gap: '1.25rem', cursor: 'pointer',
    }}
      onClick={onUnlock}
    >
      <div style={{ fontSize: '4rem' }}>🔐</div>
      <div style={{ fontSize: '1.15rem', color: '#94a3b8', fontWeight: 600 }}>
        {t('appShell.adminPinRequired')}
      </div>
      <p style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '280px', textAlign: 'center' }}>
        {t('appShell.adminOnlyHint')}
      </p>
      <button
        className="btn btn-primary"
        style={{ marginTop: '0.5rem', padding: '0.7rem 2rem', fontSize: '0.95rem' }}
        onClick={(e) => { e.stopPropagation(); onUnlock(); }}
      >
        🔑 {t('appShell.enterPin')}
      </button>
    </div>
  );
}

// ── Main Shell ────────────────────────────────────────────
export default function AppShell() {
  const { state, dispatch } = useApp();
  const { activeTab, isAdminMode, lang, settings, customers } = state;
  const { features } = useLicense();

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
  const ADMIN_TABS = ['settings', 'reports', 'tax', 'employees', 'purchaseOrders', 'intelligence', 'companion'];
  const needsAdmin = ADMIN_TABS.includes(activeTab) && !isAdminMode;

  // R-DASHBOARD-THEME-V1: user-selectable interface skin. 'tiles' (current
  // production) is the default; 'list' restores the pre-redesign sidebar.
  // 'bold-blocks' currently uses the same Sidebar — the dashboard body
  // variant lands in a follow-up phase. Stored in settings.dashboardTheme.
  const dashboardTheme = readDashboardTheme(state.settings);

  return (
    <div className={`flex h-screen max-h-screen overflow-hidden theme-${dashboardTheme}`}>
      {/* r-pkg-a2: auto-update banner — renders at top of screen when
          an update is available. No-op in browser (non-Electron). */}
      <AutoUpdateNotifier />
      {dashboardTheme === 'list' ? <SidebarList /> : <Sidebar />}

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
          {activeTab === 'companion'      && (isAdminMode ? <CompanionCenter />         : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'settings'       && (isAdminMode ? <SettingsModule />         : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'reports'        && (!isAdminMode
            ? <AdminLockScreen onUnlock={requireAdmin} lang={lang} />
            : (features.reports
              ? <ReportsModule />
              : <UpgradePrompt feature="reports" requiredTier="basic" />))}
          {activeTab === 'tax'            && (isAdminMode ? <TaxReportsModule />       : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'employees'      && (isAdminMode ? <EmployeesModule />        : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'purchaseOrders' && (isAdminMode ? <PurchaseOrdersModule />   : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}

        </Suspense>
      </main>

      {/* AI Assistant — rendered globally (Pro tier only) */}
      {features.aiAssistant && (
        <Suspense fallback={null}>
          <AIAssistantPanel />
        </Suspense>
      )}

      {/* Global Search (Cmd+K / Ctrl+K) */}
      <GlobalSearch />

      {/* Barcode Action Modal — shown when receipt barcode is scanned */}
      <BarcodeActionModal />

      {/* R-OPERATOR-FLOATING-BUBBLE-V1: draggable shortcut to Intelligence.
          Click navigates to/from the Intelligence tab; engine spins up via
          the existing IntelligenceModule when that tab activates, so we
          avoid a second engine instance and any duplicate logic. */}
      <Suspense fallback={null}>
        <FloatingOperatorBubble />
      </Suspense>
    </div>
  );
}
