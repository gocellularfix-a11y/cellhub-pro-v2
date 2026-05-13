// ============================================================
// CellHub Pro — Companion Bridge Connection Shell
// (R-COMPANION-BRIDGE-CONNECTION-V1)
//
// Higher-level pairing + device lifecycle layered on top of
// companionMockBridge. The bridge already tracks a
// CompanionConnectionState (disconnected / connecting / connected)
// for the event-queue transport; this file adds the surrounding
// device + pairing context the future Companion mobile app will
// populate when it really connects.
//
// Cero networking. Cero persistence. Cero new dependencies. Every
// action is in-memory and mock — a future round swaps the internals
// for a real transport behind the same subscribeConnectionSnapshot
// surface, so consumers don't have to change.
// ============================================================

import { generateId } from '@/utils/dates';
import {
  getConnectionState as getBridgeState,
  setConnectionState as setBridgeState,
  subscribeConnectionState as subscribeBridgeState,
} from './companionMockBridge';
// R-COMPANION-DEVICE-REGISTRY-V1: when the bridge accepts or releases
// a device, mirror that into the registry so the device-roster
// surface stays consistent with the "currently paired" pointer.
import {
  markDeviceDisconnected as registryMarkDisconnected,
  registerDevice as registryRegisterDevice,
} from './companionDeviceRegistry';
import type {
  CompanionBridgeMode,
  CompanionBridgeSnapshot,
  CompanionBridgeSnapshotListener,
  CompanionDevicePlatform,
  CompanionPairedDevice,
  CompanionPairingSession,
} from './companionTypes';

// ── Module-private state ──────────────────────────────────

let mode: CompanionBridgeMode = 'mock';
let pairingSession: CompanionPairingSession | null = null;
let pairedDevice: CompanionPairedDevice | null = null;
let lastConnectedAt: number | null = null;

const snapshotListeners = new Set<CompanionBridgeSnapshotListener>();

// ── Helpers ──────────────────────────────────────────────

function generatePin(): string {
  // Mock-only — pairing PINs never persist, never travel a network.
  // Mirrors the existing CompanionCenter pairing modal helper so the
  // dev experience matches.
  return String(100000 + Math.floor(Math.random() * 900000));
}

function buildSnapshot(): CompanionBridgeSnapshot {
  return {
    mode,
    connectionState: getBridgeState(),
    pairingSession: pairingSession ? { ...pairingSession } : null,
    pairedDevice: pairedDevice ? { ...pairedDevice } : null,
    lastConnectedAt,
  };
}

function notifySnapshot(): void {
  const snap = buildSnapshot();
  snapshotListeners.forEach((listener) => {
    try { listener(snap); } catch (err) {
      console.warn('[companion-bridge-connection] listener threw', err);
    }
  });
}

// ── Public API ────────────────────────────────────────────

/**
 * Start a mock pairing session. Idempotent: a second call while a
 * session is open returns the existing session instead of clobbering.
 * The bridge connection state moves to 'connecting' so consumers
 * subscribed to the lower-level state see the in-flight handshake.
 */
export function startPairingSession(opts?: { pin?: string }): CompanionPairingSession {
  if (pairingSession) return pairingSession;
  const now = Date.now();
  pairingSession = {
    sessionId: generateId(),
    pin: opts?.pin || generatePin(),
    startedAt: now,
    expiresAt: now + 5 * 60 * 1_000, // 5-minute pairing window
    phase: 'waiting',
  };
  // Move the lower transport to 'connecting' if we don't already have
  // a paired device — re-pair flows from a connected state shouldn't
  // visually drop the link in the dev panel.
  if (!pairedDevice) setBridgeState('connecting');
  notifySnapshot();
  return pairingSession;
}

/** Cancel an in-flight pairing session. No-op when none is open. */
export function cancelPairingSession(): void {
  if (!pairingSession) return;
  pairingSession = null;
  // If no device is paired, fall back to 'disconnected'. If one is
  // paired (re-pair scenario), keep the existing 'connected' state.
  if (!pairedDevice) setBridgeState('disconnected');
  notifySnapshot();
}

