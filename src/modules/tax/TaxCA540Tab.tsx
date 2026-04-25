// ============================================================
// CellHub Pro — CA Form 540 Tab (editable)
// Adapted from GOCELLULARAPP.html lines 3799-4100 (CA 540 tab)
// Captures withholding, quarterly estimated payments, and CA deductions
// per-partner, with persistence in settings.taxData.byYear[year].ca540
// ============================================================

import { useApp } from '@/store/AppProvider';
import { formatCurrency } from '@/utils/currency';
import { useTaxYear, dollarsToCents, centsToDollars } from './taxData';
import { inputStyle, labelStyle, cardBox } from './taxStyles';

interface Props {
  year: number;
  netProfitCents: number;  // Annual partnership net profit (passed from parent)
}

// CA Tax Brackets — single filer, by tax year
// Source: FTB 540 instructions (single filing status only — see F-FILING-STATUS warning in render)
// r29c-1: replaced single hardcoded 2025 array with year-aware map.
// If user selects a year not in the map, falls back to the most recent available year.
type Bracket = [number, number];

const CA_BRACKETS_BY_YEAR: Record<number, Bracket[]> = {
  2024: [
    [10412, 0.01],
    [24684, 0.02],
    [38959, 0.04],
    [54081, 0.06],
    [68350, 0.08],
    [349137, 0.093],
    [418961, 0.103],
    [698271, 0.113],
    [Infinity, 0.123],
  ],
  2025: [
    [10756, 0.01],
    [25499, 0.02],
    [40245, 0.04],
    [55866, 0.06],
    [70606, 0.08],
    [360659, 0.093],
    [432787, 0.103],
    [721314, 0.113],
    [Infinity, 0.123],
  ],
  2026: [
    // Estimated from FTB 2026 withholding schedules + inflation indexing.
    // Official FTB 540 rate schedules for 2026 not yet published as of Apr 2026.
    // TODO: replace with official FTB 540 numbers when published (expected late 2026).
    [11079, 0.01],
    [26264, 0.02],
    [41452, 0.04],
    [57542, 0.06],
    [72725, 0.08],
    [371479, 0.093],
    [445771, 0.103],
    [742953, 0.113],
    [Infinity, 0.123],
  ],
};

const CA_STD_DEDUCTION_BY_YEAR: Record<number, number> = {
  2024: 5363,
  2025: 5540,
  2026: 5863, // estimated (~2.8% inflation adjustment over 2025's $5,706)
};

function getBracketsForYear(year: number): Bracket[] {
  if (CA_BRACKETS_BY_YEAR[year]) return CA_BRACKETS_BY_YEAR[year];
  // Sorted DESC ([2026, 2025, 2024]). Find the most recent year ≤ requested.
  // If none (year is older than oldest available), fall back to the OLDEST
  // (last item), not the latest. r29d-1 fix.
  const available = Object.keys(CA_BRACKETS_BY_YEAR).map(Number).sort((a, b) => b - a);
  const fallback = available.find((y) => y <= year) ?? available[available.length - 1];
  return CA_BRACKETS_BY_YEAR[fallback];
}

function getStdDeductionForYear(year: number): number {
  if (CA_STD_DEDUCTION_BY_YEAR[year]) return CA_STD_DEDUCTION_BY_YEAR[year];
  // r29d-1 fix: when year < oldest available, fall back to oldest (last in DESC array),
  // not latest (first in DESC array).
  const available = Object.keys(CA_STD_DEDUCTION_BY_YEAR).map(Number).sort((a, b) => b - a);
  const fallback = available.find((y) => y <= year) ?? available[available.length - 1];
  return CA_STD_DEDUCTION_BY_YEAR[fallback];
}

function calcCABracketTax(taxableIncomeDollars: number, year: number): number {
  const brackets = getBracketsForYear(year);
  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of brackets) {
    if (taxableIncomeDollars <= prev) break;
    tax += (Math.min(taxableIncomeDollars, limit) - prev) * rate;
    prev = limit;
  }
  return tax;
}

