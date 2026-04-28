// ============================================================
// CellHub Pro — Balance Sheet (Schedule L) Tab (editable)
// Form 1065 Schedule L — partnership balance sheet. 12 line
// items × 2 columns (Begin / End of year). All money in cents.
// Singleton per year. Persistence: settings.taxData.byYear[year].balanceSheet
// ============================================================

import { useMemo } from 'react';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from '@/i18n';
import { useTaxYear, emptyBalanceSheet, dollarsToCents, centsToDollars } from './taxData';
import { inputStyle, labelStyle, cardBox } from './taxStyles';
import type { TaxBalanceSheet } from '@/store/types';

interface Props {
  year: number;
}

// [baseKey, EN, ES, PT] — each produces two fields: <base>Begin, <base>End.
const ASSET_LINES: Array<[string, string, string, string]> = [
  ['cash',                'Cash',                       'Efectivo',                   'Caixa'],
  ['accountsReceivable',  'Accounts Receivable',        'Cuentas por Cobrar',         'Contas a Receber'],
  ['inventory',           'Inventory',                  'Inventario',                 'Estoque'],
  ['otherCurrentAssets',  'Other Current Assets',       'Otros Activos Corrientes',   'Outros Ativos Correntes'],
  ['buildings',           'Buildings & Depreciable',    'Edificios y Depreciables',   'Edifícios e Depreciáveis'],
  ['accDepreciation',     'Accumulated Depreciation',   'Depreciación Acumulada',     'Depreciação Acumulada'],
  ['land',                'Land',                       'Terreno',                    'Terra'],
  ['otherAssets',         'Other Assets',               'Otros Activos',              'Outros Ativos'],
];

const LIABILITY_LINES: Array<[string, string, string, string]> = [
  ['accountsPayable',     'Accounts Payable',           'Cuentas por Pagar',          'Contas a Pagar'],
  ['shortTermDebt',       'Short-Term Debt',            'Deuda Corto Plazo',          'Dívida de Curto Prazo'],
  ['longTermDebt',        'Long-Term Debt',             'Deuda Largo Plazo',          'Dívida de Longo Prazo'],
  ['otherLiabilities',    'Other Liabilities',          'Otros Pasivos',              'Outros Passivos'],
];

type BSKey = keyof TaxBalanceSheet;

export default function TaxBalanceSheetTab({ year }: Props) {
  const { t, locale } = useTranslation();
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
          {t('taxBS.title', year)}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {t('taxBS.subtitle')}
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
        <span>{t('taxBS.beginningOfYear')}</span>
        <span>{t('taxBS.endOfYear')}</span>
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
          {t('taxBS.assetsHeader')}
        </div>
        {ASSET_LINES.map(([k, en, esLabel, pt]) => (
          <Row key={k} baseKey={k} label={locale === 'pt' ? pt : locale === 'es' ? esLabel : en} />
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
          <span>{t('taxBS.totalAssets')}</span>
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
          {t('taxBS.liabilitiesHeader')}
        </div>
        {LIABILITY_LINES.map(([k, en, esLabel, pt]) => (
          <Row key={k} baseKey={k} label={locale === 'pt' ? pt : locale === 'es' ? esLabel : en} />
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
          <span>{t('taxBS.totalLiabilities')}</span>
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
          <span>{t('taxBS.partnersEquity')}</span>
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
