// SimpleOperatorView — Phase 7 radically simplified operator layout.
// One priority. One action. Everything else quiet.
// Left: what matters most right now. Right: compact chat panel.
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import type { ChipData } from './SuggestionChips';
import type { PanelCampaignDraft } from '@/services/intelligence/chat/handlers';
import { formatCurrency } from '@/utils/currency';
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
  onFireChat: (query: string) => void;
}

interface Priority {
  icon: string;
  title: string;
  subtitle: string;
  accent: string;
  query: string;
}

function derivePriority(d: ChipData, lang: 'en' | 'es'): Priority | null {
  const es = lang === 'es';

  if (d.staleRepairCount > 0) {
    return {
      icon: '⏱️',
      title: es
        ? `${d.staleRepairCount} reparaciones sin recoger`
        : `${d.staleRepairCount} repairs still uncollected`,
      subtitle: es
        ? 'Estos clientes no han regresado. Contáctalos para recuperar el dinero.'
        : 'These customers haven\'t returned. Reach out to recover the payment.',
      accent: '#F59E0B',
      query: es ? 'qué reparaciones están retrasadas' : 'what repairs are delayed',
    };
  }

  if (d.outreachCount >= 2) {
    return {
      icon: '📞',
      title: es
        ? `${d.outreachCount} clientes esperando contacto`
        : `${d.outreachCount} customers need follow-up`,
      subtitle: es
        ? 'Seguimiento pendiente. Unos mensajes de WhatsApp pueden cerrar ventas hoy.'
        : 'Pending follow-up. A few WhatsApp messages can close sales today.',
      accent: '#3B82F6',
      query: es ? 'quién debo contactar hoy' : 'who should I contact today',
    };
  }

  if (d.repairsPending > 0) {
    return {
      icon: '✅',
      title: es
        ? `${d.repairsPending} reparaciones listas`
        : `${d.repairsPending} repairs ready for pickup`,
      subtitle: es
        ? 'Los clientes aún no han sido notificados. Notifícalos ahora.'
        : 'Customers haven\'t been notified yet. Let them know now.',
      accent: '#10B981',
      query: es ? 'reparaciones listas para entrega' : 'repairs ready for pickup',
    };
  }

  if (d.biggestLeakCents > 0) {
    return {
      icon: '💸',
      title: es ? 'Fuga de ganancia activa' : 'Profit leak active',
      subtitle: `${formatCurrency(d.biggestLeakCents)} ${es ? 'en riesgo. Revisa qué está pasando.' : 'at risk. See what\'s happening.'}`,
      accent: '#EF4444',
      query: es ? 'qué está afectando mi ganancia' : 'what is hurting my profit',
    };
  }

  if (d.deadStockLockedCents > 0) {
    return {
      icon: '📦',
      title: es ? 'Dinero bloqueado en stock' : 'Cash locked in dead stock',
      subtitle: `${formatCurrency(d.deadStockLockedCents)} ${es ? 'sin movimiento. ¿Qué hacer con esto?' : 'sitting idle. What can be done?'}`,
      accent: '#6366F1',
      query: es ? 'dónde está estancado el dinero' : 'where is money stuck',
    };
  }

  if (d.productOppsCount > 0) {
    return {
      icon: '🚀',
      title: es ? 'Oportunidad de accesorios detectada' : 'Accessory opportunity detected',
      subtitle: es
        ? `${d.productOppsCount} productos que puedes promover hoy.`
        : `${d.productOppsCount} products worth promoting today.`,
      accent: '#8B5CF6',
      query: es ? 'qué productos debo promover hoy' : 'what products should I promote today',
    };
  }

  return null;
}

