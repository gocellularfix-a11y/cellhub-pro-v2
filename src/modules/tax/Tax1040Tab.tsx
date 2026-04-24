// ============================================================
// CellHub Pro — Form 1040 Tab (editable)
// Personal Form 1040 — filing header, income, adjustments,
// deductions, credits, withholding + quarterly payments,
// filer/spouse PII. Plus dependents[] CRUD.
// Persistence: settings.taxData.byYear[year].form1040 + .dependents
// ============================================================

import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
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

const FILING_STATUS_OPTIONS: Array<[FilingStatus, string, string]> = [
  ['single',  'Single',                         'Soltero/a'],
  ['married', 'Married Filing Jointly',         'Casado/a Conjunto'],
  ['mfs',     'Married Filing Separately',      'Casado/a por Separado'],
  ['hoh',     'Head of Household',              'Cabeza de Familia'],
  ['qw',      'Qualifying Widow(er)',           'Viudo/a Calificado/a'],
];

export default function Tax1040Tab({ year }: Props) {
  const { state: { lang } } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';
  const tax = useTaxYear(year);
  const f = tax.data.form1040 ?? emptyForm1040();
  const dependents = tax.data.dependents ?? [];

  const nonNeg = (cents: number) => Math.max(0, cents);

  // Helpers to shorten the repeated input pattern for money fields
  const MoneyField = ({ fieldKey, enLabel, esLabel }: {
    fieldKey: keyof Tax1040Data;
    enLabel: string;
    esLabel: string;
  }) => (
    <div>
      <label style={labelStyle}>{es ? esLabel : enLabel} ($)</label>
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

  const TextField = ({ fieldKey, enLabel, esLabel, required }: {
    fieldKey: keyof Tax1040Data;
    enLabel: string;
    esLabel: string;
    required?: boolean;
  }) => (
    <div>
      <label style={labelStyle}>{es ? esLabel : enLabel}{required && ' *'}</label>
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
      toast(es ? 'Nombre, apellido y relación son requeridos' : 'First name, last name, and relationship are required', 'error');
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

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'Formulario 1040 — Personal' : 'Form 1040 — Personal'} — {year}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
          {es
            ? 'Declaración de impuestos personal. Los datos se guardan automáticamente.'
            : 'Personal income tax return. Auto-saves on every change.'}
        </div>
      </div>

      {/* ── Section 1: Filer info ── */}
      <div style={cardBox}>
        <SectionHeader label={es ? 'Información del Declarante' : 'Filer Information'} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <TextField fieldKey="firstName" enLabel="First Name" esLabel="Nombre" required />
          <TextField fieldKey="lastName" enLabel="Last Name" esLabel="Apellido" required />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <TextField fieldKey="ssn" enLabel="SSN" esLabel="SSN" />
          <TextField fieldKey="address" enLabel="Street Address" esLabel="Dirección" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
          <TextField fieldKey="city" enLabel="City" esLabel="Ciudad" />
          <TextField fieldKey="state" enLabel="State" esLabel="Estado" />
          <TextField fieldKey="zip" enLabel="ZIP" esLabel="Código Postal" />
        </div>
      </div>

      {/* ── Section 2: Spouse info (only if married) ── */}
      {isMarried && (
        <div style={cardBox}>
          <SectionHeader label={es ? 'Información del Cónyuge' : 'Spouse Information'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <TextField fieldKey="spouseFirstName" enLabel="Spouse First Name" esLabel="Nombre del Cónyuge" />
            <TextField fieldKey="spouseLastName" enLabel="Spouse Last Name" esLabel="Apellido del Cónyuge" />
            <TextField fieldKey="spouseSsn" enLabel="Spouse SSN" esLabel="SSN del Cónyuge" />
          </div>
        </div>
      )}

      {/* ── Section 3: Filing details ── */}
      <div style={cardBox}>
        <SectionHeader label={es ? 'Detalles de Declaración' : 'Filing Details'} />
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>{es ? 'Estado Civil Fiscal' : 'Filing Status'} *</label>
            <select
              style={inputStyle}
              value={f.filingStatus}
              onChange={(e) => tax.updateForm1040({ filingStatus: e.target.value as FilingStatus })}
            >
              {FILING_STATUS_OPTIONS.map(([val, en, esLabel]) => (
                <option key={val} value={val}>{es ? esLabel : en}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{es ? 'Dependientes (conteo)' : 'Dependents (count)'}</label>
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
              {es ? 'Deducción Estándar' : 'Standard Deduction'}
            </label>
          </div>
        </div>
      </div>

      {/* ── Section 4: Income ── */}
      <div style={cardBox}>
        <SectionHeader label={es ? 'Ingresos' : 'Income'} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <MoneyField fieldKey="wages" enLabel="Wages, Salaries, Tips" esLabel="Salarios / Propinas" />
          <MoneyField fieldKey="interestDividends" enLabel="Interest & Dividends" esLabel="Intereses y Dividendos" />
          <MoneyField fieldKey="capitalGains" enLabel="Capital Gains" esLabel="Ganancias de Capital" />
          <MoneyField fieldKey="otherIncome1040" enLabel="Other Income" esLabel="Otros Ingresos" />
        </div>
      </div>

      {/* ── Section 5: Adjustments ── */}
      <div style={cardBox}>
        <SectionHeader label={es ? 'Ajustes al Ingreso' : 'Adjustments to Income'} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <MoneyField fieldKey="iraDeduction" enLabel="IRA Deduction" esLabel="Deducción IRA" />
          <MoneyField fieldKey="studentLoanInterest" enLabel="Student Loan Interest" esLabel="Intereses Préstamos Estudiantiles" />
          <MoneyField fieldKey="hsaDeduction" enLabel="HSA Deduction" esLabel="Deducción HSA" />
          <MoneyField fieldKey="otherAdjustments" enLabel="Other Adjustments" esLabel="Otros Ajustes" />
        </div>
      </div>

      {/* ── Section 6: Deductions (only if !useStandardDeduction) ── */}
      {!f.useStandardDeduction && (
        <div style={cardBox}>
          <SectionHeader label={es ? 'Deducciones Detalladas' : 'Itemized Deductions'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <MoneyField fieldKey="itemizedDeductions" enLabel="Itemized Deductions Total" esLabel="Total Deducciones Detalladas" />
          </div>
        </div>
      )}

      {/* ── Section 7: Credits ── */}
      <div style={cardBox}>
        <SectionHeader label={es ? 'Créditos' : 'Credits'} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <MoneyField fieldKey="childTaxCredit" enLabel="Child Tax Credit" esLabel="Crédito por Hijos" />
          <MoneyField fieldKey="earnedIncomeCredit" enLabel="Earned Income Credit" esLabel="Crédito Ingreso Ganado" />
          <MoneyField fieldKey="otherCredits" enLabel="Other Credits" esLabel="Otros Créditos" />
        </div>
      </div>

      {/* ── Section 8: Withholding & Estimated Payments ── */}
      <div style={cardBox}>
        <SectionHeader label={es ? 'Retenciones y Pagos Estimados' : 'Withholding & Estimated Payments'} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <MoneyField fieldKey="federalWithholding" enLabel="Federal Withholding (W-2)" esLabel="Retención Federal (W-2)" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
          <MoneyField fieldKey="q1Payment" enLabel="Q1 Payment" esLabel="Pago Q1" />
          <MoneyField fieldKey="q2Payment" enLabel="Q2 Payment" esLabel="Pago Q2" />
          <MoneyField fieldKey="q3Payment" enLabel="Q3 Payment" esLabel="Pago Q3" />
          <MoneyField fieldKey="q4Payment" enLabel="Q4 Payment" esLabel="Pago Q4" />
        </div>
      </div>

      {/* ── Section 9: Dependents table ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
          {es ? 'Dependientes' : 'Dependents'}
        </div>
        <button onClick={openAddDep} style={btnAddStyle}>
          + {es ? 'Agregar Dependiente' : 'Add Dependent'}
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
            {es ? 'No hay dependientes registrados' : 'No dependents recorded yet'}
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
                <th style={thStyle}>{es ? 'Nombre' : 'Name'}</th>
                <th style={thStyle}>{es ? 'Fecha Nacimiento' : 'Date of Birth'}</th>
                <th style={thStyle}>{es ? 'Relación' : 'Relationship'}</th>
                <th style={thStyle}>SSN</th>
                <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>{es ? 'Acciones' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {dependents.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#e2e8f0' }}>
                    {d.firstName} {d.lastName}
                  </td>
                  <td style={tdStyle}>
                    {d.dateOfBirth ? new Date(d.dateOfBirth).toLocaleDateString(es ? 'es-MX' : 'en-US') : '—'}
                  </td>
                  <td style={tdStyle}>{d.relationship}</td>
                  <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace' }}>{d.ssn || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                      <button onClick={() => openEditDep(d)} style={iconBtnStyle('blue')} title={es ? 'Editar' : 'Edit'}>✏️</button>
                      <button onClick={() => setDepConfirmDelete(d.id)} style={iconBtnStyle('red')} title={es ? 'Borrar' : 'Delete'}>🗑</button>
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
              {depEditing ? (es ? '✏️ Editar Dependiente' : '✏️ Edit Dependent') : (es ? '+ Agregar Dependiente' : '+ Add Dependent')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Nombre' : 'First Name'} *</label>
                <input
                  style={inputStyle}
                  value={depForm.firstName}
                  onChange={(e) => setDepForm({ ...depForm, firstName: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Apellido' : 'Last Name'} *</label>
                <input
                  style={inputStyle}
                  value={depForm.lastName}
                  onChange={(e) => setDepForm({ ...depForm, lastName: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Fecha de Nacimiento' : 'Date of Birth'}</label>
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
              <label style={labelStyle}>{es ? 'Relación' : 'Relationship'} *</label>
              <select
                style={inputStyle}
                value={depForm.relationship}
                onChange={(e) => setDepForm({ ...depForm, relationship: e.target.value })}
              >
                <option value="Child">{es ? 'Hijo/a' : 'Child'}</option>
                <option value="Stepchild">{es ? 'Hijastro/a' : 'Stepchild'}</option>
                <option value="Foster Child">{es ? 'Hijo/a de Acogida' : 'Foster Child'}</option>
                <option value="Grandchild">{es ? 'Nieto/a' : 'Grandchild'}</option>
                <option value="Parent">{es ? 'Padre/Madre' : 'Parent'}</option>
                <option value="Other">{es ? 'Otro' : 'Other'}</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setDepShowModal(false)} style={btnSecondaryStyle}>
                {es ? 'Cancelar' : 'Cancel'}
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
                {es ? '💾 Guardar' : '💾 Save'}
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
              {es ? '¿Borrar este dependiente?' : 'Delete this dependent?'}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
              {es ? 'Esta acción no se puede deshacer.' : "This can't be undone."}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button onClick={() => setDepConfirmDelete(null)} style={btnSecondaryStyle}>
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button onClick={() => handleDeleteDep(depConfirmDelete)} style={{ ...btnPrimaryStyle, background: '#dc2626', color: 'white' }}>
                🗑 {es ? 'Borrar' : 'Delete'}
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
