// ============================================================
// CellHub Pro — Startup auto-backup (R-PRODUCTION-B5.2)
//
// Local-only, write-only periodic backup protection for the Electron MAIN
// process. Runs ONCE at startup (after the renderer loads) IF the last
// auto-backup is older than the interval (default 24h). It reuses the SAME
// localStorage snapshot shape the on-close backup uses and the SAME
// cellhub-AUTO-BACKUP-* filename family.
//
// HARD RULES:
//   • Local-only. NO cloud/upload/email. NO compression/encryption.
//   • WRITE-ONLY. NEVER restores/imports automatically. NEVER reads back into
//     app state. Restore stays a manual, merge-safe action (unchanged).
//   • Does NOT change persistence semantics, saveLocal, export/import format,
//     or the existing on-close backup. No IPC, no renderer UI.
//   • Never throws to the app; never blocks startup.
//
// NOTE: LOCALSTORAGE_BACKUP_KEYS duplicates the inline list in main.js's
// on-close backup and storage.ts BACKUP_KEYS. Extracting a shared source would
// require modifying on-close (out of scope this round), so the list is kept
// here with this sync warning. KEEP IN SYNC if collections are added.
// ============================================================

const path = require('path');
const fs = require('fs');

// MUST stay in sync with main.js on-close KEYS and storage.ts BACKUP_KEYS.
const LOCALSTORAGE_BACKUP_KEYS = [
  'sales', 'customers', 'inventory', 'repairs',
  'unlocks', 'special_orders', 'employees', 'settings', 'layaways',
  'purchase_orders', 'appointments', 'expenses',
  'customer_returns', 'vendor_returns',
];

// Strict match — ONLY auto-backup files. Manual backups (cellhub-backup-*.json)
// and any other file never match, so they are never pruned.
const AUTO_BACKUP_PATTERN = /^cellhub-AUTO-BACKUP-.*\.json$/;

// ── Pure helpers ─────────────────────────────────────────

/** `cellhub-AUTO-BACKUP-YYYY-MM-DD-HHmmss.json`. Deterministic for a given Date. */
function buildAutoBackupFileName(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `cellhub-AUTO-BACKUP-${stamp}.json`;
}

/**
 * True when a startup backup should run: no prior backup, an unparseable
 * timestamp, or the last one is at least `intervalHours` old. Deterministic
 * (caller injects nowMs).
 */
function shouldRunStartupBackup(lastAutoBackupIso, nowMs, intervalHours = 24) {
  if (!lastAutoBackupIso) return true;
  const last = new Date(lastAutoBackupIso).getTime();
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= intervalHours * 60 * 60 * 1000;
}

/**
 * Delete oldest AUTO backups beyond `keepCount`. Filenames embed a sortable
 * timestamp, so lexical sort == chronological. ONLY files matching the strict
 * AUTO pattern are ever considered — manual / unrelated files are untouched.
 * `fsLike` is injectable for testing. Returns the number of files deleted.
 */
function pruneAutoBackups(dir, keepCount, fsLike) {
  let entries;
  try {
    entries = fsLike.readdirSync(dir) || [];
  } catch (_e) {
    return 0;
  }
  const autos = entries.filter((f) => AUTO_BACKUP_PATTERN.test(f)).sort(); // oldest first
  if (autos.length <= keepCount) return 0;
  const toDelete = autos.slice(0, autos.length - keepCount);
  let deleted = 0;
  for (const f of toDelete) {
    try {
      fsLike.unlinkSync(path.join(dir, f));
      deleted += 1;
    } catch (_e) {
      /* skip — never throw */
    }
  }
  return deleted;
}

// ── Internal (impure) ────────────────────────────────────

function log(diagnostics, level, event, details) {
  try {
    if (diagnostics && typeof diagnostics.logDiagnosticEvent === 'function') {
      diagnostics.logDiagnosticEvent(level, event, details);
    }
  } catch (_e) {
    /* noop */
  }
}

function readLocalStorageSnapshot(mainWindow, keys) {
  // Mirrors the on-close snapshot: reads cellhub_<key> from localStorage.
  const script =
    '(function(){try{' +
    'var KEYS=' + JSON.stringify(keys) + ';' +
    'var b={};for(var i=0;i<KEYS.length;i++){var raw=localStorage.getItem("cellhub_"+KEYS[i]);if(raw)b[KEYS[i]]=JSON.parse(raw);}' +
    'b._exportedAt=new Date().toISOString();b._version="2.1.0";' +
    'return JSON.stringify(b);}catch(e){return null;}})()';
  return mainWindow.webContents.executeJavaScript(script);
}

/** True only if the snapshot carries at least one non-empty data collection. */
function snapshotHasData(snapStr) {
  try {
    const o = JSON.parse(snapStr);
    return Object.keys(o).some((k) => {
      if (k === '_exportedAt' || k === '_version') return false;
      const v = o[k];
      if (Array.isArray(v)) return v.length > 0;
      if (v && typeof v === 'object') return Object.keys(v).length > 0;
      return false;
    });
  } catch (_e) {
    return false;
  }
}

/**
 * Impure runner. Startup-if-stale: writes one auto-backup when due, updates
 * config.lastAutoBackup, prunes old AUTO files. Never throws, never blocks,
 * never restores. Returns a small status object (also useful for logging/tests).
 */
async function runStartupAutoBackup(opts) {
  const {
    app,
    mainWindow,
    loadConfig,
    saveConfig,
    diagnostics,
    keepCount = 14,
    intervalHours = 24,
  } = opts || {};
  try {
    if (!app || !mainWindow || !mainWindow.webContents || !loadConfig || !saveConfig) {
      return { ran: false, reason: 'missing-deps' };
    }
    const config = loadConfig() || {};
    if (!shouldRunStartupBackup(config.lastAutoBackup, Date.now(), intervalHours)) {
      return { ran: false, reason: 'recent' };
    }

    const snapStr = await readLocalStorageSnapshot(mainWindow, LOCALSTORAGE_BACKUP_KEYS);
    if (!snapStr || !snapshotHasData(snapStr)) {
      return { ran: false, reason: 'empty-snapshot' };
    }

    const dir = config.backupFolder || path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const fileName = buildAutoBackupFileName(new Date());
    fs.writeFileSync(path.join(dir, fileName), snapStr, 'utf8');
    saveConfig({ lastAutoBackup: new Date().toISOString() });

    const pruned = pruneAutoBackups(dir, keepCount, fs);
    log(diagnostics, 'info', 'auto-backup', `file=${fileName} pruned=${pruned}`);
    return { ran: true, file: fileName, pruned };
  } catch (e) {
    log(diagnostics, 'error', 'auto-backup-failed', e && e.message ? String(e.message) : 'unknown');
    return { ran: false, reason: 'error' };
  }
}

module.exports = {
  buildAutoBackupFileName,
  shouldRunStartupBackup,
  pruneAutoBackups,
  runStartupAutoBackup,
  LOCALSTORAGE_BACKUP_KEYS,
  AUTO_BACKUP_PATTERN,
};