export default function TaxCA540Tab({ year, netProfitCents }: Props) {
  const { state: { lang, settings } } = useApp();
  const es = lang === 'es';
  const tax = useTaxYear(year);
  const ca = tax.data.ca540;

  // r29c-1: clamp helper for money inputs that should never be negative.
  // Tax payments, withholding, and deductions are all non-negative quantities.
  const nonNeg = (cents: number) => Math.max(0, cents);

  const members = settings.partnership?.members ?? [];
  const hasMembers = members.length > 0;

  // ── Calculations ─────────────────────────────────────

  // Each partner's share of business income (in dollars for tax math)
  const totalBusinessIncomeDollars = netProfitCents / 100;

  // Per-partner CA tax estimate
  const perPartnerCalc = members.map((m) => {
    const share = (m.ownershipPct || 0) / 100;
    const partnerIncome = totalBusinessIncomeDollars * share + (m.guaranteedPayments / 100);

    // SE deduction (½ of SE tax) — partners can deduct from CA AGI
    const seEarnings = partnerIncome * 0.9235;
    const seTax = seEarnings * 0.153;
    const seDeduct = seTax * 0.5;

    // CA AGI (simplified — partner-only K-1 income)
    const caHealthIns = (ca.selfEmployedHealthInsuranceCA / 100) * share;
    const caOtherAdj = (ca.otherCADeductions / 100) * share;
    const caAGI = partnerIncome - seDeduct - caHealthIns - caOtherAdj;

    // CA Deduction (standard or itemized)
    // r29c-1: standard deduction now year-aware via getStdDeductionForYear
    const caDeduction = ca.useStandardDeductionCA
      ? getStdDeductionForYear(year)
      : (ca.itemizedDeductionsCA / 100) * share;
    const caTaxableIncome = Math.max(0, caAGI - caDeduction);

    // CA bracket tax — uses brackets for the selected year
    const caBracketTax = calcCABracketTax(caTaxableIncome, year);

    // SDI 1.1% (no cap since 2024)
    const sdi = Math.max(0, partnerIncome * 0.011);

    // MHST 1% over $1M
    const mhst = caTaxableIncome > 1_000_000 ? (caTaxableIncome - 1_000_000) * 0.01 : 0;

    const totalCATaxBeforeWithholding = caBracketTax + sdi + mhst;

    // Convert back to cents for display
    return {
      member: m,
      partnerIncome: Math.round(partnerIncome * 100),
      caAGI: Math.round(caAGI * 100),
      caDeduction: Math.round(caDeduction * 100),
      caTaxableIncome: Math.round(caTaxableIncome * 100),
      caBracketTax: Math.round(caBracketTax * 100),
      sdi: Math.round(sdi * 100),
      mhst: Math.round(mhst * 100),
      totalCATax: Math.round(totalCATaxBeforeWithholding * 100),
    };
  });

  const totalQuarterlyPayments = ca.caQ1 + ca.caQ2 + ca.caQ3 + ca.caQ4;
  const totalPrepayments = ca.caWithholding + totalQuarterlyPayments;
  const totalCATaxAllPartners = perPartnerCalc.reduce((s, p) => s + p.totalCATax, 0);
  const balanceDue = totalCATaxAllPartners - totalPrepayments;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'CA Form 540 — Estimación' : 'CA Form 540 — Estimate'} — {year}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {es
            ? 'Estimación de impuestos de California por socio. Usa brackets 2025.'
            : 'California tax estimate per partner. Uses 2025 brackets.'}
        </div>
      </div>

      {/* Empty state if no members */}
      {!hasMembers && (
        <div style={{
          background: 'rgba(251,191,36,0.08)',
          border: '1px dashed rgba(251,191,36,0.35)',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          textAlign: 'center',
          marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>👥</div>
          <div style={{ fontSize: '0.85rem', color: '#fcd34d', fontWeight: 700 }}>
            {es ? 'Agrega socios primero' : 'Add partnership members first'}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.4rem' }}>
            {es
              ? 'El cálculo de CA 540 es por socio. Ve al tab Members para configurarlos.'
              : 'CA 540 calculation is per partner. Go to the Members tab to set them up.'}
          </div>
        </div>
      )}

      {/* Editable inputs */}
      <div style={cardBox}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {es ? 'Pagos y Retenciones (Total Combinado)' : 'Payments & Withholding (Combined Total)'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
          <div>
            <label style={labelStyle}>{es ? 'Retención CA (W-2)' : 'CA Withholding (W-2)'} ($)</label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(ca.caWithholding)}
              onChange={(e) => tax.updateCA540({ caWithholding: nonNeg(dollarsToCents(e.target.value)) })}
              placeholder="0.00"
              min="0"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <div style={{
              width: '100%',
              padding: '0.55rem 0.75rem',
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: '0.5rem',
              fontSize: '0.82rem',
              color: '#86efac',
            }}>
              {es ? 'Pagos Estimados Q1-Q4:' : 'Q1-Q4 Estimated Payments:'}{' '}
              <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatCurrency(totalQuarterlyPayments)}</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '0.875rem' }}>
          {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => {
            const key = `ca${q}` as 'caQ1' | 'caQ2' | 'caQ3' | 'caQ4';
            const dueDates: Record<string, string> = { caQ1: 'Apr 15', caQ2: 'Jun 15', caQ3: 'Sep 15', caQ4: 'Jan 15' };
            return (
              <div key={q}>
                <label style={labelStyle}>{q} ($) <span style={{ color: '#64748b', fontWeight: 400, textTransform: 'none' }}>· {dueDates[key]}</span></label>
                <input
                  type="text"
                  inputMode="decimal"
                  style={inputStyle}
                  value={centsToDollars(ca[key])}
                  onChange={(e) => tax.updateCA540({ [key]: nonNeg(dollarsToCents(e.target.value)) } as Partial<typeof ca>)}
                  placeholder="0.00"
                  min="0"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div style={cardBox}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {es ? 'Deducciones CA' : 'CA Deductions'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
          <div>
            <label style={labelStyle}>{es ? 'Seguro Médico Self-Employed' : 'Self-Employed Health Insurance'} ($)</label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(ca.selfEmployedHealthInsuranceCA)}
              onChange={(e) => tax.updateCA540({ selfEmployedHealthInsuranceCA: nonNeg(dollarsToCents(e.target.value)) })}
              placeholder="0.00"
              min="0"
            />
          </div>
          <div>
            <label style={labelStyle}>{es ? 'Otras Deducciones CA' : 'Other CA Deductions'} ($)</label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(ca.otherCADeductions)}
              onChange={(e) => tax.updateCA540({ otherCADeductions: nonNeg(dollarsToCents(e.target.value)) })}
              placeholder="0.00"
              min="0"
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <input
              type="radio"
              checked={ca.useStandardDeductionCA}
              onChange={() => tax.updateCA540({ useStandardDeductionCA: true })}
              style={{ width: '1rem', height: '1rem' }}
            />
            {es ? 'Deducción Estándar' : 'Standard Deduction'} <span style={{ color: '#64748b' }}>(${getStdDeductionForYear(year)}/single, {year})</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <input
              type="radio"
              checked={!ca.useStandardDeductionCA}
              onChange={() => tax.updateCA540({ useStandardDeductionCA: false })}
              style={{ width: '1rem', height: '1rem' }}
            />
            {es ? 'Deducciones Detalladas' : 'Itemized Deductions'}
          </label>
        </div>

        {!ca.useStandardDeductionCA && (
          <div style={{ marginTop: '0.5rem' }}>
            <label style={labelStyle}>
              {es ? 'Deducciones Detalladas del Partnership (se reparten por share)' : 'Partnership Itemized Deductions (split by ownership share)'} ($)
            </label>
            <input
              type="text"
              inputMode="decimal"
              style={inputStyle}
              value={centsToDollars(ca.itemizedDeductionsCA)}
              onChange={(e) => tax.updateCA540({ itemizedDeductionsCA: nonNeg(dollarsToCents(e.target.value)) })}
              placeholder="0.00"
              min="0"
            />
            {/* r29c-1: clarify the per-share split behavior. The itemized total is divided
                by ownership %, NOT applied per-partner directly. */}
            <div style={{ marginTop: '0.4rem', fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.5 }}>
              💡 {es
                ? 'Este monto es el TOTAL de las deducciones detalladas del partnership. Se divide proporcionalmente entre los socios según su % de ownership. Si cada socio tiene sus propias deducciones individuales, eso se maneja en su 540 personal con el CPA.'
                : "This is the partnership's TOTAL itemized deductions. It's divided proportionally between partners by ownership %. If each partner has their own individual itemized deductions, that's handled on their personal 540 with the CPA."}
            </div>
          </div>
        )}
      </div>

      {/* r29c-1: filing status warning. Calculations assume single filer for all
          partners. MFJ/HoH/MFS would change brackets significantly. Future round
          will add per-partner filing status to PartnershipMember type. */}
      {hasMembers && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '2px solid rgba(239,68,68,0.35)',
          borderRadius: '0.625rem',
          padding: '0.75rem 1rem',
          marginBottom: '0.875rem',
          fontSize: '0.78rem',
          color: '#fca5a5',
          lineHeight: 1.5,
        }}>
          <strong>⚠️ {es ? 'IMPORTANTE — Estimación de Single Filer Solamente' : 'IMPORTANT — Single Filer Estimate Only'}</strong>
          <div style={{ marginTop: '0.3rem', color: '#fecaca' }}>
            {es
              ? 'Este cálculo asume que TODOS los socios filean como Single. Los brackets para Married Filing Jointly (MFJ), Head of Household (HoH), o MFS son diferentes y pueden cambiar el cálculo en 50% o más. Consulta a tu CPA para los números reales de cada socio según su filing status.'
              : 'This calculation assumes ALL partners file as Single. Brackets for Married Filing Jointly (MFJ), Head of Household (HoH), or MFS are different and can change the calculation by 50% or more. Consult your CPA for real numbers per partner based on their actual filing status.'}
          </div>
        </div>
      )}

      {/* Per-partner breakdown */}
      {hasMembers && (
        <div style={cardBox}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {es ? 'Estimación por Socio' : 'Estimate Per Partner'}
          </div>
          {perPartnerCalc.map((calc) => (
            <div key={calc.member.id} style={{
              padding: '0.875rem',
              background: 'rgba(0,0,0,0.15)',
              borderRadius: '0.5rem',
              marginBottom: '0.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>
                  {calc.member.name} <span style={{ fontWeight: 400, color: '#64748b' }}>({(calc.member.ownershipPct ?? 0).toFixed(2)}%)</span>
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f87171', fontFamily: 'ui-monospace, monospace' }}>
                  {formatCurrency(calc.totalCATax)}
                </div>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 1rem' }}>
                <div>K-1 Income: <span style={{ fontFamily: 'ui-monospace, monospace', color: '#cbd5e1' }}>{formatCurrency(calc.partnerIncome)}</span></div>
                <div>CA AGI: <span style={{ fontFamily: 'ui-monospace, monospace', color: '#cbd5e1' }}>{formatCurrency(calc.caAGI)}</span></div>
                <div>CA Deduction: <span style={{ fontFamily: 'ui-monospace, monospace', color: '#cbd5e1' }}>({formatCurrency(calc.caDeduction)})</span></div>
                <div>Taxable: <span style={{ fontFamily: 'ui-monospace, monospace', color: '#cbd5e1' }}>{formatCurrency(calc.caTaxableIncome)}</span></div>
                <div>Bracket Tax: <span style={{ fontFamily: 'ui-monospace, monospace', color: '#fca5a5' }}>{formatCurrency(calc.caBracketTax)}</span></div>
                <div>SDI 1.1%: <span style={{ fontFamily: 'ui-monospace, monospace', color: '#fca5a5' }}>{formatCurrency(calc.sdi)}</span></div>
                {calc.mhst > 0 && <div>MHST 1%: <span style={{ fontFamily: 'ui-monospace, monospace', color: '#fca5a5' }}>{formatCurrency(calc.mhst)}</span></div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Final summary */}
      {hasMembers && (
        <div style={{
          ...cardBox,
          background: balanceDue > 0 ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)',
          border: balanceDue > 0 ? '2px solid rgba(239,68,68,0.3)' : '2px solid rgba(34,197,94,0.3)',
          marginBottom: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: '0.85rem' }}>
            <span style={{ color: '#94a3b8' }}>{es ? 'CA Tax Total (todos los socios)' : 'Total CA Tax (all partners)'}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#f87171' }}>
              {formatCurrency(totalCATaxAllPartners)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: '0.85rem' }}>
            <span style={{ color: '#94a3b8' }}>{es ? '− Pagos / Retenciones' : '− Payments / Withholding'}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#22c55e' }}>
              ({formatCurrency(totalPrepayments)})
            </span>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '0.5rem',
            marginTop: '0.5rem',
            borderTop: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#cbd5e1' }}>
              {balanceDue > 0
                ? (es ? '⚠️ Saldo a Pagar' : '⚠️ Balance Due')
                : (es ? '✓ Reembolso Estimado' : '✓ Estimated Refund')}
            </span>
            <span style={{
              fontSize: '1.5rem',
              fontWeight: 800,
              color: balanceDue > 0 ? '#f87171' : '#22c55e',
              fontFamily: 'ui-monospace, monospace',
            }}>
              {formatCurrency(Math.abs(balanceDue))}
            </span>
          </div>
        </div>
      )}

      <div style={{
        marginTop: '1rem',
        padding: '0.75rem 1rem',
        background: 'rgba(251,191,36,0.06)',
        border: '1px solid rgba(251,191,36,0.2)',
        borderRadius: '0.625rem',
        fontSize: '0.72rem',
        color: '#fcd34d',
        lineHeight: 1.5,
      }}>
        ℹ️ {es
          ? 'Esta es una estimación. Brackets de 2025, deducción estándar single. Para retornos reales consulta a un CPA. CA income tax debe pagarse antes del 15 de abril; pagos estimados cada Q.'
          : 'This is an estimate. 2025 brackets, single standard deduction. For actual returns consult a CPA. CA income tax due April 15; estimated payments each quarter.'}
      </div>
    </div>
  );
}
