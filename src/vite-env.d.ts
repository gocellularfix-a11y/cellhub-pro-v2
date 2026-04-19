/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_SMS_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Electron preload bridge (available when running in Electron)
// r-pkg-a1: Slimmed to match hardened preload — only channels that the
// renderer actually consumes are declared. Removed: getConfig, saveConfig,
// getVersion, printToPdf, showSaveDialog, writeFile, readFile, openExternal.
interface ElectronAPI {
  checkLicense: () => Promise<{ valid: boolean; tier: string; expiresAt?: string }>;
  activateLicense: (key: string) => Promise<{ success: boolean; tier: string }>;
  getPrinters: () => Promise<Array<{ name: string; displayName?: string; isDefault: boolean; status: number }>>;
  // r-print-audit v2: internal preview + direct print
  printPreview: (payload: {
    html: string;
    pageSize?: { width: number; height: number } | string;
    landscape?: boolean;
    scaleFactor?: number;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
  }) => Promise<{ success: boolean; url?: string; error?: string }>;
  printRun: (payload: {
    html: string;
    deviceName: string;
    pageSize?: { width: number; height: number } | string;
    landscape?: boolean;
    scaleFactor?: number;
    copies?: number;
    color?: boolean;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
  }) => Promise<{ success: boolean; error?: string | null }>;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => void;
  // r-pkg-a2: re-added — triggers download after update-available notification.
  downloadUpdate: () => void;
  // Backup folder
  getBackupFolder: () => Promise<string>;
  setBackupFolder: () => Promise<string | null>;
  // r-batch-a (5): return an unsubscribe function so React useEffect
  // cleanups can remove the listener and prevent leaks on re-mount.
  onUpdateAvailable: (cb: (info: unknown) => void) => () => void;
  onUpdateDownloaded: (cb: (info: unknown) => void) => () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
