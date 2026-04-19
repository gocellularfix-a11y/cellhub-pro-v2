// ============================================================
// CellHub Pro — Employee Management
// Matches original app: table with Docs badge, Print Onboarding,
// 5-tab modal (Personal/Employment/Legal/Skills/Notes)
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Modal, ConfirmDialog } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { generateId } from '@/utils/dates';
import { hashPin, isHashed } from '@/utils/pinHash';
import { usePrint } from '@/hooks/usePrint';
import type { Employee, EmployeeRole } from '@/store/types';
import { persist, remove } from '@/services/persist';
import { ASSIGNABLE_MODULES, ROLE_DEFAULT_MODULES } from '@/config/constants';

// ── HTML escape helper (round 24) — prevents XSS in buildOnboardingHTML ──
function escHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Canonical role options (round 24 — C1 fix) ──────────────
// EmployeeRole = 'owner'|'manager'|'technician'|'sales'|'cashier'
// Display labels bilingual; stored value is always lowercase canonical.
const ROLE_OPTIONS: Array<{ value: EmployeeRole; en: string; es: string }> = [
  { value: 'owner',      en: 'Owner',      es: 'Dueño' },
  { value: 'manager',    en: 'Manager',    es: 'Gerente' },
  { value: 'sales',      en: 'Sales',      es: 'Ventas' },
  { value: 'technician', en: 'Technician', es: 'Técnico' },
  { value: 'cashier',    en: 'Cashier',    es: 'Cajero/a' },
];

// ── Form whitelist (round 24 — M3 fix) ──────────────────────
// When editing, we only spread these fields from the employee record
// into modal state. This prevents plaintext PIN, SSN, clockLog, etc.
// from leaking into React devtools and keeps the form state tight.
const FORM_EDITABLE_FIELDS = [
  'name', 'role', 'active',
  'phone', 'email', 'dob', 'address',
  'emergencyName', 'emergencyPhone',
  'position', 'employmentType', 'startDate',
  'hourlyRateCents', 'commissionRate',
  'paySchedule', 'scheduledHours', 'languages',
  'w4Status', 'i9Authorization', 'idDocumentType',
  'docsW4', 'docsI9', 'docsIDCopy', 'docsDirectDeposit', 'docsHandbook',
  'skillScreen', 'skillBattery', 'skillCharging',
  'skillWater', 'skillUnlock', 'skillData',
  'managerNotes',
  'allowedModules',
] as const;

function pickFormFields(emp: any): Record<string, unknown> {
  if (!emp || typeof emp !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const k of FORM_EDITABLE_FIELDS) {
    if (k in emp) out[k] = emp[k];
  }
  return out;
}

interface Props {
  employees: Employee[];
  setEmployees: (e: Employee[]) => void;
  lang: string;
  L: Record<string, any>;
  settings?: any;
  currentEmployee?: any;
}

const MODAL_SECTIONS = [
  { id: 'personal',    icon: '👤', label: 'Personal' },
  { id: 'employment',  icon: '💼', label: 'Employment' },
  { id: 'legal',       icon: '📄', label: 'Legal' },
  { id: 'skills',      icon: '⚙️',  label: 'Skills' },
  { id: 'notes',       icon: '📝', label: 'Notes' },
];

// Round 24: role is canonical lowercase EmployeeRole; money in cents;
// commission as ratio (0.07 = 7%); dead access* flags removed.
const DEFAULT_FORM = {
  // Core
  name: '', role: 'sales' as EmployeeRole, pin: '', active: true,
  // Personal
  phone: '', email: '', dob: '', address: '',
  emergencyName: '', emergencyPhone: '',
  // Employment
  position: 'Sales Associate',
  employmentType: 'Full-time',
  startDate: new Date().toISOString().slice(0, 10),
  hourlyRateCents: 0,       // money-in-cents canonical
  commissionRate: 0,        // ratio (0.07 = 7%)
  paySchedule: 'Bi-weekly',
  scheduledHours: '', languages: '',
  // Legal
  ssn: '', w4Status: '', i9Authorization: '', idDocumentType: '',
  docsW4: false, docsI9: false, docsIDCopy: false, docsDirectDeposit: false, docsHandbook: false,
  // Skills
  skillScreen: false, skillBattery: false, skillCharging: false,
  skillWater: false, skillUnlock: false, skillData: false,
  // Notes
  managerNotes: '',
  // Module access (per-employee override)
  allowedModules: [] as string[],
};

// ── Print helpers ─────────────────────────────────────────

