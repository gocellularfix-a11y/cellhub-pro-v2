// ============================================================
// CellHub Pro — Balance Sheet (Schedule L) Tab (editable)
// Form 1065 Schedule L — partnership balance sheet. 12 line
// items × 2 columns (Begin / End of year). All money in cents.
// Singleton per year. Persistence: settings.taxData.byYear[year].balanceSheet
// ============================================================

import { useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { formatCurrency } from '@/utils/currency';
import { useTaxYear, emptyBalanceSheet, dollarsToCents, centsToDollars } from './taxData';
import { inputStyle, labelStyle, cardBox } from './taxStyles';
import type { TaxBalanceSheet } from '@/store/types';

interface Props {
  year: number;
}

// [baseKey, EN label, ES label] — each produces two fields: <base>Begin, <base>End.
const ASSET_LINES: Array<[string, string, string]> = [
  ['cash',                'Cash',                       'Efectivo'],
  ['accountsReceivable',  'Accounts Receivable',        'Cuentas por Cobrar'],
  ['inventory',           'Inventory',                  'Inventario'],
  ['otherCurrentAssets',  'Other Current Assets',       'Otros Activos Corrientes'],
  ['buildings',           'Buildings & Depreciable',    'Edificios y Depreciables'],
  ['accDepreciation',     'Accumulated Depreciation',   'Depreciación Acumulada'],
  ['land',                'Land',                       'Terreno'],
  ['otherAssets',         'Other Assets',               'Otros Activos'],
];

const LIABILITY_LINES: Array<[string, string, string]> = [
  ['accountsPayable',     'Accounts Payable',           'Cuentas por Pagar'],
  ['shortTermDebt',       'Short-Term Debt',            'Deuda Corto Plazo'],
  ['longTermDebt',        'Long-Term Debt',             'Deuda Largo Plazo'],
  ['otherLiabilities',    'Other Liabilities',          'Otros Pasivos'],
];

type BSKey = keyof TaxBalanceSheet;

export default function TaxBalanceSheetTab({ year }: Props) {
  const { state: { lang } } = useApp();
  const es = lang === 'es';
  const tax = useTaxYear(year);
  const bs = tax.data.balanceSheet ?? emptyBalanceSheet();

  const nonNeg = (cents: number) => Math.max(0, cents);

  const totals = useMemo(() => {
    const assetBegin = ASSET_LINES.reduce((s, [k]) => s + bs[`${k}Begin` as BSKey], 0);
    const assetEnd   = ASSET_LINES.reduce((s, [k]) => s + bs[`${k}End` as BSKey], 0);
    const liabBegin  = LIABILITY_LINES.reduce((s, [k]) => s + bs[`${k}Begin` as BSKey], 0);
    const liabEnd    = LIABILITY_LINES.reduce((s, [k]) => s + bs[`${k}End` as BSKey], 0);
    return {
      assetBegin, assetEnd, liabBegin, liabEnd,
      equityBegin: assetBegin - liabBegin,
      equityEnd: assetEnd - liabEnd,
    };
  }, [bs]);

  const Row = ({ baseKey, label }: { baseKey: string; label: string }) => {
    const beginKey = `${baseKey}Begin` as BSKey;
    const endKey = `${baseKey}End` as BSKey;
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr',
        gap: '0.75rem',
        alignItems: 'center',
        marginBottom: '0.6rem',
      }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        <input
          type="text"
          inputMode="decimal"
          style={inputStyle}
          value={centsToDollars(bs[beginKey])}
          onChange={(e) => tax.updateBalanceSheet({ [beginKey]: nonNeg(dollarsToCents(e.target.value)) } as Partial<TaxBalanceSheet>)}
          placeholder="0.00"
        />
        <input
          type="text"
          inputMode="decimal"
          style={inputStyle}
          value={centsToDollars(bs[endKey])}
          onChange={(e) => tax.updateBalanceSheet({ [endKey]: nonNeg(dollarsToCents(e.target.value)) } as Partial<TaxBalanceSheet>)}
          placeholder="0.00"
        />
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'Schedule L — Balance General' : 'Schedule L — Balance Sheet'} — {year}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {es
            ? 'Form 1065. Requerido si ingresos ≥ $250K o activos ≥ $1M. Valores al inicio y fin del año.'
            : 'Form 1065. Required if receipts ≥ $250K or assets ≥ $1M. Beginning + ending year values.'}
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr',
        gap: '0.75rem',
        padding: '0 0 0.5rem 0',
        fontSize: '0.72rem',
        color: '#94a3b8',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        <span></span>
        <span>{es ? 'Inicio del Año ($)' : 'Beginning of Year ($)'}</span>
        <span>{es ? 'Fin del Año ($)' : 'End of Year ($)'}</span>
      </div>

      {/* ── Assets ── */}
      <div style={cardBox}>
        <div style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#60a5fa',
          marginBottom: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {es ? 'Activos' : 'Assets'}
        </div>
        {ASSET_LINES.map(([k, en, esLabel]) => (
          <Row key={k} baseKey={k} label={es ? esLabel : en} />
        ))}

        {/* Asset totals */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr',
          gap: '0.75rem',
          marginTop: '0.5rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid rgba(96,165,250,0.3)',
          fontSize: '0.85rem',
          fontWeight: 700,
          color: '#bfdbfe',
        }}>
          <span>{es ? 'Total Activos' : 'Total Assets'}</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{formatCurrency(totals.assetBegin)}</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{formatCurrency(totals.assetEnd)}</span>
        </div>
      </div>

      {/* ── Liabilities ── */}
      <div style={cardBox}>
        <div style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#f87171',
          marginBottom: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {es ? 'Pasivos' : 'Liabilities'}
        </div>
        {LIABILITY_LINES.map(([k, en, esLabel]) => (
          <Row key={k} baseKey={k} label={es ? esLabel : en} />
        ))}

        {/* Liability totals */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr',
          gap: '0.75rem',
          marginTop: '0.5rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid rgba(248,113,113,0.3)',
          fontSize: '0.85rem',
          fontWeight: 700,
          color: '#fecaca',
        }}>
          <span>{es ? 'Total Pasivos' : 'Total Liabilities'}</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{formatCurrency(totals.liabBegin)}</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{formatCurrency(totals.liabEnd)}</span>
        </div>
      </div>

      {/* ── Partners' Equity (derived) ── */}
      <div style={{
        ...cardBox,
        background: 'rgba(34,197,94,0.08)',
        border: '2px solid rgba(34,197,94,0.3)',
        marginBottom: 0,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr',
          gap: '0.75rem',
          fontSize: '0.9rem',
          fontWeight: 700,
          color: '#cbd5e1',
        }}>
          <span>{es ? "Capital de Socios (Activos − Pasivos)" : "Partners' Equity (Assets − Liabilities)"}</span>
          <span style={{
            fontFamily: 'ui-monospace, monospace',
            color: totals.equityBegin >= 0 ? '#86efac' : '#fca5a5',
            fontSize: '1rem',
          }}>{formatCurrency(totals.equityBegin)}</span>
          <span style={{
            fontFamily: 'ui-monospace, monospace',
            color: totals.equityEnd >= 0 ? '#86efac' : '#fca5a5',
            fontSize: '1rem',
          }}>{formatCurrency(totals.equityEnd)}</span>
        </div>
      </div>
    </div>
  );
}
