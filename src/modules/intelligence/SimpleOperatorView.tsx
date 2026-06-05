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

// ── Design tokens (mockup-exact) ──────────────────────────────
const BG_LEFT    = '#121821';
const BG_MAIN    = '#0f141b';
const BG_CARD    = '#171f2a';
const BORDER     = '#1d2633';
const TEXT_PRIMARY = '#f3f4f6';
const TEXT_MUTED   = '#8b98a7';
const TEXT_DIM     = '#6b7280';

// ── Shared sub-components ─────────────────────────────────────

function SectionTitle({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '.08em',
      textTransform: 'uppercase', color: TEXT_DIM, marginBottom: 14,
    }}>
      {text}
    </div>
  );
}

// ── Left panel sub-components ──────────────────────────────────

function RetentionRing({ pct, active, total }: { pct: number; active: number; total: number }) {
  const deg = Math.round(pct / 100 * 360);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{
        width: 62, height: 62, borderRadius: '50%', flexShrink: 0,
        background: `conic-gradient(#3b82f6 0deg ${deg}deg, #1f2937 ${deg}deg 360deg)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: BG_LEFT,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#93c5fd', fontSize: 13, fontWeight: 700,
        }}>
          {pct}%
        </div>
      </div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: TEXT_PRIMARY, lineHeight: 1, marginBottom: 4 }}>
          {active} <span style={{ fontSize: 14, color: TEXT_MUTED }}>/ {total}</span>
        </div>
        <div style={{ fontSize: 12, color: TEXT_MUTED, lineHeight: 1.5 }}>
          Customers returned<br />during the last 30 days
        </div>
      </div>
    </div>
  );
}

interface ServiceCardProps {
  count: number;
  label: string;
  countColor: string;
  borderColor: string;
}
function ServiceCard({ count, label, countColor, borderColor }: ServiceCardProps) {
  return (
    <div style={{
      background: BG_CARD, borderRadius: 16, padding: '16px 14px',
      border: `1px solid ${borderColor}`,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, marginBottom: 8, color: countColor }}>
        {count}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '.06em',
        textTransform: 'uppercase', color: TEXT_MUTED,
      }}>
        {label}
      </div>
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
  const displayHours = [9, 10, 11, 12, 13, 14, 15, 16];
  const maxAmount = Math.max(...displayHours.map(h => hourlySales[h] ?? 0), 1);

  const labelFor = (h: number) => {
    if (h === 9) return '9a';
    if (h === 12) return '12';
    return h < 12 ? String(h) : String(h - 12);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: '100%' }}>
      {displayHours.map((h, i) => {
        const amount = hourlySales[h] ?? 0;
        const isFuture = h > now;
        const isCurrent = h === now;
        const pct = isFuture ? 4 : Math.max(amount / maxAmount * 100, 8);
        return (
          <div key={h} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 8,
          }}>
            <div style={{
              width: '100%',
              height: animated ? `${pct}%` : '0%',
              borderRadius: '8px 8px 0 0',
              background: isCurrent ? '#3b82f6' : '#243244',
              opacity: isFuture ? 0.35 : 1,
              transition: `height 0.5s ease-out ${i * 40}ms`,
              minHeight: 10,
            }} />
            <span style={{ fontSize: 11, color: TEXT_DIM }}>{labelFor(h)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Center panel sub-components ───────────────────────────────

interface ActionCardProps {
  icon: string;
  title: string;
  subtitle: string;
  borderColor: string;
  iconBg: string;
  onClick: () => void;
}
function ActionCard({ icon, title, subtitle, borderColor, iconBg, onClick }: ActionCardProps) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: 24, borderRadius: 22, textAlign: 'left',
        background: hov ? '#1c2535' : BG_CARD,
        border: `1px solid ${borderColor}`,
        cursor: 'pointer',
        transition: 'background 0.15s',
        minHeight: 0,
      }}
    >
      <div>
        <div style={{
          width: 56, height: 56, borderRadius: 16, background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, marginBottom: 18,
        }}>
          {icon}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 8 }}>
          {title}
        </div>
      </div>
      <div style={{ fontSize: 14, color: TEXT_MUTED, lineHeight: 1.6 }}>
        {subtitle}
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────

interface SimpleOperatorViewProps {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es' | 'pt';
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
  // R-INTELLIGENCE-LAYOUT-AND-PT-TRANSLATIONS-V1: pt branch so the 3-column
  // command center (action cards, store pulse, labels) follows the app language.
  const pt = locale === 'pt';
  const seqRef = useRef(0);
  const [chatQuery, setChatQuery] = useState<{ text: string; seq: number } | undefined>(undefined);
  const [inputText, setInputText] = useState('');
  const [clearSeq, setClearSeq] = useState(0);

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

  const actions = [
    {
      icon: '💰',
      title: es ? 'Cobrar Pagos' : pt ? 'Cobrar Pagamentos' : 'Collect Payments',
      subtitle: chipData.staleRepairCount > 0
        ? `${chipData.staleRepairCount} ${es ? 'clientes sin recoger' : pt ? 'clientes aguardando pagamento' : 'customers waiting for payment'}`
        : staleRecoverable > 0 ? formatCurrency(staleRecoverable) : es ? 'Sin pendientes' : pt ? 'Em dia' : 'Up to date',
      borderColor: '#3a3218',
      iconBg: '#3a3218',
      query: es ? 'qué reparaciones están retrasadas' : 'what repairs are delayed',
    },
    {
      icon: '📦',
      title: es ? 'Promover Producto' : pt ? 'Promover Produto' : 'Promote Product',
      subtitle: chipData.productOppsCount > 0
        ? `${chipData.productOppsCount} ${es ? 'oportunidades disponibles' : pt ? 'oportunidades de upsell disponíveis' : 'suggested upsell opportunities available'}`
        : es ? 'Ver catálogo' : pt ? 'Oportunidades de upsell disponíveis' : 'Suggested upsell opportunities available',
      borderColor: '#312444',
      iconBg: '#312444',
      query: es ? 'qué productos debo promover hoy' : 'what products should I promote today',
    },
    {
      icon: '🔧',
      title: es ? 'Reparaciones Listas' : pt ? 'Reparos Prontos' : 'Repairs Ready',
      subtitle: chipData.repairsPending > 0
        ? `${chipData.repairsPending} ${es ? 'esperando recoger' : pt ? 'aguardando retirada' : 'repairs have been waiting for pickup'}`
        : es ? 'Todo al día' : pt ? 'Tudo em dia' : 'All caught up',
      borderColor: '#17352a',
      iconBg: '#17352a',
      query: es ? 'reparaciones listas para entrega' : 'repairs ready for pickup',
    },
    {
      icon: '📲',
      title: es ? 'Contactar Clientes' : pt ? 'Contatar Clientes' : 'Contact Customers',
      subtitle: chipData.outreachCount >= 2
        ? `${chipData.outreachCount} ${es ? 'pendientes' : pt ? 'pendentes' : 'pending'}`
        : es ? 'Seguimiento clientes inactivos' : pt ? 'Acompanhe clientes inativos ou de alto valor' : 'Follow up with inactive or high-value customers',
      borderColor: '#1c3147',
      iconBg: '#1c3147',
      query: es ? 'quién debo contactar hoy' : 'who should I contact today',
    },
  ];

  return (
    // R-INTELLIGENCE-LAYOUT-AND-PT-TRANSLATIONS-V1: definite viewport-relative
    // height (was `flex: 1` inside a `minHeight: 100%` scrolling page, which gave
    // the flex children NO resolved height — so long chat content grew the row
    // and stretched the center action-card grid). A definite height lets each
    // column scroll INTERNALLY (chat included) and keeps the 2×2 card grid stable
    // regardless of chat length. Matches the existing `calc(100vh - 7rem)`
    // convention used by OperatorChatShell. Page still scrolls to legacy sections.
    <div style={{ display: 'flex', height: 'calc(100vh - 7rem)', minHeight: 0, overflow: 'hidden' }}>

      {/* ── LEFT: Store Pulse ──────────────────────────────────── */}
      <div style={{
        width: 290, flexShrink: 0,
        background: BG_LEFT,
        borderRight: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column',
        padding: '24px 22px', overflowY: 'auto',
      }}>

        {/* Branding */}
        <div style={{
          paddingBottom: 20,
          borderBottom: `1px solid ${BORDER}`,
          marginBottom: 24,
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 4 }}>
            CellHub
          </div>
          <div style={{ fontSize: 13, color: '#7b8794' }}>
            {es ? 'Resumen de tu tienda' : pt ? 'Resumo de inteligência da loja' : 'Store intelligence overview'}
          </div>
        </div>

        {/* TODAY */}
        <div style={{ marginBottom: 26, flexShrink: 0 }}>
          <SectionTitle text={es ? 'Hoy' : pt ? 'Hoje' : 'Today'} />
          <div style={{
            fontSize: 40, fontWeight: 700, lineHeight: 1,
            color: '#34d399', marginBottom: 10,
          }}>
            {formatCurrency(todayRevenue)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {revPct !== null && (
              <div style={{
                background: revPct >= 0 ? '#17352a' : '#3b1a1a',
                color: revPct >= 0 ? '#34d399' : '#f87171',
                borderRadius: 999, padding: '5px 10px',
                fontSize: 12, fontWeight: 600,
              }}>
                {revPct >= 0 ? '↑' : '↓'} {Math.abs(revPct)}%
              </div>
            )}
            <div style={{ fontSize: 13, color: TEXT_MUTED }}>
              {todaySalesCount} {es ? 'transacciones' : pt ? 'transações' : 'transactions'}
            </div>
          </div>
        </div>

        {/* RETURNING CUSTOMERS */}
        <div style={{ marginBottom: 26, flexShrink: 0 }}>
          <SectionTitle text={es ? 'Clientes que regresan' : pt ? 'Clientes recorrentes' : 'Returning Customers'} />
          <RetentionRing pct={retentionPct} active={activeCustomers30d} total={customers.length} />
        </div>

        {/* ACTIVE SERVICES */}
        <div style={{ marginBottom: 26, flexShrink: 0 }}>
          <SectionTitle text={es ? 'Servicios activos' : pt ? 'Serviços ativos' : 'Active Services'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ServiceCard count={repairsInProgress} label={es ? 'Reparaciones' : pt ? 'Reparos' : 'Repairs'}       countColor="#fbbf24" borderColor="#3a3218" />
            <ServiceCard count={layawaysActive}    label="Layaways"                                countColor="#a78bfa" borderColor="#312444" />
            <ServiceCard count={unlocksActive}     label="Unlocks"                                 countColor="#60a5fa" borderColor="#1c3147" />
            <ServiceCard count={specialOrdersActive} label={es ? 'Especiales' : pt ? 'Especiais' : 'Special Orders'} countColor="#34d399" borderColor="#17352a" />
          </div>
        </div>

        {/* SALES BY HOUR */}
        <div style={{ flex: 1, minHeight: 100, display: 'flex', flexDirection: 'column' }}>
          <SectionTitle text={es ? 'Ventas por hora' : pt ? 'Vendas por hora' : 'Sales by Hour'} />
          <div style={{ flex: 1, minHeight: 0 }}>
            <HourlyChart hourlySales={hourlySales} />
          </div>
        </div>
      </div>

      {/* ── CENTER: Operational Heart ──────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: 28, background: BG_MAIN, minWidth: 0,
      }}>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 4 }}>
            {es ? 'Acciones Operacionales' : pt ? 'Ações Operacionais' : 'Operational Actions'}
          </div>
          <div style={{ fontSize: 13, color: '#7b8794' }}>
            {es ? 'Acciones rápidas para las prioridades de hoy' : pt ? 'Ações rápidas para as prioridades de hoje' : "Quick actions for today's priorities"}
          </div>
        </div>

        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 18,
        }}>
          {actions.map((a) => (
            <ActionCard
              key={a.query}
              icon={a.icon}
              title={a.title}
              subtitle={a.subtitle}
              borderColor={a.borderColor}
              iconBg={a.iconBg}
              onClick={() => fireQuery(a.query)}
            />
          ))}
        </div>

        <div style={{ marginTop: 20 }}>
          <form
            onSubmit={handleSubmit}
            style={{
              height: 60, background: BG_CARD,
              border: `1px solid #1f2937`, borderRadius: 18,
              display: 'flex', alignItems: 'center',
              padding: '0 12px 0 18px', gap: 12,
            }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={es ? 'Pregunta a Intelligence…' : pt ? 'Pergunte ao Intelligence…' : 'Ask Intelligence…'}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: TEXT_PRIMARY, fontSize: 14,
              }}
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              style={{
                width: 44, height: 44, border: 'none', borderRadius: 14,
                background: inputText.trim() ? '#2563eb' : '#1d2633',
                color: inputText.trim() ? 'white' : TEXT_DIM,
                fontSize: 18, cursor: inputText.trim() ? 'pointer' : 'not-allowed',
                flexShrink: 0, transition: 'background 0.14s, color 0.14s',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              →
            </button>
          </form>
        </div>
      </div>

      {/* ── RIGHT: Chat Execution ──────────────────────────────── */}
      <div style={{
        width: 420, flexShrink: 0,
        background: BG_LEFT,
        borderLeft: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '24px 22px',
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: TEXT_PRIMARY }}>
              {/* R-INTELLIGENCE-USE-APP-LANGUAGE-V1: title follows app language. */}
              {locale === 'es' ? 'Inteligencia' : locale === 'pt' ? 'Inteligência' : 'Intelligence'}
            </div>
            <button
              onClick={() => setClearSeq((n) => n + 1)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 5,
                background: 'transparent', border: `1px solid ${BORDER}`,
                color: TEXT_DIM, cursor: 'pointer',
              }}
            >
              {locale === 'es' ? 'Nueva sesión' : locale === 'pt' ? 'Nova sessão' : 'New session'}
            </button>
          </div>
          <div style={{ fontSize: 13, color: '#7b8794' }}>
            {locale === 'es' ? 'Pregunta sobre tu tienda' : locale === 'pt' ? 'Pergunte sobre sua loja' : 'Ask about your store'}
          </div>
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
          clearSeq={clearSeq}
        />
      </div>
    </div>
  );
}