const PRINT_CSS = `
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Arial,Helvetica,sans-serif; font-size:9.68px; color:#111; background:white; }
/* r-audit-r3: shrink-to-fit for letter (8.5×11). The 5-section onboarding
   form overflows at native size. 92% scale guarantees single-page fit. */
.page { max-width:780px; margin:0 auto; padding:0.4in 0.5in; transform:scale(0.92); transform-origin:top left; }
.header { background:#1a1a2e; color:white; padding:16px 20px; display:flex; justify-content:space-between; align-items:flex-start; }
.header h1 { font-size:15px; font-weight:700; margin-bottom:2px; }
.header p { font-size:9px; color:#aaa; }
.store-info { text-align:right; font-size:9.5px; color:#ccc; line-height:1.6; }
.store-info strong { font-size:13px; color:white; display:block; }
.section { border:1px solid #ddd; margin-bottom:10px; }
.section-title { background:#1a1a2e; color:white; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; padding:5px 10px; }
.section-body { padding:10px 12px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; margin-bottom:8px; }
.grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px 16px; margin-bottom:8px; }
.field label { display:block; font-size:8px; color:#777; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:1px; }
.field .line { border-bottom:1px solid #999; min-height:18px; width:100%; margin-top:2px; }
.field .val { border-bottom:1px solid #888; min-height:16px; font-size:11px; padding-bottom:1px; font-weight:500; }
.cb-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px 8px; margin-top:8px; font-size:10px; }
.cb { display:flex; align-items:center; gap:5px; }
.cb .box { width:11px; height:11px; border:1px solid #555; flex-shrink:0; }
.policy-item { display:flex; gap:10px; align-items:flex-start; margin-bottom:8px; }
.policy-initial { border-bottom:1px solid #333; min-width:44px; height:22px; flex-shrink:0; margin-top:2px; text-align:center; font-size:8px; color:#aaa; line-height:22px; }
.policy-text { font-size:9.5px; line-height:1.5; color:#222; background:#f9f9f9; border-left:2px solid #1a1a2e; padding:5px 8px; flex:1; }
.policy-text strong { font-weight:700; }
.sig-row { display:grid; grid-template-columns:2fr 1fr; gap:16px; margin-bottom:14px; }
.sig-block label { font-size:8px; color:#777; text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:2px; }
.sig-line { border-bottom:1.5px solid #333; height:32px; }
.consent-box { font-size:9.5px; color:#333; line-height:1.5; background:#f5f5f5; border:1px solid #ddd; padding:8px 10px; margin-bottom:14px; }
.footer { text-align:center; font-size:8.5px; color:#888; border-top:1px solid #ddd; padding-top:6px; margin-top:8px; }
@page { size:letter; margin:0.25in; }
@media print { body{margin:0;} .page{padding:0.3in 0.4in;} }
`;

