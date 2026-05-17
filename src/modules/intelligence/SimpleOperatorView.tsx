// SimpleOperatorView — CellHub Intelligence 3-column command center.
// LEFT: Store Pulse (passive awareness)
// CENTER: Operational Heart (4 mission cards + single Ask input)
// RIGHT: Chat Execution (responses only, no input)
import { useState, useRef, useEffect } from 'react';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import type { ChipData } from './SuggestionChips';
import type { PanelCampaignDraft } from '@/services/intelligence/chat/handlers';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from '@/i18n';
import OperatorChatShell from './OperatorChatShell';

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
        : staleRecoverable > 0
          ? formatCurrency(staleRecoverable)
          : es ? 'Sin pendientes' : 'Up to date',
      accent: '#F59E0B',
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
        background: '#080E1A',
        borderRight: '1px solid #111827',
        display: 'flex', flexDirection: 'column',
        padding: '24px 18px', gap: 24, overflowY: 'auto',
      }}>
        {/* Brand */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#1E3A5F', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            CellHub
          </div>
          <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>
            Intelligence
          </div>
        </div>

        {/* Today */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#1F2937', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14 }}>
            {es ? 'HOY' : 'TODAY'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
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
            <div style={{ fontSize: 9, fontWeight: 700, color: '#1F2937', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14 }}>
              {es ? 'ATENCIÓN' : 'ATTENTION'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {chipData.staleRepairCount > 0 && (
                <PulsePill icon="⏱" accent="#F59E0B"
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
        padding: '28px 32px 24px', gap: 18,
        background: '#080F1E', overflowY: 'auto', minWidth: 0,
      }}>
        <div style={{
          fontSize: 9, fontWeight: 700, color: '#1F2937',
          letterSpacing: '0.14em', textTransform: 'uppercase',
        }}>
          {es ? 'ACCIONES OPERACIONALES' : 'OPERATIONAL ACTIONS'}
        </div>

        {/* 2×2 Mission cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1 }}>
          {missions.map((m) => (
            <button
              key={m.query}
              onClick={() => fireQuery(m.query)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: 14, padding: '26px 24px', borderRadius: 14, textAlign: 'left',
                background: '#0C1528',
                border: `1px solid ${m.accent}18`,
                borderLeft: `3px solid ${m.accent}`,
                cursor: 'pointer', transition: 'background 0.12s',
              }}
            >
              <span style={{ fontSize: 32, lineHeight: 1 }}>{m.icon}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: m.accent, marginBottom: 6, lineHeight: 1.2 }}>
                  {m.title}
                </div>
                <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.5 }}>
                  {m.subtitle}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Single Ask Intelligence input */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={es ? 'Pregunta sobre tu tienda…' : 'Ask anything about your store…'}
            style={{
              flex: 1, background: '#0C1528', color: '#CBD5E1',
              borderRadius: 12, padding: '14px 18px', fontSize: 14,
              border: '1px solid #1A2535', outline: 'none', minWidth: 0,
            }}
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            style={{
              padding: '14px 20px', borderRadius: 12, fontSize: 18,
              background: inputText.trim() ? '#1E3A6E' : '#0C1528',
              color: inputText.trim() ? '#93C5FD' : '#1E2D3D',
              border: `1px solid ${inputText.trim() ? '#2D4E8A' : '#1A2535'}`,
              cursor: inputText.trim() ? 'pointer' : 'not-allowed',
              flexShrink: 0, transition: 'all 0.12s',
            }}
          >
            →
          </button>
        </form>
      </div>

      {/* ── RIGHT: Chat Execution ──────────────────────────────── */}
      <div style={{
        width: 360, flexShrink: 0,
        borderLeft: '1px solid #111827',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', background: '#080F1E',
      }}>
        <div style={{
          padding: '14px 18px 10px',
          borderBottom: '1px solid #111827',
          fontSize: 10, fontWeight: 700, color: '#1F2937',
          letterSpacing: '0.14em', textTransform: 'uppercase', flexShrink: 0,
        }}>
          {es ? 'ASISTENTE' : 'ASSISTANT'}
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

function PulseRow({ label, value, valueColor = '#4B5563' }: {
  label: string; value: string; valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 11, color: '#374151' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: valueColor }}>{value}</span>
    </div>
  );
}

function PulsePill({ icon, text, accent, onClick }: {
  icon: string; text: string; accent: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 10px', borderRadius: 7, cursor: 'pointer',
        background: accent + '0F', border: `1px solid ${accent}22`,
        width: '100%', textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, color: accent, fontWeight: 500 }}>{text}</span>
    </button>
  );
}
