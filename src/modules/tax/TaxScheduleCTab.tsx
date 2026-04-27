// ============================================================
// CellHub Pro — Schedule C Tab (editable)
// IRS Form 1040 Schedule C — Profit or Loss from Business
// Line items 8–27 + line 30 (home office). 24 expense category
// totals. All money in cents. Singleton per year — no CRUD array.
// Persistence: settings.taxData.byYear[year].scheduleC
// ============================================================

import { useMemo } from 'react';
import { formatCurrency } from '@/utils/currency';
import { useTranslation } from '@/i18n';
import { useTaxYear, emptyScheduleC, dollarsToCents, centsToDollars } from './taxData';
import { inputStyle, labelStyle, cardBox } from './taxStyles';

interface Props {
  year: number;
}

// Field keys: order matches IRS Schedule C. Labels resolved via t('taxScheduleC.<key>').
const FIELD_KEYS: string[] = [
  'advertising',
  'carAndTruck',
  'commissions',
  'contractLabor',
  'depletion',
  'depreciation',
  'employeeBenefits',
  'insurance',
  'mortgageInterest',
  'otherInterest',
  'legalProfessional',
  'officeExpense',
  'pensionProfit',
  'rentVehicles',
  'rentProperty',
  'repairs',
  'supplies',
  'taxesLicenses',
  'travel',
  'meals',
  'utilities',
  'wages',
  'otherExpenses',
  'homeOffice',
];

export default function TaxScheduleCTab({ year }: Props) {
  const { t } = useTranslation();
  const tax = useTaxYear(year);
  const sc = tax.data.scheduleC ?? emptyScheduleC();

  const nonNeg = (cents: number) => Math.max(0, cents);

  const total = useMemo(
    () => FIELD_KEYS.reduce((sum, key) => sum + (sc as unknown as Record<string, number>)[key], 0),
    [sc],
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {t('taxScheduleC.title', year)}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {t('taxScheduleC.subtitle')}
        </div>
      </div>

      {/* 24 inputs in 3-column grid */}
      <div style={cardBox}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.75rem 1rem',
        }}>
          {FIELD_KEYS.map((key) => (
            <div key={key}>
              <label style={labelStyle}>{t(`taxScheduleC.${key}`)} ($)</label>
              <input
                type="text"
                inputMode="decimal"
                style={inputStyle}
                value={centsToDollars((sc as unknown as Record<string, number>)[key])}
                onChange={(e) => tax.updateScheduleC({ [key]: nonNeg(dollarsToCents(e.target.value)) } as Record<string, number>)}
                placeholder="0.00"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Total */}
      <div style={{
        ...cardBox,
        background: 'rgba(239,68,68,0.08)',
        border: '2px solid rgba(239,68,68,0.3)',
        marginBottom: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#cbd5e1' }}>
            {t('taxScheduleC.totalLabel')}
          </span>
          <span style={{
            fontSize: '1.4rem',
            fontWeight: 800,
            color: '#fca5a5',
            fontFamily: 'ui-monospace, monospace',
          }}>
            {formatCurrency(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