function buildOnboardingHTML(emp: any, settings: any, blank = false) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  // All interpolated strings go through escHtml to prevent XSS (round 24 — C5 fix).
  const storeName = escHtml(settings?.storeName || 'Your Company');
  const storeAddress = escHtml(settings?.storeAddress || '');
  const storeWeb = escHtml(settings?.storeWebsite || '');
  const fmt = (v: any) => blank ? '' : escHtml(v || '');
  const chk = (v: boolean) => v ? '[X]' : '[ ]';

  // Round 24: format hourly rate from cents, commission from ratio.
  const hourlyDisplay = (blank || !emp?.hourlyRateCents)
    ? ''
    : `$${((emp.hourlyRateCents || 0) / 100).toFixed(2)}/hr`;
  const commissionDisplay = (blank || !emp?.commissionRate)
    ? ''
    : `${((emp.commissionRate || 0) * 100).toFixed(1)}%`;

  const field = (lbl: string, val = '') =>
    `<div class="field"><label>${escHtml(lbl)}</label><div class="${blank ? 'line' : 'val'}">${val}</div></div>`;
  const row3 = (a: string, av: string, b: string, bv: string, c: string, cv: string) =>
    `<div class="grid3">${field(a, av)}${field(b, bv)}${field(c, cv)}</div>`;
  const row2 = (a: string, av: string, b: string, bv: string) =>
    `<div class="grid2">${field(a, av)}${field(b, bv)}</div>`;
  const policy = (title: string, body: string) =>
    `<div class="policy-item"><div class="policy-initial"></div><div class="policy-text"><strong>${escHtml(title)}</strong> ${escHtml(body)}</div></div>`;

  const empNameForTitle = blank ? '' : ` - ${escHtml(emp?.name || '')}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Employee Onboarding${empNameForTitle}</title>
<style>${PRINT_CSS}</style></head><body><div class="page">
<div class="header">
  <div>
    <h1>Employee Onboarding Agreement</h1>
    <p>Acuerdo de Contratacion de Empleado</p>
    <p style="margin-top:5px;font-size:8px;color:#888;">Form EMP-001 &nbsp;|&nbsp; ${blank ? 'Date / Fecha: ' + today : 'Generated: ' + today}</p>
  </div>
  <div class="store-info">
    <strong>${storeName}</strong>${storeAddress}<br>${storeWeb}
  </div>
</div>
<div class="section"><div class="section-title">1. Employee Information / Informacion del Empleado</div><div class="section-body">
  ${row3('Full name / Nombre completo', fmt(emp?.name), 'Position / Puesto', fmt(emp?.position), 'Start date / Fecha de inicio', fmt(emp?.startDate))}
  ${row3('Phone / Telefono', fmt(emp?.phone), 'Email', fmt(emp?.email), 'Date of birth / Fecha de nac.', fmt(emp?.dob))}
  ${field('Home address / Direccion', fmt(emp?.address))}
  ${row2('Emergency contact / Contacto de emergencia', fmt(emp?.emergencyName), 'Emergency phone / Telefono emergencia', fmt(emp?.emergencyPhone))}
</div></div>
<div class="section"><div class="section-title">2. Employment Terms / Condiciones de Empleo</div><div class="section-body">
  ${row3('Employment type / Tipo', fmt(emp?.employmentType), 'Pay rate / Salario ($/hr)', hourlyDisplay, 'Pay schedule / Frecuencia', fmt(emp?.paySchedule))}
  ${row3('Schedule / Horario', fmt(emp?.scheduledHours), 'Commission / Comision', commissionDisplay, 'Languages / Idiomas', fmt(emp?.languages))}
</div></div>
<div class="section"><div class="section-title">3. Work Authorization & Tax / Autorizacion de Trabajo e Impuestos</div><div class="section-body">
  ${row3('I-9 Authorization', fmt(emp?.i9Authorization), 'ID Document type', fmt(emp?.idDocumentType), 'W-4 Filing status', fmt(emp?.w4Status))}
  <div style="font-size:8px;color:#777;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;margin-top:4px;">Documents submitted / Documentos entregados</div>
  <div class="cb-grid">
    <div class="cb"><div class="box">${blank ? '' : chk(emp?.docsW4)}</div> W-4 signed / firmado</div>
    <div class="cb"><div class="box">${blank ? '' : chk(emp?.docsI9)}</div> I-9 completed / completado</div>
    <div class="cb"><div class="box">${blank ? '' : chk(emp?.docsIDCopy)}</div> ID copies on file</div>
    <div class="cb"><div class="box">${blank ? '' : chk(emp?.docsDirectDeposit)}</div> Direct deposit form</div>
    <div class="cb"><div class="box">${blank ? '' : chk(emp?.docsHandbook)}</div> Employee handbook signed</div>
    <div class="cb"><div class="box"></div> Other: _______________</div>
  </div>
</div></div>
<div class="section"><div class="section-title">4. Store Policies / Politicas de la Tienda &mdash; Initial each / Iniciales en cada punto</div><div class="section-body">
  ${policy('Punctuality & attendance / Puntualidad:', 'Employee agrees to report on time for all scheduled shifts. Absences must be communicated at least 2 hours in advance. No-call no-show may result in immediate termination.')}
  ${policy('Cash handling & POS / Manejo de efectivo:', 'Employee is responsible for their register at all times. Cash shortages over $10 must be reported immediately. Theft will result in immediate termination and legal action.')}
  ${policy('Customer devices / Dispositivos de clientes:', 'All devices received for repair must be logged before work begins. Employee is liable for damage caused by negligence. Customer data is strictly confidential.')}
  ${policy('Confidentiality / Confidencialidad:', 'Employee agrees not to disclose pricing, supplier information, customer data, system credentials, or any proprietary business information during or after employment.')}
  ${policy('At-will employment (California) / Empleo voluntario:', 'This is an at-will employment agreement. Either party may terminate the employment relationship at any time, with or without cause, subject to applicable California law.')}
</div></div>
<div class="section"><div class="section-title">5. Agreement & Signatures / Acuerdo y Firmas</div><div class="section-body">
  <div class="consent-box">By signing below, the employee acknowledges that they have read and understood all employment terms and store policies, and agree to comply with them as a condition of employment. / Al firmar, el empleado reconoce haber leido y comprendido todos los terminos y politicas, y se compromete a cumplirlos como condicion de empleo.</div>
  <div class="sig-row"><div class="sig-block"><label>Employee signature / Firma del empleado</label><div class="sig-line"></div></div><div class="sig-block"><label>Date / Fecha</label><div class="sig-line"></div></div></div>
  <div class="sig-row" style="margin-bottom:0;"><div class="sig-block"><label>Manager / Owner signature / Firma del gerente</label><div class="sig-line"></div></div><div class="sig-block"><label>Date / Fecha</label><div class="sig-line"></div></div></div>
</div></div>
<div class="footer">${storeName} &nbsp; ${storeAddress} &nbsp; ${storeWeb} &nbsp;|&nbsp; Form EMP-001 &nbsp; Employee copy / Store copy</div>
</div></body></html>`;
}

