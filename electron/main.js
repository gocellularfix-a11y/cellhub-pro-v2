// ============================================================
// CellHub Pro — Electron Main Process (Phase 7)
// License enforcement, auto-update, thermal printing
// ============================================================
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  validateLicenseKey,
  generateTrialKey,
  getTrialDaysRemaining,
  getTierFeatures,
  computeHwFingerprint,
  checkClockRollback,
} = require('./license');

// ── Single instance lock ──────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ── Env ───────────────────────────────────────────────────
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';
let mainWindow = null;
let tray = null;

// ── Config persistence ────────────────────────────────────
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) { console.error('Failed to load config:', e); }
  return {};
}

function saveConfig(data) {
  try {
    const merged = { ...loadConfig(), ...data };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    return merged;
  } catch (e) { console.error('Failed to save config:', e); return null; }
}

// ── License management ────────────────────────────────────
function getLicenseStatus() {
  const config = loadConfig();
  const hwFingerprint = computeHwFingerprint();

  // Clock rollback guard
  if (checkClockRollback(config)) {
    return { valid: false, tier: 'none', expiresAt: null, expired: false, error: 'System clock manipulation detected.' };
  }

  // Advance highWaterMark
  if (!config.licenseHighWaterMark || Date.now() > new Date(config.licenseHighWaterMark).getTime()) {
    saveConfig({ licenseHighWaterMark: new Date().toISOString() });
  }

  // Auto-generate trial on first run
  if (!config.licenseKey) {
    const trialKey = generateTrialKey();
    saveConfig({
      licenseKey: trialKey,
      licenseTier: 'trial',
      licenseHwFingerprint: hwFingerprint,
      licenseGraceSince: null,
      licenseHighWaterMark: new Date().toISOString(),
    });
    const result = validateLicenseKey(trialKey);
    return { ...result, daysRemaining: getTrialDaysRemaining(result.expiresAt), features: getTierFeatures(result.tier) };
  }

  const result = validateLicenseKey(config.licenseKey);

  // HW fingerprint binding
  if (config.licenseHwFingerprint && config.licenseHwFingerprint !== hwFingerprint) {
    const graceSince = config.licenseGraceSince;
    if (!graceSince) {
      saveConfig({ licenseGraceSince: new Date().toISOString() });
      return { ...result, valid: true, tier: 'grace', hwMismatch: true, graceDaysRemaining: 7, features: getTierFeatures(result.tier) };
    }
    const days = (Date.now() - new Date(graceSince).getTime()) / 86400000;
    if (days <= 7) {
      return {
        ...result,
        valid: true,
        tier: 'grace',
        hwMismatch: true,
        graceDaysRemaining: Math.ceil(7 - days),
        features: getTierFeatures(result.tier),
      };
    }
    return {
      valid: false,
      tier: 'none',
      expiresAt: null,
      expired: false,
      error: 'License is bound to a different machine. Please reactivate.',
      hwMismatch: true,
      features: getTierFeatures('none'),
    };
  }

  // Same machine — bind fingerprint if not yet stored
  saveConfig({ licenseHwFingerprint: hwFingerprint, licenseGraceSince: null });

  return {
    ...result,
    daysRemaining: result.tier === 'trial' ? getTrialDaysRemaining(result.expiresAt) : null,
    features: getTierFeatures(result.valid ? result.tier : 'none'),
  };
}