const QUICK_ACTIONS: Array<{ icon: string; labelEn: string; labelEs: string; query: string; accent: string }> = [
  { icon: '📊', labelEn: "Today's performance", labelEs: 'Rendimiento de hoy', query: 'how is my store doing today', accent: '#3B82F6' },
  { icon: '💰', labelEn: 'Where is money stuck?', labelEs: '¿Dónde está el dinero?', query: 'where is money stuck', accent: '#10B981' },
  { icon: '📞', labelEn: 'Contact list', labelEs: 'Lista de contacto', query: 'who should I contact today', accent: '#3B82F6' },
  { icon: '🚀', labelEn: 'Promote products', labelEs: 'Promover productos', query: 'what products should I promote today', accent: '#8B5CF6' },
];

export default function SimpleOperatorView({
  engine,
  customers,
  lang,
  externalQuery,
  onOpenPromote,
  onPanelCampaign,
  chipData,
  todayRevenue,
  todaySalesCount,
  onFireChat,
}: SimpleOperatorViewProps) {
  const es = lang === 'es';
  const priority = derivePriority(chipData, lang);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 14, flex: 1, minHeight: 0 }}>

      {/* ── LEFT: Priority panel ──────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>

        {/* Revenue summary — minimal */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '10px 16px', borderRadius: 8,
          background: '#0F1829', border: '1px solid #1A2535',
        }}>
          <div>
            <div style={{ fontSize: 10, color: '#4B5563', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {es ? 'Ventas hoy' : 'Today'}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#34D399', lineHeight: 1.2 }}>
              {formatCurrency(todayRevenue)}
            </div>
          </div>
          <div style={{ width: 1, height: 32, background: '#1A2535' }} />
          <div style={{ fontSize: 13, color: '#6B7280' }}>
            {todaySalesCount} {es ? 'transacciones' : 'transactions'}
          </div>
        </div>

        {/* Primary focus card */}
        {priority ? (
          <div style={{
            flex: 1, padding: '24px 28px', borderRadius: 10,
            background: '#0F1829',
            border: `1px solid ${priority.accent}22`,
            borderLeft: `4px solid ${priority.accent}`,
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div>
              <div style={{ fontSize: 11, color: '#4B5563', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                {es ? 'ATENCIÓN AHORA' : 'FOCUS NOW'}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{priority.icon}</span>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#E5E7EB', lineHeight: 1.3 }}>
                  {priority.title}
                </div>
              </div>
              <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, paddingLeft: 38 }}>
                {priority.subtitle}
              </div>
            </div>
            <div style={{ paddingLeft: 38 }}>
              <button
                onClick={() => onFireChat(priority.query)}
                style={{
                  padding: '10px 22px', borderRadius: 7,
                  fontSize: 13, fontWeight: 600,
                  background: `${priority.accent}18`,
                  color: priority.accent,
                  border: `1px solid ${priority.accent}40`,
                  cursor: 'pointer',
                }}
              >
                {es ? 'Ver detalles →' : 'See details →'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            flex: 1, padding: '24px 28px', borderRadius: 10,
            background: '#0F1829', border: '1px solid #1A2535',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            gap: 10, textAlign: 'center',
          }}>
            <div style={{ fontSize: 32 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#34D399' }}>
              {es ? 'Todo al día' : 'All caught up'}
            </div>
            <div style={{ fontSize: 13, color: '#4B5563' }}>
              {es ? 'No hay alertas activas en este momento.' : 'No active alerts right now.'}
            </div>
          </div>
        )}

        {/* Quick actions — 4 compact buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.query}
              onClick={() => onFireChat(qa.query)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 5, padding: '10px 8px', borderRadius: 8,
                background: '#0F1829', border: '1px solid #1A2535',
                cursor: 'pointer', fontSize: 11,
                color: '#6B7280', textAlign: 'center',
              }}
            >
              <span style={{ fontSize: 16 }}>{qa.icon}</span>
              <span style={{ lineHeight: 1.3 }}>{es ? qa.labelEs : qa.labelEn}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Compact chat ───────────────────────────────── */}
      <OperatorChatShell
        engine={engine}
        customers={customers}
        lang={lang}
        externalQuery={externalQuery}
        onOpenPromote={onOpenPromote}
        onPanelCampaign={onPanelCampaign}
        chipData={chipData}
        compact
      />
    </div>
  );
}
