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
import { persist, remove } from '@/services/persist';
import { useLanReadOnlyMode, isLanSecondaryReadOnly } from '@/hooks/useLanReadOnly';
import { sendCreateAppointment } from '@/services/lan/lanService';
// APPOINTMENTS-SEMANTIC-LIFECYCLE-V1: admin PIN gate reused for the protected
// permanent-delete cleanup flow (duplicates / test entries only).
import AdminPinGate from '@/components/shared/AdminPinGate';
// R-COMMS-SMS-HARD-DISABLE: sendSms import removed.
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { matchesSearchPhones } from '@/utils/search';
import type { Customer, Appointment, AppointmentStatus } from '@/store/types';
import { usePrint } from '@/hooks/usePrint';
import { escHtml } from '@/utils/escHtml';
// R-RECEIPT-UNIFY-APPOINTMENT-V1: reuse the POS payment-receipt barcode renderer
// (the exact scannable CODE128 used by the master receipt) + the bundled QR lib
// so the appointment receipt shares the same visual system as the payment receipt.
import { renderBarcodeSvg, getReceiptBarcodeHeight } from '@/modules/pos/ReceiptModal';
import QRCode from 'qrcode';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import { useTranslation } from '@/i18n';

// Re-export for any legacy consumer
export type { Appointment, AppointmentStatus };

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  scheduled: 'badge-info',
  arrived:   'badge-warning',
  converted: 'badge-success',
  cancelled: 'badge-danger',
  no_show:   'badge-neutral',
};


