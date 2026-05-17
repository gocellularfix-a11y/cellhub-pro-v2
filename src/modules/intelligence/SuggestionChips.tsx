// SuggestionChips — Phase 3 operational signal chips.
// Surfaces live store signals as compact, clickable entry points.
// All chip clicks fire existing natural-language queries through
// the same fireQuery pipeline — no new handlers created.
import { memo } from 'react';
import { formatCurrency } from '@/utils/currency';

export interface ChipData {
  outreachCount: number;
  staleRepairCount: number;
  repairsPending: number;
  productOppsCount: number;
  biggestLeakCents: number;
  deadStockLockedCents: number;
}

interface ChipSignal {
  icon: string;
  title: string;
  subtitle: string;
  accent: string;
  query: string;
}

interface SuggestionChipsProps {
  chipData: ChipData;
  onFireChat: (query: string) => void;
  locale: string;
  mode?: 'row' | 'welcome';
}

// ── Build live signals from store data ───────────────────────
function buildSignals(d: ChipData, locale: string): ChipSignal[] {
  const es = locale === 'es';
  const pt = locale === 'pt';
  const signals: ChipSignal[] = [];

  if (d.outreachCount >= 2) {
    signals.push({
      icon: '📞',
      title: es ? `${d.outreachCount} clientes sin contactar`
           : pt ? `${d.outreachCount} clientes sem contato`
           :       `${d.outreachCount} customers pending outreach`,
      subtitle: es ? 'Seguimiento pendiente hoy'
              : pt ? 'Acompanhamento pendente hoje'
              :      'Follow-up still pending',
      accent: '#3B82F6',
      query: es ? 'quién debo contactar hoy'
           : pt ? 'quem devo contatar hoje'
           :      'show me customers I should contact today',
    });
  }

  if (d.staleRepairCount > 0) {
    signals.push({
      icon: '⏱️',
      title: es ? `${d.staleRepairCount} reparaciones sin recoger`
           : pt ? `${d.staleRepairCount} reparos sem retirada`
           :       `${d.staleRepairCount} repairs still uncollected`,
      subtitle: es ? 'Siguen esperando al cliente'
              : pt ? 'Ainda esperando o cliente'
              :      'Still waiting for customer',
      accent: '#F59E0B',
      query: es ? 'qué reparaciones están retrasadas'
           : pt ? 'quais reparos estão atrasados'
           :      'what repairs are delayed',
    });
  } else if (d.repairsPending > 0) {
    signals.push({
      icon: '✅',
      title: es ? `${d.repairsPending} reparaciones listas`
           : pt ? `${d.repairsPending} reparos prontos`
           :       `${d.repairsPending} repairs ready for pickup`,
      subtitle: es ? 'Pendiente notificar a clientes'
              : pt ? 'Pendente notificar clientes'
              :      'Customers not yet notified',
      accent: '#10B981',
      query: es ? 'reparaciones listas para entrega'
           : pt ? 'reparos prontos para retirada'
           :      'repairs ready for pickup',
    });
  }

  if (d.productOppsCount > 0) {
    signals.push({
      icon: '🚀',
      title: es ? 'Oportunidad de accesorios detectada'
           : pt ? 'Oportunidade de acessórios detectada'
           :      'Accessory opportunity detected',
      subtitle: es ? `${d.productOppsCount} productos para promover`
              : pt ? `${d.productOppsCount} produtos para promover`
              :      `${d.productOppsCount} products to promote`,
      accent: '#8B5CF6',
      query: es ? 'qué productos debo promover hoy'
           : pt ? 'quais produtos devo promover hoje'
           :      'what products should I promote today',
    });
  }

  if (d.biggestLeakCents > 0) {
    signals.push({
      icon: '💸',
      title: es ? 'Fuga de ganancia activa'
           : pt ? 'Vazamento de lucro ativo'
           :      'Profit leak still active',
      subtitle: `${formatCurrency(d.biggestLeakCents)} ${es ? 'aún en riesgo' : pt ? 'ainda em risco' : 'still at risk'}`,
      accent: '#EF4444',
      query: es ? 'qué está afectando mi ganancia'
           : pt ? 'o que está prejudicando meu lucro'
           :      'what is hurting my profit',
    });
  }

  if (d.deadStockLockedCents > 0) {
    signals.push({
      icon: '📦',
      title: es ? 'Dinero bloqueado en stock'
           : pt ? 'Dinheiro preso em estoque'
           :      'Cash locked in dead stock',
      subtitle: `${formatCurrency(d.deadStockLockedCents)} ${es ? 'aún inactivo' : pt ? 'ainda parado' : 'still idle'}`,
      accent: '#6366F1',
      query: es ? 'dónde está estancado el dinero'
           : pt ? 'onde o dinheiro está preso'
           :      'where is money stuck',
    });
  }

  // Fallback static chips when store has no live signals yet.
  if (signals.length < 3) {
    const statics: ChipSignal[] = [
      {
        icon: '📊',
        title: es ? 'Rendimiento de hoy'      : pt ? 'Desempenho de hoje'      : "Today's store performance",
        subtitle: es ? 'Ingresos, pedidos, ritmo' : pt ? 'Receita, pedidos, ritmo' : 'Revenue, orders, pace',
        accent: '#3B82F6',
        query: es ? 'cómo va mi tienda hoy' : pt ? 'como está minha loja hoje' : 'how is my store doing today',
      },
      {
        icon: '💰',
        title: es ? '¿Dónde está el dinero?'  : pt ? 'Onde está o dinheiro?'    : 'Where is money stuck?',
        subtitle: es ? 'Reparaciones y stock muerto' : pt ? 'Reparos e estoque parado' : 'Stale repairs and dead stock',
        accent: '#10B981',
        query: es ? 'dónde está estancado el dinero' : pt ? 'onde o dinheiro está preso' : 'where is money stuck',
      },
      {
        icon: '📞',
        title: es ? 'Contactar clientes hoy'  : pt ? 'Contatar clientes hoje'    : 'Contact customers today',
        subtitle: es ? 'Lista de outreach WhatsApp' : pt ? 'Lista de outreach WhatsApp' : 'WhatsApp outreach list',
        accent: '#3B82F6',
        query: es ? 'quién debo contactar hoy' : pt ? 'quem devo contatar hoje' : 'who should I contact today',
      },
    ];
    for (const s of statics) {
      if (!signals.find(x => x.query === s.query)) signals.push(s);
      if (signals.length >= 4) break;
    }
  }

  return signals.slice(0, 4);
}