// ── Window creation ───────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 700,
    title: 'CellHub Pro',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // r-print-audit: enable Chromium's built-in PDF viewer plugin so that
      // <iframe src="data:application/pdf;base64,..."> can render the preview.
      // Without this, Electron may not render PDFs inside iframes.
      plugins: true,
    },
    backgroundColor: '#0f172a', show: false,
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.focus(); });
  // ── Close confirmation + auto-backup ──────────────────
  let forceClose = false;
  mainWindow.on('close', async (e) => {
    if (forceClose) return; // Already confirmed, let it close
    e.preventDefault();

    // Show confirmation dialog
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Close without backup', 'Save & Close'],
      defaultId: 2,
      cancelId: 0,
      title: 'Close CellHub Pro',
      message: 'Do you want to save a backup before closing?',
    });

    if (response === 0) return; // Cancel — don't close

    if (response === 2) {
      // Save & Close — export backup data
      try {
        const backupData = await mainWindow.webContents.executeJavaScript(`
          (function() {
            try {
              const KEYS = ['sales','customers','inventory','repairs','unlocks','special_orders',
                'employees','settings','layaways','purchase_orders','appointments','expenses',
                'customer_returns','vendor_returns'];
              const backup = {};
              for (const key of KEYS) {
                const raw = localStorage.getItem('cellhub_' + key);
                if (raw) backup[key] = JSON.parse(raw);
              }
              backup._exportedAt = new Date().toISOString();
              backup._version = '2.1.0';
              return JSON.stringify(backup);
            } catch(e) { return null; }
          })()
        `);

        if (backupData) {
          const config = loadConfig();
          const backupFolder = config.backupFolder || app.getPath('documents');
          const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const fileName = 'cellhub-AUTO-BACKUP-' + dateStr + '.json';
          const filePath = path.join(backupFolder, fileName);

          // Ensure folder exists
          if (!fs.existsSync(backupFolder)) fs.mkdirSync(backupFolder, { recursive: true });
          fs.writeFileSync(filePath, backupData);
          console.log('[AutoBackup] Saved to:', filePath);
        }
      } catch (err) {
        console.error('[AutoBackup] Failed:', err);
      }
    }

    // Close the window
    forceClose = true;
    mainWindow.close();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // External links → default browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(DEV_URL) && !url.startsWith('file://')) { event.preventDefault(); shell.openExternal(url); }
  });
  // r-print-fix: allow about:blank windows for Chromium print dialog,
  // deny external URLs (open in system browser instead).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '') {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── System tray ───────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('CellHub Pro');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open CellHub Pro', click: () => { if (mainWindow) mainWindow.show(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', () => { if (mainWindow) mainWindow.show(); });
  } catch (e) { console.warn('Tray creation failed:', e.message); }
}

