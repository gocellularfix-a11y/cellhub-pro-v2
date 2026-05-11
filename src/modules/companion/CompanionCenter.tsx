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

// ── Mock device + pairing types ───────────────────────────
type DevicePlatform = 'iphone' | 'android';
interface MockDevice {
  name: string;
  platform: DevicePlatform;
  connectedAtMs: number;
  health: 'good';
}

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

  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [pairingPin, setPairingPin] = useState('');
  const [pairingPhase, setPairingPhase] = useState<PairingPhase>('waiting');
  const [pairedDevice, setPairedDevice] = useState<MockDevice | null>(null);

  // Open the pairing modal with a fresh 6-digit PIN. Random is fine
  // here — UX mockup, not business logic, never persisted.
  const startPairing = useCallback(() => {
    const pin = String(100000 + Math.floor(Math.random() * 900000));
    setPairingPin(pin);
    setPairingPhase('waiting');
    setIsPairingOpen(true);
  }, []);

  const cancelPairing = useCallback(() => {
    setIsPairingOpen(false);
    setPairingPhase('waiting');
  }, []);

  // Mock state progression: waiting → pending → connected → commit
  // device + close. setTimeout chain is local to the modal-open
  // lifecycle and always cleaned up on unmount / cancel.
  useEffect(() => {
    if (!isPairingOpen) return undefined;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    timers.push(setTimeout(() => setPairingPhase('pending'),   1500));
    timers.push(setTimeout(() => setPairingPhase('connected'), 3500));
    timers.push(setTimeout(() => {
      // Alternate platform on each successful pair for visual variety.
      const platform: DevicePlatform = Math.random() < 0.5 ? 'iphone' : 'android';
      setPairedDevice({
        name: platform === 'iphone' ? 'iPhone 15 Pro' : 'Pixel 9',
        platform,
        connectedAtMs: Date.now(),
        health: 'good',
      });
      setIsPairingOpen(false);
      setPairingPhase('waiting');
    }, 4500));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [isPairingOpen]);

  const disconnectDevice = useCallback(() => setPairedDevice(null), []);

  // Derived: top banner reflects real-time mock state.
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
    pairingPhase === 'connected' ? '#22c55e'
    : pairingPhase === 'pending' ? '#fbbf24'
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
              {pairedDevice.platform === 'iphone' ? '📱' : '🤖'}
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#86efac', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('companion.device.sectionTitle')}
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0' }}>
                {pairedDevice.name}
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

      {/* Pairing modal */}
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
            {t(`companion.pair.phase.${pairingPhase}`)}
          </div>
        </div>
      </Modal>
    </div>
  );
}
