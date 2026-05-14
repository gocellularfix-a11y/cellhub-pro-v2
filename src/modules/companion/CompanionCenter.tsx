// ============================================================
// CellHub Pro — Companion Center (R-COMPANION-CENTER-V1)
// + R-COMPANION-PAIRING-MOCK-V1
//
// UI shell + mock pairing flow. Cero backend, cero sync logic. Every
// state surfaced here is local React state so the shell can ship now
// and progressively wire up real plumbing later.
//
// Mobile companion is NOT a full POS. It is a remote-assist /
// approval-from-phone surface. Anything that would mutate cart /
// payment / inventory stays Desktop/Web.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import Modal from '@/components/ui/Modal';
import {
  emit as emitCompanionEvent,
  getLastEvent as getLastCompanionEvent,
  subscribeAll as subscribeAllCompanionEvents,
} from '@/services/companion/companionEventBus';
import {
  getQueueSize as getCompanionQueueSize,
  setConnectionState as setCompanionConnectionState,
} from '@/services/companion/companionMockBridge';
// R-COMPANION-PAIRING-WIRED-V1: the pairing/device UI now reads from
// the bridge connection shell instead of isolated local mock state.
// R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1: confirmPairedDevice is the
// real-claim sibling of mockConnectDevice (latter stays for diagnostics).
import {
  cancelPairingSession,
  confirmPairedDevice,
  getConnectionSnapshot,
  mockConnectDevice,
  mockDisconnectDevice,
  startPairingSession,
  subscribeConnectionSnapshot,
} from '@/services/companion/companionBridgeConnection';
// R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1: bridge pairing HTTP client.
import {
  submitPairingOffer,
  pollPairingStatus,
  revokePairingOffer,
  buildPairingQrPayload,
} from '@/services/companion/pairingClient';
import QRCode from 'qrcode';
// R-COMPANION-RUNTIME-TEST-PANEL-V1: dev panel that exercises the
// inbox + receiver triplet end-to-end before any real producer exists.
import {
  clearHandledActions,
  getInboxSnapshot,
  getPendingActions,
  submitAction,
  subscribeActionInbox,
} from '@/services/companion/companionActionInbox';
import { processApprovalAction } from '@/services/companion/receivers/approvalActionReceiver';
import { processMessagingAction } from '@/services/companion/receivers/messagingActionReceiver';
import { processIntelligenceAck } from '@/services/companion/receivers/intelligenceAckReceiver';
// R-COMPANION-BRIDGE-WIRE-V1: outbound bridge adapter lifecycle. Adapter
// itself owns singleton guards — start/stop are idempotent so this
// useEffect can re-run safely under remount + setting changes.
// R-COMPANION-BRIDGE-STATUS-BADGE-V1: also pull the snapshot getter so a
// small status pill can mirror PosBridgeClient state in the UI.
import {
  startCompanionBridgeAdapter,
  stopCompanionBridgeAdapter,
  getBridgeAdapterStatus,
  sendCompanionMessage,
} from '@/services/companion/companionBridgeAdapter';
import {
  generateCompanionAlerts,
} from '@/services/companion/companionAlertProducer';
import { emitIntelligenceAlertCreated } from '@/services/companion/emitters/intelligenceEmitter';
import type { PosBridgeStatus } from '@/services/companion/sdk/posBridgeClient';
import { useApp } from '@/store/AppProvider';
// R-COMPANION-APPROVAL-RUNTIME-V1: read model over approval events.
import {
  getApprovalRuntimeSnapshot,
  subscribeApprovalRuntime,
} from '@/services/companion/companionApprovalRuntime';
// R-COMPANION-MESSAGING-RUNTIME-V1: read model over messaging events.
import {
  getMessagingRuntimeSnapshot,
  subscribeMessagingRuntime,
} from '@/services/companion/companionMessagingRuntime';
// R-COMPANION-STORE-STATUS-RUNTIME-V1: read model over store-status events.
import {
  getStoreStatusRuntimeSnapshot,
  subscribeStoreStatusRuntime,
} from '@/services/companion/companionStoreStatusRuntime';
import type {
  CompanionActionInboxSnapshot,
  CompanionApprovalRuntimeSnapshot,
  CompanionBridgeSnapshot,
  CompanionDevicePlatform,
  CompanionEvent,
  CompanionMessagingRuntimeSnapshot,
  CompanionStoreStatusRuntimeSnapshot,
} from '@/services/companion/companionTypes';
// R-COMPANION-DESKTOP-IDENTITY-BRIDGE-V1 / R-BRIDGE-SIGNED-TOKEN-V1
import { getDesktopIdentity } from '@/services/license/desktopIdentity';
import { mintDesktopBridgeToken } from '@/services/companion/bridgeSignedToken';

type CardStatus = 'not_connected' | 'pairing' | 'connected_soon' | 'coming_soon';

interface CardSpec {
  id: string;
  titleKey: string;
  bodyKey: string;
  icon: string;
  /** Default mock status when no pairing flow has touched the card. */
  defaultStatus: CardStatus;
}

// Mock catalogue — all six cards live in this list so the shell stays
// flat and additions/removals are one-line.
const CARDS: CardSpec[] = [
  { id: 'connect',     titleKey: 'companion.card.connect.title',     bodyKey: 'companion.card.connect.body',     icon: '🔗',  defaultStatus: 'not_connected' },
  { id: 'pair',        titleKey: 'companion.card.pair.title',        bodyKey: 'companion.card.pair.body',        icon: '📲', defaultStatus: 'not_connected' },
  { id: 'approvals',   titleKey: 'companion.card.approvals.title',   bodyKey: 'companion.card.approvals.body',   icon: '✅', defaultStatus: 'coming_soon' },
  { id: 'storeStatus', titleKey: 'companion.card.storeStatus.title', bodyKey: 'companion.card.storeStatus.body', icon: '🏪', defaultStatus: 'coming_soon' },
  { id: 'messaging',   titleKey: 'companion.card.messaging.title',   bodyKey: 'companion.card.messaging.body',   icon: '💬', defaultStatus: 'coming_soon' },
  { id: 'health',      titleKey: 'companion.card.health.title',      bodyKey: 'companion.card.health.body',      icon: '📡', defaultStatus: 'coming_soon' },
];

// R-COMPANION-CENTER-UX-REDESIGN-V2: Quick-Actions-style tile palette.
// Each card gets its own gradient + rim + label colour so the grid
// reads as six distinct surfaces instead of one repeating template.
const CARD_PALETTE: Record<string, { bg: string; border: string; label: string }> = {
  connect:     { bg: 'linear-gradient(160deg, #1a1460 0%, #0f0c3a 100%)', border: '1.5px solid #2d2580', label: '#818cf8' },
  pair:        { bg: 'linear-gradient(160deg, #0e2150 0%, #081530 100%)', border: '1.5px solid #1a3a80', label: '#60a5fa' },
  approvals:   { bg: 'linear-gradient(160deg, #2a0f0f 0%, #1e0a0a 100%)', border: '1.5px solid #4a1515', label: '#f87171' },
  storeStatus: { bg: 'linear-gradient(160deg, #0a2e2a 0%, #061e1a 100%)', border: '1.5px solid #0f4a40', label: '#2dd4bf' },
  messaging:   { bg: 'linear-gradient(160deg, #200d50 0%, #140830 100%)', border: '1.5px solid #3a1880', label: '#c084fc' },
  health:      { bg: 'linear-gradient(160deg, #082030 0%, #041318 100%)', border: '1.5px solid #0a3850', label: '#22d3ee' },
};
const CARD_PALETTE_FALLBACK = CARD_PALETTE.connect;

