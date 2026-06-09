// ============================================================
// CellHub Pro — LAN read-only mode (SECONDARY-UI-LOCK-V1)
//
// Single source of truth for "is this machine a read-only LAN Secondary?".
// The persist layer already BLOCKS writes on a Secondary (LOCAL-LAN-READONLY-
// GUARD-V1); this hook lets the UI also DISABLE write buttons so the operator
// understands the terminal is read-only before clicking.
//
//   isLanSecondaryReadOnly()  — non-hook check (safe in services / callbacks)
//   useLanReadOnlyMode()      — reactive hook for components
//
// Role source: lanService.getConnection().role === 'secondary'.
// ============================================================
import { useEffect, useState } from 'react';
import { getConnection, LAN_RESYNC_EVENT } from '@/services/lan/lanService';
import { subscribeMirror } from '@/services/lan/lanMirror';

/** True only when this machine is a paired LAN Secondary (read-only mirror). */
export function isLanSecondaryReadOnly(): boolean {
  try { return getConnection().role === 'secondary'; }
  catch { return false; }
}

/** Reactive variant — re-renders when the LAN role changes (pair / disconnect /
 *  mirror refresh / cross-tab storage change). */
export function useLanReadOnlyMode(): boolean {
  const [readOnly, setReadOnly] = useState<boolean>(isLanSecondaryReadOnly);
  useEffect(() => {
    const update = () => setReadOnly(isLanSecondaryReadOnly());
    // Mirror status changes (incl. the periodic secondary refresh) + pairing
    // re-sync + cross-tab storage writes all re-evaluate the role.
    const unsub = subscribeMirror(update);
    window.addEventListener('storage', update);
    window.addEventListener(LAN_RESYNC_EVENT, update);
    return () => {
      unsub();
      window.removeEventListener('storage', update);
      window.removeEventListener(LAN_RESYNC_EVENT, update);
    };
  }, []);
  return readOnly;
}
