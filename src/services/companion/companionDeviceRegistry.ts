// ============================================================
// CellHub Pro — Companion Device Registry Shell
// (R-COMPANION-DEVICE-REGISTRY-V1)
//
// In-memory roster of every Companion device the desktop has seen.
// The bridge connection layer (companionBridgeConnection) owns the
// SINGLE "currently paired" device; this registry owns the broader
// LIST — including remembered devices that are not currently
// connected.
//
// Cero networking. Cero persistence. Future rounds swap the internal
// Map for a persisted store (localStorage / Capacitor Preferences)
// behind the same subscribeRegistry surface, so consumers stay
// stable through the transition.
// ============================================================

import type {
  CompanionDeviceHealth,
  CompanionDevicePlatform,
  CompanionDeviceRegistryListener,
  CompanionDeviceRegistrySnapshot,
  CompanionRegisteredDevice,
} from './companionTypes';

// ── Module-private state ──────────────────────────────────

const devices = new Map<string, CompanionRegisteredDevice>();
let activeDeviceId: string | null = null;
const listeners = new Set<CompanionDeviceRegistryListener>();

// ── Helpers ──────────────────────────────────────────────

function sortedDevices(): CompanionRegisteredDevice[] {
  // Most-recently-active first. Copy (spread) so callers can't mutate
  // module state by mutating array entries.
  return Array.from(devices.values())
    .map((d) => ({ ...d }))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function buildSnapshot(): CompanionDeviceRegistrySnapshot {
  return {
    devices: sortedDevices(),
    activeDeviceId,
  };
}

function notify(): void {
  const snap = buildSnapshot();
  listeners.forEach((listener) => {
    try { listener(snap); } catch (err) {
      console.warn('[companion-registry] listener threw', err);
    }
  });
}

// ── Public API ────────────────────────────────────────────

export interface RegisterDeviceInput {
  deviceId: string;
  deviceName: string;
  platform: CompanionDevicePlatform;
  /** Defaults to false. Trusted devices reconnect without re-pairing
   *  in future rounds — today the flag is informational only. */
  trusted?: boolean;
  /** Defaults to 'good' on register. */
  health?: CompanionDeviceHealth;
}

/**
 * Register a freshly-connected device, or update an existing entry
 * if the deviceId is already known. Either way the device ends up in
 * status='connected' and becomes the activeDeviceId. Returns the
 * resulting registered-device snapshot.
 */
export function registerDevice(input: RegisterDeviceInput): CompanionRegisteredDevice {
  const now = Date.now();
  const existing = devices.get(input.deviceId);
  const next: CompanionRegisteredDevice = {
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    platform: input.platform,
    status: 'connected',
    connectedAt: existing ? existing.connectedAt : now,
    lastSeenAt: now,
    trusted: input.trusted ?? existing?.trusted ?? false,
    health: input.health ?? 'good',
  };
  devices.set(input.deviceId, next);
  activeDeviceId = input.deviceId;
  notify();
  return { ...next };
}

/** Remove a device from the registry. Clears activeDeviceId if it was
 *  pointing at this entry. No-op when the id isn't registered. */
export function removeDevice(deviceId: string): void {
  if (!devices.has(deviceId)) return;
  devices.delete(deviceId);
  if (activeDeviceId === deviceId) activeDeviceId = null;
  notify();
}

/** Promote an existing entry to the active device. Status flips to
 *  'connected' and lastSeenAt bumps. No-op when the id is unknown. */
export function setActiveDevice(deviceId: string): void {
  const existing = devices.get(deviceId);
  if (!existing) return;
  devices.set(deviceId, {
    ...existing,
    status: 'connected',
    lastSeenAt: Date.now(),
    health: 'good',
  });
  activeDeviceId = deviceId;
  notify();
}

/** Mark a specific device disconnected. Defaults to the active one. */
export function markDeviceDisconnected(deviceId?: string): void {
  const id = deviceId ?? activeDeviceId;
  if (!id) return;
  const existing = devices.get(id);
  if (!existing) return;
  devices.set(id, {
    ...existing,
    status: 'disconnected',
    lastSeenAt: Date.now(),
    health: 'offline',
  });
  if (activeDeviceId === id) activeDeviceId = null;
  notify();
}

/** Heartbeat-style update — bumps lastSeenAt and refreshes health. */
export function touchDevice(deviceId: string, health: CompanionDeviceHealth = 'good'): void {
  const existing = devices.get(deviceId);
  if (!existing) return;
  devices.set(deviceId, {
    ...existing,
    lastSeenAt: Date.now(),
    health,
  });
  notify();
}

/** Mark trust on an existing device (true/false). No-op when unknown. */
export function setDeviceTrusted(deviceId: string, trusted: boolean): void {
  const existing = devices.get(deviceId);
  if (!existing) return;
  if (existing.trusted === trusted) return;
  devices.set(deviceId, { ...existing, trusted });
  notify();
}

/** Snapshot of the registry. Always a copy — callers cannot mutate
 *  module state. */
export function getRegistrySnapshot(): CompanionDeviceRegistrySnapshot {
  return buildSnapshot();
}

/** Subscribe to registry changes. Returns an unsubscribe handle. */
export function subscribeRegistry(listener: CompanionDeviceRegistryListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