export default function AppointmentsModule() {
  const {
    state: { repairs, customers, settings, currentEmployee, lang, appointments, globalSearchTerm, currentStoreId },
    setRepairs, setCustomers, setAppointments, dispatch,
  } = useApp();
  const { toast } = useToast();
  const { printHtml } = usePrint();
  const { t, locale } = useTranslation();
  const es = locale === 'es';
  // SECONDARY-UI-LOCK-V1: block appointment create/convert on a read-only Secondary.
  const lanReadOnly = useLanReadOnlyMode();
  const dateLoc = ({ en: 'en-US', es: 'es-MX', pt: 'pt-BR' } as Record<string, string>)[locale] ?? 'en-US';
  const waLang: 'en' | 'es' = locale === 'es' ? 'es' : 'en';
  const APPT_STATUS_LABELS: Record<AppointmentStatus, string> = {
    scheduled: t('appt.status.scheduled'),
    arrived:   t('appt.status.arrived'),
    converted: t('appt.status.converted'),
    cancelled: t('appt.status.cancelled'),
    no_show:   t('appt.status.noShow'),
  };

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
  const [postSaveModal, setPostSaveModal] = useState<Appointment | null>(null);
  const [search, setSearch] = useState('');
  // APPOINTMENTS-SEMANTIC-LIFECYCLE-V1: per-card secondary actions menu (⋯)
  // + two-stage admin delete (PIN gate → danger confirm). Cancel stays the
  // existing status-flip flow (deleteConfirm above is the CANCEL confirm).
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletePinFor, setDeletePinFor] = useState<string | null>(null);
  const [deleteApptConfirm, setDeleteApptConfirm] = useState<string | null>(null);

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
      // R-SEARCH-NORMALIZE-V1: phone-aware match (formatted vs raw).
      .filter((a) => matchesSearchPhones(
        search,
        [a.customerPhone],
        a.customerName, a.device, a.issue, (a as any).ticketNumber,
      ))
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

  const printAppointmentTicket = useCallback(async (appt: Appointment) => {
    const dateStr = new Date(appt.estimatedDropOff).toLocaleDateString(
      dateLoc,
      { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
    );
    const timeStr = new Date(appt.estimatedDropOff).toLocaleTimeString(
      dateLoc,
      { hour: 'numeric', minute: '2-digit' }
    );
    // R-RECEIPT-UNIFY-APPOINTMENT-V1: rebuilt onto the SAME visual system as the
    // POS payment receipt (generateReceiptHtml): centered Go Cellular header,
    // scannable CODE128 barcode, dashed separators, label/value info rows, and
    // the shared footer + Google Reviews QR. Appointment-specific data only —
    // the visual format mirrors the master. Same render pipeline (HTML string →
    // printHtml). All text via i18n (EN/ES/PT).
    const NP = t('appt.receipt.notProvided');
    const conf = appt.id.slice(-8).toUpperCase();
    const storeName = settings.storeName || 'GO CELLULAR';
    const storeAddress = settings.storeAddress || '';
    const storePhone = settings.storePhone ? (formatPhone(settings.storePhone) || settings.storePhone) : '';

    // Barcode (confirmation number) + Google Reviews QR — same generators the
    // payment receipt uses, so scan + QR behaviour is identical.
    const barcodeSvg = renderBarcodeSvg(conf, getReceiptBarcodeHeight(settings.paperSize));
    let qrSvg = '';
    if (settings.showReviewQr && settings.googleReviewUrl) {
      try { qrSvg = await QRCode.toString(settings.googleReviewUrl, { type: 'svg', margin: 1, width: 80 }); }
      catch { /* QR optional — template falls back to a remote img */ }
    }

    const fields: Array<[string, string]> = [
      [t('appt.receipt.customer'), (appt.customerName || '').trim() || NP],
      [t('appt.receipt.phone'),    formatPhone(appt.customerPhone) || NP],
      [t('appt.receipt.device'),   (appt.device || '').trim() || NP],
      [t('appt.receipt.issue'),    (appt.issue || '').trim() || NP],
      [t('appt.receipt.date'),     dateStr],
      [t('appt.receipt.time'),     timeStr],
    ];
    const emp = (appt.employeeName || '').trim();
    if (emp) fields.push([t('appt.receipt.attendedBy'), emp]);
    const fieldRows = fields.map(([l, v]) =>
      `<tr><td style="padding:2px 0;font-size:11px;color:#444;vertical-align:top">${escHtml(l)}:</td><td style="text-align:right;padding:2px 0;font-size:11px;font-weight:600;vertical-align:top">${escHtml(v)}</td></tr>`
    ).join('');
    const notes = (appt.notes || '').trim();
    const notesRow = notes
      ? `<tr><td colspan="2" style="padding:3px 0 0;font-size:10px"><span style="color:#444">${escHtml(t('appt.receipt.notes'))}:</span> ${escHtml(notes)}</td></tr>`
      : '';

    const guide = [
      t('appt.receipt.guideEarly'),
      t('appt.receipt.guideBring'),
      t('appt.receipt.guideReschedule'),
    ];
    const docType = t('appt.receipt.title');
    const thanks = settings.receiptFooter || t('appt.receipt.thanks');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(docType)} ${escHtml(conf)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  html, body { width: 4in; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; background: #fff; }
  body { padding: 0.1in 0.15in; box-sizing: border-box; }
  @media screen { html, body { width: 100% !important; max-width: 100% !important; } * { box-sizing: border-box; max-width: 100%; } img, svg { max-width: 100%; height: auto; } }
  table { width: 100%; border-collapse: collapse; }
  .sep { border-top: 1px dashed #999; margin: 5px 0; }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
  <div style="width:100%;box-sizing:border-box;margin-bottom:4px;border-bottom:2px solid #000;padding-bottom:4px;overflow:hidden;text-align:center">
    <div style="font-size:18px;font-weight:900;line-height:1.1;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeName)}</div>
    <div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeAddress)}</div>
    <div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storePhone)}</div>
  </div>
  <div style="width:100%;box-sizing:border-box;text-align:center;margin:0 0 6px 0;overflow:hidden">
    ${barcodeSvg ? barcodeSvg.replace('<svg', '<svg style="display:inline-block;max-width:100%"') : ''}
  </div>
  <table style="margin-bottom:5px">
    <tr><td style="font-size:11px">${escHtml(dateStr)}</td><td style="text-align:right;font-size:12px;font-weight:900">#${escHtml(conf)}</td></tr>
    <tr><td colspan="2" style="text-align:center;font-size:13px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;padding-top:3px">${escHtml(docType)}</td></tr>
  </table>
  <div class="sep"></div>
  <table style="margin-bottom:5px">${fieldRows}${notesRow}</table>
  <div class="sep"></div>
  <div style="font-size:9px;line-height:1.5;margin-bottom:5px">
    ${guide.map((g) => `<div style="margin-bottom:1px">&bull; ${escHtml(g)}</div>`).join('')}
  </div>
  <div style="text-align:center;font-size:11px;font-weight:600;line-height:1.3">
    ${escHtml(thanks)}
    ${storePhone ? `<div style="font-size:10px;font-weight:500;margin-top:2px">${escHtml(t('appt.receipt.contactLabel'))}: ${escHtml(storePhone)}</div>` : ''}
    ${settings.showReviewQr && settings.googleReviewUrl ? `
    <div style="text-align:center;margin-top:8px;padding-top:6px;border-top:1px dashed #ccc">
      <div style="font-size:10px;font-weight:700;margin-bottom:4px">${escHtml(t('appt.receipt.reviewPrompt'))}</div>
      ${qrSvg
        ? `<div style="width:72px;height:72px;margin:0 auto">${qrSvg}</div>`
        : `<img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(settings.googleReviewUrl)}" width="72" height="72" style="display:block;margin:0 auto" />`}
      <div style="font-size:8px;color:#555;margin-top:3px">&#9733;&#9733;&#9733;&#9733;&#9733; Google</div>
    </div>` : ''}
  </div>
</body></html>`;

    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
    toast(t('appt.toastPrinting'), 'info');
  }, [settings, es, dateLoc, printHtml, toast, t]);

  const sendAppointmentWhatsApp = useCallback((appt: Appointment) => {
    if (!appt.customerPhone) return;
    const dateStr = new Date(appt.estimatedDropOff).toLocaleDateString(
      dateLoc,
      { weekday: 'short', month: 'short', day: 'numeric' }
    );
    const timeStr = new Date(appt.estimatedDropOff).toLocaleTimeString(
      dateLoc,
      { hour: 'numeric', minute: '2-digit' }
    );
    const msg = buildWaMessage(
      'appointmentReminder',
      {
        customerName: appt.customerName,
        storeName: settings.storeName || 'Go Cellular',
        storePhone: settings.storePhone,
        appointmentDate: dateStr,
        appointmentTime: timeStr,
      },
      waLang,
    );
    openWhatsApp(appt.customerPhone, msg);
  }, [settings, waLang, dateLoc]);

  // LAN-OPERATION-FORWARDING-APPOINTMENT-V1: on a Secondary, a NEW appointment
  // is forwarded to the Primary (not saved locally). Edits/conversions are not
  // forwarded this round.
  const forwardCreateAppointment = useCallback(async (data: Partial<Appointment>) => {
    const rawFirst = (data as any).firstName as string | undefined;
    const rawLast = (data as any).lastName as string | undefined;
    const customerName = data.customerName
      || `${(rawFirst || '').trim()} ${(rawLast || '').trim()}`.trim();
    setShowModal(false);
    setEditAppt(null);
    toast(t('lan.appt.sending'), 'info');
    const ack = await sendCreateAppointment({
      customerId: data.customerId,
      customerName,
      customerPhone: data.customerPhone || '',
      device: data.device || '',
      issue: data.issue || '',
      estimatedDropOff: data.estimatedDropOff || '',
      notes: data.notes || '',
      employeeName: currentEmployee?.name,
    });
    if (ack.ok) {
      toast(t('lan.appt.savedPrimary'), 'success');
    } else {
      const map: Record<string, string> = {
        not_paired: t('lan.fwd.notPaired'),
        unreachable: t('lan.appt.offline'),
        no_renderer: t('lan.appt.offline'),
        timeout: t('lan.appt.offline'),
        dispatch_timeout: t('lan.appt.offline'),
        dispatch_unavailable: t('lan.appt.offline'),
      };
      toast(map[ack.error || ''] || t('lan.appt.failed'), 'error');
    }
  }, [toast, t, currentEmployee]);

  const handleSave = useCallback((data: Partial<Appointment>) => {
    // LAN-OPERATION-FORWARDING-APPOINTMENT-V1: Secondary CREATE → forward.
    if (!editAppt && isLanSecondaryReadOnly()) {
      void forwardCreateAppointment(data);
      return;
    }
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
      toast(t('appt.toastUpdated'), 'success');
    } else {
      // R-COMMS-CONSENT-UNIFY: sendConfirmationSms write + TCPA-gated SMS dispatch
      // removed in Round 1; schema field removed in Round 3.
      const appt: Appointment = {
        id: generateId(),
        storeId: currentStoreId,
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
      try {
        window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
          detail: { type: 'appointment.booked', payload: { customerId: (appt as any).customerId || undefined } },
        }));
      } catch { /* env without CustomEvent */ }

      toast(t('appt.toastCreated'), 'success');
      setPostSaveModal(appt);
    }
    setShowModal(false);
    setEditAppt(null);
  }, [editAppt, setCustomers, currentEmployee, settings, setAppointments, toast, t, forwardCreateAppointment]);

  const markArrived = useCallback((appt: Appointment) => {
    const updated: Appointment = { ...appt, status: 'arrived', updatedAt: new Date().toISOString() };
    const nextAppts = appointmentsRef.current.map((a) => a.id === appt.id ? updated : a);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    persist.appointment(updated.id, updated as unknown as Record<string, unknown>);
    toast(t('appt.toastArrived', appt.customerName), 'success');
  }, [setAppointments, toast, t]);

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

    toast(t('appt.toastRepairCreated', newRepair.ticketNumber), 'success');
  }, [currentEmployee, setRepairs, setAppointments, toast, t]);

  const cancelAppt = useCallback((id: string) => {
    const target = appointmentsRef.current.find((a) => a.id === id);
    if (!target) { setDeleteConfirm(null); return; }
    const updated: Appointment = { ...target, status: 'cancelled', updatedAt: new Date().toISOString() };
    const nextAppts = appointmentsRef.current.map((a) => a.id === id ? updated : a);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    persist.appointment(updated.id, updated as unknown as Record<string, unknown>);
    setDeleteConfirm(null);
    toast(t('appt.toastCancelled'), 'info');
  }, [setAppointments, toast, t]);

  // APPOINTMENTS-SEMANTIC-LIFECYCLE-V1: lifecycle semantics. Cancel (above)
  // is a status flip that preserves history. No Show is NOT cancellation —
  // it marks a scheduled customer who failed to arrive. Restore brings a
  // cancelled/no-show appointment back to scheduled WITHOUT creating a new
  // record. Converted appointments are immutable operational history — no
  // restore, no delete. All updates persist the FULL entity spread.
  const markNoShow = useCallback((id: string) => {
    const target = appointmentsRef.current.find((a) => a.id === id);
    if (!target) { toast(t('appt.toastNotFound'), 'error'); return; }
    if (target.status !== 'scheduled') return; // only a scheduled customer can no-show
    const updated: Appointment = { ...target, status: 'no_show', updatedAt: new Date().toISOString() };
    const nextAppts = appointmentsRef.current.map((a) => a.id === id ? updated : a);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    persist.appointment(updated.id, updated as unknown as Record<string, unknown>);
    toast(t('appt.toastNoShow'), 'info');
  }, [setAppointments, toast, t]);

  const restoreAppt = useCallback((id: string) => {
    const target = appointmentsRef.current.find((a) => a.id === id);
    if (!target) { toast(t('appt.toastNotFound'), 'error'); return; }
    // Only the reversible terminal states restore; converted stays immutable.
    if (target.status !== 'cancelled' && target.status !== 'no_show') return;
    const updated: Appointment = { ...target, status: 'scheduled', updatedAt: new Date().toISOString() };
    const nextAppts = appointmentsRef.current.map((a) => a.id === id ? updated : a);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    persist.appointment(updated.id, updated as unknown as Record<string, unknown>);
    toast(t('appt.toastRestored'), 'success');
  }, [setAppointments, toast, t]);

  // Admin cleanup ONLY (duplicates / spam / test entries) — reached through
  // PIN gate + danger confirm. Operational cancellation is cancelAppt above.
  const deleteAppt = useCallback((id: string) => {
    setDeleteApptConfirm(null);
    const target = appointmentsRef.current.find((a) => a.id === id);
    if (!target) { toast(t('appt.toastNotFound'), 'error'); return; }
    const nextAppts = appointmentsRef.current.filter((a) => a.id !== id);
    appointmentsRef.current = nextAppts;
    setAppointments(nextAppts);
    remove.appointment(id);
    toast(t('appt.toastDeleted'), 'info');
  }, [setAppointments, toast, t]);

  // ── Render ───────────────────────────────────────────────

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">📅 {t('appt.title')}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{t('appt.subtitle')}</p>
          </div>
          {/* LAN-OPERATION-FORWARDING-APPOINTMENT-V1: on a Secondary, New stays
              ENABLED — the create is forwarded to the Primary (not saved locally). */}
          <button
            onClick={() => { setEditAppt(null); setShowModal(true); }}
            className="btn btn-primary"
            title={lanReadOnly ? t('lan.appt.newOnSecondary') : undefined}
          >
            + {t('appt.newBtn')}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('appt.statTodayLabel')}</p>
            <p className={`text-2xl font-bold mt-1 ${todayCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{todayCount}</p>
            <p className="text-xs text-slate-500">{t('appt.statTodaySub')}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('appt.statArrivedLabel')}</p>
            <p className={`text-2xl font-bold mt-1 ${arrivedCount > 0 ? 'text-orange-400' : 'text-slate-500'}`}>{arrivedCount}</p>
            <p className="text-xs text-slate-500">{t('appt.statArrivedSub')}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('appt.statConvertedLabel')}</p>
            <p className="text-2xl font-bold mt-1 text-emerald-400">
              {appointments.filter((a) => a.status === 'converted').length}
            </p>
            <p className="text-xs text-slate-500">{t('appt.statConvertedSub')}</p>
          </div>
        </div>

        <GlobalSearchBar
          localValue={search}
          onLocalChange={setSearch}
          placeholder={t('appt.searchPlaceholder')}
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
              {s === 'all' ? t('appt.filterAll') : (APPT_STATUS_LABELS[s] ?? s)}
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
              <p>{t('appt.noAppointments')}</p>
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
                          {APPT_STATUS_LABELS[appt.status] ?? appt.status}
                        </span>
                        {isOverdue && <span className="badge badge-danger">{t('appt.overdue')}</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{formatPhone(appt.customerPhone)}</p>
                      <p className="text-sm text-slate-300 mt-1">{appt.device} — {appt.issue}</p>
                      {appt.notes && <p className="text-xs text-slate-500 mt-0.5 italic">{appt.notes}</p>}
                      <p className="text-xs text-slate-500 mt-1">
                        🕐 {dropOff.toLocaleDateString(dateLoc, { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}
                        {dropOff.toLocaleTimeString(dateLoc, { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {appt.status === 'scheduled' && (
                        <button onClick={() => { if (!lanReadOnly) markArrived(appt); }} disabled={lanReadOnly} title={lanReadOnly ? t('lan.readOnlyTooltip') : undefined} className="btn btn-sm" style={{ background: 'rgba(249,115,22,0.15)', color: '#fb923c', border: '1px solid rgba(249,115,22,0.3)', fontSize: '0.72rem', ...(lanReadOnly ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
                          ✅ {t('appt.btnArrived')}
                        </button>
                      )}
                      {appt.status === 'arrived' && (
                        <button onClick={() => { if (!lanReadOnly) convertToRepair(appt); }} disabled={lanReadOnly} title={lanReadOnly ? t('lan.readOnlyTooltip') : undefined} className="btn btn-sm btn-primary" style={{ fontSize: '0.72rem', ...(lanReadOnly ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
                          🔧 {t('appt.btnCreateTicket')}
                        </button>
                      )}
                      <button onClick={() => { setEditAppt(appt); setShowModal(true); }} className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem' }}>
                        ✏️ {t('appt.btnEdit')}
                      </button>
                      <button onClick={() => printAppointmentTicket(appt)} className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem' }}>
                        🖨️ {t('appt.btnPrint')}
                      </button>
                      {settings.waEnabled !== false && appt.customerPhone && (
                        <button onClick={() => sendAppointmentWhatsApp(appt)} className="btn btn-sm" style={{ background: 'rgba(37,211,102,0.15)', color: '#25d366', border: '1px solid rgba(37,211,102,0.3)', fontSize: '0.72rem' }}>
                          📱 WhatsApp
                        </button>
                      )}
                      {/* APPOINTMENTS-UX-ACTION-VISIBILITY-PLUS-INTEL-WA-V1:
                          Cancel only for active states. no_show is already a
                          terminal operational outcome — it restores via the
                          Manage menu, it doesn't cancel. */}
                      {(appt.status === 'scheduled' || appt.status === 'arrived') && (
                        <button onClick={() => setDeleteConfirm(appt.id)} className="btn btn-ghost btn-sm text-red-400" style={{ fontSize: '0.72rem' }}>
                          ✕ {t('appt.btnCancel')}
                        </button>
                      )}
                      {/* APPOINTMENTS-SEMANTIC-LIFECYCLE-V1: secondary actions
                          collapsed behind ⋯ — no large destructive buttons on
                          the card. Converted = immutable history → no menu. */}
                      {/* APPOINTMENTS-UX-ACTION-VISIBILITY-PLUS-INTEL-WA-V1:
                          discoverable labeled Manage button (bordered) instead
                          of a bare ⋯ glyph. Converted = immutable lifecycle
                          history → no Manage at all (Print/WhatsApp/Edit stay). */}
                      {appt.status !== 'converted' && (
                        <button
                          onClick={() => setOpenMenuId(openMenuId === appt.id ? null : appt.id)}
                          className="btn btn-sm"
                          style={{ fontSize: '0.72rem', background: 'rgba(148,163,184,0.08)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.3)' }}
                          title={t('appt.btnMore')}
                        >
                          ⋯ {t('appt.btnMore')}
                        </button>
                      )}
                      {openMenuId === appt.id && appt.status !== 'converted' && (
                        <>
                          {appt.status === 'scheduled' && (
                            <button onClick={() => { markNoShow(appt.id); setOpenMenuId(null); }} className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem' }}>
                              👻 {t('appt.btnNoShow')}
                            </button>
                          )}
                          {(appt.status === 'cancelled' || appt.status === 'no_show') && (
                            <button onClick={() => { restoreAppt(appt.id); setOpenMenuId(null); }} className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem' }}>
                              ↩️ {t('appt.btnRestore')}
                            </button>
                          )}
                          <button onClick={() => { setDeletePinFor(appt.id); setOpenMenuId(null); }} className="btn btn-ghost btn-sm text-red-400/70" style={{ fontSize: '0.72rem' }}>
                            🗑️ {t('appt.btnDelete')}
                          </button>
                        </>
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
        />
      )}

      {/* Post-Save modal: cajero elige Print / WhatsApp / Skip al CREAR cita */}
      <Modal
        open={!!postSaveModal}
        onClose={() => setPostSaveModal(null)}
        title={t('appt.notifyTitle')}
        size="max-w-sm"
      >
        {postSaveModal && (
          <div>
            <p className="text-sm text-slate-400 mb-4">
              {t('appt.notifySaved', postSaveModal.customerName)}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-primary"
                onClick={() => {
                  printAppointmentTicket(postSaveModal);
                  setPostSaveModal(null);
                }}
              >
                🖨️ {t('appt.btnPrintReceipt')}
              </button>
              {settings.waEnabled !== false && postSaveModal.customerPhone && (
                <button
                  className="btn"
                  style={{ background: 'rgba(37,211,102,0.15)', color: '#25d366', border: '1px solid rgba(37,211,102,0.3)' }}
                  onClick={() => {
                    sendAppointmentWhatsApp(postSaveModal);
                    setPostSaveModal(null);
                  }}
                >
                  📱 {t('appt.btnWhatsApp')}
                </button>
              )}
              <button
                className="btn btn-ghost"
                onClick={() => setPostSaveModal(null)}
              >
                {t('appt.btnSkip')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        title={t('appt.cancelTitle')}
        message={t('appt.cancelMsg')}
        variant="danger"
        onConfirm={() => deleteConfirm && cancelAppt(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* APPOINTMENTS-SEMANTIC-LIFECYCLE-V1: permanent delete is admin
          cleanup ONLY — PIN gate first, then an explicit danger confirm. */}
      <AdminPinGate
        open={!!deletePinFor}
        adminPin={settings.adminPin || ''}
        onSuccess={() => { setDeleteApptConfirm(deletePinFor); setDeletePinFor(null); }}
        onCancel={() => setDeletePinFor(null)}
      />
      <ConfirmDialog
        open={!!deleteApptConfirm}
        title={t('appt.deleteTitle')}
        message={t('appt.deleteMsg')}
        variant="danger"
        onConfirm={() => deleteApptConfirm && deleteAppt(deleteApptConfirm)}
        onCancel={() => setDeleteApptConfirm(null)}
      />
    </>
  );
}

// ── Form Modal ────────────────────────────────────────────

function AppointmentFormModal({ appointment, customers, setCustomers, onSave, onClose }: {
  appointment: Appointment | null;
  customers: Customer[];
  setCustomers: (c: Customer[]) => void;
  onSave: (data: Partial<Appointment>) => void;
  onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const apptLang: 'en' | 'es' = locale === 'pt' ? 'en' : locale as 'en' | 'es';
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
    <Modal open onClose={onClose} title={`📅 ${appointment ? t('appt.modalTitleEdit') : t('appt.modalTitleNew')}`} size="max-w-md">
      <div className="space-y-3">
        {/* r-customer-picker-sweep: shared CustomerPicker replaces free-text inputs */}
        <CustomerPicker
          customers={customers}
          selectedCustomer={selectedCustomer}
          onSelect={handleSelectCustomer}
          lang={apptLang}
          placeholder={t('appt.formSearchCustomer')}
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
                <label className="text-xs text-slate-400 block mb-1">{t('appt.formFirstName')}</label>
                <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder={t('appt.formFirstNamePh')} />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('appt.formLastName')}</label>
                <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder={t('appt.formLastNamePh')} />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('appt.formPhone')}</label>
              <input className="input" type="tel" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} placeholder="(555) 123-4567" />
            </div>
          </>
        )}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('appt.formDevice')} *</label>
          <input className="input" value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })} placeholder={t('appt.formDevicePh')} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('appt.formIssue')} *</label>
          <input className="input" value={form.issue} onChange={(e) => setForm({ ...form, issue: e.target.value })} placeholder={t('appt.formIssuePh')} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('appt.formDropOff')}</label>
          <input className="input" type="datetime-local" value={form.estimatedDropOff} onChange={(e) => setForm({ ...form, estimatedDropOff: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('appt.formNotes')}</label>
          <textarea
            className="textarea"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder={t('appt.formNotesPh')}
          />
          <p className="text-[10px] text-amber-400/70 mt-1">
            {t('appt.formPasswordWarning')}
          </p>
        </div>
        {/* R-COMMS-CONSENT-UNIFY: "Send confirmation SMS" checkbox removed in Round 1;
            Appointment.sendConfirmationSms schema field removed in Round 3. */}
      </div>
      <div className="flex gap-3 mt-4 pt-4 border-t border-white/10">
        <button onClick={onClose} className="btn btn-secondary flex-1">{t('appt.btnCancel')}</button>
        <button onClick={handleSubmit} className="btn btn-primary flex-1">
          {appointment ? t('appt.btnSave') : t('appt.btnCreate')}
        </button>
      </div>
    </Modal>
  );
}