// R-COMPANION-CENTER-UX-REDESIGN-V2: dynamic styles (hover + keyframe)
// live in a single injected stylesheet so inline style stays the
// source of truth for everything else. Idempotent via id check —
// mounts once for the lifetime of the page.
const CARD_STYLE_ID = 'cellhub-companion-card-styles-v2';
function ensureCompanionCardStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(CARD_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = CARD_STYLE_ID;
  el.textContent = `
@keyframes cellhubCompanionApprovalBadgePulse {
  0%, 100% { box-shadow: 0 0 0 rgba(251,191,36,0.0); }
  50%      { box-shadow: 0 0 14px rgba(251,191,36,0.65); }
}
div[data-cellhub-companion-card="true"]:hover:not([data-coming-soon="true"]) {
  transform: scale(1.03);
  filter: brightness(1.12);
}
`;
  document.head.appendChild(el);
}

function statusPalette(s: CardStatus): { label: string; bg: string; border: string; color: string } {
  switch (s) {
    case 'pairing':
      return { label: 'companion.statusBanner.pairing',      bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)', color: '#fbbf24' };
    case 'connected_soon':
      return { label: 'companion.statusBanner.connected',    bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.35)',  color: '#86efac' };
    case 'coming_soon':
      return { label: 'companion.statusBanner.comingSoon',   bg: 'rgba(167,139,250,0.12)',border: 'rgba(167,139,250,0.35)',color: '#c4b5fd' };
    case 'not_connected':
    default:
      return { label: 'companion.statusBanner.notConnected', bg: 'rgba(148,163,184,0.10)',border: 'rgba(148,163,184,0.25)',color: '#cbd5e1' };
  }
}

// ── Pairing animation type ────────────────────────────────
// R-COMPANION-PAIRING-WIRED-V1: device/session shapes now come from
// the bridge connection shell (CompanionPairedDevice +
// CompanionPairingSession in companionTypes). PairingPhase remains
// local because it only drives the in-modal animation between
// 'waiting' → 'pending' → 'connected' — the bridge service doesn't
// model that sub-state and shouldn't (it's a UX detail).
type PairingPhase = 'waiting' | 'pending' | 'connected';

