import { useState, useCallback } from 'react';

/**
 * Hook for PIN-gated edit sessions on completed tickets.
 *
 * Usage in a modal:
 *   const pin = usePinGate(settings.adminPin);
 *   // Render <AdminPinGate open={pin.showPinGate} ... />
 *   // On lock icon click: pin.requestUnlock()
 *   // On modal close: pin.resetLock()
 */
export function usePinGate(adminPin: string | undefined) {
  const [showPinGate, setShowPinGate] = useState(false);
  const [editUnlocked, setEditUnlocked] = useState(false);

  const requestUnlock = useCallback(() => setShowPinGate(true), []);
  const handleSuccess = useCallback(() => {
    setEditUnlocked(true);
    setShowPinGate(false);
  }, []);
  const handleCancel = useCallback(() => setShowPinGate(false), []);
  const resetLock = useCallback(() => {
    setEditUnlocked(false);
    setShowPinGate(false);
  }, []);

  return { showPinGate, editUnlocked, requestUnlock, handleSuccess, handleCancel, resetLock };
}
