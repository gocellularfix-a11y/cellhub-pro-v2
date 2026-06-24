// ============================================================
// CellHub Pro — Secondary LAN mirror failover persistence (R-SECONDARY-FAILOVER-PERSIST)
//
// A LAN Secondary holds the Primary's mirror in MEMORY only — on restart it is
// lost until the Primary is reachable again. This module persists the LATEST
// received snapshot to disk so the Secondary retains the last known Primary
// state across restarts.
//
// WRITE-ONLY foundation. This round does NOT restore and does NOT promote — it
// only saves. Atomic write (temp file + rename). Latest snapshot only
// (overwrites). Never throws; a failed write logs a warning and is otherwise
// a no-op so the Secondary UI keeps working from memory exactly as before.
// ============================================================

const path = require('path');
const fs = require('fs');

const SCHEMA_VERSION = 1;

/**
 * Pure: wrap a snapshot payload in the deterministic failover envelope.
 * `savedAtIso` is injected (deterministic for tests).
 */
function buildFailoverEnvelope(snapshot, savedAtIso, appVersion) {
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: savedAtIso,
    sourceRole: 'primary',
    targetRole: 'secondary',
    appVersion: appVersion || 'unknown',
    snapshot: snapshot === undefined ? null : snapshot,
  };
}

/** Failover directory under userData. */
function getMirrorDir(appLike) {
  return path.join(appLike.getPath('userData'), 'mirror');
}

/**
 * Persist the latest Primary snapshot atomically to
 * userData/mirror/primary-snapshot.json. Write-only, latest-only, never throws.
 * Returns a controlled result. NO restore, NO promotion.
 */
function saveMirrorSnapshot(appLike, snapshot, appVersion) {
  try {
    if (!appLike || typeof appLike.getPath !== 'function') return { ok: false, reason: 'no-app' };
    if (snapshot === undefined || snapshot === null) return { ok: false, reason: 'no-data' };
    const dir = getMirrorDir(appLike);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const finalPath = path.join(dir, 'primary-snapshot.json');
    const tmpPath = `${finalPath}.tmp`;
    const envelope = buildFailoverEnvelope(snapshot, new Date().toISOString(), appVersion);
    // Atomic: write temp, then rename over the final path (same volume).
    fs.writeFileSync(tmpPath, JSON.stringify(envelope), 'utf8');
    fs.renameSync(tmpPath, finalPath);
    return { ok: true, path: finalPath };
  } catch (e) {
    // Never throw — log a warning only; the Secondary keeps working from memory.
    try { console.warn('[mirrorFailover] save failed:', e && e.message ? e.message : e); } catch (_e) { /* noop */ }
    return { ok: false, reason: 'error' };
  }
}

module.exports = { buildFailoverEnvelope, getMirrorDir, saveMirrorSnapshot, SCHEMA_VERSION };
