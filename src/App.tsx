import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { initFirebase } from '@/config/firebase';
import { useFirestoreSync } from '@/hooks/useFirestore';
import { setFirestoreInstance, setCurrentStoreId, persist, persistSettings } from '@/services/persist';
import { useMultiStore } from '@/store/MultiStoreProvider';
import { migrateLegacyPins } from '@/utils/pinHash';
import AppShell from '@/components/layout/AppShell';
import EmployeeLogin from '@/components/shared/EmployeeLogin';
import AdminPinGate from '@/components/shared/AdminPinGate';
import SetupWizard from '@/components/shared/SetupWizard';
import PWAInstallPrompt from '@/components/shared/PWAInstallPrompt';
import PrintPreviewModal from '@/components/shared/PrintPreviewModal';
import { usePrintModal } from '@/hooks/usePrint';
import { LoadingSpinner } from '@/components/ui';
import type { Firestore } from 'firebase/firestore';
import type { Employee } from '@/store/types';

export default function App() {
  const {
    state: { loading, currentEmployee, employees, lang, settings, isAdminMode },
    setCurrentEmployee,
    setAdminMode,
    dispatch,
  } = useApp();

  const [db, setDb] = useState<Firestore | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { printModal, closePrintModal } = usePrintModal();

  // r-print-audit diagnostic: log electronAPI state at app boot to confirm
  // preload bridge is functioning. Logs appear in renderer DevTools console.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[CellHub] electronAPI present:', !!(window as any).electronAPI);
    if ((window as any).electronAPI) {
      // eslint-disable-next-line no-console
      console.log('[CellHub] electronAPI keys:', Object.keys((window as any).electronAPI));
    }
  }, []);

  const [adminPinModal, setAdminPinModal] = useState<{
    open: boolean;
    callback: (() => void) | null;
  }>({ open: false, callback: null });

  // r27 M2: one-time legacy PIN hash migration. Runs once after data loads.
  // Idempotent — re-running is a no-op because pinHash.isHashed() short-circuits.
  const migrationRanRef = useRef(false);
  useEffect(() => {
    if (migrationRanRef.current) return;
    if (loading) return;
    if (!employees || (employees.length === 0 && !settings?.adminPin)) return;
    migrationRanRef.current = true;
    (async () => {
      try {
        const count = await migrateLegacyPins(
          employees,
          settings?.adminPin,
          (id, data) => persist.employee(id, data),
          (data) => persistSettings(data),
        );
        if (count > 0) {
          console.info(`[r27] Migrated ${count} legacy plaintext PIN(s) to bcrypt.`);
        }
      } catch (err) {
        console.error('[r27] PIN migration failed:', err);
      }
    })();
    // We deliberately don't include employees / settings in deps —
    // the ref guard ensures this only runs once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Boot ────────────────────────────────────────────────
  // r-new-7: Firebase is OPT-IN. Default = localStorage-only.
  // User enables via Settings → Cloud Sync toggle, then restarts the app.
  // The Setup Wizard always runs on first launch regardless of cloud mode.

  useEffect(() => {
    let cancelled = false;

    function boot() {
      try {
        // Read cloudSyncEnabled directly from localStorage — the settings
        // slice in React state hasn't hydrated yet at boot time.
        const persistedSettings = JSON.parse(localStorage.getItem('settings') || '{}');
        const cloudSyncEnabled = persistedSettings.cloudSyncEnabled === true;

        if (cloudSyncEnabled) {
          const firestore = initFirebase(); // returns null if no config
          if (cancelled) return;
          if (firestore) {
            setDb(firestore);
            setFirestoreInstance(firestore);
          }
        }
        // Whether or not Firebase is available, check if setup was done
        const setupDone = localStorage.getItem('cellhub_setup_complete');
        if (!setupDone) {
          setNeedsSetup(true);
          dispatch({ type: 'SET_LOADING', payload: false });
        }
        // If Firebase: useFirestoreSync handles SET_LOADING false after snapshots
        // If no Firebase: useFirestoreSync loads from localStorage and sets false
      } catch (err) {
        if (!cancelled) {
          console.error('Boot error:', err);
          // Still boot in offline mode
          const setupDone = localStorage.getItem('cellhub_setup_complete');
          if (!setupDone) {
            setNeedsSetup(true);
          }
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [dispatch]);

  // ── Firestore Real-time Sync ────────────────────────────
  useFirestoreSync(db);

  // ── Multi-store: sync active storeId to persist + AppState ──
  // r-multi-m1: persist layer auto-tagger
  // r-multi-m2: AppState filtering (currentStoreId + consolidatedView)
  const { state: { currentStore, consolidatedView: msConsolidated } } = useMultiStore();
  useEffect(() => {
    const storeId = currentStore?.id || 'default';
    setCurrentStoreId(storeId);
    dispatch({ type: 'SET_CURRENT_STORE_ID', payload: storeId });
  }, [currentStore?.id, dispatch]);
  useEffect(() => {
    dispatch({ type: 'SET_CONSOLIDATED_VIEW', payload: msConsolidated });
  }, [msConsolidated, dispatch]);

  // ── Admin PIN Gate ──────────────────────────────────────

  const requireAdmin = useCallback(
    (callback: () => void) => {
      if (isAdminMode) {
        callback();
        return;
      }
      setAdminPinModal({ open: true, callback });
    },
    [isAdminMode],
  );

  const handleAdminSuccess = () => {
    setAdminMode(true);
    setAdminPinModal((prev) => {
      if (prev.callback) prev.callback();
      return { open: false, callback: null };
    });
  };

  // Listen for admin lock screen unlock requests from AppShell
  useEffect(() => {
    const handler = () => {
      if (!isAdminMode) setAdminPinModal({ open: true, callback: null });
    };
    window.addEventListener('cellhub_require_admin', handler);
    return () => window.removeEventListener('cellhub_require_admin', handler);
  }, [isAdminMode]);

  // ── Employee Login ──────────────────────────────────────

  const handleLogin = (employee: Employee) => {
    setCurrentEmployee(employee);

    // Auto-enable admin mode for owners/managers
    if (employee.role === 'owner' || employee.role === 'manager') {
      setAdminMode(true);
    }
  };

  // ── Loading ─────────────────────────────────────────────

  if (loading) {
    return <LoadingSpinner fullscreen message="Loading CellHub Pro…" />;
  }

  // ── Setup Wizard — first run ────────────────────────────

  if (needsSetup) {
    return (
      <SetupWizard
        onComplete={() => {
          setNeedsSetup(false);
        }}
      />
    );
  }

  // ── Employee Login Gate ─────────────────────────────────

  if (!currentEmployee) {
    return (
      <EmployeeLogin
        employees={employees}
        lang={lang}
        onLogin={handleLogin}
      />
    );
  }

  // ── Main App ────────────────────────────────────────────

  return (
    <>
      <AppShell />

      {/* Admin PIN Modal (rendered globally) */}
      <AdminPinGate
        open={adminPinModal.open}
        adminPin={settings.adminPin}
        onSuccess={handleAdminSuccess}
        onCancel={() => setAdminPinModal({ open: false, callback: null })}
      />

      {/* PWA install prompt — only shows in browser, never in Electron */}
      <PWAInstallPrompt />

      {/* Print Preview Modal — internal print UI with live preview.
          r-print-contract: forward caller options as initial state. */}
      <PrintPreviewModal
        open={printModal.open}
        html={printModal.html}
        onClose={closePrintModal}
        initialPrinter={printModal.options?.printer}
        initialPageSize={printModal.options?.pageSize}
        initialCopies={printModal.options?.copies}
        initialLandscape={printModal.options?.landscape}
      />
    </>
  );
}