// ── Main component ────────────────────────────────────────

export default function EmployeeSection({ employees, setEmployees, lang, L, settings, currentEmployee }: Props) {
  const es = lang === 'es';
  const { toast } = useToast();
  const { printHtml } = usePrint();

  const [showModal, setShowModal] = useState(false);
  const [editEmployee, setEditEmployee] = useState<any | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Anti-stale ref — AppProvider setters don't accept updater fns (canonical pattern)
  const employeesRef = useRef(employees);
  useEffect(() => { employeesRef.current = employees; }, [employees]);

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);
  // inactiveEmployees computed but not yet rendered — kept for future "show inactive" toggle
  void useMemo(() => employees.filter((e) => !e.active), [employees]);

  const handleSave = useCallback(async (data: any) => {
    if (editEmployee) {
      // Edit mode: if form.pin is blank, preserve the existing PIN (round 24 — M3 fix:
      // edit modal no longer loads plaintext PIN into React state at all).
      // r27 M3: hash the new PIN if one was typed. Preserved PINs are already hashed
      // (or empty), so we never re-hash an already-hashed value (isHashed short-circuit).
      const typedPin = (data.pin && String(data.pin).trim().length >= 4) ? data.pin : '';
      const preservedPin = typedPin
        ? await hashPin(typedPin)
        : editEmployee.pin;
      const updated = { ...editEmployee, ...data, pin: preservedPin };
      const nextEmployees = employeesRef.current.map((e) => (e.id === editEmployee.id ? updated : e));
      employeesRef.current = nextEmployees;
      setEmployees(nextEmployees);
      persist.employee(updated.id, updated as Record<string, unknown>);
    } else {
      // r27 M3: hash the create-mode PIN. Empty PIN is allowed (no-PIN employee).
      const hashedPin = data.pin ? await hashPin(String(data.pin)) : '';
      const newEmp = {
        id: generateId(),
        ...DEFAULT_FORM,
        ...data,
        pin: hashedPin,
        createdAt: new Date().toISOString(),
      };
      const nextEmployees = [...employeesRef.current, newEmp];
      employeesRef.current = nextEmployees;
      setEmployees(nextEmployees);
      persist.employee(newEmp.id, newEmp as Record<string, unknown>);
    }
    setShowModal(false);
    setEditEmployee(null);
  }, [editEmployee, setEmployees]);

  const toggleActive = useCallback((id: string) => {
    // Round 24 — C6: guard rails on deactivation too.
    // Can't deactivate yourself and can't deactivate the last active owner.
    const target = employeesRef.current.find((e) => e.id === id);
    if (!target) return;
    const turningOff = target.active;
    if (turningOff) {
      if (currentEmployee?.id === id) {
        toast(es ? 'No puedes desactivarte a ti mismo' : "You can't deactivate yourself", 'error');
        return;
      }
      if (target.role === 'owner') {
        const remainingActiveOwners = employeesRef.current.filter(
          (e) => e.active && e.role === 'owner' && e.id !== id,
        ).length;
        if (remainingActiveOwners === 0) {
          toast(es ? 'Debe quedar al menos un dueño activo' : 'At least one active owner must remain', 'error');
          return;
        }
      }
    }
    const toggled = employeesRef.current.map((e) => e.id === id ? { ...e, active: !e.active } : e);
    employeesRef.current = toggled;
    setEmployees(toggled);
    const emp = toggled.find((e) => e.id === id);
    if (emp) persist.employee(emp.id, emp as unknown as Record<string, unknown>);
  }, [setEmployees, currentEmployee, es, toast]);

  const handleDelete = useCallback((id: string) => {
    // Round 24 — C6: block self-delete and last-owner delete.
    const target = employeesRef.current.find((e) => e.id === id);
    if (!target) { setDeleteConfirm(null); return; }
    if (currentEmployee?.id === id) {
      toast(es ? 'No puedes eliminarte a ti mismo' : "You can't delete yourself", 'error');
      setDeleteConfirm(null);
      return;
    }
    if (target.role === 'owner') {
      const remainingOwners = employeesRef.current.filter((e) => e.role === 'owner' && e.id !== id).length;
      if (remainingOwners === 0) {
        toast(
          es ? 'Debe quedar al menos un dueño en el sistema' : 'At least one owner must remain in the system',
          'error',
        );
        setDeleteConfirm(null);
        return;
      }
    }
    const nextEmployees = employeesRef.current.filter((e) => e.id !== id);
    employeesRef.current = nextEmployees;
    setEmployees(nextEmployees);
    remove.employee(id);
    setDeleteConfirm(null);
    toast(es ? 'Empleado eliminado' : 'Employee deleted', 'success');
  }, [setEmployees, currentEmployee, es, toast]);

  const openModal = (emp: any = null) => {
    setEditEmployee(emp);
    setShowModal(true);
  };

  const handlePrintOnboarding = useCallback(async (emp: any, blank: boolean) => {
    const html = buildOnboardingHTML(emp, settings, blank);
    try {
      await printHtml(html, { silent: false, printer: settings?.detectedPrinters?.[0] });
    } catch (err) {
      console.error('[Employees] Print failed:', err);
      toast(es ? 'Error al imprimir' : 'Print failed', 'error');
    }
  }, [settings, printHtml, toast, es]);

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
          👥 {es ? 'Empleados' : 'Employees'}
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => handlePrintOnboarding(null, true)}
            style={{ padding: '0.45rem 0.875rem', borderRadius: '0.5rem', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#34d399', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            🖨️ {es ? 'Forma en Blanco' : 'Blank Form'}
          </button>
          <button onClick={() => openModal(null)} className="btn btn-primary btn-sm">
            + {es ? 'Nuevo Empleado' : 'New Employee'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              {['Name', 'Role', 'Position', 'Start Date', 'Docs', 'PIN', 'Status', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '0.625rem 0.875rem', color: '#64748b', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: '#475569' }}>No employees yet. Add your first employee.</td></tr>
            )}
            {employees.map((emp: any) => {
              const docsCount = [emp.docsW4, emp.docsI9, emp.docsIDCopy, emp.docsDirectDeposit, emp.docsHandbook].filter(Boolean).length;
              const docsBadgeColor = docsCount === 5 ? '#22c55e' : docsCount >= 3 ? '#f59e0b' : '#ef4444';
              return (
                <tr key={emp.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{emp.name}</div>
                    {emp.phone && <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{emp.phone}</div>}
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem', color: '#94a3b8' }}>{emp.role}</td>
                  <td style={{ padding: '0.625rem 0.875rem', color: '#94a3b8', fontSize: '0.78rem' }}>{emp.position || '—'}</td>
                  <td style={{ padding: '0.625rem 0.875rem', color: '#64748b', fontSize: '0.78rem' }}>{emp.startDate || '—'}</td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <span style={{ background: `${docsBadgeColor}20`, border: `1px solid ${docsBadgeColor}40`, color: docsBadgeColor, padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>
                      {docsCount}/5
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <span style={{ fontFamily: 'Courier New, monospace', background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.82rem', letterSpacing: '0.2em' }}>••••</span>
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <button
                      onClick={() => toggleActive(emp.id)}
                      style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, background: emp.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: emp.active ? '#22c55e' : '#ef4444' }}
                    >
                      {emp.active ? (es ? 'Activo' : 'Active') : (es ? 'Inactivo' : 'Inactive')}
                    </button>
                  </td>
                  <td style={{ padding: '0.625rem 0.875rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button onClick={() => openModal(emp)} className="btn btn-ghost btn-sm" title="Edit">✏️</button>
                      <button
                        onClick={() => handlePrintOnboarding(emp, false)}
                        style={{ padding: '0.25rem 0.5rem', borderRadius: '0.375rem', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#34d399', cursor: 'pointer', fontSize: '0.75rem' }}
                        title="Print onboarding form"
                      >🖨️</button>
                      <button onClick={() => setDeleteConfirm(emp.id)} className="btn btn-ghost btn-sm text-red-400" title="Delete">🗑️</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && createPortal(
        <EmployeeFormModal
          employee={editEmployee}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditEmployee(null); }}
          lang={lang} L={L}
        />,
        document.body
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        title={es ? 'Eliminar Empleado' : 'Delete Employee'}
        message={es ? '¿Eliminar este empleado? Esta acción no se puede deshacer.' : 'Delete this employee? This action cannot be undone.'}
        variant="danger"
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}

// ── Employee Form Modal ───────────────────────────────────

function EmployeeFormModal({ employee, onSave, onClose, lang, L }: {
  employee: any; onSave: (d: any) => void; onClose: () => void; lang: string; L: any;
}) {
  const es = lang === 'es';
  const isEdit = !!employee;
  // Round 24 — M3 fix: DO NOT spread the whole employee object into form state.
  // That would bleed plaintext PIN, SSN, clockLog, etc. into React devtools.
  // Instead, pick only whitelisted form fields and start PIN blank on edit.
  const [form, setForm] = useState<any>(() => ({
    ...DEFAULT_FORM,
    ...pickFormFields(employee),
    pin: '', // edit: blank means "keep existing PIN" (enforced in handleSave)
  }));
  // Initialize default modules for existing employees who don't have allowedModules
  useEffect(() => {
    const existing = pickFormFields(employee);
    if (!existing.allowedModules || (existing.allowedModules as any[]).length === 0) {
      const defaults = ROLE_DEFAULT_MODULES[employee?.role] || [];
      setForm((f: any) => ({ ...f, allowedModules: defaults }));
    }
  }, [employee?.role]);
  const [activeSection, setActiveSection] = useState('personal');
  const [validationError, setValidationError] = useState<string | null>(null);

  const upd = (field: string, val: any) => setForm((f: any) => ({ ...f, [field]: val }));

  const handleSubmit = () => {
    setValidationError(null);
    if (!form.name.trim()) { setValidationError(es ? 'Nombre requerido' : 'Name is required'); return; }
    // On CREATE, PIN is required (min 4 digits).
    // On EDIT, PIN may be blank (preserves existing) OR if provided must be ≥4 digits.
    if (!isEdit) {
      if (!form.pin || form.pin.length < 4) {
        setValidationError(es ? 'PIN de 4 dígitos requerido' : '4-digit PIN required');
        return;
      }
    } else if (form.pin && form.pin.length > 0 && form.pin.length < 4) {
      setValidationError(es ? 'El nuevo PIN debe tener al menos 4 dígitos' : 'New PIN must be at least 4 digits');
      return;
    }
    onSave(form);
  };

  const Cb = ({ field, label }: { field: string; label: string }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.83rem', cursor: 'pointer', padding: '2px 0', color: form[field] ? '#e2e8f0' : '#94a3b8' }}>
      <input type="checkbox" checked={!!form[field]} onChange={(e) => upd(field, e.target.checked)}
        style={{ width: '14px', height: '14px', accentColor: '#818cf8', cursor: 'pointer' }} />
      {label}
    </label>
  );

  const F = ({ label, field, type = 'text', placeholder = '', options }: {
    label: string; field: string; type?: string; placeholder?: string; options?: string[];
  }) => (
    <div>
      <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{label}</label>
      {options ? (
        <select className="select" value={form[field] || ''} onChange={(e) => upd(field, e.target.value)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type} className="input"
          value={form[field] || ''}
          onChange={(e) => upd(field, e.target.value)}
          placeholder={placeholder}
          style={type === 'password' ? { fontFamily: 'Courier New, monospace', letterSpacing: '0.15em' } : undefined}
        />
      )}
    </div>
  );

  return (
    <Modal open onClose={onClose}
      title={`${employee ? '✏️' : '👤'} ${employee ? (es ? 'Editar Empleado' : 'Edit Employee') : (es ? 'Nuevo Empleado' : 'New Employee')}`}
      size="max-w-2xl"
    >
      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '0.375rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.07)' }}>
        {MODAL_SECTIONS.map((s) => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
            padding: '0.4rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.78rem', fontWeight: 600,
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            background: activeSection === s.id ? 'rgba(99,102,241,0.25)' : 'transparent',
            color: activeSection === s.id ? '#818cf8' : '#64748b',
          }}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: 'calc(70vh - 140px)', overflowY: 'auto', paddingRight: '2px' }}>

        {/* ── PERSONAL ── */}
        {activeSection === 'personal' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {es ? 'Nombre' : 'Name'} * <span style={{ color: '#f87171', fontSize: '0.68rem' }}>(display name)</span>
                </label>
                <input className="input" value={form.name} onChange={(e) => upd('name', e.target.value)} placeholder="Juan Pérez" autoFocus />
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                  PIN (4 digits) {isEdit ? <span style={{ color: '#64748b', fontSize: '0.68rem' }}>({es ? 'en blanco para mantener' : 'blank to keep existing'})</span> : '*'}
                </label>
                <input type="password" className="input"
                  value={form.pin} onChange={(e) => upd('pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  maxLength={4} placeholder={isEdit ? '••••' : '0000'}
                  autoComplete="new-password"
                  style={{ fontFamily: 'Courier New, monospace', fontSize: '1.25rem', letterSpacing: '0.8em', textAlign: 'center' }} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <F label={es ? 'Teléfono' : 'Phone'} field="phone" type="tel" placeholder="(805) 555-0100" />
              <F label="Email" field="email" type="email" placeholder="juan@email.com" />
              <F label={es ? 'Fecha de nacimiento' : 'Date of birth'} field="dob" type="date" />
            </div>
            <F label={es ? 'Dirección' : 'Home address'} field="address" placeholder="123 Main St, Santa Barbara, CA 93101" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <F label={es ? 'Contacto emergencia' : 'Emergency contact'} field="emergencyName" placeholder="Maria Pérez" />
              <F label={es ? 'Teléfono emergencia' : 'Emergency phone'} field="emergencyPhone" type="tel" placeholder="(805) 555-0199" />
            </div>
          </div>
        )}

        {/* ── EMPLOYMENT ── */}
        {activeSection === 'employment' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <F label={es ? 'Posición' : 'Position'} field="position"
                options={['Sales Associate','Repair Technician','Lead Technician','Assistant Manager','Store Manager']} />
              <F label={es ? 'Tipo' : 'Employment type'} field="employmentType"
                options={['Full-time','Part-time','Seasonal']} />
              <F label={es ? 'Fecha inicio' : 'Start date'} field="startDate" type="date" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Salario ($/hr)' : 'Pay rate ($/hr)'}</label>
                <input type="number" className="input" step="0.01" min="0"
                  value={((form.hourlyRateCents ?? 0) / 100).toFixed(2)}
                  onChange={(e) => upd('hourlyRateCents', Math.round((parseFloat(e.target.value) || 0) * 100))}
                  placeholder="17.00" />
              </div>
              <F label={es ? 'Pago cada' : 'Pay schedule'} field="paySchedule"
                options={['Weekly','Bi-weekly','Semi-monthly']} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <F label={es ? 'Horario' : 'Schedule / Hours'} field="scheduledHours" placeholder="Mon–Fri 10am–6pm" />
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Comisión (%)' : 'Commission (%)'}</label>
                <input type="number" className="input" step="0.1" min="0" max="100"
                  value={((form.commissionRate ?? 0) * 100).toFixed(1)}
                  onChange={(e) => upd('commissionRate', (parseFloat(e.target.value) || 0) / 100)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>{es ? 'Rol en sistema' : 'System role'}</label>
                <select className="select" value={form.role} onChange={(e) => {
                  const newRole = e.target.value as EmployeeRole;
                  upd('role', newRole);
                  // Auto-set default modules for the new role (unless already customized)
                  const defaults = ROLE_DEFAULT_MODULES[newRole] || [];
                  if ((form.allowedModules || []).length === 0) {
                    upd('allowedModules', defaults);
                  }
                }}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{es ? r.es : r.en}</option>
                  ))}
                </select>
                <p style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.25rem' }}>
                  {es
                    ? 'El rol controla qué pestañas ve el empleado.'
                    : 'Role controls which tabs this employee can see.'}
                </p>
              </div>
              <F label={es ? 'Idiomas' : 'Languages spoken'} field="languages" placeholder="English, Spanish" />
            </div>
            <div style={{ marginTop: '0.25rem' }}>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.375rem', fontWeight: 600 }}>
                {es ? 'Módulos accesibles' : 'Module access'}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem 1rem' }}>
                {ASSIGNABLE_MODULES.map((mod) => (
                  <label key={mod.id} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer', fontSize: '0.78rem' }}>
                    <input
                      type="checkbox"
                      checked={(form.allowedModules || []).includes(mod.id)}
                      onChange={(e) => {
                        const current = form.allowedModules || [];
                        if (e.target.checked) {
                          upd('allowedModules', [...current, mod.id]);
                        } else {
                          upd('allowedModules', current.filter((id: string) => id !== mod.id));
                        }
                      }}
                      style={{ width: '1rem', height: '1rem', accentColor: '#3b82f6' }}
                    />
                    <span>{mod.icon} {mod.label}</span>
                  </label>
                ))}
              </div>
              <p style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.375rem' }}>
                {es
                  ? 'Deja vacío para usar los módulos del rol por defecto.'
                  : 'Leave empty to use default modules from the role.'}
              </p>
            </div>
          </div>
        )}

        {/* ── LEGAL ── */}
        {activeSection === 'legal' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div style={{ padding: '0.625rem 0.75rem', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '0.5rem', fontSize: '0.78rem', color: '#fbbf24' }}>
              ⚠️ {es ? 'SSN/ITIN se almacena localmente. No compartir sin autorización.' : 'SSN/ITIN stored locally only. Do not share without authorization.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>SSN / ITIN</label>
                <input type="password" className="input"
                  value={form.ssn || ''} onChange={(e) => upd('ssn', e.target.value)}
                  placeholder="XXX-XX-XXXX"
                  style={{ fontFamily: 'Courier New, monospace', letterSpacing: '0.15em' }} />
              </div>
              <F label="W-4 Filing Status" field="w4Status"
                options={['','Single','Married filing jointly','Head of household']} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <F label="I-9 Work Authorization" field="i9Authorization"
                options={['','U.S. Citizen','Lawful Permanent Resident','Work Visa','Other authorized']} />
              <F label="ID Document Type" field="idDocumentType"
                options={["","Driver's License + SS Card","Passport","Passport Card","Permanent Resident Card","Employment Auth. Document"]} />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                {es ? 'Documentos recibidos' : 'Documents received'}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                <Cb field="docsW4" label="W-4 signed" />
                <Cb field="docsI9" label="I-9 completed" />
                <Cb field="docsIDCopy" label={es ? 'Copias de ID archivadas' : 'ID copies on file'} />
                <Cb field="docsDirectDeposit" label="Direct deposit form" />
                <Cb field="docsHandbook" label={es ? 'Manual empleado firmado' : 'Employee handbook signed'} />
              </div>
            </div>
          </div>
        )}

        {/* ── SKILLS ── */}
        {activeSection === 'skills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.5rem' }}>
                🔧 {es ? 'Habilidades de reparación' : 'Repair skills'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 1rem' }}>
                <Cb field="skillScreen" label={es ? 'Cambio de pantalla' : 'Screen replacement'} />
                <Cb field="skillBattery" label={es ? 'Cambio de batería' : 'Battery replacement'} />
                <Cb field="skillCharging" label={es ? 'Puerto de carga' : 'Charging port repair'} />
                <Cb field="skillWater" label={es ? 'Daño por agua' : 'Water damage'} />
                <Cb field="skillUnlock" label="Unlocking / flashing" />
                <Cb field="skillData" label={es ? 'Transferencia de datos' : 'Data transfer'} />
              </div>
            </div>
            {/* Round 24: Access is controlled by Role (Employment tab), not per-checkbox. */}
            <div style={{ padding: '0.625rem 0.75rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#a5b4fc' }}>
              🔐 {es
                ? 'El acceso a módulos se controla por el rol del empleado (pestaña Employment). Cambia el rol allí para ajustar permisos.'
                : 'Module access is controlled by the employee role (Employment tab). Change the role there to adjust permissions.'}
            </div>
          </div>
        )}

        {/* ── NOTES ── */}
        {activeSection === 'notes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                {es ? 'Notas internas (solo manager)' : 'Internal notes (manager only)'}
              </label>
              <textarea className="textarea" rows={5}
                value={form.managerNotes || ''}
                onChange={(e) => upd('managerNotes', e.target.value)}
                placeholder={es ? 'Referido por... Experiencia previa en... Período de prueba hasta...' : 'Referred by... Previous experience at... Trial period until...'}
                style={{ resize: 'vertical', minHeight: '100px' }}
              />
            </div>
            {/* Hiring checklist summary */}
            <div style={{ padding: '0.75rem', background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '0.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#6ee7b7', fontWeight: 700, marginBottom: '0.4rem' }}>
                📋 {es ? 'Resumen de contratación' : 'Hiring checklist'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', fontSize: '0.78rem' }}>
                {[['docsW4','W-4'],['docsI9','I-9'],['docsIDCopy','ID copy'],['docsDirectDeposit','Direct deposit'],['docsHandbook','Handbook']].map(([f, lbl]) => (
                  <span key={f} style={{ color: form[f] ? '#34d399' : '#64748b' }}>
                    {form[f] ? '✅' : '⬜'} {lbl}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Section dots */}
        <div style={{ display: 'flex', gap: '5px' }}>
          {MODAL_SECTIONS.map((s) => (
            <div key={s.id} onClick={() => setActiveSection(s.id)} style={{
              width: '8px', height: '8px', borderRadius: '50%', cursor: 'pointer', transition: 'all 0.15s',
              background: activeSection === s.id ? '#818cf8' : 'rgba(255,255,255,0.15)',
            }} />
          ))}
        </div>
        {validationError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ color: '#f87171', fontSize: '0.85rem', flex: 1 }}>⚠ {validationError}</span>
            <button type="button" onClick={() => setValidationError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1rem' }}>×</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={onClose} className="btn btn-secondary">{L.cancel || 'Cancel'}</button>
          <button onClick={handleSubmit} className="btn btn-primary">
            ✓ {employee ? (L.save || 'Save') : (L.create || 'Create')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