// ── Main component ────────────────────────────────────────────
function SuggestionChips({
  chipData,
  onFireChat,
  locale,
  mode = 'row',
}: SuggestionChipsProps) {
  const signals = buildSignals(chipData, locale);

  if (mode === 'welcome') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {signals.map((s, i) => (
          <WelcomeCard key={i} signal={s} onClick={() => onFireChat(s.query)} />
        ))}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      overflowX: 'auto',
      paddingBottom: 4,
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
    } as React.CSSProperties}>
      {signals.map((s, i) => (
        <RowChip key={i} signal={s} onClick={() => onFireChat(s.query)} />
      ))}
    </div>
  );
}

export default memo(SuggestionChips);

// ── Row chip: compact horizontal card ────────────────────────
function RowChip({ signal, onClick }: { signal: ChipSignal; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '7px 11px',
        borderRadius: 8,
        border: `1px solid ${signal.accent}33`,
        background: `${signal.accent}0D`,
        cursor: 'pointer',
        flexShrink: 0,
        minWidth: 140,
        maxWidth: 200,
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{signal.icon}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: signal.accent,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: '1.2',
        }}>
          {signal.title}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#6B7280', paddingLeft: 19, lineHeight: '1.3' }}>
        {signal.subtitle}
      </div>
    </button>
  );
}

// ── Welcome card: larger display for empty state ─────────────
function WelcomeCard({ signal, onClick }: { signal: ChipSignal; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${signal.accent}33`,
        background: `${signal.accent}0D`,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'background 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{signal.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: signal.accent, lineHeight: '1.25' }}>
          {signal.title}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#6B7280', paddingLeft: 23, lineHeight: '1.35' }}>
        {signal.subtitle}
      </div>
    </button>
  );
}
