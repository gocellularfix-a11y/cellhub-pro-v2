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
import {
  cancelPairingSession,
  getConnectionSnapshot,
  mockConnectDevice,
  mockDisconnectDevice,
  startPairingSession,
  subscribeConnectionSnapshot,
} from '@/services/companion/companionBridgeConnection';
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
import type {
  CompanionActionInboxSnapshot,
  CompanionApprovalRuntimeSnapshot,
  CompanionBridgeSnapshot,
  CompanionDevicePlatform,
  CompanionEvent,
  CompanionMessagingRuntimeSnapshot,
} from '@/services/companion/companionTypes';

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
  { id: 'connect',     titleKey: 'companion.card.connect.title',     bodyKey: 'companion.card.connect.body',     icon: '🔗', defaultStatus: 'not_connected' },
  { id: 'pair',        titleKey: 'companion.card.pair.title',        bodyKey: 'companion.card.pair.body',        icon: '📷', defaultStatus: 'not_connected' },
  { id: 'approvals',   titleKey: 'companion.card.approvals.title',   bodyKey: 'companion.card.approvals.body',   icon: '✅', defaultStatus: 'coming_soon' },
  { id: 'storeStatus', titleKey: 'companion.card.storeStatus.title', bodyKey: 'companion.card.storeStatus.body', icon: '🏪', defaultStatus: 'coming_soon' },
  { id: 'messaging',   titleKey: 'companion.card.messaging.title',   bodyKey: 'companion.card.messaging.body',   icon: '💬', defaultStatus: 'coming_soon' },
  { id: 'health',      titleKey: 'companion.card.health.title',      bodyKey: 'companion.card.health.body',      icon: '📡', defaultStatus: 'coming_soon' },
];

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

