// ============================================================
// R-OFFLINE-MODE-GUARD-V1 — lightweight online/offline status + guard.
//
// Local-first: CellHub works fully offline. This module ONLY gates the few
// actions that genuinely need the internet (carrier portal, WhatsApp link,
// future cloud sync/backup). It never touches POS / cart / payment / financial
// logic and never blocks local work.
//
// Design: guardOnline() is dependency-free so it works in BOTH services and
// components. When offline it dispatches a window event; <OfflineGuardListener>
// (a React component with toast + i18n access) shows the localized message.
// ============================================================

import { useEffect, useState } from 'react';

/** Window event fired when an internet-required action is attempted offline. */
export const OFFLINE_BLOCKED_EVENT = 'cellhub:offline-blocked';

/** True when the browser/Electron reports network connectivity. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function isOffline(): boolean {
  return !isOnline();
}

/**
 * Guard for an internet-required action. Returns true when online; when offline
 * it emits OFFLINE_BLOCKED_EVENT (handled by <OfflineGuardListener> → toast) and
 * returns false so the caller can bail out without performing the action.
 *
 * Safe to call from services (no toast/i18n dependency) and components alike.
 */
export function guardOnline(actionKey?: string): boolean {
  if (isOnline()) return true;
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_BLOCKED_EVENT, { detail: { actionKey } }));
  } catch {
    /* non-browser context — ignore */
  }
  return false;
}

/**
 * window.open() that is gated by guardOnline(): opens the URL when online,
 * otherwise toasts the offline message and does nothing. Returns whether it
 * opened. Behaves identically to window.open when online.
 */
export function openExternalIfOnline(url: string, target?: string, features?: string): boolean {
  if (!guardOnline()) return false;
  window.open(url, target, features);
  return true;
}

/**
 * React hook exposing live online/offline state. Re-renders on the browser's
 * 'online' / 'offline' events.
 */
export function useOnlineStatus(): { isOnline: boolean; isOffline: boolean } {
  const [online, setOnline] = useState<boolean>(isOnline());
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Re-sync once on mount in case state changed before listeners attached.
    setOnline(isOnline());
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return { isOnline: online, isOffline: !online };
}
