// ============================================================
// CellHub Pro — LAN Operation Listener (LOCAL-LAN-PHASE-3A-V1)
//
// Mounted once globally. On the Primary, Electron main forwards a validated
// LAN_PING_OPERATION here via the `lan:operation-received` channel. PHASE 3A
// only RECORDS the last operation (for the settings panel to display) — it
// does NOT mutate AppProvider, does NOT call persist, touches no business
// data. Renders nothing.
// ============================================================
import { useEffect } from 'react';
import { onLanOperation, recordIncomingOperation } from '@/services/lan/lanService';

export default function LanOperationListener() {
  useEffect(() => {
    // Subscribe; the wrapper is a no-op outside Electron.
    const unsubscribe = onLanOperation((op) => {
      // Display-only record. Phase 3B will route real operations into a
      // command handler — this round proves the transport only.
      recordIncomingOperation(op);
    });
    return unsubscribe;
  }, []);

  return null;
}
