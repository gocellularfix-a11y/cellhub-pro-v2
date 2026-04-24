// ============================================================
// CellHub Pro — Schedule C Tab (editable)
// IRS Form 1040 Schedule C — Profit or Loss from Business
// Line items 8–27 + line 30 (home office). 24 expense category
// totals. All money in cents. Singleton per year — no CRUD array.
// Persistence: settings.taxData.byYear[year].scheduleC
// ============================================================

import { useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { formatCurrency } from '@/utils/currency';
import { useTaxYear, emptyScheduleC, dollarsToCents, centsToDollars } from './taxData';
import { inputStyle, labelStyle, cardBox } from './taxStyles';

interface Props {
  year: number;
}

// Field metadata: [key, EN label, ES label]. Order matches IRS Schedule C.
const FIELDS: Array<[string, string, string]> = [
  ['advertising',      'Advertising',                 'Publicidad'],
  ['carAndTruck',      'Car & Truck Expenses',        'Auto y Camión'],
  ['commissions',      'Commissions & Fees',          'Comisiones y Fees'],
  ['contractLabor',    'Contract Labor',              'Contratistas'],
  ['depletion',        'Depletion',                   'Agotamiento'],
  ['depreciation',     'Depreciation',                'Depreciación'],
  ['employeeBenefits', 'Employee Benefit Programs',   'Beneficios a Empleados'],
  ['insurance',        'Insurance (not health)',      'Seguros (no médicos)'],
  ['mortgageInterest', 'Mortgage Interest',           'Intereses Hipotecarios'],
  ['otherInterest',    'Other Interest',              'Otros Intereses'],
  ['legalProfessional','Legal & Professional',        'Legal y Profesional'],
  ['officeExpense',    'Office Expense',              'Gastos de Oficina'],
  ['pensionProfit',    'Pension / Profit Sharing',    'Pensión / Reparto'],
  ['rentVehicles',     'Rent — Vehicles / Equipment', 'Renta — Vehículos / Equipo'],
  ['rentProperty',     'Rent — Other Property',       'Renta — Otra Propiedad'],
  ['repairs',          'Repairs & Maintenance',       'Reparaciones y Mantenimiento'],
  ['supplies',         'Supplies',                    'Suministros'],
  ['taxesLicenses',    'Taxes & Licenses',            'Impuestos y Licencias'],
  ['travel',           'Travel',                      'Viajes'],
  ['meals',            'Meals (50% deductible)',      'Comidas (50% deducible)'],
  ['utilities',        'Utilities',                   'Servicios (luz, agua)'],
  ['wages',            'Wages',                       'Salarios'],
  ['otherExpenses',    'Other Expenses',              'Otros Gastos'],
  ['homeOffice',       'Home Office (Line 30)',       'Oficina en Casa (Línea 30)'],
];

export default function TaxScheduleCTab({ year }: Props) {
  const { state: { lang } } = useApp();
  const es = lang === 'es';
  const tax = useTaxYear(year);
  const sc = tax.data.scheduleC ?? emptyScheduleC();

  const nonNeg = (cents: number) => Math.max(0, cents);

  const total = useMemo(
    () => FIELDS.reduce((sum, [key]) => sum + (sc as unknown as Record<string, number>)[key], 0),
    [sc],
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'Schedule C — Ganancias/Pérdidas del Negocio' : 'Schedule C — Profit/Loss from Business'} — {year}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {es
            ? 'Totales por categoría. Guarda automáticamente. Para sole-proprietors — partnerships usan 1065.'
            : 'Category totals. Auto-saves. For sole-proprietors — partnerships file 1065.'}
        </div>
      </div>

      {/* 24 inputs in 3-column grid */}
      <div style={cardBox}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.75rem 1rem',
        }}>
          {FIELDS.map(([key, enLabel, esLabel]) => (
            <div key={key}>
              <label style={labelStyle}>{es ? esLabel : enLabel} ($)</label>
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
            {es ? 'Total Gastos Schedule C' : 'Total Schedule C Expenses'}
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
