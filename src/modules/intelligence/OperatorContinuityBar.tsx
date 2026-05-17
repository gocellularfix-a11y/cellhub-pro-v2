// OperatorContinuityBar — Phase 5 persistent signal strip.
// Surfaces live "still active" operational signals between the chip row
// and the message list. Derived purely from chipData — no new props.
// Only visible when messages exist (empty state shows OperatorWelcome instead).
import type { ChipData } from './SuggestionChips';
import { formatCurrency } from '@/utils/currency';

interface Signal {
  label: string;
  accent: string;
  query: string;
}

function buildActiveSignals(d: ChipData, locale: string): Signal[] {
  const es = locale === 'es';
  const pt = locale === 'pt';
  const out: Signal[] = [];

  if (d.staleRepairCount > 0) {
    out.push({
      label: es ? `${d.staleRepairCount} reparaciones sin recoger`
           : pt ? `${d.staleRepairCount} reparos sem retirada`
           :      `${d.staleRepairCount} repairs uncollected`,
      accent: '#F59E0B',
      query: es ? 'qué reparaciones están retrasadas'
           : pt ? 'quais reparos estão atrasados'
           :      'what repairs are delayed',
    });
  } else if (d.repairsPending > 0) {
    out.push({
      label: es ? `${d.repairsPending} listas para entrega`
           : pt ? `${d.repairsPending} prontos para retirada`
           :      `${d.repairsPending} ready for pickup`,
      accent: '#10B981',
      query: es ? 'reparaciones listas para entrega'
           : pt ? 'reparos prontos para retirada'
           :      'repairs ready for pickup',
    });
  }

  if (d.outreachCount >= 2) {
    out.push({
      label: es ? `${d.outreachCount} clientes sin contactar`
           : pt ? `${d.outreachCount} clientes sem contato`
           :      `${d.outreachCount} customers pending outreach`,
      accent: '#3B82F6',
      query: es ? 'quién debo contactar hoy'
           : pt ? 'quem devo contatar hoje'
           :      'who should I contact today',
    });
  }

  if (d.deadStockLockedCents > 0 && out.length < 3) {
    out.push({
      label: `${formatCurrency(d.deadStockLockedCents)} ${es ? 'bloqueado en stock' : pt ? 'bloqueado em estoque' : 'locked in dead stock'}`,
      accent: '#6366F1',
      query: es ? 'dónde está estancado el dinero'
           : pt ? 'onde o dinheiro está preso'
           :      'where is money stuck',
    });
  }

  if (d.biggestLeakCents > 0 && out.length < 3) {
    out.push({
      label: `${formatCurrency(d.biggestLeakCents)} ${es ? 'en riesgo' : pt ? 'em risco' : 'profit at risk'}`,
      accent: '#EF4444',
      query: es ? 'qué está afectando mi ganancia'
           : pt ? 'o que está prejudicando meu lucro'
           :      'what is hurting my profit',
    });
  }

  return out.slice(0, 3);
}

interface OperatorContinuityBarProps {
  chipData: ChipData;
  onFireChat: (query: string) => void;
  locale: string;
}

export default function OperatorContinuityBar({ chipData, onFireChat, locale }: OperatorContinuityBarProps) {
  const signals = buildActiveSignals(chipData, locale);
  if (signals.length === 0) return null;

  const headerLabel = locale === 'es' ? 'AÚN ACTIVO' : locale === 'pt' ? 'AINDA ATIVO' : 'STILL ACTIVE';

  return (
    <div style={{
      padding: '5px 14px',
      borderBottom: '1px solid #0D1420',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap' as React.CSSProperties['flexWrap'],
      background: '#080E1A',
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', flexShrink: 0 }}>
        {headerLabel}
      </span>
      {signals.map((sig, i) => (
        <button
          key={i}
          onClick={() => onFireChat(sig.query)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 9px',
            borderRadius: 99,
            fontSize: 11,
            color: sig.accent,
            background: `${sig.accent}12`,
            border: `1px solid ${sig.accent}30`,
            cursor: 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap' as React.CSSProperties['whiteSpace'],
          }}
        >
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: sig.accent, flexShrink: 0, display: 'inline-block',
          }} />
          {sig.label}
        </button>
      ))}
    </div>
  );
}
