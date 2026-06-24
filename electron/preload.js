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
    // R-PRODUCTION-B3.2: open the local diagnostics logs folder (fixed path in
    // main; no renderer-supplied path, no shell/openPath surface exposed).
    openDiagnosticsLogsFolder: () => ipcRenderer.invoke('diagnostics:open-logs'),
    // R-SECONDARY-FAILOVER-PERSIST: persist latest LAN mirror snapshot (Secondary).
    saveMirrorFailover: (snapshot) => ipcRenderer.invoke('mirror:save-failover', snapshot),
    // R-PROMOTE-TO-PRIMARY: read the persisted failover snapshot (manual promotion).
    readMirrorFailover: () => ipcRenderer.invoke('mirror:read-failover'),
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

    // LAN pairing (LOCAL-LAN-PAIRING-PHASE-1-V1) — handshake only, no sync.
    lanStartPrimary:    (opts) => ipcRenderer.invoke('lan:start-primary', opts),
    lanStopPrimary:     ()     => ipcRenderer.invoke('lan:stop-primary'),
    lanGetStatus:       ()     => ipcRenderer.invoke('lan:get-status'),
    lanGeneratePairCode:()     => ipcRenderer.invoke('lan:generate-code'),
    lanPairWithPrimary: (opts) => ipcRenderer.invoke('lan:pair', opts),
    // PHASE 2 (read-only snapshot)
    lanSetSnapshot:     (snap) => ipcRenderer.invoke('lan:set-snapshot', snap),
    lanFetchSnapshot:   (opts) => ipcRenderer.invoke('lan:fetch-snapshot', opts),
    // PHASE 3A (operation forwarding skeleton)
    lanSendOperation:   (opts) => ipcRenderer.invoke('lan:send-operation', opts),
    onLanOperation: (cb) => {
      const handler = (_, op) => cb(op);
      ipcRenderer.on('lan:operation-received', handler);
      return () => ipcRenderer.removeListener('lan:operation-received', handler);
    },
    // LAN-LICENSE-INHERITANCE-V1
    lanFetchLicense:    (opts) => ipcRenderer.invoke('lan:fetch-license', opts),
    // LOCAL-LAN-AUTO-DISCOVERY-V1
    lanDiscoverPrimaries:(opts) => ipcRenderer.invoke('lan:discover', opts),
    // LAN-PHASE-3B-CREATE-CUSTOMER-FORWARDING-V1: Primary renderer dispatcher.
    // Main forwards a business operation here; the renderer persists and replies.
    onLanOperationDispatch: (cb) => {
      const handler = (_, req) => cb(req);
      ipcRenderer.on('lan:operation-dispatch', handler);
      return () => ipcRenderer.removeListener('lan:operation-dispatch', handler);
    },
    lanSendOperationResult: (payload) => ipcRenderer.send('lan:operation-result', payload),
  });
  console.log('[preload] electronAPI exposed successfully');
} catch (err) {
  console.error('[preload] FAILED to expose electronAPI:', err);
}
