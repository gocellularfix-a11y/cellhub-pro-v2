// SimpleOperatorView — CellHub Intelligence 3-column command center.
// LEFT: Store Pulse   CENTER: Operational Heart   RIGHT: Chat Execution
import { useState, useRef, useEffect } from 'react';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import type { ChipData } from './SuggestionChips';
import type { PanelCampaignDraft } from '@/services/intelligence/chat/handlers';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from '@/i18n';
import OperatorChatShell from './OperatorChatShell';

// ── Design tokens ─────────────────────────────────────────────
const BG_LEFT    = '#060C16';
const BG_MAIN    = '#080F1E';
const BG_CARD    = '#0B1523';
const BG_HOVER   = '#0F1E35';
const BORDER     = '#0E1A2B';
const TEXT_DIM   = '#2D3D52';
const TEXT_MUTED = '#4B5E72';

// ── Shared sub-components ─────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
      <div style={{ width: 2, height: 10, borderRadius: 2, background: '#1A2B3C', flexShrink: 0 }} />
      <span style={{ fontSize: 9, fontWeight: 700, color: TEXT_DIM, letterSpacing: '0.14em' }}>
        {text}
      </span>
    </div>
  );
}

// ── Left panel sub-components ──────────────────────────────────

function RetentionRing({ pct }: { pct: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const R = 18;
  const circumference = 2 * Math.PI * R;
  const offset = circumference * (1 - pct / 100);
  return (
    <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="24" cy="24" r={R} fill="none" stroke="#0D1826" strokeWidth={4} />
        <circle
          cx="24" cy="24" r={R} fill="none"
          stroke="#3B82F6" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={mounted ? offset : circumference}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#3B82F6',
      }}>
        {pct}%
      </div>
    </div>
  );
}

