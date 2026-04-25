// ============================================================
// CellHub Pro — Appointments / Pre-Check-In Module
// Lets customers pre-register before arriving.
// Employees see a live queue of incoming drop-offs.
// Round 23: migrated to AppProvider state + multi-station sync.
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog } from '@/components/ui';
import CustomerPicker from '@/components/shared/CustomerPicker';
import { generateId } from '@/utils/dates';
import { normalizePhone, formatPhone } from '@/utils/normalize';
import { persist } from '@/services/persist';
// R-COMMS-SMS-HARD-DISABLE: sendSms import removed.
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { matchesSearch } from '@/utils/fuzzyMatch';
import type { Customer, Appointment, AppointmentStatus } from '@/store/types';

// Re-export for any legacy consumer
export type { Appointment, AppointmentStatus };

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  scheduled: 'badge-info',
  arrived:   'badge-warning',
  converted: 'badge-success',
  cancelled: 'badge-danger',
  no_show:   'badge-neutral',
};

const STATUS_LABEL: Record<AppointmentStatus, { en: string; es: string }> = {
  scheduled: { en: 'Scheduled', es: 'Programada' },
  arrived:   { en: 'Arrived',   es: 'Llegó' },
  converted: { en: 'Converted', es: 'Convertida' },
  cancelled: { en: 'Cancelled', es: 'Cancelada' },
  no_show:   { en: 'No Show',   es: 'No apareció' },
};

