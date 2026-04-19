/**
 * Check if running inside Electron.
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

/**
 * Get the Electron API (or null if not in Electron).
 */
export function getElectronAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}