// ── Main component ────────────────────────────────────────
export default function CompanionCenter() {
  const { t } = useTranslation();

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
    return () => { unsubSnap(); unsubEvents(); unsubInbox(); unsubApprovals(); unsubMessaging(); };
  }, []);

  // ── Derived flags from snapshot ───────────────────────
  const isPairingOpen = !!snapshot.pairingSession;
  const pairingPin = snapshot.pairingSession?.pin ?? '';
  const pairedDevice = snapshot.pairedDevice;
  const companionConnState = snapshot.connectionState;

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

  // R-COMPANION-PAIRING-WIRED-V1: pairing controls now delegate to
  // the bridge service so the centralised snapshot stays the source
  // of truth. UI state (modal open, PIN, paired device) is derived.
  const startPairing = useCallback(() => {
    setLocalPhase('waiting');
    startPairingSession();
  }, []);

  const cancelPairing = useCallback(() => {
    cancelPairingSession();
    setLocalPhase('waiting');
  }, []);

  /** Commit a mock paired device — randomised iPhone/Pixel for variety. */
  const commitMockDevice = useCallback(() => {
    const platform: CompanionDevicePlatform = Math.random() < 0.5 ? 'ios' : 'android';
    mockConnectDevice({
      deviceName: platform === 'ios' ? 'iPhone 15 Pro' : 'Pixel 9',
      platform,
    });
    setLocalPhase('waiting'); // reset for next session
  }, []);

  // Phase animation: local sub-state of 'waiting' that progresses
  // 'waiting' → 'pending' → 'connected' while the bridge session is
  // open, then the auto-commit fires bridge.mockConnectDevice. Re-runs
  // whenever a fresh sessionId opens. All timers cleaned up on cancel.
  const sessionId = snapshot.pairingSession?.sessionId;
  useEffect(() => {
    if (!sessionId) {
      setLocalPhase('waiting');
      return undefined;
    }
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    timers.push(setTimeout(() => setLocalPhase('pending'),   1500));
    timers.push(setTimeout(() => setLocalPhase('connected'), 3500));
    timers.push(setTimeout(() => { commitMockDevice(); }, 4500));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [sessionId, commitMockDevice]);

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#94a3b8' }}>
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
                <span>
                  {t('companion.device.lastConnected')}: {t('companion.device.justNow')}
                </span>
                <span>·</span>
                <span style={{ color: '#86efac', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e88' }} />
                  {t('companion.device.health.good')}
                </span>
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

      {/* Card grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '0.875rem',
      }}>
        {CARDS.map((card) => {
          const status = cardStatus(card.id, card.defaultStatus);
          const p = statusPalette(status);
          const isPairCard = card.id === 'pair';
          return (
            <div key={card.id} style={{
              padding: '1rem',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem',
              minHeight: '160px',
              transition: 'border-color 0.2s, background 0.2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                  <span aria-hidden="true" style={{ fontSize: '1.25rem', flexShrink: 0 }}>{card.icon}</span>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t(card.titleKey)}
                  </h3>
                </div>
                <span style={{
                  flexShrink: 0,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '999px',
                  background: p.bg,
                  border: `1px solid ${p.border}`,
                  color: p.color,
                  transition: 'background 0.2s, border-color 0.2s, color 0.2s',
                }}>
                  {t(p.label)}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.45, flex: 1 }}>
                {t(card.bodyKey)}
              </p>
              {/* R-COMPANION-APPROVAL-RUNTIME-V1: live runtime line
                  inside the Approval Requests card. Keeps the
                  'coming_soon' status pill intact — only adds a small
                  data row when the runtime has produced something. */}
              {card.id === 'approvals' && (approvalRuntime.pendingCount > 0 || approvalRuntime.latest) && (
                <div style={{
                  marginTop: '0.25rem',
                  padding: '0.4rem 0.55rem',
                  background: 'rgba(99,102,241,0.06)',
                  border: '1px solid rgba(99,102,241,0.18)',
                  borderRadius: '0.45rem',
                  fontSize: '0.74rem',
                  color: '#cbd5e1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.2rem',
                }}>
                  {approvalRuntime.pendingCount > 0 && (
                    <div style={{ color: '#fbbf24', fontWeight: 600 }}>
                      ⏳ {(t as (k: string, ...a: Array<string | number>) => string)('companion.card.approvals.pendingLine', approvalRuntime.pendingCount)}
                    </div>
                  )}
                  {approvalRuntime.latest && approvalRuntime.latest.status === 'approved' && (
                    <div style={{ color: '#86efac' }}>
                      ✓ {t('companion.card.approvals.latestApproved')}
                    </div>
                  )}
                  {approvalRuntime.latest && approvalRuntime.latest.status === 'denied' && (
                    <div style={{ color: '#fca5a5' }}>
                      ✕ {t('companion.card.approvals.latestDenied')}
                    </div>
                  )}
                </div>
              )}
              {/* R-COMPANION-MESSAGING-RUNTIME-V1: live runtime line
                  inside the Messaging card. Renders only once the
                  runtime has produced something. Status pill stays
                  'coming_soon' per existing beta/coming-soon feel. */}
              {card.id === 'messaging' && (messagingRuntime.totalUnread > 0 || messagingRuntime.latestMessage) && (
                <div style={{
                  marginTop: '0.25rem',
                  padding: '0.4rem 0.55rem',
                  background: 'rgba(56,189,248,0.06)',
                  border: '1px solid rgba(56,189,248,0.18)',
                  borderRadius: '0.45rem',
                  fontSize: '0.74rem',
                  color: '#cbd5e1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.2rem',
                }}>
                  {messagingRuntime.totalUnread > 0 && (
                    <div style={{ color: '#fbbf24', fontWeight: 600 }}>
                      ✉ {(t as (k: string, ...a: Array<string | number>) => string)('companion.card.messaging.unreadLine', messagingRuntime.totalUnread)}
                    </div>
                  )}
                  {messagingRuntime.latestMessage && messagingRuntime.latestMessage.direction === 'outbound' && (
                    <div style={{ color: '#7dd3fc' }}>
                      ↗ {t('companion.card.messaging.latestSent')}
                    </div>
                  )}
                  {messagingRuntime.latestMessage && messagingRuntime.latestMessage.direction === 'inbound' && (
                    <div style={{ color: '#86efac' }}>
                      ↘ {t('companion.card.messaging.latestReceived')}
                    </div>
                  )}
                  {messagingRuntime.threads.length > 0 && (
                    <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                      {(t as (k: string, ...a: Array<string | number>) => string)('companion.card.messaging.threadsLine', messagingRuntime.threads.length)}
                    </div>
                  )}
                </div>
              )}
              {isPairCard && (
                <button
                  type="button"
                  onClick={startPairing}
                  disabled={isPairingOpen}
                  style={{
                    marginTop: '0.25rem',
                    padding: '0.55rem 0.85rem',
                    borderRadius: '0.55rem',
                    border: '1px solid rgba(99,102,241,0.45)',
                    background: isPairingOpen
                      ? 'rgba(99,102,241,0.08)'
                      : 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.18))',
                    color: '#c4b5fd',
                    cursor: isPairingOpen ? 'wait' : 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 700,
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
              <span style={{ color: '#64748b', fontWeight: 400, marginLeft: '0.35rem' }}>
                ({companionConnState})
              </span>
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
              fontFamily: 'Courier New, monospace',
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
              fontFamily: 'Courier New, monospace',
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
              fontFamily: 'Courier New, monospace',
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
              fontFamily: 'Courier New, monospace',
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

      {/* Pairing modal */}
      <Modal
        open={isPairingOpen}
        onClose={cancelPairing}
        title={`📱 ${t('companion.pair.modalTitle')}`}
        size="max-w-md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={cancelPairing}>
              {t('companion.pair.cancel')}
            </button>
            <button className="btn btn-primary" onClick={commitMockDevice}>
              {t('companion.pair.mockConnect')}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem' }}>
          {/* QR placeholder */}
          <MockQR pin={pairingPin} />
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>
            {t('companion.pair.qrCaption')}
          </div>

          {/* PIN block */}
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
              paddingLeft: '0.5em', // optical-balance vs letter-spacing tail
            }}>
              {pairingPin}
            </div>
          </div>

          <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', maxWidth: '320px', lineHeight: 1.4 }}>
            {t('companion.pair.instructions')}
          </div>

          {/* Phase indicator */}
          <div style={{
            marginTop: '0.4rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.45rem 0.75rem',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${phaseColor}55`,
            borderRadius: '999px',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: phaseColor,
            transition: 'border-color 0.25s, color 0.25s',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: phaseColor,
              boxShadow: `0 0 6px ${phaseColor}88`,
            }} />
            {t(`companion.pair.phase.${localPhase}`)}
          </div>
        </div>
      </Modal>
    </div>
  );
}
