// Companion Lite — Persistent desktop session storage.
// localStorage-backed. No Firebase, no Capacitor — desktop runs as
// Electron/web and localStorage is always available.

import type { CompanionLiteDesktopSession } from '@/types/companionLite';

const KEY = 'cellhub.companionLite.desktop.v1';

export function loadDesktopSession(): CompanionLiteDesktopSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CompanionLiteDesktopSession;
  } catch {
    return null;
  }
}

export function saveDesktopSession(s: CompanionLiteDesktopSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* noop — storage full or disabled */
  }
}

export function clearDesktopSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