function ServiceTile({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div style={{
      background: BG_CARD, border: `1px solid ${BORDER}`,
      borderRadius: 8, padding: '10px 10px 9px',
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <span style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {count}
      </span>
      <span style={{ fontSize: 9, fontWeight: 600, color: TEXT_DIM, letterSpacing: '0.06em' }}>
        {label}
      </span>
    </div>
  );
}

function HourlyChart({ hourlySales }: { hourlySales: number[] }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 60);
    return () => clearTimeout(t);
  }, []);

  const now = new Date().getHours();
  const displayHours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
  const maxAmount = Math.max(...displayHours.map(h => hourlySales[h] ?? 0), 1);

  const labelFor = (h: number) => {
    if (h === 9) return '9a';
    if (h === 17) return '5p';
    if (h === 12) return '12';
    return h < 12 ? String(h) : String(h - 12);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: '100%', paddingBottom: 18, position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 18,
        background: 'repeating-linear-gradient(to bottom, transparent, transparent calc(50% - 1px), #0D1826 calc(50% - 1px), #0D1826 50%)',
        pointerEvents: 'none',
      }} />
      {displayHours.map((h, i) => {
        const amount = hourlySales[h] ?? 0;
        const isFuture = h > now;
        const isCurrent = h === now;
        const pct = isFuture ? 4 : Math.max(amount / maxAmount * 100, 0);
        return (
          <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', position: 'relative', gap: 3 }}>
            <div style={{
              width: '100%',
              height: animated ? `${pct}%` : '0%',
              borderRadius: '2px 2px 0 0',
              background: isCurrent ? '#1E4A8A' : '#1A3560',
              borderTop: `1px solid ${isCurrent ? '#3B82F6' : '#2D5090'}`,
              boxShadow: isCurrent ? '0 0 5px #3B82F635' : 'none',
              opacity: isFuture ? 0.25 : 1,
              transition: `height 0.5s ease-out ${i * 40}ms`,
            }} />
            <span style={{ fontSize: 8, color: TEXT_DIM, position: 'absolute', bottom: 0, whiteSpace: 'nowrap' }}>
              {labelFor(h)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Center panel sub-components ───────────────────────────────

function MissionCard({ icon, title, subtitle, accent, onClick }: {
  icon: string; title: string; subtitle: string; accent: string; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 10, padding: '22px 20px', borderRadius: 12, textAlign: 'left',
        background: hov ? BG_HOVER : BG_CARD,
        border: `1px solid ${hov ? accent + '28' : BORDER}`,
        borderLeft: `2px solid ${hov ? accent : accent + '88'}`,
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        minHeight: 0,
      }}
    >
      <span style={{ fontSize: 24, lineHeight: 1 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, lineHeight: 1.25, marginBottom: 5,
          color: hov ? accent : accent + 'CC',
          transition: 'color 0.15s',
        }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: hov ? TEXT_MUTED : TEXT_DIM, lineHeight: 1.5, transition: 'color 0.15s' }}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────

interface SimpleOperatorViewProps {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es';
  externalQuery?: { text: string; seq: number };
  onOpenPromote?: (productId: string, productName: string) => void;
  onPanelCampaign?: (draft: PanelCampaignDraft) => void;
  chipData: ChipData;
  todayRevenue: number;
  todaySalesCount: number;
  totalAlerts: number;
  staleRecoverable: number;
  deadStockLocked: number;
  biggestLeak: number;
  yesterdayRevenue: number;
  activeCustomers30d: number;
  repairsInProgress: number;
  layawaysActive: number;
  unlocksActive: number;
  specialOrdersActive: number;
  hourlySales: number[];
}

export default function SimpleOperatorView({
  engine, customers, lang, externalQuery,
  onOpenPromote, onPanelCampaign, chipData,
  todayRevenue, todaySalesCount,
  staleRecoverable,
  yesterdayRevenue, activeCustomers30d,
  repairsInProgress, layawaysActive, unlocksActive, specialOrdersActive,
  hourlySales,
}: SimpleOperatorViewProps) {
  const { locale } = useTranslation();
  const es = locale === 'es';
  const seqRef = useRef(0);
  const [chatQuery, setChatQuery] = useState<{ text: string; seq: number } | undefined>(undefined);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    if (externalQuery) setChatQuery(externalQuery);
  }, [externalQuery]);

  function fireQuery(text: string) {
    seqRef.current += 1;
    setChatQuery({ text, seq: seqRef.current });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim()) return;
    fireQuery(inputText.trim());
    setInputText('');
  }

  const revPct = yesterdayRevenue > 0
    ? Math.round((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100)
    : null;

  const retentionPct = customers.length > 0
    ? Math.round(activeCustomers30d / customers.length * 100)
    : 0;

  const missions = [
    {
      icon: '💰',
      title: es ? 'Cobrar Pagos' : 'Collect Payments',
      subtitle: chipData.staleRepairCount > 0
        ? `${chipData.staleRepairCount} ${es ? 'sin recoger' : 'uncollected'}`
        : staleRecoverable > 0 ? formatCurrency(staleRecoverable) : es ? 'Sin pendientes' : 'Up to date',
      accent: '#E59E0A',
      query: es ? 'qué reparaciones están retrasadas' : 'what repairs are delayed',
    },
    {
      icon: '🚀',
      title: es ? 'Promover Producto' : 'Promote a Product',
      subtitle: chipData.productOppsCount > 0
        ? `${chipData.productOppsCount} ${es ? 'oportunidades' : 'opportunities'}`
        : es ? 'Ver catálogo' : 'View catalog',
      accent: '#8B5CF6',
      query: es ? 'qué productos debo promover hoy' : 'what products should I promote today',
    },
    {
      icon: '✅',
      title: es ? 'Reparaciones Listas' : 'Repairs Ready',
      subtitle: chipData.repairsPending > 0
        ? `${chipData.repairsPending} ${es ? 'para entrega' : 'ready for pickup'}`
        : es ? 'Todo al día' : 'All caught up',
      accent: '#10B981',
      query: es ? 'reparaciones listas para entrega' : 'repairs ready for pickup',
    },
    {
      icon: '📞',
      title: es ? 'Contactar Clientes' : 'Contact Customers',
      subtitle: chipData.outreachCount >= 2
        ? `${chipData.outreachCount} ${es ? 'pendientes' : 'pending'}`
        : es ? 'Lista WhatsApp' : 'WhatsApp list',
      accent: '#3B82F6',
      query: es ? 'quién debo contactar hoy' : 'who should I contact today',
    },
  ];

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── LEFT: Store Pulse ──────────────────────────────────── */}
      <div style={{
        width: 210, flexShrink: 0,
        background: BG_LEFT,
        borderRight: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column',
        padding: '22px 18px 20px', overflowY: 'auto',
      }}>

        {/* Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: 18, borderBottom: `1px solid ${BORDER}`, marginBottom: 18, flexShrink: 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#1E3A6E', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2A4A72', letterSpacing: '0.04em' }}>
            CellHub Intelligence
          </span>
        </div>

        {/* TODAY */}
        <div style={{ flexShrink: 0 }}>
          <SectionLabel text={es ? 'HOY' : 'TODAY'} />
          <div style={{ fontSize: 26, fontWeight: 700, color: '#34D399', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 7 }}>
            {formatCurrency(todayRevenue)}
          </div>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            {revPct !== null && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                padding: '2px 7px', borderRadius: 4,
                color: revPct >= 0 ? '#34D399' : '#EF4444',
                background: revPct >= 0 ? '#34D39912' : '#EF444412',
                border: `1px solid ${revPct >= 0 ? '#34D39922' : '#EF444422'}`,
              }}>
                {revPct >= 0 ? '↑' : '↓'} {Math.abs(revPct)}%
              </span>
            )}
            <span style={{ fontSize: 11, color: TEXT_MUTED }}>
              {todaySalesCount} {es ? 'transacciones' : 'transactions'}
            </span>
          </div>
        </div>

        <div style={{ height: 1, background: '#0D1826', margin: '14px 0', flexShrink: 0 }} />

        {/* RETURNING CUSTOMERS */}
        <div style={{ flexShrink: 0 }}>
          <SectionLabel text={es ? 'CLIENTES QUE REGRESAN' : 'RETURNING CUSTOMERS'} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RetentionRing pct={retentionPct} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#64748B', lineHeight: 1, letterSpacing: '-0.01em' }}>
                {activeCustomers30d}{' '}
                <span style={{ fontSize: 13, color: TEXT_MUTED }}>/ {customers.length}</span>
              </div>
              <div style={{ fontSize: 10, color: TEXT_DIM, marginTop: 3, lineHeight: 1.5 }}>
                {es ? 'regresaron últimos 30 días' : 'returned last 30 days'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: '#0D1826', margin: '14px 0', flexShrink: 0 }} />

        {/* ACTIVE SERVICES */}
        <div style={{ flexShrink: 0 }}>
          <SectionLabel text={es ? 'SERVICIOS ACTIVOS' : 'ACTIVE SERVICES'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <ServiceTile count={repairsInProgress} label={es ? 'REPARACIONES' : 'REPAIRS'}   color="#F59E0B" />
            <ServiceTile count={layawaysActive}    label="LAYAWAYS"                           color="#8B5CF6" />
            <ServiceTile count={unlocksActive}     label="UNLOCKS"                            color="#3B82F6" />
            <ServiceTile count={specialOrdersActive} label={es ? 'ESPECIALES' : 'SPECIALS'}  color="#10B981" />
          </div>
        </div>

        <div style={{ height: 1, background: '#0D1826', margin: '14px 0', flexShrink: 0 }} />

        {/* HOURLY CHART */}
        <div style={{ flex: 1, minHeight: 90, display: 'flex', flexDirection: 'column' }}>
          <SectionLabel text={es ? 'VENTAS POR HORA' : 'SALES BY HOUR'} />
          <div style={{ flex: 1, minHeight: 0 }}>
            <HourlyChart hourlySales={hourlySales} />
          </div>
        </div>
      </div>

      {/* ── CENTER: Operational Heart ──────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: '26px 28px 22px',
        background: BG_MAIN, minWidth: 0,
      }}>

        <SectionLabel text={es ? 'ACCIONES OPERACIONALES' : 'OPERATIONAL ACTIONS'} />

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: 'minmax(130px, 200px) minmax(130px, 200px)',
          gap: 14,
        }}>
          {missions.map((m) => (
            <MissionCard
              key={m.query}
              icon={m.icon} title={m.title} subtitle={m.subtitle}
              accent={m.accent}
              onClick={() => fireQuery(m.query)}
            />
          ))}
        </div>

        <div style={{ paddingTop: 18 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={es ? 'Pregunta sobre tu tienda…' : 'Ask anything about your store…'}
              style={{
                flex: 1, background: BG_CARD, color: '#94A3B8',
                borderRadius: 10, padding: '13px 17px', fontSize: 13,
                border: `1px solid ${BORDER}`, outline: 'none', minWidth: 0,
              }}
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              style={{
                padding: '13px 18px', borderRadius: 10, fontSize: 17,
                background: inputText.trim() ? '#1A3560' : BG_CARD,
                color: inputText.trim() ? '#93C5FD' : TEXT_DIM,
                border: `1px solid ${inputText.trim() ? '#2D4E8A' : BORDER}`,
                cursor: inputText.trim() ? 'pointer' : 'not-allowed',
                flexShrink: 0, transition: 'background 0.14s, color 0.14s, border-color 0.14s',
              }}
            >
              →
            </button>
          </form>
        </div>
      </div>

      {/* ── RIGHT: Chat Execution ──────────────────────────────── */}
      <div style={{
        width: 356, flexShrink: 0,
        borderLeft: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', background: BG_MAIN,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '13px 18px 11px',
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}>
          <div style={{ width: 2, height: 10, borderRadius: 2, background: '#1A2B3C', flexShrink: 0 }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: TEXT_DIM, letterSpacing: '0.14em' }}>
            {es ? 'ASISTENTE' : 'ASSISTANT'}
          </span>
        </div>
        <OperatorChatShell
          engine={engine}
          customers={customers}
          lang={lang}
          externalQuery={chatQuery}
          onOpenPromote={onOpenPromote}
          onPanelCampaign={onPanelCampaign}
          chipData={chipData}
          compact
          hideInput
        />
      </div>
    </div>
  );
}
