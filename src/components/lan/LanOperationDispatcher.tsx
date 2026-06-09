// ============================================================
// CellHub Pro — LAN Operation Dispatcher (LAN-PHASE-3B-CREATE-CUSTOMER-FORWARDING-V1)
//
// Mounted once globally. On the PRIMARY, Electron main forwards a validated
// business operation here (channel lan:operation-dispatch) and awaits the real
// result. This is the first write-forwarding dispatcher: it creates a customer
// using the canonical shape, persists it on the PRIMARY (where the read-only
// persist guard does NOT apply — role is 'primary'), pushes a fresh snapshot so
// the Secondary's immediate re-fetch sees it, and replies with the created id.
//
// Idempotency: each created customer is tagged with the originating
// operationId; a re-sent operation returns the existing customer (duplicate)
// instead of creating a second. An in-memory set guards rapid intra-session
// duplicates before the first persist lands.
//
// STRICT SCOPE: customers only. Touches no money / sales / inventory / etc.
// Renders nothing.
// ============================================================
import { useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { persist } from '@/services/persist';
import { getConnection, buildSnapshot, pushSnapshot } from '@/services/lan/lanService';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { appendCustomerNote } from '@/utils/customerNotes';
import type { Customer, Appointment } from '@/store/types';

// Intra-session idempotency: operationIds already handled (race guard before
// the first persist is visible in state).
const processedOpIds = new Set<string>();

export default function LanOperationDispatcher() {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    if (!window.electronAPI?.onLanOperationDispatch || !window.electronAPI?.lanSendOperationResult) return;

    // Push a fresh snapshot BEFORE the ACK so the Secondary's immediate re-fetch
    // includes the change. Overrides replace the just-mutated collection; the
    // rest come from current state (mirrors the publisher). Best-effort — the
    // 15s publisher catches up regardless.
    const pushFreshSnapshot = async (overrides: { customers?: Customer[]; appointments?: Appointment[] } = {}) => {
      try {
        const s = appRef.current.state;
        const settings = s.settings as unknown as Record<string, unknown>;
        const snap = buildSnapshot(
          {
            customers: overrides.customers ?? s.customers,
            inventory: s.inventory, sales: s.sales, repairs: s.repairs,
            layaways: s.layaways, unlocks: s.unlocks, specialOrders: s.specialOrders,
            appointments: overrides.appointments ?? s.appointments,
            settings: s.settings as unknown as Record<string, unknown>,
          },
          (settings?.storeName as string) || 'CellHub Primary',
        );
        await pushSnapshot(snap);
      } catch { /* best-effort */ }
    };

    // LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1: append a forwarded note to the
    // target customer's existing notes string, persist on the Primary, snapshot.
    const handleCustomerNoteAdd = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      const a = appRef.current;
      const opId = String(op.operationId || '');
      if (!opId) return { ok: false, error: 'bad_operation' };
      const note = op.payload && op.payload.note;
      const text = note && String(note.text || '').trim();
      if (!note || !note.customerId || !text) return { ok: false, error: 'bad_payload' };

      const customers = a.state.customers || [];
      const target = customers.find((c) => c.id === note.customerId);
      if (!target) return { ok: false, error: 'customer_not_found' };

      // Idempotency: this operationId already appended to this customer.
      const applied = Array.isArray(target.lanNoteOpIds) ? target.lanNoteOpIds : [];
      if (applied.includes(opId)) return { ok: true, customerId: target.id, duplicate: true };

      const updated: Customer = {
        ...target,
        notes: appendCustomerNote(target.notes, text, note.timestamp),
        lanNoteOpIds: [...applied, opId].slice(-200), // cap the idempotency log
        updatedAt: new Date().toISOString(),
      };
      const next = customers.map((c) => (c.id === target.id ? updated : c));
      a.setCustomers(next);
      // Persist on the PRIMARY (role === 'primary' → persist guard does not block).
      persist.customer(updated.id, updated as unknown as Record<string, unknown>);
      await pushFreshSnapshot({ customers: next });
      return { ok: true, customerId: updated.id, duplicate: false };
    };

    // LAN-OPERATION-FORWARDING-APPOINTMENT-V1: create an appointment from a
    // forwarded op. Links to an existing customer by id/phone (does NOT auto-
    // create a customer — that divergence from the local flow is intentional
    // for this round). Persists on the Primary + snapshots.
    const handleCreateAppointment = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      const a = appRef.current;
      const opId = String(op.operationId || '');
      if (!opId) return { ok: false, error: 'bad_operation' };
      const p = op.payload && op.payload.appointment;
      const device = p && String(p.device || '').trim();
      const issue = p && String(p.issue || '').trim();
      if (!p || !device || !issue) return { ok: false, error: 'bad_payload' };

      const appointments = a.state.appointments || [];
      // Idempotency: this operationId already created an appointment.
      const byOp = appointments.find((ap) => ap.lanOperationId === opId);
      if (byOp) return { ok: true, appointmentId: byOp.id, duplicate: true };
      if (processedOpIds.has(opId)) {
        return { ok: true, appointmentId: appointments.find((ap) => ap.lanOperationId === opId)?.id, duplicate: true };
      }

      const customerName = String(p.customerName || '').trim();
      const phone = normalizePhone(String(p.customerPhone || ''));
      // Link to an existing customer (by id, else by phone). No auto-create.
      let linkedId = (p.customerId || '').trim() || undefined;
      if (!linkedId && phone.length >= 10) {
        const match = (a.state.customers || []).find((c) => normalizePhone(c.phone || '').slice(-10) === phone.slice(-10));
        if (match) linkedId = match.id;
      }

      processedOpIds.add(opId);
      const now = new Date().toISOString();
      const appt: Appointment = {
        id: generateId(),
        storeId: a.state.currentStoreId,
        customerId: linkedId,
        customerName,
        customerPhone: phone,
        device,
        issue,
        estimatedDropOff: String(p.estimatedDropOff || '').trim() || now,
        status: 'scheduled',
        notes: String(p.notes || ''),
        employeeName: (p.employeeName || '').trim() || undefined,
        createdAt: now,
        updatedAt: now,
        lanOperationId: opId,
      };
      const next = [appt, ...appointments];
      a.setAppointments(next);
      // Persist on the PRIMARY (role === 'primary' → persist guard does not block).
      persist.appointment(appt.id, appt as unknown as Record<string, unknown>);
      await pushFreshSnapshot({ appointments: next });
      return { ok: true, appointmentId: appt.id, duplicate: false };
    };

    const handleCreateCustomer = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      const a = appRef.current;
      const opId = String(op.operationId || '');
      if (!opId) return { ok: false, error: 'bad_operation' };
      const payload = op.payload && op.payload.customer;
      if (!payload || typeof payload !== 'object') return { ok: false, error: 'bad_payload' };

      const firstName = String(payload.firstName || '').trim();
      const lastName = String(payload.lastName || '').trim();
      const name = String(payload.name || '').trim() || `${firstName} ${lastName}`.trim();
      if (!name) return { ok: false, error: 'name_required' };
      const phone = normalizePhone(String(payload.phone || ''));

      const customers = a.state.customers || [];

      // Idempotency 1: operationId already created (persisted tag → survives restart).
      const byOp = customers.find((c) => c.lanOperationId === opId);
      if (byOp) return { ok: true, customerId: byOp.id, duplicate: true };
      // Idempotency 1b: rapid intra-session duplicate before the first persist shows.
      if (processedOpIds.has(opId)) {
        return { ok: true, customerId: customers.find((c) => c.lanOperationId === opId)?.id, duplicate: true };
      }
      // Dedup: a customer with the same phone already exists → return it.
      if (phone.length >= 10) {
        const byPhone = customers.find((c) => normalizePhone(c.phone || '').slice(-10) === phone.slice(-10));
        if (byPhone) return { ok: true, customerId: byPhone.id, duplicate: true };
      }

      processedOpIds.add(opId);

      const settings = a.state.settings as unknown as Record<string, unknown>;
      const prefix = (settings?.customerNumberPrefix as string) || 'GC';
      const ts8 = Date.now().toString().slice(-8);
      const rand4 = Math.random().toString(36).slice(2, 6).toUpperCase();
      const newCustomer: Customer = {
        id: generateId(),
        firstName,
        lastName,
        name,
        phone,
        phones: phone ? [phone] : [],
        email: String(payload.email || ''),
        loyaltyPoints: 0,
        storeCredit: 0,
        customerNumber: `${prefix}-${ts8}-${rand4}`,
        notes: String(payload.notes || ''),
        communicationConsent: !!payload.communicationConsent,
        createdAt: new Date().toISOString(),
        lanOperationId: opId,
      } as Customer;

      const next = [...customers, newCustomer];
      a.setCustomers(next);
      // Persist on the PRIMARY. role === 'primary' → the read-only persist guard
      // returns false here, so this write is allowed (full-entity spread).
      persist.customer(newCustomer.id, newCustomer as unknown as Record<string, unknown>);
      await pushFreshSnapshot({ customers: next });

      return { ok: true, customerId: newCustomer.id, duplicate: false };
    };

    const dispatch = async (op: LanOperation | undefined): Promise<LanOperationDispatchResult> => {
      if (!op) return { ok: false, error: 'unsupported_operation' };
      // Only the Primary persists. Defensive — a Secondary's main never sends this.
      if (getConnection().role === 'secondary') return { ok: false, error: 'not_primary' };
      if (op.type === 'CREATE_CUSTOMER') return handleCreateCustomer(op);
      if (op.type === 'LAN_CUSTOMER_NOTE_ADD') return handleCustomerNoteAdd(op);
      if (op.type === 'CREATE_APPOINTMENT') return handleCreateAppointment(op);
      return { ok: false, error: 'unsupported_operation' };
    };

    const unsub = window.electronAPI.onLanOperationDispatch(async (req) => {
      const requestId = req?.requestId;
      if (!requestId) return;
      let result: LanOperationDispatchResult;
      try {
        result = await dispatch(req?.op);
      } catch {
        result = { ok: false, error: 'dispatch_exception' };
      }
      try { window.electronAPI!.lanSendOperationResult({ requestId, result }); } catch { /* ignore */ }
    });

    return unsub;
  }, []);

  return null;
}
