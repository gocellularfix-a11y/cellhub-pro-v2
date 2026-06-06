import { lazy, Suspense, useCallback, useEffect } from 'react';
import { setIntelligenceContext, clearEntityContext } from '@/services/intelligence/context/intelligenceContext';
import Sidebar from './Sidebar';
import SidebarList from './SidebarList';
import { LoadingSpinner, GlobalSearch, BarcodeActionModal } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
// R-OFFLINE-MODE-GUARD-V1: turns offline-blocked action signals into a toast.
import OfflineGuardListener from '@/components/OfflineGuardListener';
import { CH_CUST_PREFIX } from '@/services/barcode/receiptPayload';
import AutoUpdateNotifier from '@/components/shared/AutoUpdateNotifier';
import UpgradePrompt from '@/components/shared/UpgradePrompt';
import { useLicense } from '@/contexts/LicenseContext';
import { readDashboardTheme } from '@/theme/dashboardTheme';
import { useTheme } from '@/theme';

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
// R-HELP-MANUAL-V1: in-app Help / Manual module.
const HelpModule = lazy(() => import('@/modules/help/HelpModule'));
const IntelligenceModule = lazy(() => import('@/modules/intelligence/IntelligenceModule'));
// COMPANION: parallel simplified companion using REST polling.
const CompanionPage = lazy(() => import('@/modules/companion/CompanionPage'));
const PurchaseOrdersModule = lazy(() => import('@/modules/purchase-orders/PurchaseOrdersModule'));
// R-OPERATOR-FLOATING-BUBBLE-V1: globally-mounted Intelligence shortcut.
const FloatingOperatorBubble = lazy(() => import('@/components/operator/FloatingOperatorBubble'));
// COMPANION: persistent badge anchored on top-right of the operator bubble.
// Visible only when there's unattended Companion activity; click navigates
// to the right Companion sub-tab and clears the count.
const CompanionBubbleBadge = lazy(() => import('@/components/companion/CompanionBubbleBadge'));
// COMPANION: background runtime that keeps polling even when the operator
// is on a different sidebar tab. Without this, leaving Companion silences
// all inbound notifications because the per-page polls unmount.
const CompanionRuntimeMount = lazy(() => import('@/components/companion/CompanionRuntimeMount'));
// COMPANION: always-on status push — keeps mobile data fresh even when the
// operator is not on the Companion tab (StatusPanel only mounts on that tab).
const StatusPushMount = lazy(() => import('@/components/companion/StatusPushMount'));
// R-BUBBLE-EXTERNAL-PAYMENT-REMINDER-NUDGE: external payment verification card
// next to the bubble. Was previously mounted inside IntelligenceModule, so
// it never surfaced unless the cashier opened that tab. Module-level dedup
// inside the component keeps the IntelligenceModule mount from doubling up.
const PaymentVerificationNudge = lazy(() => import('@/components/PaymentVerificationNudge'));

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
  const { theme } = useTheme();

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
    // R-CREDENTIAL-BARCODE-SCAN-V3: aggressive lookup. Customer credential
    // barcodes may encode the customerNumber with hyphens stripped by the
    // printer/scanner config, or be a legacy field (referralCode), or be
    // the CredentialMakerModal fallback derived from customer.id. Try each
    // strategy before falling through to inventory search.
    const normalize = (v: string) =>
      (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const wanted = normalize(code.trim());

    // S1: exact normalized customerNumber match (covers GC480055 ↔ GC-480055,
    // GC480055 ↔ gc480055, etc.)
    let match = customers.find(
      (c) => normalize(c.customerNumber || '') === wanted
    );

    // S2: referralCode match — referralCode has no hyphens by design and
    // shares the customerNumberPrefix, so a printed credential built from
    // this field still scans cleanly.
    if (!match) {
      match = customers.find(
        (c) =>
          normalize((c as { referralCode?: string }).referralCode || '') ===
          wanted
      );
    }

    // S3: CredentialMakerModal fallback format. When customerNumber is
    // empty, the credential is generated as `${prefix}-${first6alphanumOfId}`.
    // Strip the prefix from the scanned code and try matching the tail
    // against the id-prefix.
    if (!match) {
      const tail = wanted.replace(/^[A-Z]+/, '');
      if (tail.length >= 4) {
        match = customers.find((c) => {
          const cleanId = normalize(c.id || '');
          return cleanId.startsWith(tail);
        });
      }
    }

    if (!match) {
      // Diagnostic: surface this in DevTools so future credential mismatches
      // are easy to debug without re-instrumenting.
      // eslint-disable-next-line no-console
      console.warn(
        '[cellhub] credential scan: no customer match for',
        code,
        '(normalized:',
        wanted + ')',
        'searched',
        customers.length,
        'customers'
      );
      // Customer code not found — fall through to inventory search
      dispatch({ type: 'SET_INVENTORY_SEARCH', payload: code });
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
      return;
    }
    // R-CREDENTIAL-BARCODE-SCAN-V1: route through BarcodeActionModal's
    // existing CH:CUST: branch so the operator sees the full customer
    // action sheet (open, start sale, history, repairs, layaways, WA)
    // instead of auto-opening PhonePaymentModal.
    dispatch({ type: 'SET_PENDING_BARCODE_INVOICE', payload: `${CH_CUST_PREFIX}${match.id}` });
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

  // R-INTELLIGENCE-CONTEXT-AWARE-V1: broadcast coarse module context so Intelligence
  // can adapt recommendations even when no specific entity is selected.
  // R-INTELLIGENCE-AMBIENT-AWARENESS-V1: clear stale entity refs on tab switch so
  // a repair/customer/layaway from the previous tab doesn't bleed into queries
  // on the new tab. clearEntityContext() preserves activeModule + bumps updatedAt.
  useEffect(() => {
    clearEntityContext();
    setIntelligenceContext({ activeModule: activeTab });
  }, [activeTab]);

  // R-INTELLIGENCE-RUNTIME-NAVIGATION-V1: central coordinator for Intelligence
  // action-button navigation. Step 1 → navigate to module tab. Step 2 →
  // fire module-scoped open event AFTER the lazy module has mounted and
  // attached its listener.
  // INTEL-ACTION-CONTEXT-AND-NAV-RACE-FIX-V1: the old single fixed 80ms defer
  // lost the open event whenever the lazy module chunk hadn't mounted yet
  // (first click → list only; second click worked). Replaced with a bounded
  // ack-retry: events are dispatched cancelable, module listeners call
  // e.preventDefault() to ack consumption (dispatchEvent returns false), and
  // un-acked dispatches retry every RELAY_RETRY_MS up to RELAY_MAX_ATTEMPTS
  // (~3s) before giving up — same list-only fallback as before on cap-out.
  useEffect(() => {
    const RELAY_FIRST_DELAY_MS = 80;   // preserves the original fast path
    const RELAY_RETRY_MS       = 150;
    const RELAY_MAX_ATTEMPTS   = 20;
    // One pending loop per event name — a newer open request supersedes a
    // still-retrying older one for the same target module.
    const pendingRelays = new Map<string, number>();

    function dispatchWhenReady(eventName: string, detail: unknown) {
      const prev = pendingRelays.get(eventName);
      if (prev !== undefined) window.clearTimeout(prev);
      let attempts = 0;
      const fire = () => {
        pendingRelays.delete(eventName);
        attempts++;
        // dispatchEvent returns false when a handler called preventDefault →
        // the module listener is mounted and consumed the open request.
        const consumed = !window.dispatchEvent(new CustomEvent(eventName, { detail, cancelable: true }));
        if (consumed) return;
        if (attempts < RELAY_MAX_ATTEMPTS) {
          pendingRelays.set(eventName, window.setTimeout(fire, RELAY_RETRY_MS));
        } else {
          console.warn('[cellhub] intel-open relay gave up — no listener consumed', eventName);
        }
      };
      pendingRelays.set(eventName, window.setTimeout(fire, RELAY_FIRST_DELAY_MS));
    }

    function nav(tab: string) {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
    }

    const onOpenRepair = (e: Event) => {
      const { repairId } = (e as CustomEvent<{ repairId?: string }>).detail ?? {};
      if (!repairId) return;
      nav('repairs');
      dispatchWhenReady('cellhub:_intel-open-repair', { repairId });
    };

    const onOpenCustomer = (e: Event) => {
      // CUSTOMER-360-INTELLIGENCE-OPEN-HISTORY-V1: forward optional mode
      // ('edit' | 'history') so callers can choose the edit form explicitly;
      // default (no mode) opens the Customer 360 history modal.
      const { customerId, mode } = (e as CustomEvent<{ customerId?: string; mode?: 'edit' | 'history' }>).detail ?? {};
      if (!customerId) return;
      nav('customers');
      dispatchWhenReady('cellhub:_intel-open-customer', { customerId, mode });
    };

    const onOpenLayaway = (e: Event) => {
      const { layawayId } = (e as CustomEvent<{ layawayId?: string }>).detail ?? {};
      if (!layawayId) return;
      nav('layaways');
      dispatchWhenReady('cellhub:_intel-open-layaway', { layawayId });
    };

    const onOpenInventory = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId?: string }>).detail ?? {};
      if (!itemId) return;
      nav('inventory');
      dispatchWhenReady('cellhub:_intel-open-inventory', { itemId });
    };

    const onOpenUnlock = (e: Event) => {
      const { unlockId } = (e as CustomEvent<{ unlockId?: string }>).detail ?? {};
      if (!unlockId) return;
      nav('unlocks');
      dispatchWhenReady('cellhub:_intel-open-unlock', { unlockId });
    };

    const onOpenSpecialOrder = (e: Event) => {
      const { orderId } = (e as CustomEvent<{ orderId?: string }>).detail ?? {};
      if (!orderId) return;
      nav('specialOrders');
      dispatchWhenReady('cellhub:_intel-open-special-order', { orderId });
    };

    const onManagerReview = () => {
      // No dedicated approvals panel yet — navigate to Intelligence where the
      // action queue is visible. Console.warn documents the gap.
      console.warn('[cellhub] cellhub:open-manager-review: no dedicated review panel; navigating to intelligence.');
      nav('intelligence');
    };

    // R-INTELLIGENCE-CONTINUITY-V1: generic tab navigation for continuity resume.
    const onNavigateTab = (e: Event) => {
      const { tab } = (e as CustomEvent<{ tab?: string }>).detail ?? {};
      if (tab) nav(tab);
    };

    window.addEventListener('cellhub:open-repair',         onOpenRepair);
    window.addEventListener('cellhub:open-customer',       onOpenCustomer);
    window.addEventListener('cellhub:open-layaway',        onOpenLayaway);
    window.addEventListener('cellhub:open-inventory-item', onOpenInventory);
    window.addEventListener('cellhub:open-unlock',         onOpenUnlock);
    window.addEventListener('cellhub:open-special-order',  onOpenSpecialOrder);
    window.addEventListener('cellhub:open-manager-review', onManagerReview);
    window.addEventListener('cellhub:navigate-tab',        onNavigateTab);
    return () => {
      window.removeEventListener('cellhub:open-repair',         onOpenRepair);
      window.removeEventListener('cellhub:open-customer',       onOpenCustomer);
      window.removeEventListener('cellhub:open-layaway',        onOpenLayaway);
      window.removeEventListener('cellhub:open-inventory-item', onOpenInventory);
      window.removeEventListener('cellhub:open-unlock',         onOpenUnlock);
      window.removeEventListener('cellhub:open-special-order',  onOpenSpecialOrder);
      window.removeEventListener('cellhub:open-manager-review', onManagerReview);
      window.removeEventListener('cellhub:navigate-tab',        onNavigateTab);
      // INTEL-ACTION-CONTEXT-AND-NAV-RACE-FIX-V1: cancel any in-flight relay retries.
      for (const id of pendingRelays.values()) window.clearTimeout(id);
      pendingRelays.clear();
    };
  }, [dispatch]);

  // Admin-only tabs — show lock screen if not in admin mode
  const ADMIN_TABS = ['settings', 'reports', 'tax', 'employees', 'purchaseOrders', 'intelligence', 'companion'];
  const needsAdmin = ADMIN_TABS.includes(activeTab) && !isAdminMode;

  // R-DASHBOARD-THEME-V1: user-selectable interface skin. 'tiles' (current
  // production) is the default; 'list' restores the pre-redesign sidebar.
  // Color theme drives sidebar selection: 'original' and 'bold-light' always
  // use SidebarList; 'dark' uses dashboardTheme setting (tiles or list).
  const dashboardTheme = readDashboardTheme(state.settings);
  const usesListSidebar = theme === 'original' || theme === 'bold-light' || dashboardTheme === 'list';

  return (
    <div className={`flex h-screen max-h-screen overflow-hidden theme-${dashboardTheme}`}>
      {/* r-pkg-a2: auto-update banner — renders at top of screen when
          an update is available. No-op in browser (non-Electron). */}
      <AutoUpdateNotifier />
      {usesListSidebar ? <SidebarList /> : <Sidebar />}

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
          {/* R-HELP-MANUAL-V1: in-app manual — available to every role. */}
          {activeTab === 'help'           && <HelpModule />}

          {/* ── Admin-only modules ── */}
          {activeTab === 'intelligence'   && (isAdminMode ? <IntelligenceModule />      : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
          {activeTab === 'companion'      && (isAdminMode ? <CompanionPage />           : <AdminLockScreen onUnlock={requireAdmin} lang={lang} />)}
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

      {/* R-OFFLINE-MODE-GUARD-V1: offline-action toast bridge (renders nothing). */}
      <OfflineGuardListener />

      {/* Barcode Action Modal — shown when receipt barcode is scanned */}
      <BarcodeActionModal />

      {/* R-OPERATOR-FLOATING-BUBBLE-V1: draggable shortcut to Intelligence.
          Click navigates to/from the Intelligence tab; engine spins up via
          the existing IntelligenceModule when that tab activates, so we
          avoid a second engine instance and any duplicate logic. */}
      <Suspense fallback={null}>
        <FloatingOperatorBubble />
      </Suspense>
      {/* COMPANION: persistent badge on top of the bubble — click
          routes to Companion + Messages/Approvals sub-tab. */}
      <Suspense fallback={null}>
        <CompanionBubbleBadge />
      </Suspense>
      {/* COMPANION: invisible — runs the background polling loop. */}
      <Suspense fallback={null}>
        <CompanionRuntimeMount />
      </Suspense>
      {/* COMPANION: invisible — pushes store snapshot to bridge always. */}
      <Suspense fallback={null}>
        <StatusPushMount />
      </Suspense>
      {/* R-BUBBLE-EXTERNAL-PAYMENT-REMINDER-NUDGE: external payment reminder
          card mounted next to the operator bubble so it surfaces regardless
          of which tab is open. Dedup with IntelligenceModule's mount is
          handled module-internally — first mount wins. */}
      <Suspense fallback={null}>
        <PaymentVerificationNudge />
      </Suspense>
    </div>
  );
}
