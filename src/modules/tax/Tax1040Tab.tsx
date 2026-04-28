// ============================================================
// CellHub Pro — Form 1040 Tab (editable)
// Personal Form 1040 — filing header, income, adjustments,
// deductions, credits, withholding + quarterly payments,
// filer/spouse PII. Plus dependents[] CRUD.
// Persistence: settings.taxData.byYear[year].form1040 + .dependents
// ============================================================

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { useTaxYear, emptyForm1040, dollarsToCents, centsToDollars } from './taxData';
import {
  inputStyle, labelStyle, thStyle, tdStyle, iconBtnStyle,
  modalOverlay, modalCard, btnSecondaryStyle, btnPrimaryStyle, btnAddStyle, cardBox,
} from './taxStyles';
import type { Tax1040Data, TaxDependent } from '@/store/types';

interface Props {
  year: number;
}

type FilingStatus = Tax1040Data['filingStatus'];

const FILING_STATUS_VALUES: FilingStatus[] = ['single', 'married', 'mfs', 'hoh', 'qw'];

const FS_KEY_MAP: Record<FilingStatus, string> = {
  single: 'tax1040.fsSingle',
  married: 'tax1040.fsMarried',
  mfs: 'tax1040.fsMfs',
  hoh: 'tax1040.fsHoh',
  qw: 'tax1040.fsQw',
};