export interface MockConnectInput {
  deviceId?: string;
  deviceName?: string;
  platform?: CompanionDevicePlatform;
}

/**
 * Mock-connect a device. Closes any open pairing session, replaces
 * the current paired device, advances the bridge connection state.
 * Returns the resulting CompanionPairedDevice snapshot.
 *
 * R-COMPANION-DEVICE-REGISTRY-V1: also registers (or updates) the
 * device in the registry so the broader roster stays in sync with
 * the bridge's "currently paired" pointer.
 */
export function mockConnectDevice(input: MockConnectInput = {}): CompanionPairedDevice {
  const now = Date.now();
  pairedDevice = {
    deviceId: input.deviceId || generateId(),
    deviceName: input.deviceName || 'Companion Device',
    platform: input.platform || 'unknown',
    connectedAt: now,
    lastSeenAt: now,
    status: 'connected',
  };
  lastConnectedAt = now;
  pairingSession = null;
  // Mirror into the registry BEFORE the bridge-state flip so a
  // listener that reacts to 'connected' sees the registry entry
  // already present.
  registryRegisterDevice({
    deviceId: pairedDevice.deviceId,
    deviceName: pairedDevice.deviceName,
    platform: pairedDevice.platform,
  });
  setBridgeState('connected');
  notifySnapshot();
  return pairedDevice;
}

export interface ConfirmPairedDeviceInput {
  deviceId: string;
  deviceName?: string;
  platform?: CompanionDevicePlatform;
}

/**
 * Confirm a real bridge-claimed device as paired.
 * Real-pairing sibling of mockConnectDevice — same internal state
 * mutation but with a required deviceId from the bridge claim response.
 */
export function confirmPairedDevice(input: ConfirmPairedDeviceInput): CompanionPairedDevice {
  return mockConnectDevice({
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    platform: input.platform,
  });
}

/**
 * Mock-disconnect the currently paired device. No-op when none.
 *
 * R-COMPANION-DEVICE-REGISTRY-V1: also marks the device disconnected
 * in the registry (it stays in the roster — removeDevice is a
 * separate explicit action).
 */
export function mockDisconnectDevice(): void {
  if (!pairedDevice) return;
  const goingId = pairedDevice.deviceId;
  pairedDevice = null;
  registryMarkDisconnected(goingId);
  setBridgeState('disconnected');
  notifySnapshot();
}

/** Heartbeat-style update — bumps lastSeenAt on the paired device. */
export function touchPairedDevice(): void {
  if (!pairedDevice) return;
  pairedDevice = { ...pairedDevice, lastSeenAt: Date.now() };
  notifySnapshot();
}

/** Snapshot of the current bridge connection state. Caller-friendly
 *  shallow copy — mutating the result does not mutate module state. */
export function getConnectionSnapshot(): CompanionBridgeSnapshot {
  return buildSnapshot();
}

/**
 * Subscribe to snapshot changes. Returns an unsubscribe handle so
 * React consumers can clean up in useEffect.
 */
export function subscribeConnectionSnapshot(
  listener: CompanionBridgeSnapshotListener,
): () => void {
  snapshotListeners.add(listener);
  return () => { snapshotListeners.delete(listener); };
}

/** Switch the bridge mode (mock / local / future). UI-only signal. */
export function setBridgeMode(next: CompanionBridgeMode): void {
  if (next === mode) return;
  mode = next;
  notifySnapshot();
}

// ── Cross-layer wiring ────────────────────────────────────
// Module-singleton subscription that re-broadcasts every low-level
// CompanionConnectionState change as a snapshot update. Without this,
// callers that flip the bridge state directly (e.g. the dev panel's
// "Toggle connection" button in CompanionCenter) would update
// subscribeConnectionState listeners but NOT the snapshot listeners,
// leaving the bridge connection snapshot stale.
subscribeBridgeState(() => {
  notifySnapshot();
});
