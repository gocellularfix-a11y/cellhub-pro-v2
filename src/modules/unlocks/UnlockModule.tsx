// ============================================================
// CellHub Pro — Unlock Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, SearchInput, AutocompleteInput } from '@/components/ui';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { sendSms } from '@/services/sms';
import { persist, remove } from '@/services/persist';
import DepositModal from '@/components/DepositModal';
import { calcDepositTotals, reverseTaxFromPayment } from '@/utils/depositTax';
import TicketListLayout from '@/components/shared/TicketListLayout';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import TicketCard from '@/components/shared/TicketCard';
import CustomerSearchHeader from '@/components/shared/CustomerSearchHeader';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { usePrint } from '@/hooks/usePrint';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import type { Unlock, UnlockType, CartItem, Customer } from '@/store/types';

const STATUSES = ['All', 'Received', 'Processing', 'Code Received', 'Completed', 'Cancelled', 'Failed'];

const STATUS_BADGE: Record<string, string> = {
  'Received': 'badge-info',
  'Processing': 'badge-warning',
  'Code Received': 'badge-success',
  'Completed': 'badge-success',
  'Cancelled': 'badge-danger',
  'Failed': 'badge-danger',
};

export default function UnlockModule() {
  const {
    state: { unlocks, customers, settings, currentEmployee, cart, lang, globalSearchTerm },
    setUnlocks, setCustomers, setCart, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const L = getLabels(lang);

  const unlocksRef = useRef(unlocks);
  useEffect(() => { unlocksRef.current = unlocks; }, [unlocks]);

  const [search, setSearch] = useState(globalSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState('All');
  const [visibleCount, setVisibleCount] = useState(50);
  const [showModal, setShowModal] = useState(false);
  const [editUnlock, setEditUnlock] = useState<Unlock | null>(null);
  const [depositModalUnlock, setDepositModalUnlock] = useState<Unlock | null>(null);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateStatus = useCallback(
    (s: string) => {
      const map: Record<string, string> = {
        All: L.all, Received: L.received, Processing: L.processing,
        'Code Received': L.codeReceived || 'Code Received',
        Completed: L.completed, Cancelled: L.cancelled, Failed: L.failed || 'Failed',
      };
      return map[s] || s;
    }, [L],
  );

  const normalizeStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');

  const filtered = useMemo(() => {
    return unlocks
      .filter((u) => filterStatus === 'All' || normalizeStatus(u.status) === normalizeStatus(filterStatus))
      .filter((u) => matchesSearch(search, u.customerName, u.customerPhone, u.device, u.imei, u.carrier))
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [unlocks, filterStatus, search]);

  const DONE_UNLOCK = ['completed', 'cancelled', 'failed'];
  const activeCount = useMemo(
    () => unlocks.filter((u) => !DONE_UNLOCK.includes(normalizeStatus(u.status))).length,
    [unlocks],
  );

  // ── Form state (inside modal) ───────────────────────────

  const [form, setForm] = useState<Partial<Unlock>>({});

  // ── Autocomplete options ─────────────────────────────────
  // firstName/lastName split autocomplete options
  const firstNameOptions = useMemo(() =>
    customers.map((c) => {
      const parts = c.name.trim().split(' ');
      return { value: parts[0] || '', label: parts[0] || '', sublabel: c.phone, data: c };
    }).filter((o) => o.value.length > 0),
    [customers],
  );
  const lastNameOptions = useMemo(() => {
    const base = customers
      .filter((c) => !form.firstName || c.name.toLowerCase().startsWith((form.firstName as string || '').toLowerCase()))
      .map((c) => {
        const parts = c.name.trim().split(' ');
        const last = parts.slice(1).join(' ');
        return { value: last, label: last, sublabel: c.phone, data: c };
      }).filter((o) => o.value.length > 0);
    return base.filter((o, i, arr) => arr.findIndex((x) => x.label === o.label) === i);
  }, [customers, form.firstName]);
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


  const openNew = () => {
    setEditUnlock(null);
    const today = new Date().toISOString().slice(0, 10);
    setForm({
      firstName: '', lastName: '', customerPhone: '', device: '', imei: '',
      carrier: '', price: 0, cost: 0, depositAmount: 0, balance: 0,
      status: 'Received', notes: '',
      unlockType: '', unlockCode: '', supplier: '',
      orderDate: today, completionDate: '',
      taxable: false,
    } as any);
    setShowModal(true);
  };

  const openEdit = (u: Unlock) => {
    setEditUnlock(u);
    // Storage is in cents — convert to dollars for the form inputs
    setForm({
      ...u,
      price: (u.price || 0) / 100,
      cost: (u.cost || 0) / 100,
      depositAmount: (u.depositAmount || 0) / 100,
    });
    setShowModal(true);
  };

  const handleSave = useCallback(() => {
    const firstName = (form.firstName as string || '').trim();
    const lastName  = (form.lastName  as string || '').trim();
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName) {
      toast(lang === 'es' ? 'Nombre del cliente requerido' : 'Customer name required', 'error');
      return;
    }
    if (!form.customerPhone?.trim()) {
      toast(lang === 'es' ? 'Teléfono requerido' : 'Phone required', 'error');
      return;
    }
    if (!form.device?.trim()) {
      toast(lang === 'es' ? 'Dispositivo requerido' : 'Device required', 'error');
      return;
    }

    // Form values are in DOLLARS — convert to cents for storage and calculations.
    // All persisted fields (price, cost, depositAmount, balance) are in CENTS,
    // matching the rest of the system (TicketCard, formatCurrency, DepositModal).
    const priceCents   = Math.round((form.price || 0) * 100);
    const costCents    = Math.round((form.cost || 0) * 100);
    const depositCents = Math.round((form.depositAmount || 0) * 100);
    const taxable = !!(form as any).taxable;
    const taxRate = settings.taxRate || 0.0925;
    const _t = calcDepositTotals(priceCents, depositCents, taxRate, taxable);
    const balance = _t.balanceCents;

    if (depositCents > _t.totalWithTaxCents + 1) {
      toast(lang === 'es' ? 'El depósito no puede exceder el total' : 'Deposit cannot exceed total', 'error');
      return;
    }

    const normalizedImei = (form.imei || '').replace(/\s+/g, '').trim();

    // Auto-create customer — dedup by phone
    if (form.customerPhone) {
      const phone = normalizePhone(form.customerPhone);
      const existing = customers.find((c) => normalizePhone(c.phone) === phone);
      if (existing) {
        if (existing.name.toLowerCase() !== customerName.toLowerCase()) {
          toast(
            lang === 'es'
              ? `Cliente existente encontrado: ${existing.name}`
              : `Existing customer found: ${existing.name}`,
            'info',
          );
        }
      } else if (customerName) {
        const newCust: Customer = {
          id: generateId(), firstName, lastName, name: customerName, phone: form.customerPhone,
          email: '', loyaltyPoints: 0, storeCredit: 0,
          customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-4)}`,
          notes: '', smsConsent: false, createdAt: new Date().toISOString(),
        };
        setCustomers([...customers, newCust]);
        persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
      }
    }

    if (editUnlock) {
      // Auto-set completionDate the first time it transitions to completed
      const justCompleted =
        form.status === 'Completed' && editUnlock.status !== 'Completed';
      const completionDate = justCompleted && !form.completionDate
        ? new Date().toISOString().slice(0, 10)
        : form.completionDate;

      const updated: Unlock = {
        ...editUnlock, ...form, customerName,
        // Override with cents — form values are dollars, storage is cents
        price: priceCents,
        cost: costCents,
        depositAmount: depositCents,
        balance,
        imei: normalizedImei,
        completionDate,
        updatedAt: new Date().toISOString(),
      } as Unlock;
      const nextUnlocks = unlocksRef.current.map((u) => (u.id === editUnlock.id ? updated : u));
      unlocksRef.current = nextUnlocks;
      setUnlocks(nextUnlocks);
        persist.unlock(updated.id, updated as unknown as Record<string, unknown>);

      // Auto-SMS on completion
      if (updated.status === 'Completed' && editUnlock.status !== 'Completed' &&
          settings.smsAutoUnlockReady && updated.customerPhone) {
        const codeLine = updated.unlockCode
          ? (lang === 'es' ? ` Código: ${updated.unlockCode}.` : ` Code: ${updated.unlockCode}.`)
          : '';
        const msg = lang === 'es'
          ? `Hola ${customerName}, su desbloqueo está listo.${codeLine} ${settings.storeName || 'CellHub Pro'}`
          : `Hi ${customerName}, your unlock is ready!${codeLine} ${settings.storeName || 'CellHub Pro'}`;
        sendSms(updated.customerPhone, msg, settings).catch(console.error);
      }
      toast(L.saved || 'Saved!', 'success');
    } else {
      const newUnlock: Unlock = {
        id: generateId(), ...form, customerName,
        // Override with cents — form values are dollars, storage is cents
        price: priceCents,
        cost: costCents,
        // r-deposit-integrity-1 P1: deposit lives in cart until POS checkout
        // confirms. Entity persists with depositAmount=0 and full balance.
        depositAmount: 0,
        balance: _t.totalWithTaxCents,
        imei: normalizedImei,
        status: form.status || 'Received',
        employeeName: currentEmployee?.name,
        employeeId: currentEmployee?.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Unlock;
      const nextUnlocks = [...unlocksRef.current, newUnlock];
      unlocksRef.current = nextUnlocks;
      setUnlocks(nextUnlocks);
        persist.unlock(newUnlock.id, newUnlock as unknown as Record<string, unknown>);

      // Deposit to cart — Option B: reverse-tax to pre-tax base + taxable flag
      if (depositCents > 0) {
        const split = reverseTaxFromPayment(depositCents, taxRate, taxable);
        const item: CartItem = {
          id: generateId(), name: `${newUnlock.device} - Unlock Deposit`,
          category: 'service', price: split.baseCents, qty: 1,
          taxable, cbeEligible: false, unlockId: newUnlock.id,
          notes: `Unlock for ${customerName}`,
        };
        setCart([...cart, item]);
        toast('Deposit added to cart', 'info');
      }
      toast(L.unlockCreated || 'Unlock created!', 'success');
    }

    setShowModal(false);
    setEditUnlock(null);
  }, [form, editUnlock, customers, settings, currentEmployee, cart, lang, L,
      setUnlocks, setCustomers, setCart, toast]);

  const collectBalance = useCallback((u: Unlock) => {
    if (!u.balance || u.balance <= 0) return;
    const taxable = !!(u as any).taxable;
    const taxRate = settings.taxRate || 0.0925;
    const split = reverseTaxFromPayment(u.balance, taxRate, taxable);
    const item: CartItem = {
      id: generateId(), name: `${u.device} - Unlock Balance`,
      category: 'service', price: split.baseCents, qty: 1,
      taxable, cbeEligible: false, unlockId: u.id,
      notes: `Balance for ${u.customerName}`,
    };
    setCart([...cart, item]);
    toast(`Balance ${formatCurrency(u.balance)} added to cart`, 'info');
  }, [cart, setCart, settings, toast]);

  // ── Print 4x6 thermal ticket ─────────────────────────────
  const printTicket = useCallback(() => {
    const storeName = settings.storeName || 'CellHub Pro';
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';
    const firstName = (form.firstName as string || '').trim();
    const lastName  = (form.lastName  as string || '').trim();
    const customerName = `${firstName} ${lastName}`.trim() || form.customerName || '';
    const fmt = (v: unknown) => v == null ? '' : String(v);
    const money = (v: number) => `$${(v / 100).toFixed(2)}`;
    const typeLabel = (t?: string) => {
      if (!t) return '';
      return ({ factory: 'Factory', imei: 'IMEI', subsidy: 'Subsidy', custom: 'Custom' } as Record<string, string>)[t] || t;
    };
    const ticketNum = editUnlock ? editUnlock.id.slice(-8).toUpperCase() : 'NEW';
    const lines = [
      storeName.toUpperCase(), storeAddr,
      storePhone, '----------------------------------------',
      `UNLOCK TICKET: ${ticketNum}`,
      `STATUS: ${fmt(form.status)}`,
      `DATE: ${new Date().toLocaleString()}`,
      '----------------------------------------',
      `CUSTOMER: ${customerName}`,
      form.customerPhone ? `PHONE: ${fmt(form.customerPhone)}` : '',
      '----------------------------------------',
      `DEVICE: ${fmt(form.device)}`,
      `CARRIER: ${fmt(form.carrier)}`,
      form.imei ? `IMEI: ${fmt(form.imei)}` : '',
      form.unlockType ? `TYPE: ${typeLabel(form.unlockType as string)}` : '',
      form.supplier ? `SUPPLIER: ${fmt(form.supplier)}` : '',
      form.unlockCode ? `CODE: ${fmt(form.unlockCode)}` : '',
      '----------------------------------------',
      form.orderDate ? `ORDERED: ${fmt(form.orderDate)}` : '',
      form.completionDate ? `COMPLETED: ${fmt(form.completionDate)}` : '',
      '----------------------------------------',
      `PRICE: ${money(Math.round((form.price || 0) * 100))}`,
      `DEPOSIT: ${money(Math.round((form.depositAmount || 0) * 100))}`,
      `BALANCE: ${money(Math.max(0, Math.round(((form.price || 0) - (form.depositAmount || 0)) * 100)))}`,
      '----------------------------------------',
      form.notes ? 'NOTES:' : '',
      form.notes ? fmt(form.notes) : '',
    ].filter(Boolean);
    const content = lines.join('\n');
    const html = `<!DOCTYPE html><html><head><title>Unlock Ticket</title><style>@page{size:4in 6in;margin:0}html,body{width:4in;height:6in;margin:0;padding:0}body{font-family:monospace}.paper{width:4in;height:6in;padding:.25in;box-sizing:border-box}pre{font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0}</style></head><body><div class="paper"><pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div></body></html>`;
    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });
  }, [form, editUnlock, settings, printHtml]);

  return (
    <>
      <TicketListLayout
        title={L.unlocks || 'Unlocks'}
        icon="🔓"
        statuses={STATUSES}
        activeStatus={filterStatus}
        onStatusChange={(s) => { setFilterStatus(s); setVisibleCount(50); }}
        translateStatus={translateStatus}
        // r-global-search: search props removed; GlobalSearchBar mounted via slot.
        globalSearchSlot={
          <GlobalSearchBar
            localValue={search}
            onLocalChange={(s) => { setSearch(s); setVisibleCount(50); }}
            excludeCollection="unlocks"
            placeholder={lang === 'es' ? 'Buscar cliente, dispositivo, IMEI, operador…' : 'Search customer, device, IMEI, carrier…'}
          />
        }
        stats={[
          { label: L.activeUnlocks || 'Active', value: activeCount, color: 'text-purple-400' },
          { label: L.completed || 'Completed', value: unlocks.filter((u) => normalizeStatus(u.status) === 'completed').length, color: 'text-emerald-400' },
          { label: L.total || 'Total', value: unlocks.length },
        ]}
        onNew={openNew}
        newLabel={L.newUnlock || 'New Unlock'}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-3">🔓</span>
            <p>No unlocks found</p>
          </div>
        ) : (
          filtered.slice(0, visibleCount).map((u) => (
            <TicketCard
              ref={isHighlighted(u.id) ? highlightRef : null}
              highlighted={isHighlighted(u.id)}
              key={u.id}
              ticketNumber={u.id.slice(-8).toUpperCase()}
              customerName={u.customerName}
              customerPhone={u.customerPhone}
              device={`${u.device} (${u.carrier})`}
              issue={u.imei ? `IMEI: ${u.imei}` : undefined}
              status={u.status}
              statusBadgeClass={STATUS_BADGE[u.status] || 'badge-neutral'}
              total={u.price}
              deposit={u.depositAmount}
              balance={u.balance}
              createdAt={u.createdAt as string}
              onClick={() => openEdit(u)}
              onCollectBalance={u.balance > 0 ? () => setDepositModalUnlock(u) : undefined}
              onWhatsApp={settings.waEnabled !== false && u.customerPhone ? () => openWhatsApp(
                u.customerPhone,
                buildWaMessage(
                  ['Completed', 'Code Received'].includes(u.status) ? 'repairReady' : 'balanceDue',
                  {
                    customerName: u.customerName,
                    storeName: settings.storeName || 'Go Cellular',
                    storePhone: settings.storePhone,
                    device: `${u.device} (${u.carrier})`,
                    balance: u.balance > 0 ? `$${(u.balance / 100).toFixed(2)}` : undefined,
                    ticketNumber: u.id.slice(-8).toUpperCase(),
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

      {/* Unlock Modal */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditUnlock(null); }}
        title={`🔓 ${editUnlock ? 'Edit Unlock' : 'New Unlock'}`}
        size="max-w-lg"
      >
        <div className="space-y-3">
          {/* r-customer-picker-sweep: wrap customer inputs in shared
              CustomerSearchHeader. The 3 AutocompleteInputs below are kept
              as-is — they still provide per-field autocomplete on top of
              the header search button. */}
          <CustomerSearchHeader
            customers={customers}
            lang={lang === 'es' ? 'es' : 'en'}
            onSelect={(c) => {
              const parts = c.name.trim().split(/\s+/);
              setForm({
                ...form,
                firstName: parts[0] || '',
                lastName: parts.slice(1).join(' ') || '',
                customerPhone: c.phone || '',
                customerName: c.name || '',
              });
            }}
          >
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Nombre *' : 'First Name *'}</label>
                <AutocompleteInput
                  value={(form.firstName as string) || ''}
                  onChange={(val) => setForm({ ...form, firstName: val })}
                  onSelect={(opt) => {
                    setForm({ ...form, firstName: opt.value,
                      lastName: (form.lastName as string) || (opt.data as Customer)?.name?.split(' ').slice(1).join(' ') || '',
                      customerPhone: (opt.data as Customer)?.phone || form.customerPhone || '' });
                  }}
                  options={firstNameOptions}
                  placeholder={lang === 'es' ? 'Jorge' : 'John'}
                  maxResults={6}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Apellido' : 'Last Name'}</label>
                <AutocompleteInput
                  value={(form.lastName as string) || ''}
                  onChange={(val) => setForm({ ...form, lastName: val })}
                  onSelect={(opt) => {
                    setForm({ ...form, lastName: opt.value,
                      firstName: (form.firstName as string) || (opt.data as Customer)?.name?.split(' ')[0] || '',
                      customerPhone: (opt.data as Customer)?.phone || form.customerPhone || '' });
                  }}
                  options={lastNameOptions}
                  placeholder={lang === 'es' ? 'Ochoa' : 'Doe'}
                  maxResults={6}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Phone</label>
                <AutocompleteInput
                  type="tel"
                  value={form.customerPhone || ''}
                  onChange={(val) => setForm({ ...form, customerPhone: val })}
                  onSelect={(opt) => {
                    setForm({ ...form, customerPhone: opt.value, customerName: (opt.data as Customer)?.name || form.customerName || '' });
                  }}
                  options={phoneOptions}
                  placeholder="(555) 123-4567"
                  maxResults={6}
                  matchHint={phoneMatch ? (
                    <span style={{ fontSize: '0.72rem', color: '#34d399' }}>&#10003; {phoneMatch.name}</span>
                  ) : undefined}
                />
              </div>
            </div>
          </CustomerSearchHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">IMEI</label>
              <input
                value={form.imei || ''}
                onChange={(e) => setForm({ ...form, imei: e.target.value })}
                className="input"
                maxLength={15}
                inputMode="numeric"
                placeholder="15 digits"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Device</label>
              <AutocompleteInput
                value={form.device || ''}
                onChange={(val) => setForm({ ...form, device: val })}
                onSelect={(opt) => setForm({ ...form, device: opt.value })}
                options={DEVICE_MODEL_OPTIONS}
                placeholder="iPhone 14 Pro"
                maxResults={8}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Carrier</label>
              <AutocompleteInput
                value={form.carrier || ''}
                onChange={(val) => setForm({ ...form, carrier: val })}
                onSelect={(opt) => setForm({ ...form, carrier: opt.value })}
                options={CARRIER_OPTIONS}
                placeholder="AT&T, T-Mobile..."
                maxResults={8}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Price ($)</label>
              <input type="number" value={form.price || ''} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} className="input" step="0.01" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Cost ($)</label>
              <input type="number" value={form.cost || ''} onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} className="input" step="0.01" placeholder="Supplier cost" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Deposit ($)</label>
              <input type="number" value={form.depositAmount || ''} onChange={(e) => setForm({ ...form, depositAmount: parseFloat(e.target.value) || 0 })} className="input" step="0.01" />
              {/* r-pkg-b2: warn when editing deposit on existing ticket */}
              {editUnlock && (form.depositAmount || 0) > 0 && (
                <p style={{ fontSize: '0.68rem', color: '#f59e0b', marginTop: '0.35rem' }}>
                  ⚠️ {lang === 'es'
                    ? 'Cambiar el depósito aquí NO procesa un pago. Usa "Cobrar Balance" para registrar pagos por el POS.'
                    : 'Changing the deposit here does NOT process a payment. Use "Collect Balance" to record payments through the POS.'}
                </p>
              )}
            </div>
          </div>

          {/* Unlock type + supplier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Tipo de desbloqueo' : 'Unlock Type'}</label>
              <select
                value={form.unlockType || ''}
                onChange={(e) => setForm({ ...form, unlockType: e.target.value as UnlockType })}
                className="select"
              >
                <option value="">—</option>
                <option value="factory">Factory</option>
                <option value="imei">IMEI</option>
                <option value="subsidy">Subsidy</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Proveedor' : 'Supplier'}</label>
              <input
                value={form.supplier || ''}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                className="input"
                placeholder="DoctorSIM, UnlockBoot..."
              />
            </div>
          </div>

          {/* Unlock code */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {lang === 'es' ? 'Código de desbloqueo' : 'Unlock Code'}
              <span className="text-slate-500 ml-1">({lang === 'es' ? 'del proveedor' : 'from supplier'})</span>
            </label>
            <input
              value={form.unlockCode || ''}
              onChange={(e) => setForm({ ...form, unlockCode: e.target.value })}
              className="input"
              placeholder="NCK / FRP bypass / Factory code..."
              style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
            />
          </div>

          {/* Dates + status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Fecha de orden' : 'Order Date'}</label>
              <input
                type="date"
                value={form.orderDate || ''}
                onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Fecha completado' : 'Completion Date'}</label>
              <input
                type="date"
                value={form.completionDate || ''}
                onChange={(e) => setForm({ ...form, completionDate: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Status</label>
              <select value={form.status || 'Received'} onChange={(e) => setForm({ ...form, status: e.target.value as any })} className="select">
                {['Received', 'Processing', 'Code Received', 'Completed', 'Cancelled', 'Failed'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Notes</label>
            <textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="textarea" rows={2} />
          </div>

          {/* Tax toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.08)' }}>
            <input
              type="checkbox"
              id="unlock-taxable"
              checked={!!(form as any).taxable}
              onChange={(e) => setForm({ ...form, taxable: e.target.checked } as any)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="unlock-taxable" style={{ fontSize: '0.82rem', color: '#cbd5e1', cursor: 'pointer' }}>
              {lang === 'es' ? `Aplicar impuesto (${((settings.taxRate || 0.0925) * 100).toFixed(2)}%)` : `Apply tax (${((settings.taxRate || 0.0925) * 100).toFixed(2)}%)`}
            </label>
            <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: 'auto' }}>
              {lang === 'es' ? 'Por defecto OFF' : 'Default OFF'}
            </span>
          </div>

          {/* Totals */}
          {(form.price || 0) > 0 && (() => {
            const previewPriceCents = Math.round((form.price || 0) * 100);
            const previewDepositCents = Math.round((form.depositAmount || 0) * 100);
            const _t = calcDepositTotals(previewPriceCents, previewDepositCents, settings.taxRate || 0.0925, !!(form as any).taxable);
            return (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', padding: '0.875rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 700, padding: '0.2rem 0' }}>
                <span>Service Price:</span><span>{formatCurrency(_t.subtotalCents)}</span>
              </div>
              {(form as any).taxable && _t.taxCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', padding: '0.2rem 0' }}>
                  <span>+ Tax ({((settings.taxRate || 0.0925) * 100).toFixed(2)}%):</span><span>+{formatCurrency(_t.taxCents)}</span>
                </div>
              )}
              {(form as any).taxable && _t.taxCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 700, padding: '0.2rem 0', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.25rem', paddingTop: '0.3rem' }}>
                  <span>Total w/ Tax:</span><span>{formatCurrency(_t.totalWithTaxCents)}</span>
                </div>
              )}
              {(form.depositAmount || 0) > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e', padding: '0.2rem 0' }}>
                    <span>− Deposit (paid):</span><span>−{formatCurrency(previewDepositCents)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', fontWeight: 800, fontSize: '0.95rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.25rem', paddingTop: '0.3rem' }}>
                    <span>= Balance Due:</span>
                    <span>{formatCurrency(_t.balanceCents)}</span>
                  </div>
                </>
              )}
            </div>
            );
          })()}
        </div>
        <div className="flex gap-3 mt-4 pt-4 border-t border-white/10">
          <button onClick={() => setShowModal(false)} className="btn btn-secondary flex-1">{L.cancel}</button>
          <button onClick={printTicket} className="btn btn-secondary flex-1" title={lang === 'es' ? 'Imprimir ticket 4x6' : 'Print 4x6 ticket'}>
            🖨️ {lang === 'es' ? 'Imprimir' : 'Print'}
          </button>
          <button onClick={handleSave} className="btn btn-primary flex-1">{editUnlock ? L.save : L.create}</button>
        </div>
      </Modal>

      {/* COLLECT BALANCE MODAL */}
      {depositModalUnlock && (
        <DepositModal
          title={lang === 'es' ? `Desbloqueo ${depositModalUnlock.id.slice(-8).toUpperCase()} — Cobrar` : `Unlock ${depositModalUnlock.id.slice(-8).toUpperCase()} — Collect`}
          itemLabel={`${depositModalUnlock.device} (${depositModalUnlock.carrier}) — Unlock`}
          itemPrice={(depositModalUnlock.price || 0) / 100}
          taxRate={settings.taxRate || 0.0925}
          taxable={!!(depositModalUnlock as any).taxable}
          existingDeposit={(depositModalUnlock.depositAmount || 0) / 100}
          mode="balance"
          lang={lang}
          onClose={() => setDepositModalUnlock(null)}
          onConfirm={() => {
            collectBalance(depositModalUnlock);
            setDepositModalUnlock(null);
          }}
        />
      )}
    </>
  );
}
