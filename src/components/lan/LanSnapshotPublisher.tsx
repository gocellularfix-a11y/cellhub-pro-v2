// ============================================================
// CellHub Pro — LAN Snapshot Publisher (LOCAL-LAN-PAIRING-PHASE-2-V1)
//
// Mounted once globally. When this machine is the LAN Primary, it pushes a
// read-only snapshot of current store state to the Electron main process on
// an interval, so paired Secondary devices can fetch it over /snapshot.
//
// READ-ONLY: this never mutates app state, never touches persist/POS/money.
// Renders nothing.
// ============================================================
import { useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { getConnection, buildSnapshot, pushSnapshot, isElectron } from '@/services/lan/lanService';

const PUSH_INTERVAL_MS = 15_000;

export default function LanSnapshotPublisher() {
  const { state } = useApp();
  // Keep the latest state in a ref so the interval reads fresh data without
  // re-arming the timer on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isElectron()) return;

    const publish = () => {
      if (getConnection().role !== 'primary') return;
      const s = stateRef.current;
      const snap = buildSnapshot(
        {
          customers: s.customers, inventory: s.inventory, sales: s.sales, repairs: s.repairs,
          layaways: s.layaways, unlocks: s.unlocks, specialOrders: s.specialOrders,
          appointments: s.appointments, settings: s.settings as unknown as Record<string, unknown>,
        },
        (s.settings as { storeName?: string })?.storeName || 'CellHub Primary',
      );
      void pushSnapshot(snap);
    };

    publish(); // push once immediately on mount
    const id = window.setInterval(publish, PUSH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
