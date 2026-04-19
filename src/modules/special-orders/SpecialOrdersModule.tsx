// ============================================================
// CellHub Pro — Special Orders Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, AutocompleteInput } from '@/components/ui';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { persist, remove } from '@/services/persist';
import DepositModal from '@/components/DepositModal';
import { calcDepositTotals, reverseTaxFromPayment } from '@/utils/depositTax';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import TicketListLayout from '@/components/shared/TicketListLayout';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import TicketCard from '@/components/shared/TicketCard';
import CustomerSearchHeader from '@/components/shared/CustomerSearchHeader';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import type { SpecialOrder, CartItem, Customer } from '@/store/types';

// FIX Bug 1+2: Added In Transit, Received, Ready so those orders aren't invisible
const STATUSES = ['All', 'Ordered', 'In Transit', 'Received', 'Ready', 'Picked Up', 'Cancelled'];

const STATUS_BADGE: Record<string, string> = {
  Ordered: 'badge-info', ordered: 'badge-info',
  Arrived: 'badge-success', received: 'badge-success', ready: 'badge-success',
  'Picked Up': 'badge-neutral', picked_up: 'badge-neutral',
  Cancelled: 'badge-danger', cancelled: 'badge-danger',
  in_transit: 'badge-warning',
};

export default function SpecialOrdersModule() {
  const {
    state: { specialOrders, customers, settings, currentEmployee, cart, lang, globalSearchTerm },
    setSpecialOrders, setCustomers, setCart, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const L = getLabels(lang);

  const [search, setSearch] = useState(globalSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState('All');
  const [visibleCount, setVisibleCount] = useState(50);
  const [showModal, setShowModal] = useState(false);
  const [editOrder, setEditOrder] = useState<SpecialOrder | null>(null);
  const [form, setForm] = useState<Partial<SpecialOrder>>({});
  const [depositModalOrder, setDepositModalOrder] = useState<SpecialOrder | null>(null);

  // Refs to avoid stale closures in handlers (multi-station Firestore sync).
  // Setters from context don't accept function updaters, so we track the latest
  // committed state in refs and always build next-state from ref.current.
  const specialOrdersRef = useRef(specialOrders);
  const customersRef = useRef(customers);
  const cartRef = useRef(cart);
  useEffect(() => { specialOrdersRef.current = specialOrders; }, [specialOrders]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizeStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');

  const translateStatus = useCallback(
    (s: string) => {
      const map: Record<string, string> = {
        All: L.all,
        Ordered:     lang === 'es' ? 'Ordenado'   : 'Ordered',
        'In Transit': lang === 'es' ? 'En Tránsito' : 'In Transit',
        Received:    lang === 'es' ? 'Recibido'   : 'Received',
        Ready:       lang === 'es' ? 'Listo'       : 'Ready',
        'Picked Up': lang === 'es' ? 'Entregado'  : 'Picked Up',
        Cancelled:   L.cancelled,
      };
      return map[s] || s;
    }, [L, lang],
  );

  // FIX Bug 1+2: normalize both sides so each tab only matches its own status
  const filtered = useMemo(() => {
    return specialOrders
      .filter((o) => filterStatus === 'All' || normalizeStatus(o.status) === normalizeStatus(filterStatus))
      .filter((o) => matchesSearch(search, o.customerName, o.customerPhone, o.itemDescription, o.supplier))
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [specialOrders, filterStatus, search]);

  // FIX Bug 6: normalize status; only picked_up and cancelled are "done"
  // in_transit, received, ready are still active (order not yet delivered to customer)
  const DONE_SO_STATUSES = ['picked_up', 'cancelled'];
  const activeCount = useMemo(
    () => specialOrders.filter((o) => !DONE_SO_STATUSES.includes(normalizeStatus(o.status))).length,
    [specialOrders],
  );

  const openNew = () => {
    setEditOrder(null);
    setForm({
      firstName: '', lastName: '', customerPhone: '', itemDescription: '',
      supplier: '', cost: '' as any, price: '' as any, depositAmount: '' as any, balance: 0,
      status: 'ordered', notes: '', taxable: false,
    } as any);
    setShowModal(true);
  };

  const openEdit = (o: SpecialOrder) => {
    setEditOrder(o);
    const parts = (o.customerName || '').trim().split(' ');
    setForm({
      ...o,
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      cost: (o.cost ? (o.cost / 100).toFixed(2) : '') as any,
      price: (o.price ? (o.price / 100).toFixed(2) : '') as any,
      depositAmount: (o.depositAmount ? (o.depositAmount / 100).toFixed(2) : '') as any,
    });
    setShowModal(true);
  };

  const handleSave = useCallback(() => {
    const firstName = ((form as any).firstName || '').trim();
    const lastName  = ((form as any).lastName  || '').trim();
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName || !form.itemDescription?.trim()) return;
    const phoneLen = ((form as any).customerPhone || '').replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) { toast(lang === 'es' ? 'Teléfono debe ser 10 dígitos' : 'Phone must be 10 digits', 'error'); return; }

    const price = Math.round((parseFloat(form.price as any) || 0) * 100);
    const deposit = Math.round((parseFloat(form.depositAmount as any) || 0) * 100);
    const cost = Math.round((parseFloat(form.cost as any) || 0) * 100);
    const taxable = !!(form as any).taxable;
    const taxRate = settings.taxRate || 0.0925;
    // Use shared helper for totals — single source of truth across modules
    const _t = calcDepositTotals(price, deposit, taxRate, taxable);
    const balance = _t.balanceCents;
    // r-deposit-integrity-1 P1: balance on a NEW order must not reflect the
    // deposit yet — the deposit only exists in the cart until POS checkout
    // confirms. See POSModule.handleCompleteSale for the reconciliation step.
    const balanceBeforeDeposit = _t.totalWithTaxCents;

    // Auto-create customer — build next-state from ref, don't commit yet.
    // Collapsing create-customer + create-order into a single pass avoids the
    // stale-closure bug where two setCustomers/setSpecialOrders calls in sequence
    // could overwrite each other when the Firestore listener pushed an update
    // between them (same pattern as ReceiptModal handleCreateAndAssign fix).
    let workingCustomers = customersRef.current;
    let customersChanged = false;
    let persistCustomer: Customer | null = null;

    if (form.customerPhone) {
      const phone = normalizePhone(form.customerPhone);
      const existing = workingCustomers.find((c) => normalizePhone(c.phone) === phone);
      if (!existing && customerName) {
        // FIX: customer number uses full timestamp + random suffix (not .slice(-4))
        // to avoid collisions in multi-station environments. Same pattern as
        // PaymentModal invoice numbers and ReceiptModal create-and-assign.
        const ts = Date.now().toString().slice(-8);
        const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
        const newCust: Customer = {
          id: generateId(), firstName, lastName, name: customerName, phone: form.customerPhone || '',
          email: '', loyaltyPoints: 0, storeCredit: 0,
          customerNumber: `${settings.customerNumberPrefix || 'GC'}-${ts}-${rand}`,
          notes: '', smsConsent: false, createdAt: new Date().toISOString(),
        };
        workingCustomers = [...workingCustomers, newCust];
        customersChanged = true;
        persistCustomer = newCust;
      }
    }

    if (editOrder) {
      const updated: SpecialOrder = {
        ...editOrder, ...form, customerName, balance,
        cost, price, depositAmount: deposit,
        updatedAt: new Date().toISOString(),
      } as SpecialOrder;
      const nextOrders = specialOrdersRef.current.map((o) => (o.id === editOrder.id ? updated : o));
      specialOrdersRef.current = nextOrders;
      setSpecialOrders(nextOrders);
      persist.specialOrder(updated.id, updated as unknown as Record<string, unknown>);

      // Commit customer changes if any (edit-path rarely creates customer, but
      // the autocreate logic above still runs when phone is filled in)
      if (customersChanged) {
        customersRef.current = workingCustomers;
        setCustomers(workingCustomers);
        if (persistCustomer) {
          persist.customer(persistCustomer.id, persistCustomer as unknown as Record<string, unknown>);
        }
      }

      toast(L.saved || 'Saved!', 'success');
    } else {
      const newOrder: SpecialOrder = {
        id: generateId(), ...form, customerName,
        cost, price,
        // r-deposit-integrity-1: override form's depositAmount and balance.
        // The deposit lives in the cart until POS checkout confirms.
        depositAmount: 0,
        balance: balanceBeforeDeposit,
        status: form.status || 'ordered',
        employeeName: currentEmployee?.name,
        employeeId: currentEmployee?.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as SpecialOrder;
      const nextOrders = [...specialOrdersRef.current, newOrder];
      specialOrdersRef.current = nextOrders;
      setSpecialOrders(nextOrders);
      persist.specialOrder(newOrder.id, newOrder as unknown as Record<string, unknown>);

      // Commit customer changes if any (must happen BEFORE deposit cart add so
      // the customer exists in state when subsequent modules look it up)
      if (customersChanged) {
        customersRef.current = workingCustomers;
        setCustomers(workingCustomers);
        if (persistCustomer) {
          persist.customer(persistCustomer.id, persistCustomer as unknown as Record<string, unknown>);
        }
      }

      if (deposit > 0) {
        // Reverse-tax via shared helper: deposit cash is tax-inclusive,
        // split into pre-tax base + tax so cart adds tax and ends at exactly $deposit.
        const split = reverseTaxFromPayment(deposit, taxRate, taxable);
        const item: CartItem = {
          id: generateId(), name: `Special Order Deposit - ${form.itemDescription}`,
          category: 'service', price: split.baseCents, qty: 1,
          taxable, cbeEligible: false, specialOrderId: newOrder.id,
          notes: `For ${customerName}`,
        };
        const nextCart = [...cartRef.current, item];
        cartRef.current = nextCart;
        setCart(nextCart);
        toast('Deposit added to cart', 'info');
      }
      toast(L.specialOrderCreated || 'Special order created!', 'success');
    }

    setShowModal(false);
    setEditOrder(null);
  }, [form, editOrder, settings, currentEmployee, lang, L,
      setSpecialOrders, setCustomers, setCart, toast]);

  // NOTE: `collectBalance` was removed as dead code — the TicketCard's
  // onCollectBalance handler opens the DepositModal directly via
  // setDepositModalOrder, which has its own payment flow with proper
  // user-input validation. The old collectBalance function bypassed that
  // flow and marked orders as picked_up unconditionally.

  return (
    <>
      <TicketListLayout
        title={L.specialOrders || 'Special Orders'}
        icon="📋"
        statuses={STATUSES}
        activeStatus={filterStatus}
        onStatusChange={(s) => { setFilterStatus(s); setVisibleCount(50); }}
        translateStatus={translateStatus}
        // r-global-search: search props removed; GlobalSearchBar mounted via slot.
        globalSearchSlot={
          <GlobalSearchBar
            localValue={search}
            onLocalChange={(s) => { setSearch(s); setVisibleCount(50); }}
            excludeCollection="specialOrders"
            placeholder={lang === 'es' ? 'Buscar cliente, artículo, proveedor…' : 'Search customer, item, supplier…'}
          />
        }
        stats={[
          { label: L.active || 'Active', value: activeCount, color: 'text-blue-400' },
          { label: L.completed || 'Completed', value: specialOrders.filter((o) => normalizeStatus(o.status) === 'picked_up').length, color: 'text-emerald-400' },
          { label: L.total || 'Total', value: specialOrders.length },
        ]}
        onNew={openNew}
        newLabel={L.newOrder || 'New Order'}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-3">📋</span>
            <p>No special orders found</p>
          </div>
        ) : (
          filtered.slice(0, visibleCount).map((o) => (
            <TicketCard
              ref={isHighlighted(o.id) ? highlightRef : null}
              highlighted={isHighlighted(o.id)}
              key={o.id}
              ticketNumber={o.id.slice(-8).toUpperCase()}
              customerName={o.customerName}
              customerPhone={o.customerPhone}
              device={o.itemDescription}
              issue={o.supplier ? `Supplier: ${o.supplier}` : undefined}
              status={o.status}
              statusBadgeClass={STATUS_BADGE[o.status] || 'badge-neutral'}
              total={o.price || (o as any).totalPrice || (o as any).total}
              deposit={o.depositAmount}
              balance={o.balance}
              createdAt={o.createdAt as string}
              onClick={() => openEdit(o)}
              onCollectBalance={o.balance > 0 ? () => setDepositModalOrder(o) : undefined}
              onWhatsApp={settings.waEnabled !== false && o.customerPhone ? () => openWhatsApp(
                o.customerPhone,
                buildWaMessage(
                  ['received','ready','arrived'].includes(normalizeStatus(o.status)) ? 'specialOrderReady' : 'balanceDue',
                  {
                    customerName: o.customerName,
                    storeName: settings.storeName || 'Go Cellular',
                    storePhone: settings.storePhone,
                    itemDescription: o.itemDescription,
                    balance: o.balance > 0 ? `$${(o.balance / 100).toFixed(2)}` : undefined,
                  },
                  lang as 'en' | 'es',
                )
              ) : undefined}
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

      {/* Special Order Modal */}
      {showModal && (
        <SpecialOrderModal
          editOrder={editOrder}
          form={form}
          setForm={setForm}
          customers={customers}
          settings={settings}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditOrder(null); }}
          lang={lang}
          L={L}
        />
      )}
      {depositModalOrder && (
        <DepositModal
          title={lang === 'es' ? 'Cobrar Pedido Especial' : 'Collect Special Order Payment'}
          itemLabel={depositModalOrder.itemDescription || 'Special Order'}
          itemPrice={(depositModalOrder.price || 0) / 100}
          taxRate={settings.taxRate || 0.0925}
          taxable={!!(depositModalOrder as any).taxable}
          existingDeposit={(depositModalOrder.depositAmount || 0) / 100}
          mode="balance"
          lang={lang}
          onClose={() => setDepositModalOrder(null)}
          onConfirm={({ depositAmt }) => {
            const o = depositModalOrder;
            const amtCents = Math.round(depositAmt * 100);
            const taxable = !!(o as any).taxable;
            const taxRate = settings.taxRate || 0.0925;
            const split = reverseTaxFromPayment(amtCents, taxRate, taxable);
            const cartItem: CartItem = {
              id: generateId(),
              name: `${lang === 'es' ? 'Pago Pedido' : 'Special Order Payment'} — ${o.itemDescription || 'Item'}`,
              category: 'service',
              price: split.baseCents,
              qty: 1, taxable, cbeEligible: false,
              specialOrderId: o.id,
              notes: o.id.slice(-6).toUpperCase(),
            };
            const nextCart = [...cartRef.current, cartItem];
            cartRef.current = nextCart;
            setCart(nextCart);
            // r-pkg-b1: DO NOT update specialOrder balance/depositAmount here.
            // The POS checkout handler (POSModule.tsx §4b) reads the order from
            // state and applies deduction + persist when the sale completes.
            // Premature persist here caused double-deduction and false revenue
            // if the user cancelled checkout.
            setDepositModalOrder(null);
            toast(lang === 'es' ? `$${depositAmt.toFixed(2)} agregado al carrito` : `$${depositAmt.toFixed(2)} added to cart`, 'success');
          }}
        />
      )}
    </>
  );
}

// ── SpecialOrderModal ─────────────────────────────────────

interface SpecialOrderModalProps {
  editOrder: SpecialOrder | null;
  form: Partial<SpecialOrder>;
  setForm: (f: Partial<SpecialOrder>) => void;
  customers: Customer[];
  settings: import('@/store/types').StoreSettings;
  onSave: () => void;
  onClose: () => void;
  lang: string;
  L: Record<string, any>;
}

// FIX Bug 2: align modal statuses with filter tab values (normalized lowercase)
const SPECIAL_ORDER_STATUSES = ['ordered', 'in_transit', 'received', 'ready', 'picked_up', 'cancelled'];

function SpecialOrderModal({ editOrder, form, setForm, customers, settings, onSave, onClose, lang, L }: SpecialOrderModalProps) {
  const es = lang === 'es';
  const upd = (field: keyof SpecialOrder, val: any) => setForm({ ...form, [field]: val });

  // Dollar helpers for display (prices stored as dollar strings)
  const priceC = Math.round((parseFloat(form.price as any) || 0) * 100);
  const costC = Math.round((parseFloat(form.cost as any) || 0) * 100);
  const depositC = Math.round((parseFloat(form.depositAmount as any) || 0) * 100);
  const taxable  = !!(form as any).taxable;
  const taxRate  = settings.taxRate || 0.0925;
  const _formTotals = calcDepositTotals(priceC, depositC, taxRate, taxable);
  const taxC     = _formTotals.taxCents;
  const totalC   = _formTotals.totalWithTaxCents;
  const profitC  = priceC - costC;
  const balanceC = _formTotals.balanceCents;

  // firstName/lastName split autocomplete
  const firstNameOptions = useMemo(() =>
    customers.map((c) => {
      const parts = c.name.trim().split(' ');
      return { value: parts[0] || '', label: parts[0] || '', sublabel: c.phone, data: c };
    }).filter((o) => o.value.length > 0),
    [customers],
  );
  const lastNameOptions = useMemo(() => {
    const base = customers
      .filter((c) => !(form as any).firstName || c.name.toLowerCase().startsWith(((form as any).firstName || '').toLowerCase()))
      .map((c) => {
        const parts = c.name.trim().split(' ');
        const last = parts.slice(1).join(' ');
        return { value: last, label: last, sublabel: c.phone, data: c };
      }).filter((o) => o.value.length > 0);
    return base.filter((o, i, arr) => arr.findIndex((x) => x.label === o.label) === i);
  }, [customers, (form as any).firstName]);
  const phoneOptions = useMemo(() =>
    customers.map((c) => ({ value: c.phone || '', label: c.phone || '', sublabel: c.name, data: c }))
      .filter((o) => o.value.length > 0),
    [customers],
  );
  const phoneMatch = useMemo(() => {
    const digits = normalizePhone(form.customerPhone || '');
    if (digits.length < 7) return null;
    return customers.find((c) => normalizePhone(c.phone) === digits) || null;
  }, [form.customerPhone, customers]);
  const itemOptions = useMemo(() =>
    DEVICE_MODEL_OPTIONS.map((o) => o),
    [],
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '560px', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontWeight: 700 }}>
            📋 {editOrder ? (es ? 'Editar Pedido' : 'Edit Special Order') : (es ? 'Nuevo Pedido Especial' : 'New Special Order')}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

          {/* Customer */}
          {/* r-customer-picker-sweep: wrap customer inputs in shared
              CustomerSearchHeader for explicit "Select Customer" button. */}
          <CustomerSearchHeader
            customers={customers}
            lang={es ? 'es' : 'en'}
            onSelect={(c) => {
              const parts = c.name.trim().split(/\s+/);
              setForm({
                ...form,
                firstName: parts[0] || '',
                lastName: parts.slice(1).join(' ') || '',
                customerPhone: c.phone || '',
                customerName: c.name || '',
              } as any);
            }}
          >
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="label">👤 {es ? 'Nombre *' : 'First Name *'}</label>
                <AutocompleteInput
                  value={(form as any).firstName || ''}
                  onChange={(val) => setForm({ ...form, firstName: val } as any)}
                  onSelect={(opt) => {
                    setForm({ ...form, firstName: opt.value,
                      lastName: (form as any).lastName || (opt.data as Customer)?.name?.split(' ').slice(1).join(' ') || '',
                      customerPhone: form.customerPhone || (opt.data as Customer)?.phone || '',
                    } as any);
                  }}
                  options={firstNameOptions}
                  placeholder={es ? 'Jorge' : 'John'}
                  maxResults={6}
                />
              </div>
              <div>
                <label className="label">{es ? 'Apellido' : 'Last Name'}</label>
                <AutocompleteInput
                  value={(form as any).lastName || ''}
                  onChange={(val) => setForm({ ...form, lastName: val } as any)}
                  onSelect={(opt) => {
                    setForm({ ...form, lastName: opt.value,
                      firstName: (form as any).firstName || (opt.data as Customer)?.name?.split(' ')[0] || '',
                      customerPhone: form.customerPhone || (opt.data as Customer)?.phone || '',
                    } as any);
                  }}
                  options={lastNameOptions}
                  placeholder={es ? 'Ochoa' : 'Doe'}
                  maxResults={6}
                />
              </div>
            </div>

            {/* Phone */}
            <div style={{ marginTop: '0.75rem' }}>
              <label className="label">📞 {es ? 'Teléfono' : 'Phone'}</label>
              <AutocompleteInput
                type="tel"
                value={form.customerPhone || ''}
                onChange={(val) => upd('customerPhone', val)}
                onSelect={(opt) => {
                  upd('customerPhone', opt.value);
                  if (opt.data) upd('customerName', (opt.data as Customer).name || form.customerName || '');
                }}
                options={phoneOptions}
                placeholder="(805) 000-0000"
                maxResults={6}
                matchHint={phoneMatch ? (
                  <span style={{ fontSize: '0.72rem', color: '#34d399' }}>&#10003; {phoneMatch.name}</span>
                ) : undefined}
              />
            </div>
          </CustomerSearchHeader>

          {/* Item */}
          <div>
            <label className="label">📦 {es ? 'Artículo / Descripción' : 'Item / Description'} *</label>
            <AutocompleteInput
              value={form.itemDescription || ''}
              onChange={(val) => upd('itemDescription', val)}
              onSelect={(opt) => upd('itemDescription', opt.value)}
              options={itemOptions}
              placeholder={es ? 'iPhone 15 Pro 256GB Azul' : 'iPhone 15 Pro 256GB Blue'}
              maxResults={8}
            />
          </div>

          {/* Supplier */}
          <div>
            <label className="label">🏭 {es ? 'Proveedor' : 'Supplier'}</label>
            <input className="input" value={form.supplier || ''} onChange={(e) => upd('supplier', e.target.value)} placeholder={es ? 'Nombre del proveedor' : 'Supplier name'} />
          </div>

          {/* Status */}
          <div>
            <label className="label">{es ? 'Estado' : 'Status'}</label>
            <select className="select" value={form.status || 'ordered'} onChange={(e) => upd('status', e.target.value)}>
              {SPECIAL_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
              ))}
            </select>
          </div>

          {/* Pricing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">💵 {es ? 'Costo ($)' : 'Cost ($)'}</label>
              <input
                className="input" type="number" step="0.01" min="0"
                value={form.cost as any}
                onChange={(e) => upd('cost', e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="label">🏷️ {es ? 'Precio ($)' : 'Price ($)'} *</label>
              <input
                className="input" type="number" step="0.01" min="0"
                value={form.price as any}
                onChange={(e) => upd('price', e.target.value)}
                placeholder="0.00" style={{ fontWeight: 700 }}
              />
            </div>
            <div>
              <label className="label">💰 {es ? 'Depósito ($)' : 'Deposit ($)'}</label>
              <input
                className="input" type="number" step="0.01" min="0"
                value={form.depositAmount as any}
                onChange={(e) => upd('depositAmount', e.target.value)}
                placeholder="0.00" style={{ color: '#10b981', fontWeight: 700 }}
              />
              {/* r-pkg-b2: warn when editing deposit on existing order */}
              {editOrder && parseFloat(form.depositAmount as any || '0') > 0 && (
                <p style={{ fontSize: '0.68rem', color: '#f59e0b', marginTop: '0.35rem' }}>
                  ⚠️ {es
                    ? 'Cambiar el depósito aquí NO procesa un pago. Usa "Cobrar Balance" para registrar pagos por el POS.'
                    : 'Changing the deposit here does NOT process a payment. Use "Collect Balance" to record payments through the POS.'}
                </p>
              )}
            </div>
          </div>

          {/* Taxable toggle */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={taxable}
                onChange={(e) => upd('taxable' as any, e.target.checked)}
                style={{ width: '1rem', height: '1rem', cursor: 'pointer' }}
              />
              <span>🧾 {es ? `Cobrar impuestos (${(taxRate * 100).toFixed(2)}%)` : `Charge sales tax (${(taxRate * 100).toFixed(2)}%)`}</span>
            </label>
          </div>

          {/* Totals preview */}
          {priceC > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.875rem' }}>
              {costC > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                    <span>{es ? 'Costo' : 'Cost'}:</span><span>${(costC / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: profitC >= 0 ? '#10b981' : '#ef4444', padding: '0.2rem 0', fontWeight: 700 }}>
                    <span>📈 {es ? 'Ganancia' : 'Profit'}:</span>
                    <span>${(profitC / 100).toFixed(2)} {priceC > 0 && costC > 0 && <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>({((profitC / priceC) * 100).toFixed(1)}%)</span>}</span>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.3rem 0' }} />
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1', padding: '0.2rem 0' }}>
                <span>{es ? 'Precio' : 'Price'}:</span><span>${(priceC / 100).toFixed(2)}</span>
              </div>
              {taxable && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                  <span>+ {es ? 'Impuestos' : 'Tax'} ({(taxRate * 100).toFixed(2)}%):</span><span>+${(taxC / 100).toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#fff', padding: '0.25rem 0', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.2rem' }}>
                <span>{es ? 'Total' : 'Total'}:</span><span>${(totalC / 100).toFixed(2)}</span>
              </div>
              {depositC > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', padding: '0.2rem 0' }}>
                  <span>− {es ? 'Depósito' : 'Deposit'}:</span><span>−${(depositC / 100).toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: balanceC > 0 ? '#f59e0b' : '#10b981', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.35rem', marginTop: '0.25rem', fontSize: '1rem' }}>
                <span>= {es ? 'Balance' : 'Balance'}:</span><span>${(balanceC / 100).toFixed(2)}</span>
              </div>
              {taxable && depositC > 0 && (
                <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(59,130,246,0.08)', borderRadius: '0.4rem', fontSize: '0.72rem', color: '#93c5fd' }}>
                  💡 {es
                    ? `Del depósito $${(depositC / 100).toFixed(2)}: $${((depositC / (1 + taxRate)) / 100).toFixed(2)} subtotal + $${((depositC - depositC / (1 + taxRate)) / 100).toFixed(2)} impuestos`
                    : `Deposit $${(depositC / 100).toFixed(2)} breakdown: $${((depositC / (1 + taxRate)) / 100).toFixed(2)} subtotal + $${((depositC - depositC / (1 + taxRate)) / 100).toFixed(2)} tax`}
                </div>
              )}
            </div>
          )}

          {/* Estimated arrival */}
          <div>
            <label className="label">📅 {es ? 'Llegada Estimada' : 'Est. Arrival'}</label>
            <input className="input" type="date" value={form.estimatedArrival || ''} onChange={(e) => upd('estimatedArrival', e.target.value)} />
          </div>

          {/* Notes */}
          <div>
            <label className="label">📝 {es ? 'Notas' : 'Notes'}</label>
            <textarea className="input" rows={2} value={form.notes || ''} onChange={(e) => upd('notes', e.target.value)} placeholder={es ? 'Notas adicionales...' : 'Additional notes...'} style={{ resize: 'vertical' }} />
          </div>

          {!editOrder && depositC > 0 && (
            <div style={{ padding: '0.65rem 0.875rem', background: 'rgba(16,185,129,0.1)', borderRadius: '0.5rem', border: '1px solid rgba(16,185,129,0.3)', fontSize: '0.82rem', color: '#10b981' }}>
              💡 {es ? 'El depósito se agregará al carrito automáticamente.' : 'Deposit will be automatically added to cart.'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{L.cancel || 'Cancel'}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={onSave}>💾 {L.save || 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
