// ============================================================
// CellHub Pro — Preload / Context Bridge
// r-pkg-a1: Hardened — only channels actually consumed by the renderer
// are exposed. Removed 9 unused channels (getConfig, saveConfig,
// getVersion, printToPdf, showSaveDialog, writeFile, readFile,
// openExternal, downloadUpdate) to minimize attack surface.
// Re-add WITH validation when features need them.
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

// r-print-audit: log to confirm preload ran. Visible in main process terminal.
console.log('[preload] script started, exposing electronAPI');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // License
    checkLicense:     ()       => ipcRenderer.invoke('check-license'),
    activateLicense:  (key)    => ipcRenderer.invoke('activate-license', key),

    // Printing — internal preview + direct print (r-print-audit v2)
    getPrinters:      ()         => ipcRenderer.invoke('get-printers'),
    printPreview:     (payload)  => ipcRenderer.invoke('print:preview', payload),
    printRun:         (payload)  => ipcRenderer.invoke('print:run', payload),

    // Auto-update
    checkForUpdates:  ()       => ipcRenderer.invoke('check-for-updates'),
    installUpdate:    ()       => ipcRenderer.send('install-update'),
    // r-pkg-a2: re-added — needed by AutoUpdateNotifier to trigger download.
    downloadUpdate:   ()       => ipcRenderer.send('download-update'),
    // Backup
    getBackupFolder:  ()       => ipcRenderer.invoke('get-backup-folder'),
    setBackupFolder:  ()       => ipcRenderer.invoke('set-backup-folder'),
    // r-batch-a (5): returns unsubscribe function to prevent listener leaks.
    onUpdateAvailable: (cb) => {
      const handler = (_, info) => cb(info);
      ipcRenderer.on('update-available', handler);
      return () => ipcRenderer.removeListener('update-available', handler);
    },
    onUpdateDownloaded: (cb) => {
      const handler = (_, info) => cb(info);
      ipcRenderer.on('update-downloaded', handler);
      return () => ipcRenderer.removeListener('update-downloaded', handler);
    },
  });
  console.log('[preload] electronAPI exposed successfully');
} catch (err) {
  console.error('[preload] FAILED to expose electronAPI:', err);
}
