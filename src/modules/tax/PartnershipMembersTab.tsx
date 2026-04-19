// ============================================================
// CellHub Pro — Partnership Members CRUD
// Manages PartnershipMember[] in settings.partnership.members
// Used by Form 1065 / Schedule K-1 generation
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { persistSettings } from '@/services/persist';
import { formatCurrency } from '@/utils/currency';
import { calcMemberK1 } from './taxData';
import type { PartnershipMember, PartnershipInfo } from '@/store/types';

// ── Helpers ──────────────────────────────────────────────

const DEFAULT_PARTNERSHIP: PartnershipInfo = {
  ein: '',
  legalName: '',
  entityType: 'llc-p',
  formationDate: '',
  businessActivity: '',
  productOrService: '',
  accountingMethod: 'cash',
  members: [],
};

function blankMember(): PartnershipMember {
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    ssn: '',
    ein: '',
    address: '',
    city: '',
    state: 'CA',
    zip: '',
    ownershipPct: 0,
    isManaging: false,
    isUSResident: true,
    beginningCapital: 0,
    contributions: 0,
    distributions: 0,
    guaranteedPayments: 0,
    notes: '',
  };
}

function maskSSN(ssn: string): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return digits;
  if (digits.length >= 9) return `XXX-XX-${digits.slice(-4)}`;
  return ssn;
}

function formatSSNInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function formatEINInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 9);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}-${d.slice(2)}`;
}

function dollarsToCents(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function centsToDollars(c: number): string {
  return (c / 100).toFixed(2);
}

// ── Reusable styled inputs ───────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.75rem',
  color: '#e2e8f0',
  fontSize: '0.85rem',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  color: '#94a3b8',
  marginBottom: '0.3rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

// ============================================================
// MAIN COMPONENT
// ============================================================
interface Props {
  netProfitCents: number;  // Annual net profit (Box 1 K-1) — passed in from parent
}

export default function PartnershipMembersTab({ netProfitCents }: Props) {
  const { state: { settings, lang }, setSettings } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';

  const partnership: PartnershipInfo = settings.partnership ?? DEFAULT_PARTNERSHIP;
  const members = partnership.members ?? [];

  // r29a — anti-stale ref. Same reason as useTaxYear: without this, every
  // updatePartnership call captures `partnership` from the render that
  // DEFINED the function, not the one that CALLED it, so multi-station
  // edits clobber each other.
  const partnershipRef = useRef(partnership);
  useEffect(() => {
    partnershipRef.current = partnership;
  });

  // Edit modal state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<PartnershipMember | null>(null);
  const [showEntityForm, setShowEntityForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── Persist helpers ────────────────────────────────────

  // r29a — reads from ref + calls persistSettings. Previously this only
  // updated reducer state without persisting, so all partnership/K-1 data
  // was LOST on app reload. Catastrophic for IRS Form 1065 compliance.
  const updatePartnership = useCallback((patch: Partial<PartnershipInfo>) => {
    const current = partnershipRef.current;
    const next = { ...DEFAULT_PARTNERSHIP, ...current, ...patch };
    setSettings({ partnership: next });
    persistSettings({ partnership: next });
    // Refresh the ref immediately so a rapid second update sees the new state.
    partnershipRef.current = next;
  }, [setSettings]);

  const saveMember = () => {
    if (!editingMember) return;
    if (!editingMember.name.trim()) return;

    // r29d-1 — F-MEMBER-VALIDATION: explicit validation with toast feedback.

    // Ownership % must be between 0 and 100
    const ownership = editingMember.ownershipPct || 0;
    if (!Number.isFinite(ownership) || ownership < 0 || ownership > 100) {
      toast(
        es ? 'El porcentaje de propiedad debe estar entre 0 y 100' : 'Ownership % must be between 0 and 100',
        'error',
      );
      return;
    }

    // Adding this member must not exceed 100% total ownership.
    // Read from ref (not closure) for multi-station safety.
    const currentMembers = partnershipRef.current.members ?? [];
    const existing = currentMembers.find((m) => m.id === editingMember.id);
    const otherMembersPct = currentMembers
      .filter((m) => m.id !== editingMember.id)
      .reduce((s, m) => s + (m.ownershipPct || 0), 0);
    if (otherMembersPct + ownership > 100.01) {
      // 0.01 tolerance for float drift
      toast(
        es
          ? `La propiedad total excedería 100% (${(otherMembersPct + ownership).toFixed(2)}%). Ajusta los porcentajes.`
          : `Total ownership would exceed 100% (${(otherMembersPct + ownership).toFixed(2)}%). Adjust the percentages.`,
        'error',
      );
      return;
    }

    // SSN format check (only if SSN is provided — empty is allowed for ITIN-only members
    // or members not yet configured). Format must be XXX-XX-XXXX (9 digits with dashes).
    const ssn = (editingMember.ssn || '').trim();
    if (ssn) {
      const ssnDigits = ssn.replace(/\D/g, '');
      if (ssnDigits.length !== 9) {
        toast(
          es
            ? 'SSN/ITIN debe tener 9 dígitos (formato XXX-XX-XXXX)'
            : 'SSN/ITIN must be 9 digits (format XXX-XX-XXXX)',
          'error',
        );
        return;
      }
    }

    let newMembers: PartnershipMember[];
    if (existing) {
      newMembers = currentMembers.map((m) => (m.id === editingMember.id ? editingMember : m));
    } else {
      newMembers = [...currentMembers, editingMember];
    }

    updatePartnership({ members: newMembers });
    setEditingId(null);
    setEditingMember(null);
  };

  const deleteMember = (id: string) => {
    // r29a — read members from the ref, not the closure
    const currentMembers = partnershipRef.current.members ?? [];
    updatePartnership({ members: currentMembers.filter((m) => m.id !== id) });
    setConfirmDelete(null);
  };

  const openAdd = () => {
    const m = blankMember();
    // Auto-suggest remaining ownership %
    const used = members.reduce((s, x) => s + (x.ownershipPct || 0), 0);
    m.ownershipPct = Math.max(0, 100 - used);
    setEditingMember(m);
    setEditingId(m.id);
  };

  const openEdit = (m: PartnershipMember) => {
    setEditingMember({ ...m });
    setEditingId(m.id);
  };

  // ── Derived ────────────────────────────────────────────

  const totalPct = members.reduce((s, m) => s + (m.ownershipPct || 0), 0);
  const pctValid = members.length > 0 && Math.abs(totalPct - 100) < 0.01;
  const hasMembers = members.length > 0;

  // r29d-1 — K-1 computations now use canonical calcMemberK1 from taxData.
  // Previously the local version returned `seEarnings` as `(ord+GP)` without
  // the × 0.9235 multiplier, mislabeling K-1 Box 14 by overreporting 7.65%.
  // The new shape uses `netSEEarnings` (correct) instead of `seEarnings`.
  const memberK1 = (m: PartnershipMember) => calcMemberK1(m, netProfitCents);

  // ══════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════

  return (
    <div>
      {/* ── Partnership entity info ── */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '0.75rem',
        padding: '1rem',
        marginBottom: '1rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {es ? 'Información de la Sociedad' : 'Partnership Entity Info'}
            </div>
            <div style={{ fontSize: '0.95rem', color: '#e2e8f0', marginTop: '0.2rem', fontWeight: 600 }}>
              {partnership.legalName || (es ? '(Nombre legal no configurado)' : '(Legal name not set)')}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
              EIN: {partnership.ein || (es ? '(no configurado)' : '(not set)')}
              {' · '}
              {partnership.entityType === 'llc-p' ? 'LLC (Partnership)' : 'General Partnership'}
              {' · '}
              {partnership.accountingMethod === 'cash' ? (es ? 'Efectivo' : 'Cash') : (es ? 'Devengo' : 'Accrual')}
            </div>
          </div>
          <button
            onClick={() => setShowEntityForm(!showEntityForm)}
            style={{
              background: 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.4)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.875rem',
              color: '#93c5fd',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {showEntityForm ? (es ? '✕ Cerrar' : '✕ Close') : (es ? '✏️ Editar' : '✏️ Edit')}
          </button>
        </div>

        {showEntityForm && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginTop: '0.75rem' }}>
            <div>
              <label style={labelStyle}>{es ? 'Nombre Legal' : 'Legal Name'}</label>
              <input
                style={inputStyle}
                value={partnership.legalName}
                onChange={(e) => updatePartnership({ legalName: e.target.value })}
                placeholder="Go Cellular LLC"
              />
            </div>
            <div>
              <label style={labelStyle}>EIN (XX-XXXXXXX)</label>
              <input
                style={inputStyle}
                value={partnership.ein}
                onChange={(e) => updatePartnership({ ein: formatEINInput(e.target.value) })}
                placeholder="12-3456789"
                maxLength={10}
              />
            </div>
            <div>
              <label style={labelStyle}>{es ? 'Tipo de Entidad' : 'Entity Type'}</label>
              <select
                style={inputStyle}
                value={partnership.entityType}
                onChange={(e) => updatePartnership({ entityType: e.target.value as any })}
              >
                <option value="llc-p">LLC taxed as Partnership</option>
                <option value="partnership">General Partnership</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{es ? 'Método Contable' : 'Accounting Method'}</label>
              <select
                style={inputStyle}
                value={partnership.accountingMethod}
                onChange={(e) => updatePartnership({ accountingMethod: e.target.value as any })}
              >
                <option value="cash">{es ? 'Efectivo' : 'Cash'}</option>
                <option value="accrual">{es ? 'Devengo' : 'Accrual'}</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{es ? 'Fecha de Formación' : 'Formation Date'}</label>
              <input
                type="date"
                style={inputStyle}
                value={partnership.formationDate}
                onChange={(e) => updatePartnership({ formationDate: e.target.value })}
              />
            </div>
            <div>
              <label style={labelStyle}>{es ? 'Actividad Comercial' : 'Business Activity'}</label>
              <input
                style={inputStyle}
                value={partnership.businessActivity}
                onChange={(e) => updatePartnership({ businessActivity: e.target.value })}
                placeholder={es ? 'Reparación de celulares' : 'Cell phone repair'}
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>{es ? 'Producto / Servicio Principal' : 'Principal Product/Service'}</label>
              <input
                style={inputStyle}
                value={partnership.productOrService}
                onChange={(e) => updatePartnership({ productOrService: e.target.value })}
                placeholder={es ? 'Reparación de celulares y accesorios' : 'Phone repair and accessories'}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Ownership % validation banner ── */}
      {hasMembers && !pctValid && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: '0.625rem',
          padding: '0.75rem 1rem',
          marginBottom: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          <span style={{ fontSize: '1.1rem' }}>⚠️</span>
          <span style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
            {es
              ? `Los porcentajes de propiedad suman ${totalPct.toFixed(2)}% — deben sumar 100%.`
              : `Ownership percentages total ${totalPct.toFixed(2)}% — must equal 100%.`}
          </span>
        </div>
      )}
      {hasMembers && pctValid && (
        <div style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: '0.625rem',
          padding: '0.6rem 1rem',
          marginBottom: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          <span style={{ fontSize: '1rem' }}>✓</span>
          <span style={{ fontSize: '0.78rem', color: '#86efac' }}>
            {es
              ? `${members.length} ${members.length === 1 ? 'socio' : 'socios'} · 100% asignado`
              : `${members.length} ${members.length === 1 ? 'member' : 'members'} · 100% allocated`}
          </span>
        </div>
      )}

      {/* ── Members header + Add button ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1' }}>
          {es ? 'Socios / Miembros' : 'Members / Partners'}
        </div>
        <button
          onClick={openAdd}
          style={{
            background: 'linear-gradient(135deg, #22d3ee, #0891b2)',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.55rem 1rem',
            color: '#0f172a',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + {es ? 'Agregar Socio' : 'Add Member'}
        </button>
      </div>

      {/* ── Empty state ── */}
      {!hasMembers && !editingMember && (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px dashed rgba(255,255,255,0.15)',
          borderRadius: '0.75rem',
          padding: '2rem 1rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👥</div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.25rem', fontWeight: 600 }}>
            {es ? 'No hay socios configurados' : 'No members configured'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {es
              ? 'Agrega cada socio del Partnership para generar el K-1.'
              : 'Add each Partnership member to generate K-1 forms.'}
          </div>
        </div>
      )}

      {/* ── Member cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: members.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '0.875rem',
      }}>
        {members.map((m) => {
          const k1 = memberK1(m);
          return (
            <div key={m.id} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '0.75rem',
              padding: '1rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    👤 {m.name}
                    {m.isManaging && (
                      <span style={{
                        fontSize: '0.6rem',
                        background: 'rgba(34,211,238,0.15)',
                        border: '1px solid rgba(34,211,238,0.4)',
                        color: '#67e8f9',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '0.25rem',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                      }}>
                        {es ? 'Gerente' : 'Managing'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.15rem' }}>
                    {m.ssn ? `SSN: ${maskSSN(m.ssn)}` : (es ? 'SSN no configurado' : 'No SSN set')}
                    {m.ein && ` · EIN: ${m.ein}`}
                  </div>
                  {(m.address || m.city) && (
                    <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.15rem' }}>
                      {m.address && `${m.address}, `}{m.city}{m.state && `, ${m.state}`} {m.zip}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', marginLeft: '0.5rem' }}>
                  <button
                    onClick={() => openEdit(m)}
                    style={{
                      background: 'rgba(59,130,246,0.15)',
                      border: '1px solid rgba(59,130,246,0.4)',
                      borderRadius: '0.4rem',
                      padding: '0.35rem 0.6rem',
                      color: '#93c5fd',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    title={es ? 'Editar' : 'Edit'}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => setConfirmDelete(m.id)}
                    style={{
                      background: 'rgba(239,68,68,0.12)',
                      border: '1px solid rgba(239,68,68,0.35)',
                      borderRadius: '0.4rem',
                      padding: '0.35rem 0.6rem',
                      color: '#fca5a5',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    title={es ? 'Borrar' : 'Delete'}
                  >
                    🗑
                  </button>
                </div>
              </div>

              {/* K-1 preview rows */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                <MemberRow label={es ? 'Propiedad' : 'Ownership'} value={`${m.ownershipPct.toFixed(2)}%`} bold />
                <MemberRow label="Box 1 — Ordinary Income" value={formatCurrency(k1.ordinaryIncome)} color="#22c55e" />
                {m.guaranteedPayments > 0 && (
                  <MemberRow label="Box 4 — Guaranteed Payments" value={formatCurrency(m.guaranteedPayments)} color="#fbbf24" />
                )}
                <MemberRow label="Box 14 — Net SE Earnings" value={formatCurrency(k1.netSEEarnings)} />
                <MemberRow label="SE Tax (15.3%)" value={formatCurrency(k1.seTax)} color="#f87171" />
                <MemberRow label="½ SE Deduction" value={formatCurrency(k1.halfSE)} color="#22c55e" />
                <div style={{ borderTop: '1px dashed rgba(255,255,255,0.08)', marginTop: '0.4rem', paddingTop: '0.4rem' }}>
                  <MemberRow label="Beginning Capital" value={formatCurrency(m.beginningCapital)} small />
                  <MemberRow label="+ Contributions" value={formatCurrency(m.contributions)} small color="#22c55e" />
                  <MemberRow label="+ Income Share" value={formatCurrency(k1.ordinaryIncome)} small color="#22c55e" />
                  <MemberRow label="− Distributions" value={formatCurrency(m.distributions)} small color="#f87171" />
                  <MemberRow label="Ending Capital" value={formatCurrency(k1.endingCapital)} bold />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* EDIT MODAL                                          */}
      {/* ══════════════════════════════════════════════════ */}
      {editingMember && (
        <div
          onClick={() => { setEditingMember(null); setEditingId(null); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0f172a',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '640px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)',
            }}
          >
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '1rem' }}>
              {members.find((m) => m.id === editingId)
                ? (es ? '✏️ Editar Socio' : '✏️ Edit Member')
                : (es ? '+ Agregar Socio' : '+ Add Member')}
            </div>

            {/* Personal info */}
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
              {es ? 'Información Personal' : 'Personal Info'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={labelStyle}>{es ? 'Nombre Completo' : 'Full Name'} *</label>
                <input
                  style={inputStyle}
                  value={editingMember.name}
                  onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                  placeholder="Jorge Smith"
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>SSN / ITIN *</label>
                <input
                  style={inputStyle}
                  value={editingMember.ssn}
                  onChange={(e) => setEditingMember({ ...editingMember, ssn: formatSSNInput(e.target.value) })}
                  placeholder="123-45-6789"
                  maxLength={11}
                />
              </div>
              <div>
                <label style={labelStyle}>EIN ({es ? 'si es entidad' : 'if entity'})</label>
                <input
                  style={inputStyle}
                  value={editingMember.ein || ''}
                  onChange={(e) => setEditingMember({ ...editingMember, ein: formatEINInput(e.target.value) })}
                  placeholder="12-3456789"
                  maxLength={10}
                />
              </div>
            </div>

            {/* Address */}
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
              {es ? 'Dirección' : 'Address'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Calle' : 'Street'}</label>
                <input
                  style={inputStyle}
                  value={editingMember.address}
                  onChange={(e) => setEditingMember({ ...editingMember, address: e.target.value })}
                  placeholder="123 Main St"
                />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Ciudad' : 'City'}</label>
                <input
                  style={inputStyle}
                  value={editingMember.city}
                  onChange={(e) => setEditingMember({ ...editingMember, city: e.target.value })}
                  placeholder="Santa Barbara"
                />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Estado' : 'State'}</label>
                <input
                  style={inputStyle}
                  value={editingMember.state}
                  onChange={(e) => setEditingMember({ ...editingMember, state: e.target.value.toUpperCase().slice(0, 2) })}
                  placeholder="CA"
                  maxLength={2}
                />
              </div>
              <div>
                <label style={labelStyle}>ZIP</label>
                <input
                  style={inputStyle}
                  value={editingMember.zip}
                  onChange={(e) => setEditingMember({ ...editingMember, zip: e.target.value })}
                  placeholder="93103"
                />
              </div>
            </div>

            {/* Ownership */}
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
              {es ? 'Propiedad y Estado' : 'Ownership & Status'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={labelStyle}>% {es ? 'Propiedad' : 'Ownership'} *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  style={inputStyle}
                  value={editingMember.ownershipPct === 0 ? '' : editingMember.ownershipPct}
                  onChange={(e) => {
                    // r29d-1 — preserve empty string mid-typing instead of coercing to 0.
                    // The saveMember validation will catch invalid values; here we just
                    // need to let the user clear-and-retype without losing the field.
                    const v = e.target.value;
                    const parsed = v === '' ? 0 : parseFloat(v);
                    setEditingMember({
                      ...editingMember,
                      ownershipPct: Number.isFinite(parsed) ? parsed : 0,
                    });
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.4rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={editingMember.isManaging}
                    onChange={(e) => setEditingMember({ ...editingMember, isManaging: e.target.checked })}
                    style={{ width: '1rem', height: '1rem' }}
                  />
                  {es ? 'Gerente' : 'Managing'}
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.4rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={editingMember.isUSResident}
                    onChange={(e) => setEditingMember({ ...editingMember, isUSResident: e.target.checked })}
                    style={{ width: '1rem', height: '1rem' }}
                  />
                  {es ? 'Residente EE.UU.' : 'US Resident'}
                </label>
              </div>
            </div>

            {/* Capital account */}
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
              {es ? 'Cuenta de Capital (K-1 Item L)' : 'Capital Account (K-1 Item L)'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={labelStyle}>{es ? 'Capital Inicial' : 'Beginning Capital'} ($)</label>
                <input
                  style={inputStyle}
                  value={centsToDollars(editingMember.beginningCapital)}
                  onChange={(e) => setEditingMember({ ...editingMember, beginningCapital: dollarsToCents(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Aportaciones del Año' : 'Contributions YTD'} ($)</label>
                <input
                  style={inputStyle}
                  value={centsToDollars(editingMember.contributions)}
                  onChange={(e) => setEditingMember({ ...editingMember, contributions: dollarsToCents(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Distribuciones del Año' : 'Distributions YTD'} ($)</label>
                <input
                  style={inputStyle}
                  value={centsToDollars(editingMember.distributions)}
                  onChange={(e) => setEditingMember({ ...editingMember, distributions: dollarsToCents(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label style={labelStyle}>{es ? 'Pagos Garantizados' : 'Guaranteed Payments'} ($)</label>
                <input
                  style={inputStyle}
                  value={centsToDollars(editingMember.guaranteedPayments)}
                  onChange={(e) => setEditingMember({ ...editingMember, guaranteedPayments: dollarsToCents(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>{es ? 'Notas' : 'Notes'}</label>
              <textarea
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={editingMember.notes || ''}
                onChange={(e) => setEditingMember({ ...editingMember, notes: e.target.value })}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setEditingMember(null); setEditingId(null); }}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.5rem',
                  padding: '0.65rem 1.25rem',
                  color: '#cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={saveMember}
                disabled={!editingMember.name.trim()}
                style={{
                  background: !editingMember.name.trim()
                    ? 'rgba(34,211,238,0.3)'
                    : 'linear-gradient(135deg, #22d3ee, #0891b2)',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '0.65rem 1.5rem',
                  color: '#0f172a',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: !editingMember.name.trim() ? 'not-allowed' : 'pointer',
                  opacity: !editingMember.name.trim() ? 0.5 : 1,
                }}
              >
                {es ? '💾 Guardar' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* DELETE CONFIRMATION                                 */}
      {/* ══════════════════════════════════════════════════ */}
      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 210,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0f172a',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '420px',
              width: '100%',
            }}
          >
            <div style={{ fontSize: '2rem', textAlign: 'center', marginBottom: '0.5rem' }}>⚠️</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', textAlign: 'center', marginBottom: '0.5rem' }}>
              {es ? '¿Borrar este socio?' : 'Delete this member?'}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginBottom: '1.25rem' }}>
              {es
                ? 'Esta acción no se puede deshacer. La información del socio se eliminará permanentemente.'
                : "This can't be undone. The member's information will be permanently removed."}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.5rem',
                  padding: '0.65rem 1.25rem',
                  color: '#cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={() => deleteMember(confirmDelete)}
                style={{
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '0.65rem 1.5rem',
                  color: 'white',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {es ? '🗑 Borrar' : '🗑 Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline row helper ────────────────────────────────────
function MemberRow({ label, value, color, bold, small }: {
  label: string; value: string; color?: string; bold?: boolean; small?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: small ? '0.2rem 0' : '0.3rem 0',
    }}>
      <span style={{
        fontSize: small ? '0.7rem' : '0.75rem',
        color: bold ? '#cbd5e1' : '#94a3b8',
        fontWeight: bold ? 700 : 400,
      }}>{label}</span>
      <span style={{
        fontSize: small ? '0.72rem' : '0.78rem',
        fontWeight: bold ? 800 : 600,
        color: color || '#e2e8f0',
        fontFamily: 'ui-monospace, monospace',
      }}>{value}</span>
    </div>
  );
}