// ── IPC Handlers ──────────────────────────────────────────
// r-pkg-a1: Hardened — only 4 channels that the renderer actually uses
// are exposed. The 9 unused channels (get-config, save-config,
// get-app-version, print-to-pdf, show-save-dialog, write-file,
// read-file, open-external, download-update) were removed to reduce
// attack surface. Re-add WITH validation when needed for future features.
function registerIpcHandlers() {
  // License
  ipcMain.handle('check-license', () => getLicenseStatus());
  ipcMain.handle('activate-license', (_, key) => {
    const result = validateLicenseKey(key);
    if (result.valid) {
      saveConfig({
        licenseKey: key.trim().toUpperCase(),
        licenseTier: result.tier,
        licenseActivatedAt: new Date().toISOString(),
        licenseHwFingerprint: computeHwFingerprint(),
        licenseGraceSince: null,
        licenseHighWaterMark: new Date().toISOString(),
      });
      return { success: true, tier: result.tier, expiresAt: result.expiresAt, features: getTierFeatures(result.tier) };
    }
    return { success: false, error: result.error || 'Invalid license key' };
  });

  // ── Printing (r-print-audit v2: internal preview + direct print) ──
  // Three IPC channels:
  //   printers:list   — returns all system printers
  //   print:preview   — generates PDF preview via hidden BrowserWindow
  //   print:run       — sends job to a specific printer via webContents.print()
  //
  // The renderer shows a PrintPreviewModal with live preview, printer picker,
  // scale, margins, and zoom — no dependency on Chrome or Windows print dialog.

  ipcMain.handle('get-printers', async () => {
    if (!mainWindow) return [];
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: p.isDefault, status: p.status }));
    } catch (e) { return []; }
  });

  ipcMain.handle('print:preview', async (_, payload) => {
    const os = require('os');
    console.log('[print:preview] called, html length:', (payload.html || '').length);
    const previewWin = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    try {
      const html = buildPrintableHtml(payload.html);
      console.log('[print:preview] loading data URL, total length:', html.length);

      // r-print-contract-v2: stable render synchronization.
      // Replaced fragile setTimeout(250) with did-finish-load + fonts.ready.
      // Belt-and-suspenders: a 2s safety timeout in case fonts.ready never
      // resolves (some embedded SVG/data-uri fonts can stall).
      const ready = new Promise((resolve) => {
        previewWin.webContents.once('did-finish-load', async () => {
          try {
            await previewWin.webContents.executeJavaScript(
              'document.fonts && document.fonts.ready ? document.fonts.ready.then(()=>true) : Promise.resolve(true)'
            );
          } catch (_) {}
          resolve();
        });
      });
      const safety = new Promise((resolve) => setTimeout(resolve, 2000));
      await previewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await Promise.race([ready, safety]);
      console.log('[print:preview] render ready');

      // r-print-contract-v2: respect document CSS @page rules when present.
      // If the HTML has `@page { size: ... }`, preferCSSPageSize lets that
      // win over the payload pageSize. Repair tickets, unlock tickets, and
      // receipts all declare their own @page rules and previously had them
      // ignored, forcing receipts into 4×6 by default.
      //
      // Electron printToPDF expects pageSize as either a preset string
      // ('A4', 'Letter', etc.) OR { width, height } in MICRONS (1/1000 mm).
      // PAGE_SIZES in the renderer already use microns so they pass through.
      // Margins for printToPDF are in INCHES — the modal UI already labels
      // them as inches, so they pass through unchanged.
      const pdfOptions = {
        landscape: payload.landscape || false,
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        pageSize: payload.pageSize || { width: 101600, height: 152400 },
        scale: (payload.scaleFactor || 100) / 100,
        margins: {
          top: payload.margins?.top || 0,
          bottom: payload.margins?.bottom || 0,
          left: payload.margins?.left || 0,
          right: payload.margins?.right || 0,
        },
      };
      console.log('[print:preview] printToPDF options:', JSON.stringify(pdfOptions));
      const pdfBuffer = await previewWin.webContents.printToPDF(pdfOptions);
      console.log('[print:preview] PDF generated, size:', pdfBuffer.length, 'bytes');

      // r-print-audit fix: return base64 data URL instead of file:// path.
      // Electron's renderer blocks file:// resources by default for security
      // ("Not allowed to load local resource"). data: URLs are allowed and
      // render directly in the iframe. We still write the file to disk for
      // debugging purposes, but the renderer never references it.
      const printDir = path.join(os.tmpdir(), 'cellhub-print');
      if (!fs.existsSync(printDir)) fs.mkdirSync(printDir, { recursive: true });
      const filePath = path.join(printDir, `preview-${Date.now()}.pdf`);
      fs.writeFileSync(filePath, pdfBuffer);
      console.log('[print:preview] wrote to:', filePath);

      // Clean old previews (keep last 5)
      try {
        const files = fs.readdirSync(printDir).filter(f => f.startsWith('preview-')).sort();
        for (const old of files.slice(0, Math.max(0, files.length - 5))) {
          fs.unlinkSync(path.join(printDir, old));
        }
      } catch (_) {}

      const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
      return { success: true, url: dataUrl };
    } catch (err) {
      console.error('[print:preview] FAILED:', err);
      return { success: false, error: err.message || String(err) };
    } finally {
      if (!previewWin.isDestroyed()) previewWin.close();
    }
  });

  ipcMain.handle('print:run', async (_, payload) => {
    console.log('[print:run] called, printer:', payload.deviceName);
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    try {
      const html = buildPrintableHtml(payload.html);

      // r-print-contract-v2: stable render synchronization (same as preview).
      const ready = new Promise((resolve) => {
        printWin.webContents.once('did-finish-load', async () => {
          try {
            await printWin.webContents.executeJavaScript(
              'document.fonts && document.fonts.ready ? document.fonts.ready.then(()=>true) : Promise.resolve(true)'
            );
          } catch (_) {}
          resolve();
        });
      });
      const safety = new Promise((resolve) => setTimeout(resolve, 2000));
      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await Promise.race([ready, safety]);

      // RECEIPT-PRINTER-PAGE-RANGE-FIX-V1b: Chromium only paginates DURING
      // the print, so a requested pageRange is never validated against a real
      // page count — single-page receipts with a custom range, or ranges past
      // the last page, fail the whole job with an opaque error. When (and
      // only when) a custom range was requested, probe the actual page count
      // via printToPDF on the already-loaded window (cheap for receipts):
      //   pageCount <= 1 → drop pageRanges entirely (print-all is the
      //                    identical output for a one-page document)
      //   pageCount  > 1 → clamp ranges into [0, pageCount-1]; if nothing
      //                    survives, fail fast with a CLEAR message.
      // Probe failure → send ranges as-is (pre-existing behavior).
      let effectiveRanges = Array.isArray(payload.pageRanges) && payload.pageRanges.length > 0
        ? payload.pageRanges
        : null;
      // RECEIPT-PRINTER-CUSTOM-RANGE-BYPASS-V1: runtime confirmed that even a
      // VALID {from:0,to:0} range fails the silent print job on the shop
      // printer (Chromium/driver pageRanges quirk) while All-pages prints
      // fine. For receipt-sized paper (width <= 4in: 80mm/4x6/label/cr80) a
      // "page 1 only" custom range is OUTPUT-IDENTICAL to printing all pages
      // of a one-page receipt — so drop the ranges entirely and print all.
      // No probe needed, no error shown. Multipage/letter documents keep the
      // probe-validated range path below.
      if (effectiveRanges) {
        const isReceiptSize = ((payload.pageSize && payload.pageSize.width) || 101600) <= 101600;
        const onlyFirstPage = effectiveRanges.every((r) => (r.from || 0) === 0 && (r.to || 0) === 0);
        if (isReceiptSize && onlyFirstPage) {
          console.log('[print:run] receipt-size + page-1-only range → bypassing pageRanges (identical output)');
          effectiveRanges = null;
        }
      }
      if (effectiveRanges) {
        try {
          const probePdf = await printWin.webContents.printToPDF({
            landscape: payload.landscape || false,
            printBackground: true,
            preferCSSPageSize: true,
            pageSize: payload.pageSize || { width: 101600, height: 152400 },
            margins: {
              top: payload.margins?.top || 0,
              bottom: payload.margins?.bottom || 0,
              left: payload.margins?.left || 0,
              right: payload.margins?.right || 0,
            },
          });
          // Chromium/Skia PDFs list each page object as "/Type /Page" —
          // count them (excluding the "/Type /Pages" tree node). 0 → heuristic
          // failed → leave ranges untouched.
          const pageCount = (probePdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
          console.log('[print:run] page-count probe:', pageCount, 'requested ranges:', JSON.stringify(effectiveRanges));
          if (pageCount === 1) {
            // RECEIPT-PRINTER-CUSTOM-RANGE-BYPASS-V1: one-page document —
            // a range covering page 1 prints all (identical output); a range
            // that does NOT include page 1 is a clean validation error, never
            // a generic "Print job failed".
            const coversFirstPage = effectiveRanges.some((r) => (r.from || 0) === 0);
            if (coversFirstPage) {
              effectiveRanges = null;
            } else {
              if (!printWin.isDestroyed()) printWin.close();
              return { success: false, error: 'Page range out of bounds — document has 1 page' };
            }
          } else if (pageCount > 1) {
            const clamped = effectiveRanges
              .map((r) => ({ from: Math.max(0, r.from || 0), to: Math.min(r.to || 0, pageCount - 1) }))
              .filter((r) => r.from <= r.to);
            if (clamped.length === 0) {
              if (!printWin.isDestroyed()) printWin.close();
              return { success: false, error: `Page range out of bounds — document has ${pageCount} pages` };
            }
            effectiveRanges = clamped;
          }
        } catch (probeErr) {
          console.warn('[print:run] page-count probe failed, sending ranges as-is:', probeErr);
        }
      }

      return await new Promise((resolve) => {
        // r-print-contract-v2: margin unit consistency.
        // The modal UI labels margins as INCHES and printToPDF (preview path)
        // expects inches. But webContents.print with marginType:'custom'
        // expects MICRONS, not inches. Without conversion, a "0.25 in" margin
        // in the UI becomes 0.25 microns at the printer (effectively zero) —
        // preview and real print disagree silently.
        // 1 inch = 25400 microns.
        const inchesToMicrons = (n) => Math.round((n || 0) * 25400);
        const printOptions = {
          silent: true,
          printBackground: true,
          deviceName: payload.deviceName,
          copies: payload.copies || 1,
          color: payload.color !== false,
          landscape: payload.landscape || false,
          scaleFactor: payload.scaleFactor || 100,
          pageSize: payload.pageSize || { width: 101600, height: 152400 },
          margins: payload.margins
            ? {
                marginType: 'custom',
                top: inchesToMicrons(payload.margins.top),
                bottom: inchesToMicrons(payload.margins.bottom),
                left: inchesToMicrons(payload.margins.left),
                right: inchesToMicrons(payload.margins.right),
              }
            : { marginType: 'none' },
          // R-PRINT-PAGE-RANGES-V1: forward parsed pageRanges from the
          // print preview modal. webContents.print accepts an array of
          // {from, to} — 0-BASED page indices, inclusive (the renderer
          // converts from the 1-based UI values before sending — see
          // RECEIPT-PRINTER-PAGE-RANGE-FIX-V1). Omitted = all pages.
          // RECEIPT-PRINTER-PAGE-RANGE-FIX-V1b: effectiveRanges is the
          // probe-validated version (single-page → null, clamped otherwise).
          ...(effectiveRanges ? { pageRanges: effectiveRanges } : {}),
        };
        console.log('[print:run] options:', JSON.stringify(printOptions));
        printWin.webContents.print(printOptions, (success, failureReason) => {
          console.log('[print:run] result:', success, failureReason);
          if (!printWin.isDestroyed()) printWin.close();
          resolve({ success, error: failureReason || null });
        });
      });
    } catch (err) {
      console.error('[print:run] FAILED:', err);
      if (!printWin.isDestroyed()) printWin.close();
      return { success: false, error: err.message || String(err) };
    }
  });

  // Backup folder config
  ipcMain.handle('get-backup-folder', () => {
    const config = loadConfig();
    return config.backupFolder || app.getPath('documents');
  });

  ipcMain.handle('set-backup-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Backup Folder',
    });
    if (!result.canceled && result.filePaths[0]) {
      saveConfig({ backupFolder: result.filePaths[0] });
      return result.filePaths[0];
    }
    return null;
  });

  // Auto-update — r-pkg-a1: listener dedup to prevent accumulation
  // when check-for-updates is called multiple times.
  let updateListenersRegistered = false;
  ipcMain.handle('check-for-updates', async () => {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      if (!updateListenersRegistered) {
        autoUpdater.on('update-available', (info) => { if (mainWindow) mainWindow.webContents.send('update-available', info); });
        autoUpdater.on('update-downloaded', (info) => { if (mainWindow) mainWindow.webContents.send('update-downloaded', info); });
        updateListenersRegistered = true;
      }
      await autoUpdater.checkForUpdates();
      return { checking: true };
    } catch (e) { return { checking: false, error: e.message }; }
  });
  ipcMain.on('install-update', () => { try { require('electron-updater').autoUpdater.quitAndInstall(); } catch (e) {} });
  // r-pkg-a2: re-added download-update (was removed in r-pkg-a1 as unused;
  // now needed by the new AutoUpdateNotifier component).
  ipcMain.on('download-update', () => { try { require('electron-updater').autoUpdater.downloadUpdate(); } catch (e) {} });
}

// ── App lifecycle ─────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  createTray();
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

// ── Print helper ──────────────────────────────────────────
// Wraps raw HTML content in a minimal document shell for printToPDF/print.
// The content already has its own styles (@page, body width, etc.) so we
// just ensure DOCTYPE + charset + background printing.
function buildPrintableHtml(content) {
  // If content already starts with <!DOCTYPE or <html, use as-is
  const trimmed = content.trimStart();
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) return content;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: white; }
    @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>${content}</body></html>`;
}
