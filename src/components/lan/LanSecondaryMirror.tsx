// ============================================================
// CellHub Pro — LAN Secondary Mirror (LOCAL-LAN-SECONDARY-HYDRATION-V1)
//
// Mounted once globally. When this machine is a paired LAN Secondary, it
// fetches the Primary's authenticated read-only snapshot and hydrates the
// app's IN-MEMORY state (via the existing AppProvider setters) so the
// dashboard / customers / inventory / repairs / transactions reflect the
// Primary's data instead of this machine's empty local store.
//
// STRICT READ-ONLY:
//   • Uses only AppProvider SET_* convenience setters, which are pure
//     in-memory reducer updates — they do NOT write localStorage / persist.
//   • Never touches money / tax / receipts / POS / Firebase.
//   • On app restart the Secondary reverts to its own local data (the mirror
//     is never written to disk as authoritative).
//
// Auto-refreshes every REFRESH_MS while connected; an immediate re-sync can be
// requested via the cellhub:lan-resync event (fired right after pairing).
// Renders nothing.
// ============================================================
import { useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { getConnection, fetchSnapshot, LAN_RESYNC_EVENT } from '@/services/lan/lanService';
import { setMirrorStatus, getMirrorStatus } from '@/services/lan/lanMirror';
import type {
  Customer, InventoryItem, Sale, Repair, Unlock, SpecialOrder, Layaway, Appointment,
  StoreCreditLedger, CustomerReturn,
} from '@/store/types';

const REFRESH_MS = 20_000; // auto-refresh cadence (within the 15–30s requirement)

export default function LanSecondaryMirror() {
  const app = useApp();
  // Keep the latest setters in a ref so the interval/listener stay stable.
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    // LAN-CONNECTION-STATE-UX-V1: settle the transient "reconnected" badge
    // back to "connected" after a short window.
    let reconnectTimer: number | null = null;
    const RECONNECTED_SETTLE_MS = 4000;

    const asArr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

    const applySnapshot = (data: Record<string, unknown> | null | undefined) => {
      if (!data || typeof data !== 'object') return;
      const a = appRef.current;
      const customers = asArr(data.customers);
      const inventory = asArr(data.inventory);
      const sales = asArr(data.sales);
      const repairs = asArr(data.repairs);
      const layaways = asArr(data.layaways);
      const unlocks = asArr(data.unlocks);
      const specialOrders = asArr(data.specialOrders);
      const appointments = asArr(data.appointments);
      const storeCreditLedger = asArr(data.storeCreditLedger);
      const customerReturns = asArr(data.customerReturns);
      // In-memory only. NOTE: settings are intentionally NOT hydrated so the
      // Secondary keeps its own printers / license / tax config untouched.
      if (customers) a.setCustomers(customers as Customer[]);
      if (inventory) a.setInventory(inventory as InventoryItem[]);
      if (sales) a.setSales(sales as Sale[]);
      if (repairs) a.setRepairs(repairs as Repair[]);
      if (layaways) a.setLayaways(layaways as Layaway[]);
      if (unlocks) a.setUnlocks(unlocks as Unlock[]);
      if (specialOrders) a.setSpecialOrders(specialOrders as SpecialOrder[]);
      if (appointments) a.setAppointments(appointments as Appointment[]);
      if (storeCreditLedger) a.setStoreCreditLedger(storeCreditLedger as StoreCreditLedger[]);
      if (customerReturns) a.setCustomerReturns(customerReturns as CustomerReturn[]);
    };

    const tick = async () => {
      if (getConnection().role !== 'secondary') {
        setMirrorStatus({ active: false, syncing: false, connState: 'connecting' });
        return;
      }
      // Mark the in-flight poll WITHOUT changing connState — so a routine
      // background refresh does not flip the banner into a spinner. connState
      // only changes once we know the outcome below.
      setMirrorStatus({ active: true, syncing: true });
      const res = await fetchSnapshot();
      if (cancelled) return;
      const prev = getMirrorStatus();
      if (res.ok && res.data) {
        applySnapshot(res.data as Record<string, unknown>);
        // R-SECONDARY-FAILOVER-PERSIST: persist the latest Primary snapshot to
        // disk so the Secondary retains last-known data across restarts.
        // Fire-and-forget — never blocks the UI; no restore/promote here.
        try { void window.electronAPI?.saveMirrorFailover?.(res.data); } catch { /* best-effort */ }
        // Only a recovery from a real offline drop shows "Reconnected"; the
        // first-ever connect (from 'connecting') goes straight to 'connected'.
        const cameBackOnline = prev.connState === 'offline';
        setMirrorStatus({
          active: true, syncing: false, lastSyncAt: Date.now(),
          stale: !!res.stale, primaryName: res.primaryName || null, error: null,
          connState: cameBackOnline ? 'reconnected' : 'connected',
        });
        if (cameBackOnline) {
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(() => {
            // Settle to steady "connected" only if we haven't dropped again.
            if (!cancelled && getMirrorStatus().connState === 'reconnected') {
              setMirrorStatus({ connState: 'connected' });
            }
          }, RECONNECTED_SETTLE_MS);
        }
      } else {
        // Failed poll: keep the cached mirror visible. With prior data →
        // "offline (cached)"; never synced yet → still "connecting/waiting".
        const hasCachedData = prev.lastSyncAt != null;
        setMirrorStatus({
          active: true, syncing: false, error: res.error || 'fetch_failed',
          connState: hasCachedData ? 'offline' : 'connecting',
        });
      }
    };

    void tick(); // hydrate immediately on mount
    timer = window.setInterval(() => { void tick(); }, REFRESH_MS);

    const onResync = () => { void tick(); };
    window.addEventListener(LAN_RESYNC_EVENT, onResync);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.removeEventListener(LAN_RESYNC_EVENT, onResync);
    };
  }, []);

  return null;
}
