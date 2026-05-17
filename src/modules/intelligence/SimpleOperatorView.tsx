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
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
      <div style={{ width: 2, height: 10, borderRadius: 2, background: '#1A2B3C', flexShrink: 0 }} />
      <span style={{ fontSize: 9, fontWeight: 700, color: TEXT_DIM, letterSpacing: '0.14em' }}>
        {text}
      </span>
    </div>
  );
}

function PulseRow({ label, value, valueColor = '#64748B' }: {
  label: string; value: string; valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 11, color: TEXT_MUTED }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: valueColor, letterSpacing: '-0.01em' }}>{value}</span>
    </div>
  );
}

function PulsePill({ icon, text, accent, onClick }: {
  icon: string; text: string; accent: string; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
        background: hov ? accent + '18' : accent + '0B',
        border: `1px solid ${hov ? accent + '30' : accent + '1A'}`,
        width: '100%', textAlign: 'left',
        transition: 'background 0.14s, border-color 0.14s',
      }}
    >
      <span style={{ fontSize: 11, flexShrink: 0 }}>{icon}</span>
      <span style={{
        fontSize: 11, fontWeight: 500,
        color: hov ? accent : accent + 'BB',
        transition: 'color 0.14s',
      }}>
        {text}
      </span>
    </button>
  );
}

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
        gap: 12, padding: '24px 22px', borderRadius: 12, textAlign: 'left',
        background: hov ? BG_HOVER : BG_CARD,
        border: `1px solid ${hov ? accent + '28' : BORDER}`,
        borderLeft: `2px solid ${hov ? accent : accent + '88'}`,
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        minHeight: 0,
      }}
    >
      <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
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
}

export default function SimpleOperatorView({
  engine, customers, lang, externalQuery,
  onOpenPromote, onPanelCampaign, chipData,
  todayRevenue, todaySalesCount, totalAlerts,
  staleRecoverable, biggestLeak,
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

  const hasAttention = chipData.staleRepairCount > 0
    || chipData.outreachCount >= 2
    || chipData.repairsPending > 0
    || biggestLeak > 0;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── LEFT: Store Pulse ──────────────────────────────────── */}
      <div style={{
        width: 210, flexShrink: 0,
        background: BG_LEFT,
        borderRight: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column',
        padding: '22px 18px 24px', overflowY: 'auto',
      }}>

        {/* Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: 22, borderBottom: `1px solid ${BORDER}`, marginBottom: 22 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#1E3A6E', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2A4A72', letterSpacing: '0.04em' }}>
            CellHub Intelligence
          </span>
        </div>

        {/* Today metrics */}
        <div style={{ marginBottom: 22 }}>
          <SectionLabel text={es ? 'HOY' : 'TODAY'} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <PulseRow label={es ? 'Ventas' : 'Revenue'} value={formatCurrency(todayRevenue)} valueColor="#34D399" />
            <PulseRow label={es ? 'Transacciones' : 'Transactions'} value={String(todaySalesCount)} />
            {totalAlerts > 0 && (
              <PulseRow label={es ? 'Alertas' : 'Alerts'} value={String(totalAlerts)} valueColor="#FBBF24" />
            )}
          </div>
        </div>

        {/* Attention signals */}
        {hasAttention && (
          <div>
            <SectionLabel text={es ? 'ATENCIÓN' : 'ATTENTION'} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chipData.staleRepairCount > 0 && (
                <PulsePill icon="⏱" accent="#E59E0A"
                  text={`${chipData.staleRepairCount} ${es ? 'sin recoger' : 'uncollected'}`}
                  onClick={() => fireQuery(es ? 'qué reparaciones están retrasadas' : 'what repairs are delayed')} />
              )}
              {chipData.outreachCount >= 2 && (
                <PulsePill icon="📞" accent="#3B82F6"
                  text={`${chipData.outreachCount} ${es ? 'por contactar' : 'to contact'}`}
                  onClick={() => fireQuery(es ? 'quién debo contactar hoy' : 'who should I contact today')} />
              )}
              {chipData.repairsPending > 0 && (
                <PulsePill icon="✅" accent="#10B981"
                  text={`${chipData.repairsPending} ${es ? 'listas' : 'ready'}`}
                  onClick={() => fireQuery(es ? 'reparaciones listas para entrega' : 'repairs ready for pickup')} />
              )}
              {biggestLeak > 0 && (
                <PulsePill icon="💸" accent="#EF4444"
                  text={`${formatCurrency(biggestLeak)} ${es ? 'en riesgo' : 'at risk'}`}
                  onClick={() => fireQuery(es ? 'qué está afectando mi ganancia' : 'what is hurting my profit')} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── CENTER: Operational Heart ──────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: '26px 28px 22px',
        background: BG_MAIN, minWidth: 0,
      }}>

        {/* Section label */}
        <SectionLabel text={es ? 'ACCIONES OPERACIONALES' : 'OPERATIONAL ACTIONS'} />

        {/* 2×2 Mission cards — fill available vertical space */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 14, flex: 1, minHeight: 0,
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

        {/* Ask Intelligence — single global input */}
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
        {/* Minimal section header */}
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
