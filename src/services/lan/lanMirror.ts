// ============================================================
// CellHub Pro — LAN Secondary Mirror status (LOCAL-LAN-SECONDARY-HYDRATION-V1)
//
// Tiny pub/sub store describing the read-only mirror state on a Secondary.
// The global <LanSecondaryMirror> writes it; the global <LanMirrorBanner> and
// the Settings → Local Network panel read it. Pure in-memory — never persists,
// never touches business state.
// ============================================================

// LAN-CONNECTION-STATE-UX-V1: coarse connection state the banner/panel key off,
// so a failed background poll reads as "offline (cached)" instead of a
// perpetual "syncing…" spinner.
//   connecting  — trying, no successful sync yet (first connect / waiting, no cache)
//   connected   — last fetch succeeded; live mirror
//   offline     — fetch failing but we have cached data to keep showing
//   reconnected — transient success right after being offline (settles → connected)
export type LanConnState = 'connecting' | 'connected' | 'offline' | 'reconnected';

export interface LanMirrorStatus {
  active: boolean;            // true while this machine is a connected Secondary mirror
  syncing: boolean;          // a snapshot fetch is in flight (internal; UI keys off connState)
  connState: LanConnState;   // LAN-CONNECTION-STATE-UX-V1
  lastSyncAt: number | null; // ms of the last successful hydration
  stale: boolean;            // Primary reported its snapshot as stale
  primaryName: string | null;
  error: string | null;      // last fetch error code, or null
}

let status: LanMirrorStatus = {
  active: false,
  syncing: false,
  connState: 'connecting',
  lastSyncAt: null,
  stale: false,
  primaryName: null,
  error: null,
};

const subscribers = new Set<(s: LanMirrorStatus) => void>();

export function getMirrorStatus(): LanMirrorStatus {
  return status;
}

export function setMirrorStatus(patch: Partial<LanMirrorStatus>): void {
  status = { ...status, ...patch };
  subscribers.forEach((cb) => { try { cb(status); } catch { /* ignore */ } });
}

/** Subscribe to mirror-status changes. Fires once immediately. Returns an
 *  unsubscribe fn. */
export function subscribeMirror(cb: (s: LanMirrorStatus) => void): () => void {
  subscribers.add(cb);
  try { cb(status); } catch { /* ignore */ }
  return () => { subscribers.delete(cb); };
}
