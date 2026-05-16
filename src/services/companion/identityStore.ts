// Companion — Persistent desktop session storage.
// localStorage-backed. No Firebase, no Capacitor — desktop runs as
// Electron/web and localStorage is always available.

import type { CompanionDesktopSession } from '@/types/companion';

const KEY = 'cellhub.companion.desktop.v1';
// Legacy key from Companion Lite era. Kept for one-time migration only.
const LEGACY_KEY = 'cellhub.companionLite.desktop.v1';

export function loadDesktopSession(): CompanionDesktopSession | null {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      // Backward compatibility: migrate any existing Companion Lite session.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        try {
          localStorage.setItem(KEY, legacy);
          localStorage.removeItem(LEGACY_KEY);
        } catch {
          /* noop — best-effort migration */
        }
        raw = legacy;
      }
    }
    if (!raw) return null;
    return JSON.parse(raw) as CompanionDesktopSession;
  } catch {
    return null;
  }
}

export function saveDesktopSession(s: CompanionDesktopSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* noop — storage full or disabled */
  }
}

export function clearDesktopSession(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* noop */
  }
}
