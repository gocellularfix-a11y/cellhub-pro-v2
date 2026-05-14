// ============================================================
// CellHub Pro — Companion Runtime Mount
// (R-COMPANION-RUNTIME-GLOBAL-MOUNT-V1)
//
// Globally-mounted, render-nothing component that owns the
// Companion bridge adapter lifecycle AND the live store snapshot
// emit. Previously these effects lived inside CompanionCenter,
// which is lazy-mounted by AppShell only when the user is on the
// Companion tab. Result: leaving the tab tore down the bridge and
// stopped pushing snapshots to the mobile Companion — values
// appeared as zeros on the phone whenever the operator was on POS,
// Inventory, Dashboard, etc.
//
// This mount keeps the bridge alive and the dashboard:stats_updated
// stream flowing for the whole desktop session. CompanionCenter
// keeps its UI (status pill, panels) reading the same global
// snapshot — it just no longer owns the lifecycle.
//
// Cero new transport logic. Cero refactor of existing services.
// Additive: one mount + two effects moved up the tree.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import {
  startCompanionBridgeAdapter,
  stopCompanionBridgeAdapter,
  getBridgeAdapterStatus,
  emitStoreSnapshot,
} from '@/services/companion/companionBridgeAdapter';
import {
  getConnectionSnapshot,
  subscribeConnectionSnapshot,
} from '@/services/companion/companionBridgeConnection';
import {
  getApprovalRuntimeSnapshot,
  subscribeApprovalRuntime,
} from '@/services/companion/companionApprovalRuntime';
import { getDesktopIdentity } from '@/services/license/desktopIdentity';
import { mintDesktopBridgeToken } from '@/services/companion/bridgeSignedToken';
// R-COMPANION-SNAPSHOT-AGGREGATOR-V1 — canonical store snapshot math.
import { computeCompanionStoreSnapshot } from '@/services/companion/companionSnapshotAggregator';
import type { PosBridgeStatus } from '@/services/companion/sdk/posBridgeClient';
import type {
  CompanionApprovalRuntimeSnapshot,
  CompanionBridgeSnapshot,
} from '@/services/companion/companionTypes';

export default function CompanionRuntimeMount() {
  const { state: { settings, employees, currentEmployee, currentStoreId, sales, repairs } } = useApp();

  const bridgeEnabled = ((settings as unknown as { companionBridgeEnabled?: boolean }).companionBridgeEnabled) === true;
  const bridgeUrl     = ((settings as unknown as { companionBridgeUrl?: string }).companionBridgeUrl) || 'https://cellhub-companion-production.up.railway.app';

  // Mirror the bridge connection snapshot so we react to pairing /
  // disconnect events the same way CompanionCenter does. Subscription
  // is module-singleton so this is safe regardless of remount order.
  const [snapshot, setSnapshot] = useState<CompanionBridgeSnapshot>(() => getConnectionSnapshot());
  useEffect(() => {
    const unsub = subscribeConnectionSnapshot((s) => setSnapshot(s));
    return () => { unsub(); };
  }, []);
  const companionConnState = snapshot.connectionState;

  // Mirror the bridge adapter PosBridgeStatus into local state via the
  // same 1s polling pattern CompanionCenter uses. Polling is required
  // because the SDK status comes from createPosBridgeClient internals
  // and there's no exported observable for it here.
  const [bridgeStatus, setBridgeStatus] = useState<PosBridgeStatus>(() => getBridgeAdapterStatus());
  useEffect(() => {
    const sync = () => setBridgeStatus(getBridgeAdapterStatus());
    sync();
    const handle = setInterval(sync, 1000);
    return () => clearInterval(handle);
  }, []);

  // Approval runtime — pending count feeds the store snapshot. Listening
  // here keeps the snapshot emit reactive to APPROVAL_CREATED /
  // APPROVED / DENIED events regardless of whether CompanionCenter
  // is mounted.
  const [approvalRuntime, setApprovalRuntime] = useState<CompanionApprovalRuntimeSnapshot>(() => getApprovalRuntimeSnapshot());
  useEffect(() => {
    const unsub = subscribeApprovalRuntime((s) => setApprovalRuntime(s));
    return () => { unsub(); };
  }, []);

  // R-COMPANION-SNAPSHOT-AGGREGATOR-V1 — single source of truth.
  // Uses canonical helpers (isToday, normalizeRepairStatus) and
  // currentEmployee as the on-shift signal so values match Dashboard
  // and never zero out from a missing clockLog write.
  const storeSnapshot = useMemo(() => computeCompanionStoreSnapshot({
    sales,
    repairs,
    employees,
    currentEmployee: currentEmployee ?? null,
    pendingApprovalsCount: approvalRuntime.pendingCount,
  }), [sales, repairs, employees, currentEmployee, approvalRuntime.pendingCount]);

  // ── Bridge adapter lifecycle ──────────────────────────────
  // Start when (a) the bridge connection shell has a paired device AND
  // (b) settings.companionBridgeEnabled is true. Stop in every other
  // case so disconnect/reconnect cycles propagate cleanly.
  useEffect(() => {
    let cancelled = false;

    if (companionConnState === 'connected' && bridgeEnabled) {
      const identity = getDesktopIdentity();
      if (!identity || !identity.desktopDeviceId || !identity.storeId) {
        console.warn('[CompanionRuntimeMount] missing desktop identity — bridge registration skipped');
      } else {
        void mintDesktopBridgeToken({ storeId: identity.storeId, deviceId: identity.desktopDeviceId })
          .then(authToken => {
            if (cancelled) return;
            console.info(`[CompanionRuntimeMount] registering desktopDeviceId=${identity.desktopDeviceId} storeId=${identity.storeId}`);
            startCompanionBridgeAdapter({
              bridgeUrl,
              storeId: identity.storeId,
              deviceId: identity.desktopDeviceId,
              authToken,
              getEmployeeName: (id) => (employees.find((e) => e.id === id)?.name) || '',
              getStoreLocation: () => settings.storeAddress || '',
            });
          });
      }
    } else {
      stopCompanionBridgeAdapter();
    }

    return () => {
      cancelled = true;
      stopCompanionBridgeAdapter();
    };
  }, [companionConnState, bridgeEnabled, bridgeUrl, settings.storeAddress, employees]);

  // ── Live store snapshot emit ──────────────────────────────
  // Push dashboard:stats_updated to mobile whenever bridge is up and
  // any tracked value changes. Fires immediately on connect so the
  // mobile gets real values right away.
  useEffect(() => {
    if (bridgeStatus !== 'connected') return;
    emitStoreSnapshot({
      todayRevenueCents: storeSnapshot.todayRevenueCents,
      todaySalesCount: storeSnapshot.todaySalesCount,
      openRepairsCount: storeSnapshot.openRepairsCount,
      clockedInCount: storeSnapshot.clockedInCount,
      clockedInNames: storeSnapshot.clockedInNames,
      pendingApprovalsCount: storeSnapshot.pendingApprovalsCount,
      // R-COMPANION-SNAPSHOT-STORE-ID-FIX-V1: use the SAME storeId the
      // bridge registered with (getDesktopIdentity().storeId), NOT the
      // app-state currentStoreId. They can drift — the bridge server
      // routes by registered room and may reject (or kick the socket)
      // when the payload's storeId doesn't match the registered one.
      storeId: getDesktopIdentity()?.storeId || currentStoreId || '',
      updatedAt: new Date().toISOString(),
    });
  }, [bridgeStatus, storeSnapshot, currentStoreId]);

  return null;
}