export default function AppointmentsModule() {
  const {
    state: { repairs, customers, settings, currentEmployee, lang, appointments, globalSearchTerm },
    setRepairs, setCustomers, setAppointments, dispatch,
  } = useApp();
  const { toast } = useToast();
  const es = lang === 'es';

  // Anti-stale-closure refs (canonical pattern — setters don't accept updater fns)
  const appointmentsRef = useRef(appointments);
  const customersRef = useRef(customers);
  const repairsRef = useRef(repairs);
  useEffect(() => { appointmentsRef.current = appointments; }, [appointments]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { repairsRef.current = repairs; }, [repairs]);

  // Consume cross-module global search term
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
  }, [globalSearchTerm]);

  const [filter, setFilter] = useState<AppointmentStatus | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Day-boundary refresh — recompute todayCount every minute so overnight
  // rollover is reflected without manual reload (matches Dashboard r21 pattern).
  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Computed ─────────────────────────────────────────────

  const filtered = useMemo(() => {
    return appointments
      .filter((a) => filter === 'all' || a.status === filter)
      .filter((a) => !search.trim() || matchesSearch(search, a.customerName, a.customerPhone, a.device, a.issue, (a as any).ticketNumber))
      .sort((a, b) => new Date(a.estimatedDropOff).getTime() - new Date(b.estimatedDropOff).getTime());
  }, [appointments, filter]);

  const todayCount = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTs = startOfToday.getTime();
    return appointments.filter((a) => {
      const d = new Date(a.estimatedDropOff);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === todayTs && a.status === 'scheduled';
    }).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, minuteTick]);

  const arrivedCount = useMemo(
    () => appointments.filter((a) => a.status === 'arrived').length,
    [appointments],
  );

  // ── Actions ──────────────────────────────────────────────

  const handleSave = useCallback((data: Partial<Appointment>) => {
    const rawFirst = (data as any).firstName as string | undefined;
    const rawLast = (data as any).lastName as string | undefined;
    const customerName = data.customerName
      || `${(rawFirst || '').trim()} ${(rawLast || '').trim()}`.trim();
    const normalizedPhone = normalizePhone(data.customerPhone || '');
    // R-COMMS-SMS-HARD-DISABLE: removed `smsOptIn` extraction (form checkbox gone).

    // Auto-create customer if phone provided and not already in system.
    // Reads customers via ref to avoid clobbering concurrent listener updates.
    let linkedCustomerId: string | undefined;
    if (data.customerId) {
      linkedCustomerId = data.customerId;
    } else if (normalizedPhone && customerName) {
      const existing = customersRef.current.find(
        (c) => normalizePhone(c.phone || '') === normalizedPhone
          || (Array.isArray(c.phones) && c.phones.some((p) => normalizePhone(p || '') === normalizedPhone)),
      );
      if (existing) {
        linkedCustomerId = existing.id;
      } else {
        const nameParts = customerName.split(/\s+/);
        const firstName = rawFirst?.trim() || nameParts[0] || '';
        const lastName  = rawLast?.trim()  || nameParts.slice(1).join(' ');
        // Round 18 pattern: slice(-8) + rand4 suffix to prevent multi-station collisions
        const ts8 = Date.now().toString().slice(-8);
        const rand4 = Math.random().toString(36).slice(2, 6).toUpperCase();
        const custNum = `${settings.customerNumberPrefix || 'GC'}-${ts8}-${rand4}`;
        const newCust: Customer = {
          id: generateId(),
          firstName,
          lastName,
          name: customerName,
          phone: normalizedPhone,      // store normalized so future matches hit
          phones: [normalizedPhone],
          carriers: [''],
          email: '',
          address: '',
          city: '',
          state: '',
          zip: '',
          carrier: '',
          plan: '',
          monthlyPayment: '',
          loyaltyPoints: 0,
          storeCredit: 0,
          customerNumber: custNum,
          notes: '',
          communicationConsent: false, // R-COMMS-CONSENT-UNIFY: unified consent field
          createdAt: new Date().toISOString(),
        };
        const nextCustomers = [...customersRef.current, newCust];
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
        linkedCustomerId = newCust.id;
      }
    }

    const now = new Date().toISOString();

    if (editAppt) {
      // R-COMMS-SMS-HARD-DISABLE: removed sendConfirmationSms write (form checkbox retired).
      const updated: Appointment = {
        ...editAppt,
        ...data,
        customerId: linkedCustomerId || editAppt.customerId,
        customerName,
        customerPhone: normalizedPhone,
        updatedAt: now,
      };
      const nextAppts = appointmentsRef.current.map((a) => a.id === editAppt.id ? updated : a);
      appointmentsRef.current = nextAppts;
      setAppointments(nextAppts);
      persist.appointment(updated.id, updated as unknown as Record<string, unknown>);
      toast(es ? 'Cita actualizada' : 'Appointment updated', 'success');
    } else {
      // R-COMMS-CONSENT-UNIFY: sendConfirmationSms write + TCPA-gated SMS dispatch
      // removed in Round 1; schema field removed in Round 3.
      const appt: Appointment = {
        id: generateId(),
        customerId: linkedCustomerId,
        customerName,
        customerPhone: normalizedPhone,
        device: data.device || '',
        issue: data.issue || '',
        estimatedDropOff: data.estimatedDropOff || now,
        status: 'scheduled',
        notes: data.notes || '',
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name,
        createdAt: now,
        updatedAt: now,
      };
      const nextAppts = [appt, ...appointmentsRef.current];
      appointmentsRef.current = nextAppts;
      setAppointments(nextAppts);
      persist.appointment(appt.id, appt as unknown as Record<string, unknown>);

      toast(es ? 'Cita creada' : 'Appointment created', 'success');
    }
    setShowModal(false);
    setEditAppt(null);
  }, [editAppt, setCustomers, currentEmployee, settings, es, setAppointments, toast]);

  const markArrived = useCallback((appt: Appointment) => {
    const updated: Appointment = { ...appt, status: 'arrived', updatedAt: new Date().toISOString() };
    const nextAppts = appointmentsRef.current.map((a) => a.id === appt.id ? updated : a);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    persist.appointment(updated.id, updated as unknown as Record<string, unknown>);
    toast(es ? `${appt.customerName} llegó` : `${appt.customerName} arrived`, 'success');
  }, [setAppointments, es, toast]);

  const convertToRepair = useCallback((appt: Appointment) => {
    // Guard: prevent double-conversion (double-click or stale UI)
    if (appt.status === 'converted' || appt.repairId) return;
    const freshAppt = appointmentsRef.current.find((a) => a.id === appt.id);
    if (freshAppt?.status === 'converted' || freshAppt?.repairId) return;

    // Resolve customerId: prefer stored link, else lookup by normalized phone
    let linkedCustomerId = appt.customerId;
    if (!linkedCustomerId && appt.customerPhone) {
      const np = normalizePhone(appt.customerPhone);
      const match = customersRef.current.find(
        (c) => normalizePhone(c.phone || '') === np
          || (Array.isArray(c.phones) && c.phones.some((p) => normalizePhone(p || '') === np)),
      );
      if (match) linkedCustomerId = match.id;
    }

    // Ticket number in the EXACT format RepairModule uses (round 23: match parity)
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const rand4 = Math.random().toString(36).slice(2, 6).toUpperCase();
    const ticketNumber = `RPR-${yy}${mm}${dd}-${rand4}`;

    const nameParts = (appt.customerName || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ');

    const newRepair: any = {
      id: generateId(),
      ticketNumber,
      customerId: linkedCustomerId,
      customerName: appt.customerName,
      customerPhone: appt.customerPhone,
      firstName,
      lastName,
      device: appt.device,
      deviceModel: appt.device,
      brand: '',
      model: appt.device,
      deviceType: 'Phone',
      issue: appt.issue,
      diagnosis: '',
      status: 'Received',
      priority: 'Normal',
      parts: [],
      laborCost: 0,
      partsTotal: 0,
      subtotal: 0,
      taxAmount: 0,
      estimatedCost: 0,
      total: 0,
      depositAmount: 0,
      balance: 0,
      techNotes: appt.notes || '',
      notes: appt.notes || '',
      internalNotes: `From appointment ${appt.id.slice(-6).toUpperCase()}`,
      warranty: 30,
      estimatedCompletion: '',
      employeeName: currentEmployee?.name || '',
      employeeId: currentEmployee?.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const nextRepairs = [newRepair, ...repairsRef.current];
    repairsRef.current = nextRepairs;
    setRepairs(nextRepairs);
    persist.repair(newRepair.id, newRepair);

    // Mark appointment as converted and link to repair (anti-stale)
    const updatedAppt: Appointment = {
      ...appt,
      status: 'converted',
      repairId: newRepair.id,
      customerId: linkedCustomerId || appt.customerId,
      updatedAt: new Date().toISOString(),
    };
    const nextAppts = appointmentsRef.current.map((a) => a.id === appt.id ? updatedAppt : a);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    persist.appointment(updatedAppt.id, updatedAppt as unknown as Record<string, unknown>);

    toast(
      es ? `Ticket de reparación creado — ${newRepair.ticketNumber}` : `Repair ticket created — ${newRepair.ticketNumber}`,
      'success',
    );
  }, [currentEmployee, setRepairs, setAppointments, es, toast]);

  const cancelAppt = useCallback((id: string) => {
    const target = appointmentsRef.current.find((a) => a.id === id);
    if (!target) { setDeleteConfirm(null); return; }
    const updated: Appointment = { ...target, status: 'cancelled', updatedAt: new Date().toISOString() };
    const nextAppts = appointmentsRef.current.map((a) => a.id === id ? updated : a);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    persist.appointment(updated.id, updated as unknown as Record<string, unknown>);
    setDeleteConfirm(null);
    toast(es ? 'Cita cancelada' : 'Appointment cancelled', 'info');
  }, [setAppointments, es, toast]);

  // ── Render ───────────────────────────────────────────────

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">📅 {es ? 'Citas' : 'Appointments'}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{es ? 'Pre-registro de drop-offs' : 'Pre-check-in for drop-offs'}</p>
          </div>
          <button onClick={() => { setEditAppt(null); setShowModal(true); }} className="btn btn-primary">
            + {es ? 'Nueva Cita' : 'New Appointment'}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{es ? 'Hoy' : 'Today'}</p>
            <p className={`text-2xl font-bold mt-1 ${todayCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{todayCount}</p>
            <p className="text-xs text-slate-500">{es ? 'pendientes' : 'scheduled'}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{es ? 'Llegaron' : 'Arrived'}</p>
            <p className={`text-2xl font-bold mt-1 ${arrivedCount > 0 ? 'text-orange-400' : 'text-slate-500'}`}>{arrivedCount}</p>
            <p className="text-xs text-slate-500">{es ? 'esperando ticket' : 'awaiting ticket'}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{es ? 'Convertidas' : 'Converted'}</p>
            <p className="text-2xl font-bold mt-1 text-emerald-400">
              {appointments.filter((a) => a.status === 'converted').length}
            </p>
            <p className="text-xs text-slate-500">{es ? 'este mes' : 'this month'}</p>
          </div>
        </div>

        <GlobalSearchBar
          localValue={search}
          onLocalChange={setSearch}
          placeholder={es ? 'Buscar citas por cliente, dispositivo...' : 'Search appointments by customer, device...'}
        />

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {(['all', 'scheduled', 'arrived', 'converted', 'cancelled', 'no_show'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === s ? 'bg-brand-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {s === 'all' ? (es ? 'Todas' : 'All') : (STATUS_LABEL[s]?.[lang as 'en' | 'es'] || s)}
              {' '}
              <span className="opacity-60">({appointments.filter((a) => s === 'all' || a.status === s).length})</span>
            </button>
          ))}
        </div>

        {/* Appointment list */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <span className="text-4xl block mb-3">📅</span>
              <p>{es ? 'No hay citas' : 'No appointments'}</p>
            </div>
          ) : (
            filtered.map((appt) => {
              const dropOff = new Date(appt.estimatedDropOff);
              const isOverdue = appt.status === 'scheduled' && dropOff < new Date();
              return (
                <div
                  key={appt.id}
                  className="card p-4"
                  style={{ borderLeft: `3px solid ${appt.status === 'arrived' ? '#f97316' : appt.status === 'converted' ? '#34d399' : appt.status === 'cancelled' ? '#ef4444' : '#667eea'}` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white">{appt.customerName}</span>
                        <span className={`badge ${STATUS_BADGE[appt.status]}`}>
                          {STATUS_LABEL[appt.status]?.[lang as 'en' | 'es'] || appt.status}
                        </span>
                        {isOverdue && <span className="badge badge-danger">{es ? 'Atrasada' : 'Overdue'}</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{formatPhone(appt.customerPhone)}</p>
                      <p className="text-sm text-slate-300 mt-1">{appt.device} — {appt.issue}</p>
                      {appt.notes && <p className="text-xs text-slate-500 mt-0.5 italic">{appt.notes}</p>}
                      <p className="text-xs text-slate-500 mt-1">
                        🕐 {dropOff.toLocaleDateString(es ? 'es-MX' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}
                        {dropOff.toLocaleTimeString(es ? 'es-MX' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {appt.status === 'scheduled' && (
                        <button onClick={() => markArrived(appt)} className="btn btn-sm" style={{ background: 'rgba(249,115,22,0.15)', color: '#fb923c', border: '1px solid rgba(249,115,22,0.3)', fontSize: '0.72rem' }}>
                          ✅ {es ? 'Llegó' : 'Arrived'}
                        </button>
                      )}
                      {appt.status === 'arrived' && (
                        <button onClick={() => convertToRepair(appt)} className="btn btn-sm btn-primary" style={{ fontSize: '0.72rem' }}>
                          🔧 {es ? 'Crear Ticket' : 'Create Ticket'}
                        </button>
                      )}
                      <button onClick={() => { setEditAppt(appt); setShowModal(true); }} className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem' }}>
                        ✏️ {es ? 'Editar' : 'Edit'}
                      </button>
                      {appt.status !== 'cancelled' && appt.status !== 'converted' && (
                        <button onClick={() => setDeleteConfirm(appt.id)} className="btn btn-ghost btn-sm text-red-400" style={{ fontSize: '0.72rem' }}>
                          ✕ {es ? 'Cancelar' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Appointment form modal */}
      {showModal && (
        <AppointmentFormModal
          appointment={editAppt}
          customers={customers}
          setCustomers={setCustomers}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditAppt(null); }}
          lang={lang}
          es={es}
        />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        title={es ? 'Cancelar cita' : 'Cancel appointment'}
        message={es ? '¿Cancelar esta cita?' : 'Cancel this appointment?'}
        variant="danger"
        onConfirm={() => deleteConfirm && cancelAppt(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}

// ── Form Modal ────────────────────────────────────────────

function AppointmentFormModal({ appointment, customers, setCustomers, onSave, onClose, lang, es }: {
  appointment: Appointment | null;
  customers: Customer[];
  setCustomers: (c: Customer[]) => void;
  onSave: (data: Partial<Appointment>) => void;
  onClose: () => void;
  lang: string;
  es: boolean;
}) {
  void lang;
  const defaultDT = () => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  };

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(() => {
    if (appointment?.customerId) {
      return customers.find((c) => c.id === appointment.customerId) ?? null;
    }
    return null;
  });
  const nameParts = (appointment?.customerName || '').trim().split(/\s+/);
  const [form, setForm] = useState({
    firstName: appointment?.customerId
      ? (customers.find((c) => c.id === appointment?.customerId)?.firstName || nameParts[0] || '')
      : (nameParts[0] || ''),
    lastName: appointment?.customerId
      ? (customers.find((c) => c.id === appointment?.customerId)?.lastName || nameParts.slice(1).join(' ') || '')
      : (nameParts.slice(1).join(' ') || ''),
    customerPhone: appointment?.customerPhone || '',
    device: appointment?.device || '',
    issue: appointment?.issue || '',
    estimatedDropOff: appointment?.estimatedDropOff
      ? new Date(appointment.estimatedDropOff).toISOString().slice(0, 16)
      : defaultDT(),
    notes: appointment?.notes || '',
    // R-COMMS-SMS-HARD-DISABLE: removed sendConfirmationSms form field (checkbox retired).
  });

  const handleSelectCustomer = useCallback((c: Customer | null) => {
    setSelectedCustomer(c);
    if (c) {
      const parts = c.name.trim().split(/\s+/);
      setForm((prev) => ({
        ...prev,
        firstName: c.firstName || parts[0] || '',
        lastName: c.lastName || parts.slice(1).join(' ') || '',
        customerPhone: c.phone || '',
      }));
    }
  }, []);

  const handleSubmit = () => {
    const customerName = selectedCustomer?.name
      || `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
      || appointment?.customerName
      || '';
    if (!customerName || !form.device.trim() || !form.issue.trim()) return;
    const customerPhone = selectedCustomer?.phone
      || form.customerPhone.trim()
      || appointment?.customerPhone
      || '';
    onSave({
      ...form,
      customerId: selectedCustomer?.id || appointment?.customerId,
      customerName,
      customerPhone: customerPhone ? normalizePhone(customerPhone) : undefined,
      estimatedDropOff: new Date(form.estimatedDropOff).toISOString(),
    } as Partial<Appointment>);
  };

  return (
    <Modal open onClose={onClose} title={`📅 ${appointment ? (es ? 'Editar Cita' : 'Edit Appointment') : (es ? 'Nueva Cita' : 'New Appointment')}`} size="max-w-md">
      <div className="space-y-3">
        {/* r-customer-picker-sweep: shared CustomerPicker replaces free-text inputs */}
        <CustomerPicker
          customers={customers}
          selectedCustomer={selectedCustomer}
          onSelect={handleSelectCustomer}
          lang={lang as 'en' | 'es'}
          placeholder={es ? 'Buscar cliente…' : 'Search customer…'}
          onCreateCustomer={(newCust) => {
            try {
              const updated = [...customers, newCust];
              setCustomers(updated);
              persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
            } catch (_) { /* defensive */ }
          }}
        />
        {!selectedCustomer && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{es ? 'Nombre *' : 'First Name *'}</label>
                <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder={es ? 'Jorge' : 'John'} />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{es ? 'Apellido' : 'Last Name'}</label>
                <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder={es ? 'Ochoa' : 'Doe'} />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{es ? 'Teléfono' : 'Phone'}</label>
              <input className="input" type="tel" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} placeholder="(555) 123-4567" />
            </div>
          </>
        )}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{es ? 'Dispositivo' : 'Device'} *</label>
          <input className="input" value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })} placeholder={es ? 'Ej: iPhone 13, Samsung S22...' : 'e.g. iPhone 13, Samsung S22...'} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">{es ? 'Problema' : 'Issue'} *</label>
          <input className="input" value={form.issue} onChange={(e) => setForm({ ...form, issue: e.target.value })} placeholder={es ? 'Ej: Pantalla rota, no enciende...' : 'e.g. Cracked screen, won\'t turn on...'} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">{es ? 'Fecha y hora de entrega' : 'Drop-off date & time'}</label>
          <input className="input" type="datetime-local" value={form.estimatedDropOff} onChange={(e) => setForm({ ...form, estimatedDropOff: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">{es ? 'Notas adicionales' : 'Additional notes'}</label>
          <textarea
            className="textarea"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder={es ? 'Detalles adicionales, color, accesorios...' : 'Additional details, color, accessories...'}
          />
          <p className="text-[10px] text-amber-400/70 mt-1">
            {es
              ? '⚠️ No escribas contraseñas aquí. Anótalas en papel.'
              : '⚠️ Do not write passwords here. Write them on paper.'}
          </p>
        </div>
        {/* R-COMMS-CONSENT-UNIFY: "Send confirmation SMS" checkbox removed in Round 1;
            Appointment.sendConfirmationSms schema field removed in Round 3. */}
      </div>
      <div className="flex gap-3 mt-4 pt-4 border-t border-white/10">
        <button onClick={onClose} className="btn btn-secondary flex-1">{es ? 'Cancelar' : 'Cancel'}</button>
        <button onClick={handleSubmit} className="btn btn-primary flex-1">
          {appointment ? (es ? 'Guardar' : 'Save') : (es ? 'Crear Cita' : 'Create Appointment')}
        </button>
      </div>
    </Modal>
  );
}