export default function Tax1040Tab({ year }: Props) {
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const tax = useTaxYear(year);
  const f = tax.data.form1040 ?? emptyForm1040();
  const dependents = tax.data.dependents ?? [];

  const nonNeg = (cents: number) => Math.max(0, cents);

  // Helpers to shorten the repeated input pattern for money fields
  const MoneyField = ({ fieldKey, labelKey }: {
    fieldKey: keyof Tax1040Data;
    labelKey: string;
  }) => (
    <div>
      <label style={labelStyle}>{t(labelKey)} ($)</label>
      <input
        type="text"
        inputMode="decimal"
        style={inputStyle}
        value={centsToDollars(f[fieldKey] as number)}
        onChange={(e) => tax.updateForm1040({ [fieldKey]: nonNeg(dollarsToCents(e.target.value)) } as Partial<Tax1040Data>)}
        placeholder="0.00"
      />
    </div>
  );

  const TextField = ({ fieldKey, labelKey, required }: {
    fieldKey: keyof Tax1040Data;
    labelKey: string;
    required?: boolean;
  }) => (
    <div>
      <label style={labelStyle}>{t(labelKey)}{required && ' *'}</label>
      <input
        type="text"
        style={inputStyle}
        value={String(f[fieldKey] ?? '')}
        onChange={(e) => tax.updateForm1040({ [fieldKey]: e.target.value } as Partial<Tax1040Data>)}
      />
    </div>
  );

  const isMarried = f.filingStatus === 'married' || f.filingStatus === 'mfs';

  // ── Dependents CRUD state ──
  const [depEditing, setDepEditing] = useState<TaxDependent | null>(null);
  const [depShowModal, setDepShowModal] = useState(false);
  const [depConfirmDelete, setDepConfirmDelete] = useState<string | null>(null);
  const [depForm, setDepForm] = useState({
    firstName: '',
    lastName: '',
    ssn: '',
    dateOfBirth: '',
    relationship: 'Child',
  });

  const openAddDep = () => {
    setDepEditing(null);
    setDepForm({ firstName: '', lastName: '', ssn: '', dateOfBirth: '', relationship: 'Child' });
    setDepShowModal(true);
  };

  const openEditDep = (d: TaxDependent) => {
    setDepEditing(d);
    setDepForm({
      firstName: d.firstName,
      lastName: d.lastName,
      ssn: d.ssn,
      dateOfBirth: d.dateOfBirth,
      relationship: d.relationship,
    });
    setDepShowModal(true);
  };

  const handleSaveDep = () => {
    if (!depForm.firstName.trim() || !depForm.lastName.trim() || !depForm.relationship.trim()) {
      toast(t('tax1040.errNameRelRequired'), 'error');
      return;
    }
    const payload = {
      firstName: depForm.firstName.trim(),
      lastName: depForm.lastName.trim(),
      ssn: depForm.ssn.trim(),
      dateOfBirth: depForm.dateOfBirth,
      relationship: depForm.relationship.trim(),
    };
    if (depEditing) {
      tax.updateDependent(depEditing.id, payload);
    } else {
      tax.addDependent(payload);
    }
    setDepShowModal(false);
    setDepEditing(null);
  };

  const handleDeleteDep = (id: string) => {
    tax.deleteDependent(id);
    setDepConfirmDelete(null);
  };

  const dateLocale = locale === 'es' ? 'es-MX' : locale === 'pt' ? 'pt-BR' : 'en-US';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {t('tax1040.title', year)}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {t('tax1040.subtitle')}
        </div>
      </div>

      {/* ── Section 1: Filer info ── */}
      <div style={cardBox}>
        <SectionHeader label={t('tax1040.filerInfoHeader')} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <TextField fieldKey="firstName" labelKey="tax1040.firstName" required />
          <TextField fieldKey="lastName" labelKey="tax1040.lastName" required />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <TextField fieldKey="ssn" labelKey="tax1040.ssn" />
          <TextField fieldKey="address" labelKey="tax1040.address" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
          <TextField fieldKey="city" labelKey="tax1040.city" />
          <TextField fieldKey="state" labelKey="tax1040.state" />
          <TextField fieldKey="zip" labelKey="tax1040.zip" />
        </div>
      </div>

      {/* ── Section 2: Spouse info (only if married) ── */}
      {isMarried && (
        <div style={cardBox}>
          <SectionHeader label={t('tax1040.spouseInfoHeader')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <TextField fieldKey="spouseFirstName" labelKey="tax1040.spouseFirstName" />
            <TextField fieldKey="spouseLastName" labelKey="tax1040.spouseLastName" />
            <TextField fieldKey="spouseSsn" labelKey="tax1040.spouseSsn" />
          </div>
        </div>
      )}

      {/* ── Section 3: Filing details ── */}
      <div style={cardBox}>
        <SectionHeader label={t('tax1040.filingDetailsHeader')} />
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>{t('tax1040.filingStatus')} *</label>
            <select
              style={inputStyle}
              value={f.filingStatus}
              onChange={(e) => tax.updateForm1040({ filingStatus: e.target.value as FilingStatus })}
            >
              {FILING_STATUS_VALUES.map((val) => (
                <option key={val} value={val}>{t(FS_KEY_MAP[val])}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t('tax1040.dependentsCount')}</label>
            <input
              type="number"
              min="0"
              style={inputStyle}
              value={f.dependents}
              onChange={(e) => tax.updateForm1040({ dependents: Math.max(0, parseInt(e.target.value) || 0) })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#cbd5e1', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={f.useStandardDeduction}
                onChange={(e) => tax.updateForm1040({ useStandardDeduction: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#22d3ee' }}
              />
              {t('tax1040.standardDeduction')}
            </label>
          </div>
        </div>
      </div>

      {/* ── Section 4: Income ── */}
      <div style={cardBox}>
        <SectionHeader label={t('tax1040.incomeHeader')} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <MoneyField fieldKey="wages" labelKey="tax1040.wages" />
          <MoneyField fieldKey="interestDividends" labelKey="tax1040.interestDividends" />
          <MoneyField fieldKey="capitalGains" labelKey="tax1040.capitalGains" />
          <MoneyField fieldKey="otherIncome1040" labelKey="tax1040.otherIncome1040" />
        </div>
      </div>

      {/* ── Section 5: Adjustments ── */}
      <div style={cardBox}>
        <SectionHeader label={t('tax1040.adjustmentsHeader')} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <MoneyField fieldKey="iraDeduction" labelKey="tax1040.iraDeduction" />
          <MoneyField fieldKey="studentLoanInterest" labelKey="tax1040.studentLoanInterest" />
          <MoneyField fieldKey="hsaDeduction" labelKey="tax1040.hsaDeduction" />
          <MoneyField fieldKey="otherAdjustments" labelKey="tax1040.otherAdjustments" />
        </div>
      </div>

      {/* ── Section 6: Deductions (only if !useStandardDeduction) ── */}
      {!f.useStandardDeduction && (
        <div style={cardBox}>
          <SectionHeader label={t('tax1040.itemizedHeader')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <MoneyField fieldKey="itemizedDeductions" labelKey="tax1040.itemizedTotal" />
          </div>
        </div>
      )}

      {/* ── Section 7: Credits ── */}
      <div style={cardBox}>
        <SectionHeader label={t('tax1040.creditsHeader')} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <MoneyField fieldKey="childTaxCredit" labelKey="tax1040.childTaxCredit" />
          <MoneyField fieldKey="earnedIncomeCredit" labelKey="tax1040.earnedIncomeCredit" />
          <MoneyField fieldKey="otherCredits" labelKey="tax1040.otherCredits" />
        </div>
      </div>

      {/* ── Section 8: Withholding & Estimated Payments ── */}
      <div style={cardBox}>
        <SectionHeader label={t('tax1040.withholdingHeader')} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <MoneyField fieldKey="federalWithholding" labelKey="tax1040.federalWithholding" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
          <MoneyField fieldKey="q1Payment" labelKey="tax1040.q1Payment" />
          <MoneyField fieldKey="q2Payment" labelKey="tax1040.q2Payment" />
          <MoneyField fieldKey="q3Payment" labelKey="tax1040.q3Payment" />
          <MoneyField fieldKey="q4Payment" labelKey="tax1040.q4Payment" />
        </div>
      </div>

      {/* ── Section 9: Dependents table ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
          {t('tax1040.dependentsHeader')}
        </div>
        <button onClick={openAddDep} style={btnAddStyle}>
          + {t('tax1040.addDependentBtn')}
        </button>
      </div>

      {dependents.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px dashed rgba(255,255,255,0.15)',
          borderRadius: '0.75rem',
          padding: '2rem 1rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>👨‍👩‍👧</div>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>
            {t('tax1040.noDependents')}
          </div>
        </div>
      ) : (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '0.75rem',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th style={thStyle}>{t('tax1040.thName')}</th>
                <th style={thStyle}>{t('tax1040.thDob')}</th>
                <th style={thStyle}>{t('tax1040.thRelationship')}</th>
                <th style={thStyle}>SSN</th>
                <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{t('tax1040.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {dependents.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#e2e8f0' }}>
                    {d.firstName} {d.lastName}
                  </td>
                  <td style={tdStyle}>
                    {d.dateOfBirth ? new Date(d.dateOfBirth).toLocaleDateString(dateLocale) : '—'}
                  </td>
                  <td style={tdStyle}>{d.relationship}</td>
                  <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace' }}>{d.ssn || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                      <button onClick={() => openEditDep(d)} style={iconBtnStyle('blue')} title={t('tax1040.editIcon')}>✏️</button>
                      <button onClick={() => setDepConfirmDelete(d.id)} style={iconBtnStyle('red')} title={t('tax1040.deleteIcon')}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ════════════ DEPENDENT MODAL ════════════ */}
      {depShowModal && (
        <div onClick={() => setDepShowModal(false)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {depEditing ? t('tax1040.editDepTitle') : t('tax1040.addDepTitle')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{t('tax1040.firstName')} *</label>
                <input
                  style={inputStyle}
                  value={depForm.firstName}
                  onChange={(e) => setDepForm({ ...depForm, firstName: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>{t('tax1040.lastName')} *</label>
                <input
                  style={inputStyle}
                  value={depForm.lastName}
                  onChange={(e) => setDepForm({ ...depForm, lastName: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{t('tax1040.dobLabel')}</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={depForm.dateOfBirth}
                  onChange={(e) => setDepForm({ ...depForm, dateOfBirth: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>SSN</label>
                <input
                  style={inputStyle}
                  value={depForm.ssn}
                  onChange={(e) => setDepForm({ ...depForm, ssn: e.target.value })}
                  placeholder="XXX-XX-XXXX"
                />
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>{t('tax1040.relRel')} *</label>
              <select
                style={inputStyle}
                value={depForm.relationship}
                onChange={(e) => setDepForm({ ...depForm, relationship: e.target.value })}
              >
                <option value="Child">{t('tax1040.relChild')}</option>
                <option value="Stepchild">{t('tax1040.relStepchild')}</option>
                <option value="Foster Child">{t('tax1040.relFosterChild')}</option>
                <option value="Grandchild">{t('tax1040.relGrandchild')}</option>
                <option value="Parent">{t('tax1040.relParent')}</option>
                <option value="Other">{t('tax1040.relOther')}</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setDepShowModal(false)} style={btnSecondaryStyle}>
                {t('tax1040.cancel')}
              </button>
              <button
                onClick={handleSaveDep}
                disabled={!depForm.firstName.trim() || !depForm.lastName.trim()}
                style={{
                  ...btnPrimaryStyle,
                  opacity: (!depForm.firstName.trim() || !depForm.lastName.trim()) ? 0.5 : 1,
                  cursor: (!depForm.firstName.trim() || !depForm.lastName.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                {t('tax1040.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ DEPENDENT DELETE CONFIRM ════════════ */}
      {depConfirmDelete && (
        <div onClick={() => setDepConfirmDelete(null)} style={{ ...modalOverlay, zIndex: 210 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalCard, maxWidth: '420px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
              {t('tax1040.deleteDepTitle')}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
              {t('tax1040.cantUndo')}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button onClick={() => setDepConfirmDelete(null)} style={btnSecondaryStyle}>
                {t('tax1040.cancel')}
              </button>
              <button onClick={() => handleDeleteDep(depConfirmDelete)} style={{ ...btnPrimaryStyle, background: '#dc2626', color: 'white' }}>
                🗑 {t('tax1040.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared section header ────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: '0.78rem',
      fontWeight: 700,
      color: '#cbd5e1',
      marginBottom: '0.75rem',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      {label}
    </div>
  );
}
