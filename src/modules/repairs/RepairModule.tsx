// ============================================================
// CellHub Pro — Repair Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { reverseTaxFromPayment } from '@/utils/depositTax';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { persist, remove } from '@/services/persist';
import DepositModal from '@/components/DepositModal';
import { sendSms } from '@/services/sms';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import TicketListLayout from '@/components/shared/TicketListLayout';
import TicketCard from '@/components/shared/TicketCard';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { usePrint } from '@/hooks/usePrint';
import RepairModal from './RepairModal';
import CancelRepairModal from './CancelRepairModal';
import type { Repair, CartItem, Customer, Sale } from '@/store/types';

// FIX Bug 2: Added 'Waiting Parts' and 'Ready' so those tickets aren't invisible
const STATUSES = ['All', 'Received', 'In Progress', 'Waiting Parts', 'Ready', 'Complete', 'Cancelled'];

const STATUS_BADGE: Record<string, string> = {
  'Received': 'badge-info',
  'In Progress': 'badge-warning',
  'Waiting Parts': 'badge-warning',
  'Ready': 'badge-success',
  'Complete': 'badge-success',
  'Cancelled': 'badge-danger',
};

export default function RepairModule() {
  const {
    state: { repairs, customers, inventory, settings, currentEmployee, cart, sales, lang, globalSearchTerm },
    setRepairs, setCustomers, setCart, setSales, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const L = getLabels(lang);

  const [search, setSearch] = useState(globalSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState('All');
  const [visibleCount, setVisibleCount] = useState(50);
  const [showModal, setShowModal] = useState(false);
  const [editRepair, setEditRepair] = useState<Repair | null>(null);
  const [depositModalRepair, setDepositModalRepair] = useState<Repair | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Repair | null>(null);

  // ── Stale-closure guard: ref-based mirror of repairs so back-to-back
  // setRepairs calls (modal save + collectBalance) don't pisarse mutually.
  const repairsRef = useRef(repairs);
  useEffect(() => { repairsRef.current = repairs; }, [repairs]);
  const customersRef = useRef(customers);
  const cartRef = useRef(cart);
  const salesRef = useRef(sales);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  useEffect(() => { salesRef.current = sales; }, [sales]);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Translated statuses ─────────────────────────────────

  const translateStatus = useCallback(
    (status: string) => {
      const map: Record<string, string> = {
        All: L.all, Received: L.received, 'In Progress': L.inProgress,
        'Waiting Parts': L.waitingParts || 'Waiting Parts',
        Ready: L.ready || 'Ready',
        Complete: L.completed, Cancelled: L.cancelled,
      };
      return map[status] || status;
    },
    [L],
  );

  // ── Filtered list ───────────────────────────────────────

  // FIX Bug 1: normalize both sides so each tab only matches its own status
  // FIX Bug 2: 'Waiting Parts' and 'Ready' now have filter tabs so they're no longer invisible
  const normalizeStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');

  const filtered = useMemo(() => {
    return repairs
      .filter((r) => {
        if (filterStatus === 'All') return true;
        return normalizeStatus(r.status) === normalizeStatus(filterStatus);
      })
      .filter((r) =>
        matchesSearch(search, r.customerName, r.customerPhone, r.device, r.issue, r.id),
      )
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [repairs, filterStatus, search]);

  // ── Stats ───────────────────────────────────────────────

  // FIX Bug 3: normalize status to lowercase so 'complete', 'cancelled', 'ready' etc. are caught
  const DONE_STATUSES = ['complete', 'cancelled', 'picked_up', 'ready'];
  const activeCount = useMemo(
    () => repairs.filter((r) => !DONE_STATUSES.includes(normalizeStatus(r.status))).length,
    [repairs],
  );
  const completeCount = useMemo(
    () => repairs.filter((r) => ['complete', 'picked_up', 'ready'].includes(normalizeStatus(r.status))).length,
    [repairs],
  );

  // ── Auto-print repair ticket on creation ────────────────────
  // `displayOverride` lets callers print a ticket showing values that aren't
  // yet persisted on the entity. Specifically, when a repair is created with
  // a pending deposit, the entity holds depositAmount=0 (r-deposit-integrity-1)
  // but the customer should see the deposit they actually paid. The caller
  // passes the real numbers; persistence stays untouched.
  const printRepairTicket = useCallback((repair: any, displayOverride?: {
    depositAmount?: number;  // cents
    balance?: number;        // cents
  }) => {
    const safe = (v: any) => v == null ? '' : String(v);
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const storeName = (settings.storeName || 'CellHub Pro').toUpperCase();
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';
    const es = lang === 'es';

    const lines: string[] = [];
    lines.push(storeName);
    if (storeAddr) lines.push(storeAddr);
    if (storePhone) lines.push(storePhone);
    lines.push('----------------------------------------');
    lines.push(es ? 'TICKET DE REPARACIÓN' : 'REPAIR TICKET');
    lines.push(`TICKET: ${safe(repair.ticketNumber)}`);
    lines.push(`${es ? 'FECHA' : 'DATE'}: ${new Date().toLocaleString()}`);
    lines.push(`STATUS: ${safe(repair.status)}`);
    lines.push('----------------------------------------');
    lines.push(`${es ? 'CLIENTE' : 'CUSTOMER'}: ${safe(repair.customerName)}`);
    if (repair.customerPhone) lines.push(`${es ? 'TEL' : 'PHONE'}: ${safe(repair.customerPhone)}`);
    lines.push('----------------------------------------');
    lines.push(`${es ? 'DISPOSITIVO' : 'DEVICE'}: ${safe(repair.device)}`);
    if (repair.imei) lines.push(`IMEI: ${safe(repair.imei)}`);
    lines.push('----------------------------------------');
    lines.push(`${es ? 'PROBLEMA' : 'ISSUE'}: ${safe(repair.issue)}`);
    if (repair.notes) {
      lines.push('----------------------------------------');
      lines.push(`${es ? 'NOTAS' : 'NOTES'}: ${safe(repair.notes)}`);
    }
    lines.push('----------------------------------------');
    lines.push(`SUBTOTAL: ${money(repair.subtotal || 0)}`);
    if (repair.laborCost) lines.push(`${es ? 'LABOR' : 'LABOR'}: ${money(repair.laborCost)}`);
    if (repair.taxable && repair.taxAmount > 0) {
      lines.push(`${es ? 'IMPUESTO' : 'TAX'} (${((repair.taxRate || 0) * 100).toFixed(2)}%): ${money(repair.taxAmount)}`);
    }
    lines.push(`TOTAL: ${money(repair.total || 0)}`);
    const displayDeposit = displayOverride?.depositAmount ?? (repair.depositAmount || 0);
    const displayBalance = displayOverride?.balance ?? (repair.balance || 0);
    lines.push(`${es ? 'DEPÓSITO' : 'DEPOSIT'}: ${money(displayDeposit)}`);
    lines.push(`${es ? 'BALANCE' : 'BALANCE'}: ${money(displayBalance)}`);
    lines.push('----------------------------------------');
    if (repair.warranty) lines.push(`${es ? 'GARANTÍA' : 'WARRANTY'}: ${repair.warranty} ${es ? 'días' : 'days'}`);
    lines.push(es ? '¡Gracias por su preferencia!' : 'Thank you for your business!');

    const text = lines.filter(Boolean).join('\n');
    const html = `<!DOCTYPE html><html><head><title>Repair ${safe(repair.ticketNumber)}</title><style>@page{size:4in 6in;margin:0}html,body{width:4in;height:6in;margin:0;padding:0;font-family:monospace}body{padding:.25in;box-sizing:border-box}pre{font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0}</style></head><body><pre>${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`;
    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  }, [settings, lang, printHtml]);

  // ── Save handler ────────────────────────────────────────

  const handleSave = useCallback(
    (repairData: Partial<Repair>) => {
      // Auto-create customer if new — dedup by phone
      if (repairData.customerName && repairData.customerPhone) {
        const phone = normalizePhone(repairData.customerPhone);
        const existing = customers.find(
          (c) => normalizePhone(c.phone) === phone,
        );

        if (existing) {
          // Customer exists — notify if name differs
          if (existing.name.toLowerCase() !== repairData.customerName.toLowerCase()) {
            toast(
              lang === 'es'
                ? `Cliente existente encontrado: ${existing.name}`
                : `Existing customer found: ${existing.name}`,
              'info',
            );
          }
        } else {
          const repairFirstName = (repairData as { firstName?: string }).firstName || repairData.customerName.trim().split(/\s+/)[0] || '';
          const repairLastName  = (repairData as { lastName?: string }).lastName  || repairData.customerName.trim().split(/\s+/).slice(1).join(' ') || '';
          const newCustomer: Customer = {
            id: generateId(),
            firstName: repairFirstName,
            lastName: repairLastName,
            name: repairData.customerName,
            phone: repairData.customerPhone,
            phones: [repairData.customerPhone],
            email: '',
            loyaltyPoints: 0,
            storeCredit: 0,
            customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            notes: '',
            smsConsent: false,
            createdAt: new Date().toISOString(),
          };
          const nextCustomers = [...customersRef.current, newCustomer];
          customersRef.current = nextCustomers;
          setCustomers(nextCustomers);
          persist.customer(newCustomer.id, newCustomer as unknown as Record<string, unknown>);
        }
      }

      if (editRepair) {
        // r-deposit-integrity-1 EDIT guard: spread repairData first but then
        // FORCE depositAmount + balance back to whatever the entity currently
        // has. These two fields are managed exclusively by:
        //   (a) POSModule.handleCompleteSale — increments on checkout
        //   (b) handleCancelRepair — resets on cancel+refund
        // Any other write path is a bug. If the cashier wants to collect a
        // deposit/balance, they use the "Collect" button which pushes to cart.
        // If they want to refund, they use the Cancel button (new flow).
        // Recalculate balance from the new total so price changes (parts/labor)
        // still update balance = total - depositAmount correctly.
        const spread = { ...editRepair, ...repairData } as Repair;
        const lockedDeposit = editRepair.depositAmount || 0;
        const newTotal = (spread as any).total || spread.estimatedCost || 0;
        const lockedBalance = Math.max(0, newTotal - lockedDeposit);
        const updated: Repair = {
          ...spread,
          depositAmount: lockedDeposit,
          balance: lockedBalance,
          id: editRepair.id,
          createdAt: editRepair.createdAt,
          updatedAt: new Date().toISOString(),
        } as Repair;

        const next = repairsRef.current.map((r) => (r.id === editRepair.id ? updated : r));
        repairsRef.current = next;
        setRepairs(next);
        persist.repair(updated.id, updated as unknown as Record<string, unknown>);

        // Proactive SMS on status changes (if customer has smsConsent or phone exists)
        const prevStatus = editRepair.status;
        const newStatus = updated.status;
        const statusChanged = prevStatus !== newStatus;
        const hasPhone = !!updated.customerPhone;
        const smsEnabled = settings.smsProvider !== 'none' && settings.smsApiKey;

        if (statusChanged && hasPhone && smsEnabled) {
          const store = settings.storeName || '';
          const name = updated.customerName?.split(' ')[0] || updated.customerName;
          const device = [(updated as any).brand, (updated as any).model].filter(Boolean).join(' ') || updated.device;
          const ticket = (updated as any).ticketNumber || updated.id.slice(-6).toUpperCase();
          let msg = '';

          if (newStatus === 'Received' || newStatus === 'received') {
            if (settings.smsAutoRepairReady) {
              msg = lang === 'es'
                ? `Hola ${name}, recibimos tu ${device}. Ticket #${ticket}. Te avisamos cuando esté listo. — ${store}`
                : `Hi ${name}, we received your ${device}. Ticket #${ticket}. We'll text you when it's ready. — ${store}`;
            }
          } else if (newStatus === 'In Progress' || newStatus === 'in_progress') {
            if (settings.smsAutoRepairReady) {
              msg = lang === 'es'
                ? `Hola ${name}, tu ${device} está en reparación. Ticket #${ticket}. — ${store}`
                : `Hi ${name}, we're working on your ${device}. Ticket #${ticket}. — ${store}`;
            }
          } else if (newStatus === 'Complete' || newStatus === 'complete' || newStatus === 'ready') {
            if (settings.smsAutoRepairReady) {
              msg = lang === 'es'
                ? `Hola ${name}, tu reparación está lista. Pasa a recoger tu ${device}. Total: ${formatCurrency(updated.balance || 0)}. — ${store}`
                : `Hi ${name}, your ${device} is ready for pickup! Total due: ${formatCurrency(updated.balance || 0)}. — ${store}`;
            }
          } else if (newStatus === 'Cancelled' || newStatus === 'cancelled') {
            if (settings.smsAutoRepairReady) {
              msg = lang === 'es'
                ? `Hola ${name}, tu ticket #${ticket} fue cancelado. Llámanos si tienes preguntas. — ${store}`
                : `Hi ${name}, your repair ticket #${ticket} has been cancelled. Call us if you have questions. — ${store}`;
            }
          }

          if (msg) sendSms(updated.customerPhone, msg, settings).catch(console.error);
        }

        toast(L.saved || 'Saved!', 'success');
      } else {
        // Create new — ticket number matching original format
        const now = new Date();
        const ticketNum = (repairData as any).ticketNumber ||
          `RPR-${String(now.getFullYear()).slice(-2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(Math.floor(Math.random()*9000)+1000)}`;
        const rd = repairData as any;
        const deviceLabel = [rd.brand, rd.model].filter(Boolean).join(' ') || rd.device || '';
        // Generate short random tracking token for public status page
        const trackingToken = Math.random().toString(36).slice(2, 10).toUpperCase();

        const newRepair = {
          id: generateId(),
          ticketNumber: ticketNum,
          trackingToken,
          // Customer
          customerName: rd.customerName || '',
          customerPhone: rd.customerPhone || '',
          firstName: rd.firstName || '',
          lastName: rd.lastName || '',
          // Device
          device: deviceLabel,
          deviceModel: rd.model || rd.deviceModel || '',
          brand: rd.brand || '',
          model: rd.model || '',
          deviceType: rd.deviceType || 'Phone',
          imei: rd.imei || '',
          carrier: rd.carrier || '',
          password: rd.password || '',
          // Repair
          issue: rd.issue || '',
          diagnosis: rd.diagnosis || '',
          status: rd.status || 'Received',
          priority: rd.priority || 'Normal',
          // Financials (cents)
          parts: rd.parts || [],
          laborCost: rd.laborCost || 0,
          partsTotal: rd.partsTotal || 0,
          subtotal: rd.subtotal || 0,
          taxAmount: rd.taxAmount || 0,
          taxable: !!rd.taxable,
          taxRate: rd.taxRate || 0,
          estimatedCost: rd.total || rd.estimatedCost || 0,
          total: rd.total || rd.estimatedCost || 0,
          // r-deposit-integrity-1 P1: deposits MUST NOT be reflected in the
          // entity until the POS checkout confirms the sale. The amount the
          // user typed is captured into `pendingDepositAmt` below and pushed
          // to the cart; the entity itself is persisted as if no deposit had
          // been collected. POSModule.handleCompleteSale reconciles the cart
          // items back to the entity when the sale is finalized. If the
          // cashier abandons the cart, the entity stays at depositAmount=0
          // and no revenue ghost is created.
          depositAmount: 0,
          deposit: 0,
          balance: rd.total || rd.estimatedCost || 0,
          // Notes
          techNotes: rd.notes || rd.techNotes || '',
          notes: rd.notes || '',
          internalNotes: rd.internalNotes || '',
          // Meta
          warranty: rd.warranty || 30,
          estimatedCompletion: rd.estimatedCompletion || '',
          technicianName: currentEmployee?.name || '',
          employeeName: currentEmployee?.name,
          employeeId: currentEmployee?.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as unknown as Repair;

        const next = [...repairsRef.current, newRepair];
        repairsRef.current = next;
        setRepairs(next);
        persist.repair(newRepair.id, newRepair as unknown as Record<string, unknown>);

        // r-deposit-integrity-1: read pending deposit from form data (rd),
        // NOT from newRepair — newRepair was persisted with depositAmount=0.
        const depositAmt = rd.depositAmount || 0;
        if (depositAmt > 0) {
          // Option B: reverse-tax deposit so cart base + tax = exactly $deposit
          const isTaxable = !!(newRepair as any).taxable;
          const repairTaxRate = settings.taxRate || 0.0925;
          const split = reverseTaxFromPayment(depositAmt, repairTaxRate, isTaxable);
          const depositItem: CartItem = {
            id: generateId(),
            name: `${deviceLabel} — ${lang === 'es' ? 'Depósito Reparación' : 'Repair Deposit'}`.trim(),
            category: 'service',
            price: split.baseCents,
            qty: 1,
            taxable: isTaxable,
            cbeEligible: false,
            repairId: newRepair.id,
            notes: `Ticket: ${ticketNum}`,
          };
          setCart([...cartRef.current, depositItem]);
          toast(
            lang === 'es'
              ? `Reparación creada. Depósito ${formatCurrency(depositAmt)} agregado al carrito.`
              : `Repair created. Deposit ${formatCurrency(depositAmt)} added to cart. Go to POS.`,
            'info'
          );
        } else {
          toast(L.repairCreated || 'Repair ticket created!', 'success');
        }

        // Auto-print repair ticket on creation.
        // r-repair-deposit-print: newRepair has depositAmount=0 (intentional),
        // but the customer paid `depositAmt` right now. Pass display override
        // so the printed ticket shows the real deposit and remaining balance.
        // The persisted entity stays at depositAmount=0; POS checkout
        // reconciles the real number into the entity later.
        const displayTotalCents = Number(newRepair.total || newRepair.estimatedCost || 0);
        const displayBalanceCents = Math.max(0, displayTotalCents - depositAmt);
        setTimeout(
          () => printRepairTicket(newRepair, {
            depositAmount: depositAmt,
            balance: displayBalanceCents,
          }),
          300
        );
      }

      setShowModal(false);
      setEditRepair(null);
    },
    [editRepair, customers, settings, currentEmployee, cart, lang, L,
     setRepairs, setCustomers, setCart, toast, printRepairTicket],
  );

  // ── Cancel repair with deposit disposal ────────────────────
  // BUG #1 fix: Before this, cancelling a repair left depositAmount intact
  // on the entity — ghost revenue with no record of what happened to the money.
  // Now every cancellation forces a disposition choice.
  const handleCancelRepair = useCallback((repair: Repair, choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => {
    const depositCents = repair.depositAmount || 0;
    const now = new Date().toISOString();

    // 1. Customer side effects (store credit or voided sale)
    if (choice.method === 'store_credit' && depositCents > 0) {
      const phoneTail = (repair.customerPhone || '').replace(/\D/g, '').slice(-10);
      const matched = customersRef.current.find((c) => {
        if ((repair as any).customerId && c.id === (repair as any).customerId) return true;
        if (phoneTail) {
          const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
          if (cPhone && cPhone === phoneTail) return true;
        }
        return false;
      });
      if (matched) {
        const updatedCustomer = {
          ...matched,
          storeCredit: (matched.storeCredit || 0) + depositCents,
        };
        const nextCustomers = customersRef.current.map((c) =>
          c.id === matched.id ? updatedCustomer : c
        );
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(updatedCustomer.id, updatedCustomer as unknown as Record<string, unknown>);
      } else {
        toast(
          lang === 'es'
            ? '⚠️ No se identificó al cliente. Aplica crédito manualmente.'
            : '⚠️ Customer not matched. Apply credit manually.',
          'warning'
        );
      }
    } else if (choice.method === 'cash' && depositCents > 0) {
      const refundSale: Sale = {
        id: generateId(),
        storeId: (repair as any).storeId,
        invoiceNumber: `REFUND-${repair.id.slice(-6).toUpperCase()}`,
        customerId: (repair as any).customerId,
        customerName: repair.customerName,
        customerPhone: repair.customerPhone,
        items: [{
          id: generateId(),
          name: `${repair.device} — ${lang === 'es' ? 'Reembolso cancelación' : 'Cancellation refund'}`,
          category: 'service' as any,
          price: -depositCents,
          qty: 1,
          taxable: false,
          cbeEligible: false,
          repairId: repair.id,
        }],
        subtotal: -depositCents,
        taxAmount: 0,
        cbeTotal: 0,
        total: -depositCents,
        paymentMethod: 'Cash' as any,
        status: 'voided',
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name,
        notes: `Repair cancelled — cash refund for ticket ${(repair as any).ticketNumber || repair.id.slice(-6).toUpperCase()}`,
        refundReason: 'Repair cancelled',
        createdAt: now,
      };
      const nextSales = [...salesRef.current, refundSale];
      salesRef.current = nextSales;
      setSales(nextSales);
      persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
    }

    // 2. Update repair entity
    const updated = {
      ...repair,
      status: 'Cancelled',
      depositRefundMethod: choice.method,
      depositRefundAmount: depositCents,
      cancellationNote: choice.note || '',
      cancelledAt: now,
      depositAmount: 0,
      balance: 0,
      updatedAt: now,
    } as unknown as Repair;
    const nextRepairs = repairsRef.current.map((r) => r.id === repair.id ? updated : r);
    repairsRef.current = nextRepairs;
    setRepairs(nextRepairs);
    persist.repair(updated.id, updated as unknown as Record<string, unknown>);

    // 3. Toast feedback
    const msg = {
      store_credit: lang === 'es'
        ? `Cancelado. Crédito $${(depositCents/100).toFixed(2)} agregado al cliente.`
        : `Cancelled. $${(depositCents/100).toFixed(2)} store credit added.`,
      cash: lang === 'es'
        ? `Cancelado. Reembolso $${(depositCents/100).toFixed(2)} registrado.`
        : `Cancelled. $${(depositCents/100).toFixed(2)} cash refund recorded.`,
      forfeit: lang === 'es'
        ? `Cancelado. Depósito retenido.`
        : `Cancelled. Deposit forfeited.`,
    }[choice.method];
    toast(msg, 'success');
    setCancelTarget(null);
  }, [lang, setCustomers, setSales, setRepairs, toast, currentEmployee]);

  // ── Collect balance ─────────────────────────────────────

  const collectBalance = useCallback(
    (repair: Repair) => {
      if (!repair.balance || repair.balance <= 0) return;

      const isTaxable = !!(repair as any).taxable;
      const repairTaxRate = settings.taxRate || 0.0925;
      const split = reverseTaxFromPayment(repair.balance, repairTaxRate, isTaxable);
      const balanceItem: CartItem = {
        id: generateId(),
        name: `${repair.device} — ${lang === 'es' ? 'Balance Reparación' : 'Repair Balance'}`,
        category: 'service',
        price: split.baseCents,
        qty: 1,
        taxable: isTaxable,
        cbeEligible: false,
        repairId: repair.id,
        notes: `Balance for ${repair.customerName}`,
      };

      setCart([...cartRef.current, balanceItem]);
      toast(lang === 'es'
        ? `Balance ${formatCurrency(repair.balance)} agregado al carrito`
        : `Balance ${formatCurrency(repair.balance)} added to cart`, 'info');
    },
    [setCart, settings, toast],
  );

  // ── Render ──────────────────────────────────────────────

  return (
    <>
      <TicketListLayout
        title={L.repairs || 'Repairs'}
        icon="🔧"
        statuses={STATUSES}
        activeStatus={filterStatus}
        onStatusChange={(s) => { setFilterStatus(s); setVisibleCount(50); }}
        translateStatus={translateStatus}
        // r-global-search: search props removed; GlobalSearchBar mounted via slot.
        // Local `search` state still drives the filtered list memo (synced mode).
        globalSearchSlot={
          <GlobalSearchBar
            localValue={search}
            onLocalChange={(s) => { setSearch(s); setVisibleCount(50); }}
            excludeCollection="repairs"
            placeholder={L.searchPlaceholder}
          />
        }
        stats={[
          { label: L.activeRepairs || 'Active', value: activeCount, color: 'text-orange-400' },
          { label: L.completed || 'Completed', value: completeCount, color: 'text-emerald-400' },
          { label: L.total || 'Total', value: repairs.length, color: 'text-slate-300' },
        ]}
        onNew={() => { setEditRepair(null); setShowModal(true); }}
        newLabel={L.newRepair || 'New Repair'}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-3">🔧</span>
            <p>{L.noRepairsFound || 'No repairs found'}</p>
          </div>
        ) : (
          filtered.slice(0, visibleCount).map((repair) => (
            <TicketCard
              ref={isHighlighted(repair.id) ? highlightRef : null}
              highlighted={isHighlighted(repair.id)}
              key={repair.id}
              ticketNumber={(repair as any).ticketNumber || repair.id.slice(-8).toUpperCase()}
              customerName={repair.customerName}
              customerPhone={repair.customerPhone}
              device={[(repair as any).brand, (repair as any).model].filter(Boolean).join(' ') || repair.device || ''}
              issue={repair.issue}
              status={repair.status}
              statusBadgeClass={STATUS_BADGE[repair.status] || STATUS_BADGE[(repair.status || '').toLowerCase()] || 'badge-neutral'}
              total={(repair as any).total || repair.estimatedCost || 0}
              deposit={(repair as any).depositAmount || (repair as any).deposit || 0}
              balance={repair.balance || 0}
              createdAt={repair.createdAt as string}
              priority={repair.priority}
              onClick={() => { setEditRepair(repair); setShowModal(true); }}
              onCollectBalance={repair.balance > 0 ? () => setDepositModalRepair(repair) : undefined}
              onWhatsApp={settings.waEnabled !== false && repair.customerPhone ? () => {
                const tmplKey = ['Complete','complete','ready'].includes(repair.status) ? 'repairReady'
                  : ['In Progress','in_progress'].includes(repair.status) ? 'repairInProgress'
                  : repair.balance > 0 ? 'balanceDue'
                  : 'repairReceived';
                const customTmpl = tmplKey === 'repairReady' ? settings.waTemplateRepairReady
                  : tmplKey === 'repairReceived' ? settings.waTemplateRepairReceived
                  : tmplKey === 'balanceDue' ? settings.waTemplateBalanceDue
                  : undefined;
                openWhatsApp(
                  repair.customerPhone,
                  buildWaMessage(
                    tmplKey as any,
                    {
                      customerName: repair.customerName,
                      storeName: settings.storeName || 'Go Cellular',
                      storePhone: settings.storePhone,
                      device: [(repair as any).brand, (repair as any).model].filter(Boolean).join(' ') || repair.device || '',
                      balance: repair.balance > 0 ? `$${(repair.balance / 100).toFixed(2)}` : undefined,
                      ticketNumber: (repair as any).ticketNumber || repair.id.slice(-8).toUpperCase(),
                    },
                    lang as 'en' | 'es',
                    customTmpl || undefined,
                  )
                );
              } : undefined}
              lang={lang}
              L={L}
            />
          ))
        )}

          {filtered.length > visibleCount && (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <button
                onClick={() => setVisibleCount((n) => n + 50)}
                className="btn btn-secondary btn-sm"
              >
                {lang === 'es'
                  ? `Mostrar más (${filtered.length - visibleCount} restantes)`
                  : `Show more (${filtered.length - visibleCount} remaining)`}
              </button>
            </div>
          )}
      </TicketListLayout>

      {depositModalRepair && (
        <DepositModal
          title={lang === 'es' ? `Depósito — ${(depositModalRepair as any).ticketNumber || depositModalRepair.id.slice(-6).toUpperCase()}` : `Deposit — ${(depositModalRepair as any).ticketNumber || depositModalRepair.id.slice(-6).toUpperCase()}`}
          itemLabel={`${[(depositModalRepair as any).brand, (depositModalRepair as any).model].filter(Boolean).join(' ') || depositModalRepair.device} — ${depositModalRepair.issue || 'Repair'}`}
          itemPrice={((depositModalRepair as any).subtotal || depositModalRepair.estimatedCost || 0) / 100}
          taxRate={settings.taxRate || 0.0925}
          taxable={!!(depositModalRepair as any).taxable}
          existingDeposit={(depositModalRepair.depositAmount || 0) / 100}
          mode={depositModalRepair.balance > 0 ? 'balance' : 'deposit'}
          lang={lang}
          onClose={() => setDepositModalRepair(null)}
          onConfirm={({ depositAmt }) => {
            const r = depositModalRepair;
            const amtCents = Math.round(depositAmt * 100);
            const isTaxable = !!(r as any).taxable;
            const repairTaxRate = settings.taxRate || 0.0925;
            const split = reverseTaxFromPayment(amtCents, repairTaxRate, isTaxable);
            const cartItem: CartItem = {
              id: generateId(),
              name: r.balance > 0
                ? `${r.device} — ${lang === 'es' ? 'Balance Reparación' : 'Repair Balance'}`
                : `${r.device} — ${lang === 'es' ? 'Depósito Reparación' : 'Repair Deposit'}`,
              category: 'service',
              price: split.baseCents,
              qty: 1,
              taxable: isTaxable,
              cbeEligible: false,
              repairId: r.id,
              notes: `${r.id.slice(-6).toUpperCase()}`,
            };
            setCart([...cart, cartItem]);
            // r-pkg-b1: DO NOT update repair balance here. The POS checkout
            // handler (POSModule.tsx §4a) reads repair.balance from state and
            // applies the deduction + persist when the sale completes. If we
            // also deducted here, it would double-deduct. The balance stays
            // visually unchanged until checkout — that's correct because the
            // money hasn't been collected yet.
            setDepositModalRepair(null);
            toast(lang === 'es' ? `$${depositAmt.toFixed(2)} agregado al carrito` : `$${depositAmt.toFixed(2)} added to cart`, 'success');
          }}
        />
      )}

      {showModal && (
        <RepairModal
          repair={editRepair}
          customers={customers}
          inventory={inventory}
          settings={settings}
          allRepairs={repairs}
          onSave={handleSave}
          onCollectBalance={collectBalance}
          onRequestCancel={(r) => {
            setShowModal(false);
            setEditRepair(null);
            setCancelTarget(r);
          }}
          onClose={() => { setShowModal(false); setEditRepair(null); }}
          lang={lang}
          L={L}
        />
      )}

      {cancelTarget && (
        <CancelRepairModal
          repair={cancelTarget}
          customerHasPhone={!!cancelTarget.customerPhone}
          customerName={cancelTarget.customerName}
          lang={lang}
          onConfirm={(choice) => handleCancelRepair(cancelTarget, choice)}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </>
  );
}
