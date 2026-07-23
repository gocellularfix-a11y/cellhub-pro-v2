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
import { persist, batchSave } from '@/services/persist';
import { getConnection, buildSnapshot, pushSnapshot } from '@/services/lan/lanService';
// R-2.1.4-CLOSEOUT / R-2.1.4-LAN-PRINT: canonical bridged-print mapping +
// media-based Primary printer routing (single source).
// R-PRINT-SERVER-V1: explicit-printer submit contract + printer inventory.
// R-PRINT-SERVER-V1.1: the authoritative per-printer FIFO queue lives in
// ELECTRON MAIN (electron/printQueue.js) — this dispatcher only talks to it
// via the printQueue* IPC. Local Primary prints (printRun) serialize through
// the SAME main-process lanes, so a local job and a Secondary job aimed at
// one physical printer can never run concurrently.
import { buildBridgedPrintRunPayload, resolveBridgePrinter, buildPrinterInventory, buildPrintServerRunPayload } from '@/services/lan/printBridge';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { appendCustomerNote } from '@/utils/customerNotes';
import type { Customer, Appointment, Sale, InventoryItem, StoreSettings } from '@/store/types';
import { resolvePosCheckout } from '@/services/lan/posCheckoutForwarding';
import type { FinalizeSaleCoreSuccess } from '@/modules/pos/finalizeSaleCore';
// P0-C1c (F-B/F-F): the SAME committed-sale workflow cleanup local POS uses, so
// a forwarded checkout also closes its phone-payment workflows after commit.
import { completeCommittedPhonePaymentWorkflows } from '@/modules/pos/completePhonePaymentWorkflows';

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

    // LAN-HARDWARE-BRIDGE-FOUNDATION-V1: print a forwarded receipt on the
    // PRIMARY's own default printer. The Primary owns the hardware — the
    // Secondary never names a device on this LEGACY/silent path. Returns a
    // clean printer error if the Primary has no default printer or the job
    // fails. R-PRINT-SERVER-V1: the job now runs through the per-printer
    // FIFO queue (same lane as explicit submits), so it can never interleave
    // with another job on the same physical printer; the ACK still awaits
    // the real print result (unchanged contract for the silent receipt path).
    const handlePrintReceipt = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      const a = appRef.current;
      if (!window.electronAPI?.printRun) return { ok: false, error: 'print_unavailable' };
      const settings = a.state.settings as unknown as Record<string, unknown>;
      const print = op.payload && op.payload.print;
      // R-2.1.4-LAN-PRINT: route the bridged job to a Primary printer by the
      // job's MEDIA TYPE (from pageSize) using the store's printer→media
      // assignments — NEVER the blind detectedPrinters[0]. A Letter report
      // with no report-printer assignment is rejected with a clear error
      // (no_report_printer) so it is never sent to the receipt printer; the
      // Secondary shows the failure and can retry after configuration.
      const resolution = resolveBridgePrinter(
        (print as { pageSize?: { width: number; height: number } } | undefined)?.pageSize,
        (settings?.printerMediaTypes as Record<string, string> | undefined),
        (settings?.detectedPrinters as string[] | undefined),
      );
      if (!resolution.ok) return { ok: false, error: resolution.error || 'no_printer' };
      // R-2.1.4-CLOSEOUT: the full print contract (pageRanges, margins,
      // scale, landscape) is defensively re-validated and mapped onto the
      // SAME printRun payload a direct print uses, so a bridged Custom Range
      // job flows through the canonical selected-page pipeline. A payload
      // with invalid pageRanges is REJECTED — never silently printed in full.
      const built = buildBridgedPrintRunPayload(print, resolution.printer || '');
      if (!built.ok) return { ok: false, error: built.error };
      try {
        // R-PRINT-SERVER-V1.1: printRun serializes through the main-process
        // per-printer queue. The wire printJobId dedups (a re-sent operation
        // awaits the SAME job instead of printing twice); op.deviceId records
        // ownership in the queue registry.
        const jobId = String((print as { printJobId?: string } | undefined)?.printJobId || '') || `legacy-${op.operationId}`;
        const res = await window.electronAPI.printRun({
          ...built.payload,
          jobId,
          deviceId: op.deviceId,
          documentType: String((print as { receiptType?: string } | undefined)?.receiptType || 'receipt'),
          origin: 'lan-legacy-receipt',
        });
        if (res && res.success) return { ok: true, printed: true };
        return { ok: false, error: (res && res.error) || 'print_failed' };
      } catch {
        return { ok: false, error: 'print_exception' };
      }
    };

    // ── R-PRINT-SERVER-V1: Primary print-server handlers ──────────────

    // Advertise the Primary's CURRENT printers (live scan, so a just-plugged
    // printer shows on the next Secondary refresh) + media assignments.
    const handlePrinterList = async (): Promise<LanOperationDispatchResult> => {
      const a = appRef.current;
      if (!window.electronAPI?.getPrinters) return { ok: false, error: 'print_unavailable' };
      const settings = a.state.settings as unknown as Record<string, unknown>;
      try {
        const list = await window.electronAPI.getPrinters();
        const printers = buildPrinterInventory(list, settings?.printerMediaTypes as Record<string, string> | undefined);
        return {
          ok: true,
          printers: printers as unknown as LanWirePrinterInfo[],
          primaryName: (settings?.storeName as string) || 'CellHub Primary',
        };
      } catch {
        return { ok: false, error: 'printer_scan_failed' };
      }
    };

    // Accept ONE complete explicit-printer job, resolve its printerId
    // against the Primary's real device list, submit it to the MAIN-PROCESS
    // per-printer FIFO queue (print:queue-submit) and ACK immediately with
    // { jobId, queuePosition }. Status flows back via LAN_PRINT_STATUS_REQUEST
    // polls — never a long-held HTTP response.
    const handlePrintSubmit = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      if (!window.electronAPI?.printQueueSubmit || !window.electronAPI?.getPrinters) return { ok: false, error: 'print_unavailable' };
      let names: string[] = [];
      try { names = ((await window.electronAPI.getPrinters()) || []).map((p) => p.name); }
      catch { return { ok: false, error: 'printer_scan_failed' }; }
      const run = buildPrintServerRunPayload(op.payload && op.payload.printSubmit, names);
      if (!run.ok) return { ok: false, error: run.error, jobId: run.jobId };
      const res = await window.electronAPI.printQueueSubmit({
        jobId: run.jobId,
        payload: run.payload as unknown as Record<string, unknown> & { deviceName: string },
        metadata: { deviceId: op.deviceId, documentType: run.documentType, origin: 'lan-secondary' },
      });
      if (!res || !res.success) return { ok: false, error: (res && res.error) || 'queue_submit_failed', jobId: run.jobId };
      return {
        ok: true,
        jobId: run.jobId,
        queuePosition: res.ahead || 0,
        jobStatus: {
          jobId: run.jobId, printerName: run.printerName,
          state: (res.state as LanPrintJobStatusWire['state']) || 'queued', ahead: res.ahead || 0,
        },
      };
    };

    // R-PRINT-SERVER-V1.1: OWNERSHIP-CHECKED status/cancel — the main queue
    // verifies job.deviceId === op.deviceId and answers a generic
    // job_not_found otherwise, so a Secondary can never inspect or cancel
    // another device's job even with a stolen jobId.
    const handlePrintStatus = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      const jobId = String(op.payload?.jobRef?.jobId || '');
      if (!jobId) return { ok: false, error: 'bad_job_id' };
      if (!window.electronAPI?.printQueueStatus) return { ok: false, error: 'print_unavailable' };
      const res = await window.electronAPI.printQueueStatus({ jobId, deviceId: op.deviceId });
      if (!res || !res.success || !res.jobStatus) return { ok: false, error: (res && res.error) || 'job_not_found' };
      const s = res.jobStatus as unknown as { jobId: string; deviceName?: string; printerName?: string; state: LanPrintJobStatusWire['state']; ahead: number; error?: string };
      return {
        ok: true,
        jobId,
        jobStatus: {
          jobId: s.jobId, printerName: s.deviceName || s.printerName || '',
          state: s.state, ahead: s.ahead, error: s.error,
        },
      };
    };

    const handlePrintCancel = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      const jobId = String(op.payload?.jobRef?.jobId || '');
      if (!jobId) return { ok: false, error: 'bad_job_id' };
      if (!window.electronAPI?.printQueueCancel) return { ok: false, error: 'print_unavailable' };
      const res = await window.electronAPI.printQueueCancel({ jobId, deviceId: op.deviceId });
      const s = res && res.jobStatus ? res.jobStatus as unknown as { jobId: string; deviceName?: string; printerName?: string; state: LanPrintJobStatusWire['state']; ahead: number; error?: string } : null;
      return {
        ok: !!(res && res.success),
        error: res && res.success ? undefined : ((res && res.error) || 'job_not_found'),
        jobId,
        jobStatus: s ? {
          jobId: s.jobId, printerName: s.deviceName || s.printerName || '',
          state: s.state, ahead: s.ahead, error: s.error,
        } : undefined,
      };
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

    // R-LAN-POS-CHECKOUT-FORWARDING: finalize a forwarded Secondary checkout on
    // the PRIMARY, headlessly. Reuses finalizeSaleCore (via resolvePosCheckout) —
    // the SAME engine as local POS, no duplication. Applies the result with the
    // global app setters + persist + batchSave; pushes a fresh snapshot so the
    // Secondary re-fetch sees the committed sale. CRITICAL: never calls
    // POSModule.handleCompleteSale and never touches the Primary POS UI (no cart
    // reset, no receipt modal, no payment modal) — only global business data.
    const pushCheckoutSnapshot = async (result: FinalizeSaleCoreSuccess): Promise<void> => {
      try {
        const s = appRef.current.state;
        const settings = s.settings as unknown as Record<string, unknown>;
        const ex = result.exchange;
        const snap = buildSnapshot(
          {
            customers: result.customerChanged ? result.customers : s.customers,
            inventory: ex && ex.inventoryChanged ? ex.inventory : (result.inventoryOps.length > 0 ? result.inventory : s.inventory),
            sales: ex && ex.salesChanged ? ex.sales : result.nextSales,
            repairs: result.repairOps.length > 0 ? result.repairs : s.repairs,
            layaways: result.layawayOps.length > 0 ? result.layaways : s.layaways,
            unlocks: result.unlockOps.length > 0 ? result.unlocks : s.unlocks,
            specialOrders: result.specialOrderOps.length > 0 ? result.specialOrders : s.specialOrders,
            appointments: s.appointments,
            // P0-SC-1: these two were previously omitted, so buildSnapshot
            // defaulted them to [] and the post-checkout push WIPED the
            // Secondary's storeCreditLedger/customerReturns mirror until the
            // periodic publisher restored it. Passing the real arrays both
            // fixes the wipe and propagates a just-debited certificate
            // balance to the Secondary immediately.
            storeCreditLedger: result.ledgerOps.length > 0 ? result.storeCreditLedger : s.storeCreditLedger,
            customerReturns: ex && ex.returnsChanged ? ex.returns : s.customerReturns,
            settings: s.settings as unknown as Record<string, unknown>,
          },
          (settings?.storeName as string) || 'CellHub Primary',
        );
        await pushSnapshot(snap);
      } catch { /* best-effort — the 15s publisher catches up */ }
    };

    const handlePosCheckout = async (op: LanOperation): Promise<LanOperationDispatchResult> => {
      const a = appRef.current;
      const opId = String(op.operationId || '');
      const sale = op.payload && op.payload.checkout ? (op.payload.checkout.sale as Sale | undefined) : undefined;
      const s = a.state;
      const resolution = resolvePosCheckout(sale ?? null, opId, {
        sales: s.sales || [],
        inventory: s.inventory || [],
        customers: s.customers || [],
        repairs: s.repairs || [],
        specialOrders: s.specialOrders || [],
        unlocks: s.unlocks || [],
        layaways: s.layaways || [],
        storeCreditLedger: s.storeCreditLedger || [],
        customerReturns: s.customerReturns || [],
        settings: s.settings as unknown as StoreSettings,
      });
      if (!resolution.ok) return { ok: false, error: resolution.error };
      if (resolution.duplicate) return { ok: true, saleId: resolution.saleId, duplicate: true };

      const { taggedSale, result } = resolution;
      // Apply headlessly. Same order/conditionals as POSModule's local apply.
      a.setSales(result.nextSales);
      persist.sale(taggedSale.id, taggedSale as unknown as Record<string, unknown>);
      if (result.inventoryOps.length > 0) { a.setInventory(result.inventory); batchSave(result.inventoryOps); }
      if (result.customerChanged && result.workingCustomer) {
        a.setCustomers(result.customers);
        persist.customer(result.workingCustomer.id, result.workingCustomer as unknown as Record<string, unknown>);
      }
      if (result.repairOps.length > 0) { a.setRepairs(result.repairs); batchSave(result.repairOps); }
      if (result.specialOrderOps.length > 0) { a.setSpecialOrders(result.specialOrders); batchSave(result.specialOrderOps); }
      if (result.unlockOps.length > 0) { a.setUnlocks(result.unlocks); batchSave(result.unlockOps); }
      if (result.layawayOps.length > 0) { a.setLayaways(result.layaways); batchSave(result.layawayOps); }
      if (result.ledgerOps.length > 0) { a.setStoreCreditLedger(result.storeCreditLedger); batchSave(result.ledgerOps); }
      if (result.exchange) {
        const ex = result.exchange;
        if (ex.salesChanged) {
          a.setSales(ex.sales);
          for (const id of ex.updatedSaleIds) {
            const x = ex.sales.find((y) => y.id === id);
            if (x) persist.sale(x.id, x as unknown as Record<string, unknown>);
          }
        }
        if (ex.inventoryChanged) {
          a.setInventory(ex.inventory);
          const exInvOps = ex.updatedInventoryIds
            .map((id) => ex.inventory.find((y) => y.id === id))
            .filter((iv): iv is InventoryItem => !!iv)
            .map((iv) => ({ collection: 'inventory', id: iv.id, data: iv as unknown as Record<string, unknown> }));
          if (exInvOps.length > 0) batchSave(exInvOps);
        }
        if (ex.returnsChanged) {
          a.setCustomerReturns(ex.returns);
          for (const rec of ex.persistedReturns) persist.customerReturn(rec.id, rec as unknown as Record<string, unknown>);
        }
      }
      // P0-C1c (F-B): the forwarded sale is now committed/persisted on the
      // Primary (persist.sale + applies above). Close its phone-payment
      // workflows with the SAME shared cleanup local POS uses — never before
      // the commit, never on a rejected finalize. Idempotent + never throws, so
      // a store cleanup failure cannot revert this committed sale (F-F). See the
      // helper for the machine-local LAN caveat.
      completeCommittedPhonePaymentWorkflows(result.sideEffects.completeWorkflowIds, 'lan-primary', taggedSale.id);
      await pushCheckoutSnapshot(result);
      return { ok: true, saleId: taggedSale.id, duplicate: false };
    };

    const dispatch = async (op: LanOperation | undefined): Promise<LanOperationDispatchResult> => {
      if (!op) return { ok: false, error: 'unsupported_operation' };
      // Only the Primary persists. Defensive — a Secondary's main never sends this.
      if (getConnection().role === 'secondary') return { ok: false, error: 'not_primary' };
      if (op.type === 'CREATE_CUSTOMER') return handleCreateCustomer(op);
      if (op.type === 'LAN_CUSTOMER_NOTE_ADD') return handleCustomerNoteAdd(op);
      if (op.type === 'CREATE_APPOINTMENT') return handleCreateAppointment(op);
      if (op.type === 'LAN_PRINT_RECEIPT_REQUEST') return handlePrintReceipt(op);
      if (op.type === 'LAN_POS_CHECKOUT') return handlePosCheckout(op);
      // R-PRINT-SERVER-V1: print-server protocol.
      if (op.type === 'LAN_PRINTER_LIST_REQUEST') return handlePrinterList();
      if (op.type === 'LAN_PRINT_SUBMIT') return handlePrintSubmit(op);
      if (op.type === 'LAN_PRINT_STATUS_REQUEST') return handlePrintStatus(op);
      if (op.type === 'LAN_PRINT_CANCEL_REQUEST') return handlePrintCancel(op);
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