// Deterministic-from-PIN visual stand-in for a real QR code. 13×13
// grid with three solid 3×3 corner finders + noisy interior derived
// from the PIN, so each pairing session shows a different pattern
// without ever generating a scannable code.
function MockQR({ pin }: { pin: string }) {
  const SIZE = 13;
  const seed = (parseInt(pin || '0', 10) || 1) >>> 0;
  let prng = seed || 1;
  const nextBit = (): boolean => {
    prng = (prng * 1103515245 + 12345) >>> 0;
    return ((prng >>> 16) & 1) === 1;
  };
  const isCornerFinder = (x: number, y: number): boolean => {
    // Three 3×3 solid squares — visual locator stand-in.
    const corners: Array<[number, number]> = [[0, 0], [SIZE - 3, 0], [0, SIZE - 3]];
    for (const [cx, cy] of corners) {
      if (x >= cx && x < cx + 3 && y >= cy && y < cy + 3) return true;
    }
    return false;
  };
  const cells: boolean[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    cells.push(isCornerFinder(x, y) ? true : nextBit());
  }
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${SIZE}, 1fr)`,
        gap: 0,
        width: 180,
        height: 180,
        background: '#fff',
        padding: 6,
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        boxSizing: 'content-box',
      }}
    >
      {cells.map((on, i) => (
        <div key={i} style={{ background: on ? '#000' : '#fff' }} />
      ))}
    </div>
  );
}

// R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1 — Real scannable QR. The
// payload is the URL-style string built by buildPairingQrPayload; the
// mobile companion app parses it to extract bridgeUrl, storeId, code,
// role, exp.
function RealPairingQR({ payload }: { payload: string }) {
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    if (!payload) { setSrc(''); return undefined; }
    let cancelled = false;
    QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      color: { dark: '#000000', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setSrc(url);
    }).catch((err) => {
      console.warn('[CompanionCenter] QR generation failed', err);
    });
    return () => { cancelled = true; };
  }, [payload]);

  if (!src) {
    return (
      <div
        aria-label="Generating QR"
        style={{
          width: 180, height: 180,
          background: '#0f172a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8,
          color: '#475569', fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        Generating QR…
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Companion pairing QR code"
      width={180}
      height={180}
      style={{
        borderRadius: 8,
        padding: 6,
        background: '#fff',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        boxSizing: 'content-box',
        imageRendering: 'pixelated',
      }}
    />
  );
}

// ── R-APPROVAL-AUDIT-LOG-V1: pure helpers for the history feed ──

function auditActionLabel(actionType: string | undefined): string {
  switch (actionType) {
    case 'CANCEL_LAYAWAY':       return 'Layaway cancel';
    case 'CANCEL_REPAIR':        return 'Repair cancel';
    case 'CANCEL_UNLOCK':        return 'Unlock cancel';
    case 'CANCEL_SPECIAL_ORDER': return 'Special order cancel';
    case 'PRICE_OVERRIDE':       return 'Price override';
    case 'DISCOUNT_OVERRIDE':    return 'Discount';
    case 'REFUND':               return 'Refund';
    default:                     return actionType || 'Approval';
  }
}

function auditRelTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)   return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

function auditFmtAmt(cents: number | undefined): string {
  if (!cents || cents === 0) return '';
  return ` — $${(cents / 100).toFixed(2)}`;
}

// ── Main component ────────────────────────────────────────
export default function CompanionCenter() {
  const { t } = useTranslation();

  // R-COMPANION-BRIDGE-WIRE-V1: pull settings + employees for the adapter.
  // Cero store mutations from this component — read-only access.
  const { state: { settings, employees, currentEmployee, currentStoreId, sales, repairs, inventory, lang } } = useApp();
  const bridgeEnabled = ((settings as unknown as { companionBridgeEnabled?: boolean }).companionBridgeEnabled) === true;
  // R-BRIDGE-CLOUD-WIRING-V1 — default points at Railway-hosted bridge
  // so a fresh install just works. Users can still override the URL via
  // Settings → Companion → Bridge URL (e.g., for on-prem / dogfood).
  const bridgeUrl     = ((settings as unknown as { companionBridgeUrl?: string }).companionBridgeUrl) || 'https://cellhub-companion-production.up.railway.app';

  // R-COMPANION-BRIDGE-STATUS-BADGE-V1 — mirror the adapter's PosBridgeStatus
  // into local state. Polling uses the existing getBridgeAdapterStatus() with
  // a small interval so 'connecting' / 'reconnecting' transitions are visible
  // without missing them. Cero bridge logic changes — read-only snapshot.
  const [bridgeStatus, setBridgeStatus] = useState<PosBridgeStatus>(() => getBridgeAdapterStatus());
  useEffect(() => {
    const sync = () => setBridgeStatus(getBridgeAdapterStatus());
    sync();
    const handle = setInterval(sync, 1000);
    return () => clearInterval(handle);
  }, []);

  // R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1: pairing-countdown ticker.
  useEffect(() => {
    setNowMs(Date.now());
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  // R-COMPANION-PAIRING-WIRED-V1: snapshot subscription drives every
  // pairing + paired-device decision. Local animation phase remains
  // local because it's a UX-only sub-state of 'waiting'.
  const [snapshot, setSnapshot] = useState<CompanionBridgeSnapshot>(() => getConnectionSnapshot());
  const [localPhase, setLocalPhase] = useState<PairingPhase>('waiting');

  // R-COMPANION-EVENT-LAYER-V1: dev panel state mirrors the bus + bridge.
  // companionConnState now comes from snapshot.connectionState — one
  // subscription drives both surfaces.
  const [companionLastEvent, setCompanionLastEvent] = useState<CompanionEvent | null>(() =>
    getLastCompanionEvent()
  );
  const [companionQueue, setCompanionQueue] = useState<number>(() => getCompanionQueueSize());

  // R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1: 1-second ticker drives
  // the pairing-modal countdown without re-rendering CompanionCenter on
  // every animation frame. Stops when no pairing session is open.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // R-COMPANION-DESKTOP-PAIRING-FINAL-POLISH-V1: bridge offer outcome
  // tracked separately from the local pairing session so the modal can
  // distinguish "waiting for phone" (offer registered) from "bridge
  // unavailable / offer rejected".
  const [offerAccepted, setOfferAccepted] = useState<boolean>(false);
  const [offerError, setOfferError] = useState<string | null>(null);

  // R-COMPANION-RUNTIME-TEST-PANEL-V1: inbox snapshot for the dev
  // panel below. Cero touches to existing event-bus subscriptions.
  const [inboxSnap, setInboxSnap] = useState<CompanionActionInboxSnapshot>(() => getInboxSnapshot());

  // R-COMPANION-APPROVAL-RUNTIME-V1: read model snapshot driven by
  // APPROVAL_CREATED / APPROVED / DENIED events. Used by the
  // Approval Requests card body.
  const [approvalRuntime, setApprovalRuntime] = useState<CompanionApprovalRuntimeSnapshot>(() => getApprovalRuntimeSnapshot());

  // R-COMPANION-MESSAGING-RUNTIME-V1: read model snapshot driven by
  // MESSAGE_SENT / MESSAGE_RECEIVED / MESSAGE_READ events. Used by
  // the Messaging card body.
  const [messagingRuntime, setMessagingRuntime] = useState<CompanionMessagingRuntimeSnapshot>(() => getMessagingRuntimeSnapshot());
  // R-COMPANION-MESSAGING-SIMPLE-V1: chat input draft.
  const [msgDraft, setMsgDraft] = useState('');

  // R-COMPANION-INTELLIGENCE-LIVE-ALERTS-V1: run deterministic alert rules
  // every 5 minutes while bridge is connected. emitIntelligenceAlertCreated
  // feeds the companion event bus → bridge adapter → mobile feed. Producer
  // has built-in 30-min per-rule cooldown so the timer is safe to tick often.
  useEffect(() => {
    const run = () => {
      if (bridgeStatus !== 'connected') return;
      const alerts = generateCompanionAlerts({
        sales,
        repairs,
        inventory,
        pendingApprovalCount: approvalRuntime.pendingCount,
      });
      for (const a of alerts) {
        emitIntelligenceAlertCreated({
          alertId: `${a.configId}-${Date.now()}`,
          severity: a.severity,
          kind: a.configId,
          insightType: a.insightType,
          title: a.title,
          body: a.body,
        });
      }
    };
    run(); // fire immediately on mount / bridgeStatus change
    const handle = setInterval(run, 5 * 60 * 1000);
    return () => clearInterval(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeStatus, sales, repairs, inventory, approvalRuntime.pendingCount]);

  // R-COMPANION-STORE-STATUS-RUNTIME-V1: read model snapshot driven
  // by STORE_OPENED / STORE_CLOSED / STORE_STATUS_UPDATED events.
  // Used by the Store Status card body.
  const [storeStatusRuntime, setStoreStatusRuntime] = useState<CompanionStoreStatusRuntimeSnapshot>(() => getStoreStatusRuntimeSnapshot());

  useEffect(() => {
    // Bridge snapshot subscription — fires for pairing-session start/
    // cancel, mock-connect/disconnect, AND for any low-level bridge
    // state change (the singleton bridge in companionBridgeConnection
    // re-broadcasts those into the snapshot). One callback covers
    // connectionState, pairingSession, pairedDevice. Queue size is
    // refreshed here because 'connected' state drains the queue.
    const unsubSnap = subscribeConnectionSnapshot((snap) => {
      setSnapshot(snap);
      setCompanionQueue(getCompanionQueueSize());
    });
    const unsubEvents = subscribeAllCompanionEvents((e) => {
      setCompanionLastEvent(e);
      setCompanionQueue(getCompanionQueueSize());
    });
    const unsubInbox = subscribeActionInbox((s) => setInboxSnap(s));
    const unsubApprovals = subscribeApprovalRuntime((s) => setApprovalRuntime(s));
    const unsubMessaging = subscribeMessagingRuntime((s) => setMessagingRuntime(s));
    const unsubStoreStatus = subscribeStoreStatusRuntime((s) => setStoreStatusRuntime(s));
    // R-COMPANION-CENTER-UX-REDESIGN-V2: inject card hover + badge
    // pulse keyframes once. Idempotent.
    ensureCompanionCardStyles();
    return () => { unsubSnap(); unsubEvents(); unsubInbox(); unsubApprovals(); unsubMessaging(); unsubStoreStatus(); };
  }, []);

  // ── Derived flags from snapshot ───────────────────────
  const isPairingOpen = !!snapshot.pairingSession;
  const pairingPin = snapshot.pairingSession?.pin ?? '';
  const pairedDevice = snapshot.pairedDevice;
  const companionConnState = snapshot.connectionState;

  // R-COMPANION-STORE-STATUS-LIVE-V1: operational snapshot derived from live store state.
  const todayDateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, locale-independent
  const clockedInEmployees = useMemo(() =>
    employees.filter((e) => {
      if (!e.active) return false;
      const log = e.clockLog || [];
      if (log.length === 0) return false;
      return !log[log.length - 1].clockOut;
    }), [employees]);

  const todaySales = useMemo(() =>
    sales.filter((s) => {
      if (s.status !== 'completed') return false;
      try { return new Date(s.createdAt as string).toLocaleDateString('en-CA') === todayDateStr; }
      catch { return false; }
    }), [sales, todayDateStr]);

  const todayRevenueCents = useMemo(() =>
    todaySales.reduce((sum, s) => sum + (s.total || 0), 0), [todaySales]);

  const openRepairsCount = useMemo(() =>
    repairs.filter((r) => {
      const s = (r.status || '').toLowerCase().replace(/ /g, '_');
      return s !== 'picked_up' && s !== 'cancelled' && s !== 'refunded';
    }).length, [repairs]);

  // R-COMPANION-BRIDGE-WIRE-V1: adapter lifecycle. Starts only when both
  // (a) the local mock bridge state is 'connected' AND
  // (b) settings.companionBridgeEnabled is true.
  // Adapter is idempotent so re-runs from remounts / setting flips are
  // safe — singleton guard inside the adapter prevents duplicate listeners.
  // R-BRIDGE-SIGNED-TOKEN-V1: mint a STRICT HMAC-signed token before starting
  // the adapter. cancelled guard prevents a stale async callback from starting
  // the adapter after the effect has already cleaned up (deps changed / unmount).
  useEffect(() => {
    let cancelled = false;

    if (companionConnState === 'connected' && bridgeEnabled) {
      const identity = getDesktopIdentity();
      if (!identity || !identity.desktopDeviceId || !identity.storeId) {
        console.warn('[CompanionBridge] Missing desktop identity — bridge registration skipped');
      } else {
        void mintDesktopBridgeToken({ storeId: identity.storeId, deviceId: identity.desktopDeviceId })
          .then(authToken => {
            if (cancelled) return;
            console.info(`[CompanionBridge] Registering desktopDeviceId=${identity.desktopDeviceId} storeId=${identity.storeId}`);
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

  const toggleCompanionConnection = useCallback(() => {
    setCompanionConnectionState(companionConnState === 'connected' ? 'disconnected' : 'connected');
  }, [companionConnState]);

  // Dev-only: emit a deterministic mock event so the panel can show
  // the bus working without depending on real producers.
  const simulateCompanionEvent = useCallback(() => {
    emitCompanionEvent({
      type: 'APPROVAL_CREATED',
      category: 'approvals',
      payload: {
        approvalId: `mock-${Date.now().toString(36)}`,
        actionType: 'CANCEL_LAYAWAY',
        status: 'pending',
      },
      createdAt: Date.now(),
    });
  }, []);

  // R-COMPANION-RUNTIME-TEST-PANEL-V1: dev-only inbox actions. Each
  // submit injects a mock inbox entry mirroring what a real Companion
  // mobile would dispatch. Process pending iterates every pending
  // entry and routes it to the matching receiver — confirms the full
  // loop (submit → inbox → receiver → mark handled) works locally.
  const submitMockApprove = useCallback(() => {
    submitAction({
      type: 'approve_request',
      payload: {
        approvalId: `mock-approval-${Date.now().toString(36)}`,
        approvedByEmployeeId: 'mock-manager',
        reason: 'dev test',
      },
    });
  }, []);
  const submitMockDeny = useCallback(() => {
    submitAction({
      type: 'deny_request',
      payload: {
        approvalId: `mock-approval-${Date.now().toString(36)}`,
        deniedByEmployeeId: 'mock-manager',
        reason: 'dev test',
      },
    });
  }, []);
  const submitMockMessage = useCallback(() => {
    submitAction({
      type: 'send_message',
      payload: {
        messageId: `mock-msg-${Date.now().toString(36)}`,
        fromEmployeeId: 'mock-manager',
        channel: 'internal',
        preview: 'dev test',
      },
    });
  }, []);
  const submitMockAck = useCallback(() => {
    submitAction({
      type: 'acknowledge_intelligence_alert',
      payload: {
        alertId: `mock-alert-${Date.now().toString(36)}`,
        acknowledgedByEmployeeId: 'mock-manager',
      },
    });
  }, []);
  const processAllPending = useCallback(() => {
    const pending = getPendingActions();
    for (const action of pending) {
      if (action.type === 'approve_request' || action.type === 'deny_request') {
        processApprovalAction(action.actionId);
      } else if (action.type === 'send_message') {
        processMessagingAction(action.actionId);
      } else if (action.type === 'acknowledge_intelligence_alert') {
        processIntelligenceAck(action.actionId);
      }
    }
  }, []);
  const clearHandledNow = useCallback(() => {
    clearHandledActions();
  }, []);

  // R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1: pairing controls now
  // also publish the offer to the bridge and listen for a real claim.
  // The local CompanionPairingSession remains the React-facing source
  // of truth for the modal UI; the bridge is the cross-device truth.
  const pairingStoreId = currentStoreId || settings.storeName || 'default';

  const startPairing = useCallback(async () => {
    setLocalPhase('waiting');
    setOfferAccepted(false);
    setOfferError(null);
    const session = startPairingSession();
    if (!bridgeEnabled) {
      // Local-only session — used by the diagnostics panel's
      // "Simulate paired device" flow. Bridge-side claim is unreachable.
      return;
    }
    const result = await submitPairingOffer({
      bridgeUrl,
      code: session.pin,
      storeId: pairingStoreId,
      role: 'manager',
      expiresAt: session.expiresAt,
    });
    if (result.ok) {
      setOfferAccepted(true);
    } else {
      console.warn(
        `[CompanionCenter] pairing offer rejected by bridge — reason=${result.reason ?? 'unknown'}`,
      );
      setOfferError(result.reason ?? 'unknown');
    }
  }, [bridgeEnabled, bridgeUrl, pairingStoreId]);

  const cancelPairing = useCallback(() => {
    const session = snapshot.pairingSession;
    cancelPairingSession();
    setLocalPhase('waiting');
    setOfferAccepted(false);
    setOfferError(null);
    if (session && bridgeEnabled) {
      void revokePairingOffer({
        bridgeUrl,
        code: session.pin,
        storeId: pairingStoreId,
      });
    }
  }, [bridgeEnabled, bridgeUrl, pairingStoreId, snapshot.pairingSession]);

  /** Diagnostics-only: bypass the real bridge claim flow and stamp a
   *  random mock device as paired. Useful for UI dev without a phone.
   *  R-COMPANION-DESKTOP-PAIRING-FINAL-POLISH-V1: dropped "(mock)"
   *  suffix from the device names so the paired-device card in the
   *  main UI never carries dev/mock wording. The button itself is
   *  fully inside Developer Diagnostics with a clear "testing only"
   *  label. */
  const commitMockDevice = useCallback(() => {
    const platform: CompanionDevicePlatform = Math.random() < 0.5 ? 'ios' : 'android';
    mockConnectDevice({
      deviceName: platform === 'ios' ? 'iPhone 15 Pro' : 'Pixel 9',
      platform,
    });
    setLocalPhase('waiting');
  }, []);

  // R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1: real pairing poller.
  // While a pairing session is open AND bridge is enabled, poll the
  // bridge every 2 s for the offer's status. On 'claimed' → confirm
  // device locally; on 'expired' → close the modal and revoke server-side.
  // Replaces the prior 4.5s commitMockDevice auto-timer.
  const sessionId = snapshot.pairingSession?.sessionId;
  const sessionPin = snapshot.pairingSession?.pin;
  const sessionExpiresAt = snapshot.pairingSession?.expiresAt;
  useEffect(() => {
    if (!sessionId || !sessionPin || !sessionExpiresAt) {
      setLocalPhase('waiting');
      return undefined;
    }
    // UX phase animation: 'waiting' → 'pending' after a brief delay so
    // the user sees motion while the bridge offer is propagating.
    const animationTimer = setTimeout(() => setLocalPhase('pending'), 1200);

    if (!bridgeEnabled) {
      // No bridge: poller does nothing. User can still cancel manually.
      return () => clearTimeout(animationTimer);
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      // Client-side expiry guard: if we passed expiresAt, the bridge
      // would already report 'expired' on next poll, but cancelling
      // here keeps the UI tight.
      if (Date.now() >= sessionExpiresAt) {
        cancelPairing();
        return;
      }
      const result = await pollPairingStatus({ bridgeUrl, code: sessionPin });
      if (cancelled) return;
      if (result.status === 'claimed' && result.deviceId) {
        setLocalPhase('connected');
        confirmPairedDevice({
          deviceId: result.deviceId,
          deviceName: result.deviceName,
          platform: (result.platform as CompanionDevicePlatform | undefined) ?? 'unknown',
        });
        return; // stop polling — claim succeeded
      }
      if (result.status === 'expired') {
        cancelPairing();
        return;
      }
      pollTimer = setTimeout(tick, 2_000);
    };
    pollTimer = setTimeout(tick, 500);

    return () => {
      cancelled = true;
      clearTimeout(animationTimer);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [sessionId, sessionPin, sessionExpiresAt, bridgeEnabled, bridgeUrl, cancelPairing]);

  const disconnectDevice = useCallback(() => {
    mockDisconnectDevice();
  }, []);

  // Derived: top banner reflects real-time bridge snapshot.
  const overallStatus: CardStatus = pairedDevice
    ? 'connected_soon'
    : isPairingOpen ? 'pairing' : 'not_connected';
  const banner = statusPalette(overallStatus);

  // Per-card status: pair + connect cards mirror live pairing state.
  const cardStatus = useMemo(() => (id: string, fallback: CardStatus): CardStatus => {
    if (id === 'pair' || id === 'connect') {
      if (pairedDevice) return 'connected_soon';
      if (isPairingOpen) return 'pairing';
      return 'not_connected';
    }
    return fallback;
  }, [pairedDevice, isPairingOpen]);

  const phaseColor =
    localPhase === 'connected' ? '#22c55e'
    : localPhase === 'pending' ? '#fbbf24'
    : '#94a3b8';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <h1 style={{
          fontSize: '1.65rem', fontWeight: 800, color: '#fff',
          display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0,
        }}>
          <span aria-hidden="true">📱</span>
          {t('companion.title')}
        </h1>
        <p style={{ fontSize: '0.9rem', color: '#94a3b8', margin: 0, maxWidth: '560px', lineHeight: 1.4 }}>
          {t('companion.subtitle')}
        </p>
      </div>

      {/* Overall status banner */}
      <div style={{
        padding: '0.625rem 0.875rem',
        background: banner.bg,
        border: `1px solid ${banner.border}`,
        borderRadius: '0.625rem',
        fontSize: '0.85rem',
        fontWeight: 600,
        color: banner.color,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        alignSelf: 'flex-start',
        transition: 'background 0.2s, border-color 0.2s, color 0.2s',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: banner.color,
          boxShadow: `0 0 6px ${banner.color}88`,
        }} />
        {t(banner.label)}
      </div>

      {/* R-COMPANION-BRIDGE-WIRE-V1 + R-COMPANION-BRIDGE-STATUS-BADGE-V1:
          single status row. When the feature is off, render the long
          enable-in-Settings hint (preserves the prior round's UX). When
          on, render a compact pill mirroring the PosBridgeClient status
          via getBridgeAdapterStatus(). UI-only; no behavior changes. */}
      {!bridgeEnabled ? (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'rgba(148,163,184,0.08)',
          border: '1px solid rgba(148,163,184,0.25)',
          borderRadius: '0.5rem',
          fontSize: '0.78rem',
          color: '#94a3b8',
          alignSelf: 'flex-start',
          maxWidth: '560px',
          lineHeight: 1.4,
        }}>
          {t('companion.bridge.disabled')}
        </div>
      ) : (() => {
        // Inline pill: prefix label + colored dot + state text. Strings
        // come from companion.bridge.status.* keys (EN/ES/PT).
        const palette: Record<PosBridgeStatus, { fg: string; bg: string; border: string; labelKey: string }> = {
          idle:         { fg: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', labelKey: 'companion.bridge.status.idle' },
          connecting:   { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.30)',  labelKey: 'companion.bridge.status.connecting' },
          reconnecting: { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.30)',  labelKey: 'companion.bridge.status.reconnecting' },
          connected:    { fg: '#22c55e', bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.30)',   labelKey: 'companion.bridge.status.connected' },
          disconnected: { fg: '#f97316', bg: 'rgba(249,115,22,0.10)',  border: 'rgba(249,115,22,0.30)',  labelKey: 'companion.bridge.status.disconnected' },
          rejected:     { fg: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)',   labelKey: 'companion.bridge.status.rejected' },
        };
        const sty = palette[bridgeStatus] ?? palette.idle;
        return (
          <div
            data-testid="companion-bridge-status-pill"
            style={{
              padding: '0.375rem 0.75rem',
              background: sty.bg,
              border: `1px solid ${sty.border}`,
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: sty.fg,
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              lineHeight: 1.2,
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: sty.fg,
              boxShadow: `0 0 6px ${sty.fg}88`,
            }} />
            <span style={{ fontWeight: 600 }}>{t(sty.labelKey)}</span>
          </div>
        );
      })()}

      {/* Paired-device card — only renders when a device is paired */}
      {pairedDevice && (
        <div style={{
          padding: '1rem 1.1rem',
          background: 'rgba(34,197,94,0.06)',
          border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
            <div style={{
              fontSize: '1.75rem',
              flexShrink: 0,
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
            }}>
              {pairedDevice.platform === 'ios' ? '📱' : pairedDevice.platform === 'android' ? '🤖' : '📟'}
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#86efac', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('companion.device.sectionTitle')}
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0' }}>
                {pairedDevice.deviceName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                <span style={{
                  padding: '0.1rem 0.45rem',
                  borderRadius: '999px',
                  background: 'rgba(167,139,250,0.15)',
                  color: '#c4b5fd',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}>
                  {t(`companion.device.platform.${pairedDevice.platform}`)}
                </span>
                <span>·</span>
                {/* R-COMPANION-DESKTOP-PAIRING-FINAL-POLISH-V1: real connected
                    status + last-seen relative time (uses pairedDevice.lastSeenAt
                    which today equals connectedAt; future heartbeats will
                    bump it without any UI change). */}
                {(() => {
                  const isConnected = pairedDevice.status === 'connected';
                  return (
                    <span style={{
                      color: isConnected ? '#86efac' : '#fca5a5',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: isConnected ? '#22c55e' : '#ef4444',
                        boxShadow: `0 0 6px ${isConnected ? '#22c55e88' : '#ef444488'}`,
                      }} />
                      {t(isConnected ? 'companion.device.status.connected' : 'companion.device.status.disconnected')}
                    </span>
                  );
                })()}
                <span>·</span>
                {(() => {
                  // Relative last-seen, derived from real pairedDevice.lastSeenAt.
                  const diff = Math.max(0, Math.floor((nowMs - pairedDevice.lastSeenAt) / 1000));
                  let label: string;
                  if (diff < 5)        label = t('companion.device.justNow');
                  else if (diff < 60)  label = `${diff}${t('companion.device.seconds')}`;
                  else if (diff < 3600) label = `${Math.floor(diff / 60)}${t('companion.device.minutes')}`;
                  else                  label = `${Math.floor(diff / 3600)}${t('companion.device.hours')}`;
                  return <span>{t('companion.device.lastSeen')}: {label}</span>;
                })()}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={disconnectDevice}
            style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '0.5rem',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            ✕ {t('companion.device.disconnect')}
          </button>
        </div>
      )}

      {/* R-COMPANION-CENTER-UX-REDESIGN-V2: vertical tile cards
          matching the Quick Actions visual language. Bigger emoji,
          uppercase bold label, per-card gradient. Status pill stays
          top-right; the approval pending badge moves to top-left as
          a pulsing amber chip. Hover scale + brightness comes from
          the injected attribute selector — inline style owns the
          rest. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '14px',
        width: '100%',
      }}>
        {CARDS.map((card) => {
          const status = cardStatus(card.id, card.defaultStatus);
          const p = statusPalette(status);
          const isPairCard = card.id === 'pair';
          const isComingSoon = status === 'coming_soon';
          const isApprovals = card.id === 'approvals';
          const approvalBadge = isApprovals ? approvalRuntime.pendingCount : 0;
          const palette = CARD_PALETTE[card.id] ?? CARD_PALETTE_FALLBACK;
          return (
            <div
              key={card.id}
              data-cellhub-companion-card="true"
              data-coming-soon={isComingSoon ? 'true' : 'false'}
              style={{
                position: 'relative',
                padding: '28px 20px 22px',
                background: palette.bg,
                border: palette.border,
                borderRadius: '18px',
                minHeight: '240px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                textAlign: 'center',
                cursor: isComingSoon ? 'default' : 'pointer',
                transition: 'transform 180ms ease, filter 180ms ease, opacity 200ms ease',
                opacity: isComingSoon ? 0.45 : 1,
                pointerEvents: isComingSoon ? 'none' : 'auto',
                overflow: 'hidden',
              }}
            >
              {/* Approval pending badge — pulsing amber chip top-left. */}
              {isApprovals && approvalBadge > 0 && (
                <span
                  aria-label={(t as (k: string, ...a: Array<string | number>) => string)('companion.card.approvals.pendingLine', approvalBadge)}
                  style={{
                    position: 'absolute',
                    top: 14,
                    left: 14,
                    background: '#fbbf24',
                    color: '#0f1117',
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '3px 9px',
                    borderRadius: 6,
                    letterSpacing: '0.3px',
                    animation: 'cellhubCompanionApprovalBadgePulse 2s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                >
                  {approvalBadge}
                </span>
              )}

              {/* Status pill — top-right, same logic as V1. */}
              <span style={{
                position: 'absolute',
                top: 14,
                right: 14,
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                padding: '3px 9px',
                borderRadius: 6,
                background: p.bg,
                border: `1px solid ${p.border}`,
                color: p.color,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}>
                {t(p.label)}
              </span>

              {/* Icon block — large centered emoji. */}
              <span
                aria-hidden="true"
                style={{
                  display: 'block',
                  fontSize: 52,
                  marginBottom: 14,
                  filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))',
                  lineHeight: 1,
                }}
              >
                {card.icon}
              </span>

              {/* Label — bold uppercase. */}
              <h3 style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                lineHeight: 1.2,
                marginBottom: 6,
                color: palette.label,
              }}>
                {t(card.titleKey)}
              </h3>

              {/* Subtitle — quiet, two-line clamp so longer copy still fits. */}
              <p style={{
                margin: 0,
                fontSize: 12,
                color: 'rgba(255,255,255,0.45)',
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {t(card.bodyKey)}
              </p>

              {/* Pair card action button — full-width inside the tile body. */}
              {isPairCard && !isComingSoon && (
                <button
                  type="button"
                  onClick={startPairing}
                  disabled={isPairingOpen}
                  style={{
                    marginTop: 14,
                    width: '100%',
                    padding: 8,
                    background: isPairingOpen
                      ? 'rgba(99,102,241,0.10)'
                      : 'rgba(99,102,241,0.22)',
                    border: '1px solid rgba(99,102,241,0.45)',
                    color: '#c4b5fd',
                    borderRadius: 9,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: isPairingOpen ? 'wait' : 'pointer',
                    opacity: isPairingOpen ? 0.6 : 1,
                    transition: 'background 0.2s, opacity 0.2s',
                  }}
                >
                  {pairedDevice
                    ? `↻ ${t('companion.card.pair.repairButton')}`
                    : `🔗 ${t('companion.card.pair.startButton')}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* R-COMPANION-STORE-STATUS-LIVE-V1: live operational snapshot */}
      <div style={{
        marginTop: '0.75rem',
        background: 'linear-gradient(160deg, #0a1a14 0%, #060e0c 100%)',
        border: '1px solid rgba(45,212,191,0.18)',
        borderRadius: '0.9rem',
        padding: '1rem 1.1rem',
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#2dd4bf', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Store Snapshot
          </span>
          <span style={{
            fontSize: '0.68rem',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 5,
            background: companionConnState === 'connected' ? 'rgba(74,222,128,0.12)' : 'rgba(148,163,184,0.10)',
            color: companionConnState === 'connected' ? '#4ade80' : '#64748b',
            border: `1px solid ${companionConnState === 'connected' ? 'rgba(74,222,128,0.3)' : 'rgba(148,163,184,0.2)'}`,
          }}>
            {companionConnState === 'connected' ? '● Live' : companionConnState === 'connecting' ? '○ Connecting…' : '○ Offline'}
          </span>
        </div>

        {/* Stat grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>

          {/* On Shift */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>ON SHIFT</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: clockedInEmployees.length > 0 ? '#e2e8f0' : '#475569', lineHeight: 1.1 }}>
              {clockedInEmployees.length}
            </div>
            {clockedInEmployees.length > 0 ? (
              <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 3, lineHeight: 1.4 }}>
                {clockedInEmployees.slice(0, 3).map((e) => e.name).join(', ')}
                {clockedInEmployees.length > 3 ? ` +${clockedInEmployees.length - 3}` : ''}
              </div>
            ) : (
              <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: 3 }}>Nobody clocked in</div>
            )}
          </div>

          {/* Today's Sales */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>TODAY</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: todayRevenueCents > 0 ? '#e2e8f0' : '#475569', lineHeight: 1.1 }}>
              ${(todayRevenueCents / 100).toFixed(2)}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 3 }}>
              {todaySales.length} {todaySales.length === 1 ? 'sale' : 'sales'}
            </div>
          </div>

          {/* Open Repairs */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>OPEN REPAIRS</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: openRepairsCount > 0 ? '#fbbf24' : '#475569', lineHeight: 1.1 }}>
              {openRepairsCount}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 3 }}>
              {openRepairsCount === 1 ? 'ticket' : 'tickets'} in progress
            </div>
          </div>

          {/* Pending Approvals */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>PENDING APPROVALS</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: approvalRuntime.pendingCount > 0 ? '#f87171' : '#475569', lineHeight: 1.1 }}>
              {approvalRuntime.pendingCount}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 3 }}>
              {approvalRuntime.pendingCount === 0 ? 'all clear' : 'waiting for response'}
            </div>
          </div>
        </div>
      </div>

      {/* R-APPROVAL-AUDIT-LOG-V1: live approval history feed */}
      <div style={{
        marginTop: '0.75rem',
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '0.75rem',
        padding: '0.75rem 1rem',
      }}>
        <div style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          Approval Activity
          {approvalRuntime.items.length > 0 && (
            <span style={{
              background: 'rgba(148,163,184,0.15)',
              color: '#94a3b8',
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 4,
            }}>
              {approvalRuntime.items.length}
            </span>
          )}
        </div>

        {approvalRuntime.items.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
            No approval activity this session.
          </p>
        ) : (
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {approvalRuntime.items.slice(0, 50).map((item) => {
              const isApproved = item.status === 'approved';
              const isDenied   = item.status === 'denied';
              const isPending  = item.status === 'pending';
              const reqEmp = employees.find((e) => e.id === item.requestedByEmployeeId);
              const reqName = reqEmp?.name || (item.requestedByEmployeeId ? item.requestedByEmployeeId.slice(-6) : '—');
              const approverRaw = item.approvedByEmployeeId;
              const approverName = approverRaw === 'approver:admin'
                ? 'Admin PIN'
                : approverRaw
                  ? (employees.find((e) => e.id === approverRaw)?.name || approverRaw.slice(-6))
                  : null;
              const statusColor = isApproved ? '#4ade80' : isDenied ? '#f87171' : '#fbbf24';
              const statusIcon  = isApproved ? '✔' : isDenied ? '✖' : '…';
              const label = auditActionLabel(item.actionType) + auditFmtAmt(item.affectedAmount);
              return (
                <div key={item.approvalId} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  padding: '0.35rem 0.5rem',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.03)',
                  fontSize: '0.75rem',
                }}>
                  <span style={{ color: statusColor, fontWeight: 700, minWidth: 14, lineHeight: 1.6 }}>
                    {statusIcon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e2e8f0', fontWeight: 600, lineHeight: 1.3 }}>
                      {label}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.68rem', lineHeight: 1.4 }}>
                      {reqName}
                      {approverName && ` → ${approverName}`}
                      {isPending && <span style={{ color: '#fbbf24' }}> · pending</span>}
                      {isDenied && item.reason && <span> · {item.reason}</span>}
                    </div>
                  </div>
                  <span style={{ color: '#475569', fontSize: '0.65rem', whiteSpace: 'nowrap', lineHeight: 1.6 }}>
                    {auditRelTime(item.updatedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* R-COMPANION-MESSAGING-SIMPLE-V1: live chat panel */}
      <div style={{
        marginTop: '0.75rem',
        background: 'linear-gradient(160deg, #120820 0%, #0b0516 100%)',
        border: '1px solid rgba(192,132,252,0.18)',
        borderRadius: '0.9rem',
        padding: '1rem 1.1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            💬 {lang === 'es' ? 'Mensajes' : 'Messages'}
          </span>
          {messagingRuntime.totalUnread > 0 && (
            <span style={{
              background: 'rgba(192,132,252,0.18)',
              color: '#c084fc',
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 10,
              border: '1px solid rgba(192,132,252,0.3)',
            }}>
              {messagingRuntime.totalUnread} {lang === 'es' ? 'sin leer' : 'unread'}
            </span>
          )}
        </div>

        {/* Message feed — oldest first, max 30 shown */}
        <div style={{
          maxHeight: 240,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
        }}>
          {messagingRuntime.recentMessages.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
              {lang === 'es' ? 'Sin mensajes esta sesión.' : 'No messages this session.'}
            </p>
          ) : (
            [...messagingRuntime.recentMessages].reverse().map((msg) => {
              const isOut = msg.direction === 'outbound';
              const senderEmp = employees.find((e) => e.id === msg.fromEmployeeId);
              const senderLabel = senderEmp?.name || (isOut ? (currentEmployee?.name || 'You') : 'Manager');
              const text = msg.body || msg.preview || '';
              return (
                <div key={msg.messageId} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isOut ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{
                    maxWidth: '80%',
                    background: isOut ? 'rgba(192,132,252,0.18)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${isOut ? 'rgba(192,132,252,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: isOut ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '0.45rem 0.65rem',
                    fontSize: '0.78rem',
                    color: '#e2e8f0',
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}>
                    {text}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2, paddingInline: 4 }}>
                    {senderLabel} · {auditRelTime(msg.updatedAt)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={msgDraft}
            onChange={(e) => setMsgDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && msgDraft.trim() && bridgeStatus === 'connected') {
                sendCompanionMessage(msgDraft.trim(), currentEmployee?.id || '', currentEmployee?.name || 'Store');
                setMsgDraft('');
              }
            }}
            placeholder={bridgeStatus === 'connected'
              ? (lang === 'es' ? 'Escribe un mensaje…' : 'Type a message…')
              : (lang === 'es' ? 'Conecta el bridge para enviar' : 'Connect bridge to send')}
            disabled={bridgeStatus !== 'connected'}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(192,132,252,0.25)',
              borderRadius: 8,
              color: '#e2e8f0',
              fontSize: '0.82rem',
              padding: '0.45rem 0.65rem',
              outline: 'none',
              opacity: bridgeStatus !== 'connected' ? 0.5 : 1,
            }}
          />
          <button
            type="button"
            disabled={!msgDraft.trim() || bridgeStatus !== 'connected'}
            onClick={() => {
              if (msgDraft.trim()) {
                sendCompanionMessage(msgDraft.trim(), currentEmployee?.id || '', currentEmployee?.name || 'Store');
                setMsgDraft('');
              }
            }}
            style={{
              padding: '0.45rem 0.9rem',
              background: msgDraft.trim() && bridgeStatus === 'connected'
                ? 'rgba(192,132,252,0.22)'
                : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(192,132,252,0.35)',
              borderRadius: 8,
              color: '#c084fc',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: msgDraft.trim() && bridgeStatus === 'connected' ? 'pointer' : 'default',
              opacity: msgDraft.trim() && bridgeStatus === 'connected' ? 1 : 0.4,
              transition: 'background 0.15s, opacity 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {lang === 'es' ? 'Enviar' : 'Send'}
          </button>
        </div>
      </div>

      {/* R-COMPANION-CENTER-UX-REDESIGN: developer diagnostics hidden
          inside a collapsed <details> so the main surface stays clean.
          No PIN, no remote toggle — just hidden by default and one
          click away when debugging is needed. */}
      <details style={{
        marginTop: '0.75rem',
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '0.75rem',
        padding: '0.5rem 0.85rem',
      }}>
        <summary style={{
          cursor: 'pointer',
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          listStyle: 'none',
          padding: '0.25rem 0',
          userSelect: 'none',
        }}>
          {t('companion.diagnostics.title')}
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
      {/* R-COMPANION-EVENT-LAYER-V1: dev debug panel. Lightweight,
          unstyled-by-design surface that proves the bus + bridge work
          before any real producers are wired. Subscribes once on mount;
          listeners are released on unmount via useEffect cleanup. */}
      <div style={{
        padding: '0.75rem 0.9rem',
        background: 'rgba(255,255,255,0.02)',
        border: '1px dashed rgba(148,163,184,0.2)',
        borderRadius: '0.625rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        fontSize: '0.78rem',
        color: '#94a3b8',
      }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b' }}>
          {t('companion.debug.title')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem' }}>
          <div>
            <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{t('companion.debug.connected')}</div>
            <div style={{
              color: companionConnState === 'connected' ? '#86efac' : '#cbd5e1',
              fontWeight: 600,
            }}>
              {companionConnState === 'connected' ? t('companion.debug.yes') : t('companion.debug.no')}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{t('companion.debug.lastEvent')}</div>
            <div style={{ fontFamily: 'Courier New, monospace', color: '#e2e8f0', fontWeight: 600 }}>
              {companionLastEvent ? companionLastEvent.type : t('companion.debug.noEvents')}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{t('companion.debug.queueSize')}</div>
            <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{companionQueue}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={toggleCompanionConnection}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(148,163,184,0.25)',
              background: 'rgba(255,255,255,0.04)',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            ⇋ {t('companion.debug.toggleConnection')}
          </button>
          <button
            type="button"
            onClick={simulateCompanionEvent}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(99,102,241,0.30)',
              background: 'rgba(99,102,241,0.08)',
              color: '#a5b4fc',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            ⚡ {t('companion.debug.simulateEvent')}
          </button>
          {/* R-COMPANION-DESKTOP-REAL-PAIRING-SOURCE-V1 — diagnostics-only
              mock-pair shortcut. Production path is the real pairing
              modal + QR; this button bypasses the bridge claim flow for
              UI development without a phone. */}
          <button
            type="button"
            onClick={commitMockDevice}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(251,191,36,0.30)',
              background: 'rgba(251,191,36,0.08)',
              color: '#fbbf24',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
            title={t('companion.debug.mockPairHint')}
          >
            🛠 {t('companion.debug.mockPair')}
          </button>
        </div>
      </div>

      {/* R-COMPANION-RUNTIME-TEST-PANEL-V1: dev-only action-inbox
          runtime test panel. Lives below the event-bus dev panel.
          Subscribes to subscribeActionInbox; buttons exercise the
          full loop (submit -> inbox -> receiver -> mark handled).
          Cero real approval / message / alert mutation. */}
      <div style={{
        padding: '0.75rem 0.9rem',
        background: 'rgba(255,255,255,0.02)',
        border: '1px dashed rgba(148,163,184,0.2)',
        borderRadius: '0.625rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        fontSize: '0.78rem',
        color: '#94a3b8',
      }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b' }}>
          {t('companion.inbox.title')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
          <div>
            <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{t('companion.inbox.pending')}</div>
            <div style={{ color: inboxSnap.pendingCount > 0 ? '#fbbf24' : '#e2e8f0', fontWeight: 600 }}>
              {inboxSnap.pendingCount}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{t('companion.inbox.handled')}</div>
            <div style={{ color: '#e2e8f0', fontWeight: 600 }}>
              {inboxSnap.actions.length - inboxSnap.pendingCount}
            </div>
          </div>
        </div>
        {/* Submit buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.35rem' }}>
          <button
            type="button"
            onClick={submitMockApprove}
            style={{
              padding: '0.35rem 0.55rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(34,197,94,0.3)',
              background: 'rgba(34,197,94,0.08)',
              color: '#86efac',
              cursor: 'pointer',
              fontSize: '0.74rem',
              fontWeight: 600,
            }}
          >
            {t('companion.inbox.submitApprove')}
          </button>
          <button
            type="button"
            onClick={submitMockDeny}
            style={{
              padding: '0.35rem 0.55rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.08)',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: '0.74rem',
              fontWeight: 600,
            }}
          >
            {t('companion.inbox.submitDeny')}
          </button>
          <button
            type="button"
            onClick={submitMockMessage}
            style={{
              padding: '0.35rem 0.55rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(56,189,248,0.3)',
              background: 'rgba(56,189,248,0.08)',
              color: '#7dd3fc',
              cursor: 'pointer',
              fontSize: '0.74rem',
              fontWeight: 600,
            }}
          >
            {t('companion.inbox.submitMessage')}
          </button>
          <button
            type="button"
            onClick={submitMockAck}
            style={{
              padding: '0.35rem 0.55rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(167,139,250,0.3)',
              background: 'rgba(167,139,250,0.08)',
              color: '#c4b5fd',
              cursor: 'pointer',
              fontSize: '0.74rem',
              fontWeight: 600,
            }}
          >
            {t('companion.inbox.submitAck')}
          </button>
        </div>
        {/* Process / clear */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={processAllPending}
            disabled={inboxSnap.pendingCount === 0}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(99,102,241,0.30)',
              background: 'rgba(99,102,241,0.08)',
              color: '#a5b4fc',
              cursor: inboxSnap.pendingCount === 0 ? 'not-allowed' : 'pointer',
              opacity: inboxSnap.pendingCount === 0 ? 0.5 : 1,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            ▶ {t('companion.inbox.processPending')}
          </button>
          <button
            type="button"
            onClick={clearHandledNow}
            disabled={inboxSnap.actions.length - inboxSnap.pendingCount === 0}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '0.4rem',
              border: '1px solid rgba(148,163,184,0.25)',
              background: 'rgba(255,255,255,0.04)',
              color: '#cbd5e1',
              cursor: inboxSnap.actions.length - inboxSnap.pendingCount === 0 ? 'not-allowed' : 'pointer',
              opacity: inboxSnap.actions.length - inboxSnap.pendingCount === 0 ? 0.5 : 1,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            ✕ {t('companion.inbox.clearHandled')}
          </button>
        </div>
      </div>
        </div>
      </details>

      {/* Pairing modal — R-COMPANION-DESKTOP-PAIRING-FINAL-POLISH-V1 */}
      <Modal
        open={isPairingOpen}
        onClose={cancelPairing}
        title={`📱 ${t('companion.pair.modalTitle')}`}
        size="max-w-md"
        footer={
          <button className="btn btn-secondary" onClick={cancelPairing}>
            {t('companion.pair.cancel')}
          </button>
        }
      >
        {(() => {
          // Real-pairing modal status derivation.
          type ModalStatus = 'waiting' | 'received' | 'connected' | 'expired' | 'bridge_unavailable' | 'offer_failed';
          const session = snapshot.pairingSession;
          let modalStatus: ModalStatus;
          if (!bridgeEnabled) {
            modalStatus = 'bridge_unavailable';
          } else if (offerError) {
            modalStatus = 'offer_failed';
          } else if (session && Date.now() >= session.expiresAt) {
            modalStatus = 'expired';
          } else if (localPhase === 'connected') {
            modalStatus = 'connected';
          } else if (offerAccepted && session) {
            modalStatus = 'received';
          } else {
            modalStatus = 'waiting';
          }

          const statusPalette: Record<ModalStatus, { fg: string; bg: string; border: string; labelKey: string }> = {
            waiting:            { fg: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.35)', labelKey: 'companion.pair.status.waiting' },
            received:           { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.35)',  labelKey: 'companion.pair.status.received' },
            connected:          { fg: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.40)',   labelKey: 'companion.pair.status.connected' },
            expired:            { fg: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.40)',   labelKey: 'companion.pair.status.expired' },
            bridge_unavailable: { fg: '#fb923c', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.40)',  labelKey: 'companion.pair.status.bridgeUnavailable' },
            offer_failed:      { fg: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.40)',   labelKey: 'companion.pair.status.offerFailed' },
          };
          const sty = statusPalette[modalStatus];
          const isError = modalStatus === 'bridge_unavailable' || modalStatus === 'offer_failed';
          const isTerminal = isError || modalStatus === 'expired';

          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem' }}>
              {/* Real-status badge (top of modal) */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.45rem 0.85rem',
                background: sty.bg,
                border: `1px solid ${sty.border}`,
                borderRadius: '999px',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: sty.fg,
                transition: 'border-color 0.25s, color 0.25s, background 0.25s',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: sty.fg,
                  boxShadow: `0 0 6px ${sty.fg}88`,
                }} />
                {t(sty.labelKey)}
              </div>

              {/* Error helper text (when bridge unavailable or offer failed) */}
              {isError && (
                <div style={{
                  fontSize: '0.78rem',
                  color: sty.fg,
                  textAlign: 'center',
                  maxWidth: '340px',
                  lineHeight: 1.45,
                  padding: '0.6rem 0.8rem',
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${sty.border}`,
                  borderRadius: '0.5rem',
                }}>
                  {modalStatus === 'bridge_unavailable'
                    ? t('companion.bridge.disabled')
                    : t('companion.pair.bridge.offerFailedHint')}
                </div>
              )}

              {/* Connected success state */}
              {modalStatus === 'connected' && (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div style={{ fontSize: '3rem', lineHeight: 1, marginBottom: '0.75rem' }}>✅</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#22c55e' }}>
                    {lang === 'es' ? '¡Tu teléfono está conectado!' : 'Your phone is connected!'}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#86efac', marginTop: '0.3rem' }}>
                    {lang === 'es' ? 'La tienda está lista.' : 'Store is ready.'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.65rem' }}>
                    {lang === 'es' ? 'Puedes cerrar esta ventana.' : 'You can close this window.'}
                  </div>
                </div>
              )}

              {/* QR + PIN + countdown — hidden in terminal states and success */}
              {!isTerminal && session && modalStatus !== 'connected' && (
                <>
                  {/* Numbered onboarding steps */}
                  <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {([
                      lang === 'es' ? 'Instala CellHub Companion en tu teléfono' : 'Install CellHub Companion on your phone',
                      lang === 'es' ? 'Abre la app y toca Escanear QR' : 'Open the app and tap Scan QR',
                      lang === 'es' ? 'Apunta al código — ¡listo!' : 'Point at this code — done!',
                    ] as string[]).map((step, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 800, color: '#a5b4fc', flexShrink: 0,
                        }}>{i + 1}</span>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4 }}>{step}</span>
                      </div>
                    ))}
                  </div>
                  <RealPairingQR
                    payload={buildPairingQrPayload({
                      bridgeUrl,
                      storeId: pairingStoreId,
                      code: session.pin,
                      role: 'manager',
                      expiresAt: session.expiresAt,
                    })}
                  />
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>
                    {t('companion.pair.qrCaption')}
                  </div>

                  {/* 6-digit fallback code */}
                  <div style={{
                    marginTop: '0.4rem',
                    padding: '0.65rem 0.95rem',
                    background: 'rgba(99,102,241,0.10)',
                    border: '1px solid rgba(99,102,241,0.30)',
                    borderRadius: '0.625rem',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
                  }}>
                    <div style={{ fontSize: '0.7rem', color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                      {t('companion.pair.pinLabel')}
                    </div>
                    <div style={{
                      fontFamily: 'Courier New, monospace',
                      fontSize: '1.85rem',
                      fontWeight: 800,
                      letterSpacing: '0.5em',
                      color: '#e2e8f0',
                      paddingLeft: '0.5em',
                    }}>
                      {pairingPin}
                    </div>
                  </div>

                  {/* Expiry countdown */}
                  {(() => {
                    const remaining = Math.max(0, Math.floor((session.expiresAt - nowMs) / 1000));
                    const mins = Math.floor(remaining / 60);
                    const secs = remaining % 60;
                    const tone = remaining <= 5 ? '#ef4444' : remaining <= 30 ? '#fbbf24' : '#94a3b8';
                    return (
                      <div style={{ fontSize: '0.72rem', color: tone, textAlign: 'center', fontFamily: 'Courier New, monospace' }}>
                        {t('companion.pair.expiresIn')} {mins}:{String(secs).padStart(2, '0')}
                      </div>
                    );
                  })()}

                </>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
