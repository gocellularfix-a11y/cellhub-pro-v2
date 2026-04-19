// ============================================================
// CellHub Pro — Customer Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { Modal, ConfirmDialog } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { normalizePhone, formatPhone } from '@/utils/normalize';
import { generateId, formatDate } from '@/utils/dates';
import type { Customer, Sale } from '@/store/types';
import { persist, remove } from '@/services/persist';

export default function CustomerModule() {
  // Round 18: extract `state` at root and destructure separately so we can also
  // read returns/appointments from the same state without calling useApp() again.
  // Old code called useApp() three times — each subscribed to the context and
  // forced extra re-renders.
  const app = useApp();
  const { state, setCustomers, dispatch } = app;
  const { customers, sales, repairs, unlocks, specialOrders, layaways, settings, lang, customerSearchTerm } = state;

  // returns and appointments live in localStorage (not AppState yet) — to be
  // lifted into the store in a future phase. For now we read them untyped and
  // narrow to a minimal shape inside getCustomerHistory below.
  const returns_      = (state as unknown as { returns?: unknown[] }).returns      || [];
  const appointments_ = (state as unknown as { appointments?: unknown[] }).appointments || [];

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord<HTMLTableRowElement>();
  const L = getLabels(lang);

  // Round 18: customersRef anti-stale-closure pattern (canonical project pattern).
  // setCustomers from AppProvider only accepts arrays (not functions), so handlers
  // that read `customers` from the closure can clobber concurrent updates from the
  // Firestore listener (multi-station sync). All write paths in this module read
  // customersRef.current and assign back before calling setCustomers.
  const customersRef = useRef(customers);
  useEffect(() => { customersRef.current = customers; }, [customers]);

  const [search, setSearch] = useState(customerSearchTerm || '');
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [viewHistory, setViewHistory] = useState<Customer | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteWarningMsg, setDeleteWarningMsg] = useState<string | null>(null);
  const [dupConfirm, setDupConfirm] = useState<{
    message: string;
    onMerge: () => void;
    onCreateNew: () => void;
  } | null>(null);
  const [showLapsedOnly, setShowLapsedOnly] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    title: string;
    variant?: 'danger' | 'warning' | 'default';
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  // Lapsed = no visit in 30+ days
  const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
  const lapsedCustomers = useMemo(() => customers.filter((c) => {
    const last = c.updatedAt
      ? new Date(c.updatedAt as string).getTime()
      : new Date(c.createdAt as string).getTime();
    return (Date.now() - last) > DAYS_30;
  }), [customers]);

  // Clear cross-module search after first render (was wrongly written with useState)
  useEffect(() => {
    if (customerSearchTerm) dispatch({ type: 'SET_CUSTOMER_SEARCH', payload: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return customers
      .filter((c) => {
        if (showLapsedOnly) {
          const last = c.updatedAt
            ? new Date(c.updatedAt as string).getTime()
            : new Date(c.createdAt as string).getTime();
          if ((Date.now() - last) <= DAYS_30) return false;
        }
        // Base fuzzy match on common fields
        if (matchesSearch(search, c.name, c.phone, c.email, c.customerNumber, (c as any).carrier, (c as any).plan, (c as any).address)) {
          return true;
        }
        // Also search secondary phones[] if present
        const phones = (c as any).phones;
        if (search && Array.isArray(phones) && phones.length > 0) {
          const sDigits = search.replace(/\D/g, '');
          if (sDigits.length >= 3) {
            for (const p of phones) {
              if (p && String(p).replace(/\D/g, '').includes(sDigits)) return true;
            }
          }
        }
        return !search;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, search, showLapsedOnly]);

  // Customer purchase history — all transaction types
  const getCustomerHistory = useCallback(
    (customer: Customer) => {
      const phone = normalizePhone(customer.phone);
      const id    = customer.id;

      // Sales: match by customerId OR by customerPhone (fallback for unlinked sales)
      const customerSales = sales
        .filter((s) =>
          s.status === 'completed' &&
          (s.customerId === id || normalizePhone(s.customerPhone || '') === phone)
        )
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerRepairs = repairs
        .filter((r) => (r as any).customerId === id || normalizePhone(r.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerLayaways = layaways
        .filter((l) => (l as any).customerId === id || normalizePhone(l.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerUnlocks = unlocks
        .filter((u) => (u as any).customerId === id || normalizePhone(u.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerSpecialOrders = specialOrders
        .filter((o) => (o as any).customerId === id || normalizePhone(o.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerReturns = returns_
        .filter((r: any) =>
          r.customerId === id || normalizePhone(r.customerPhone || '') === phone
        )
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const customerAppointments = appointments_
        .filter((a: any) => normalizePhone(a.customerPhone || '') === phone)
        .sort((a: any, b: any) => new Date(b.date || b.scheduledAt || 0).getTime() - new Date(a.date || a.scheduledAt || 0).getTime());

      return {
        sales: customerSales,
        repairs: customerRepairs,
        layaways: customerLayaways,
        unlocks: customerUnlocks,
        specialOrders: customerSpecialOrders,
        returns: customerReturns,
        appointments: customerAppointments,
      };
    },
    [sales, repairs, layaways, unlocks, specialOrders, returns_, appointments_],
  );

  // ── Per-customer sales stats (precomputed for table columns) ──
  const customerStats = useMemo(() => {
    const map = new Map<string, { totalSpent: number; visits: number; lastVisit: string }>();
    for (const c of customers) {
      const phone = normalizePhone(c.phone);
      const id = c.id;
      const mySales = sales.filter((s) =>
        s.status === 'completed' &&
        (s.customerId === id || normalizePhone(s.customerPhone || '') === phone),
      );
      const totalSpent = mySales.reduce((sum, s) => sum + (s.total || 0), 0);
      const visits = mySales.length;
      let lastVisit = '';
      if (mySales.length > 0) {
        const sorted = mySales.map((s) => new Date(s.createdAt as string).getTime()).sort((a, b) => b - a);
        lastVisit = new Date(sorted[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      map.set(c.id, { totalSpent, visits, lastVisit });
    }
    return map;
  }, [customers, sales]);

  // ── CRUD ────────────────────────────────────────────────
  const handleSave = useCallback(
    (data: Partial<Customer>) => {
      const firstName = (data.firstName || '').trim();
      const lastName  = (data.lastName  || '').trim();
      const composedName = `${firstName} ${lastName}`.trim() || data.name || '';

      if (editCustomer) {
        const updated: Customer = {
          ...editCustomer,
          ...data,
          firstName: firstName || editCustomer.firstName,
          lastName:  lastName  || editCustomer.lastName,
          name: composedName || editCustomer.name,
          updatedAt: new Date().toISOString(),
        };
        // Round 18: read from ref to avoid stale-closure clobber on multi-station sync
        const nextCustomers = customersRef.current.map((c) => c.id === editCustomer.id ? updated : c);
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(updated.id, updated as unknown as Record<string, unknown>);
        toast(L.saved || 'Saved!', 'success');
      } else {
        // Duplicate detection — by phone (last 10 digits) or by first+last name.
        // Round 18: search baseline reads customersRef.current so dup-check sees
        // any concurrent customers added by another station between renders.
        const newFirst = firstName.toLowerCase();
        const newLast  = lastName.toLowerCase();
        const newPhone = normalizePhone(data.phone || '');
        const baseCustomers = customersRef.current;

        const existingByPhone = newPhone.length >= 10 ? baseCustomers.find((c) => {
          // Check primary phone
          const cPhone = normalizePhone(c.phone || '');
          if (cPhone.length >= 10 && cPhone.slice(-10) === newPhone.slice(-10)) return true;
          // Also check secondary phones[] array
          const cPhones = (c as any).phones;
          if (Array.isArray(cPhones)) {
            for (const p of cPhones) {
              const pNorm = normalizePhone(p || '');
              if (pNorm.length >= 10 && pNorm.slice(-10) === newPhone.slice(-10)) return true;
            }
          }
          return false;
        }) : null;

        const existingByName = !existingByPhone && newFirst ? baseCustomers.find((c) => {
          const cFirst = (c.firstName || '').trim().toLowerCase();
          const cLast  = (c.lastName  || '').trim().toLowerCase();
          if (newFirst && newLast && cFirst === newFirst && cLast === newLast) return true;
          return false;
        }) : null;

        const existing = existingByPhone || existingByName;
        if (existing) {
          const matchType = existingByPhone
            ? (lang === 'es' ? 'teléfono' : 'phone')
            : (lang === 'es' ? 'nombre' : 'name');
          const existName = `${existing.firstName || ''} ${existing.lastName || ''}`.trim() || existing.name;
          const existPhone = existing.phone ? formatPhone(existing.phone) : 'N/A';
          // Show merge/create dialog instead of blocking confirm()
          const doMerge = () => {
            const existingPhones = Array.isArray((existing as any).phones) ? (existing as any).phones : (existing.phone ? [existing.phone] : []);
            const incomingPhones = Array.isArray((data as any).phones) ? (data as any).phones : (data.phone ? [data.phone] : []);
            const mergedPhones = Array.from(new Set([...existingPhones, ...incomingPhones].map((p) => normalizePhone(p)).filter(Boolean)));
            const merged: Customer = {
              ...existing,
              ...data,
              id: existing.id,
              customerNumber: existing.customerNumber,
              createdAt: existing.createdAt,
              firstName: firstName || existing.firstName,
              lastName: lastName || existing.lastName,
              name: composedName || existing.name,
              phones: mergedPhones,
              updatedAt: new Date().toISOString(),
            } as Customer;
            const mergedNext = customersRef.current.map((c) => c.id === existing.id ? merged : c);
            customersRef.current = mergedNext;
            setCustomers(mergedNext);
            persist.customer(merged.id, merged as unknown as Record<string, unknown>);
            toast(lang === 'es' ? 'Cliente actualizado' : 'Customer updated', 'success');
            setShowModal(false);
            setEditCustomer(null);
          };
          setDupConfirm({
            message: lang === 'es'
              ? `⚠️ Ya existe un cliente con el mismo ${matchType}.\n\nCliente: ${existName}\nTeléfono: ${existPhone}\n\n¿Actualizar existente o crear nuevo?`
              : `⚠️ A customer with the same ${matchType} already exists.\n\nCustomer: ${existName}\nPhone: ${existPhone}\n\nUpdate existing or create new?`,
            onMerge: doMerge,
            onCreateNew: () => {
              setDupConfirm(null);
            },
          });
          return; // Wait for user choice via dialog
        }

        // Multi-station safe customer number — slice(-8) for timestamp + 4 random chars.
        // Pattern: ${prefix}-${ts8}-${rand4}. Round 18 fix — old slice(-4) collided
        // every ~10 seconds across the two stations syncing through Firestore.
        const ts8 = Date.now().toString().slice(-8);
        const rand4 = Math.random().toString(36).slice(2, 6).toUpperCase();
        const custNum = `${settings.customerNumberPrefix || 'GC'}-${ts8}-${rand4}`;
        // Referral code: prefix + 4 random chars (independent of customerNumber so it
        // stays short enough for the maxLength={10} input). Example: GC7K9X.
        const referralRand = Math.random().toString(36).slice(2, 6).toUpperCase();
        const referralCode = `${settings.customerNumberPrefix || 'GC'}${referralRand}`;

        const { firstName: _df, lastName: _dl, name: _dn, ...dataRest } = data;
        const newCustomer: Customer = {
          id: generateId(),
          phone: data.phone || '',
          email: data.email || '',
          loyaltyPoints: 0,
          storeCredit: 0,
          customerNumber: custNum,
          notes: data.notes || '',
          smsConsent: data.smsConsent ?? false,
          createdAt: new Date().toISOString(),
          ...dataRest,
          // Canonical name fields — placed last so nothing in dataRest overrides them
          firstName,
          lastName,
          name: composedName,
          referralCode,
        };

        // If a referral code was provided, award bonus points to both parties.
        // Round 18: collapsed single-pass through customersRef so referrer update +
        // new customer add commit in one setCustomers call without stale-closure risk.
        const usedCode = data.referredBy?.trim().toUpperCase();
        let workingCustomers = customersRef.current;
        if (usedCode && settings.loyaltyEnabled) {
          const referrer = workingCustomers.find(
            (c) => c.referralCode?.toUpperCase() === usedCode,
          );
          if (referrer) {
            const REFERRAL_BONUS = 50; // 50 points to each party
            const updatedReferrer: Customer = {
              ...referrer,
              loyaltyPoints: (referrer.loyaltyPoints || 0) + REFERRAL_BONUS,
              updatedAt: new Date().toISOString(),
            };
            workingCustomers = workingCustomers.map((c) => c.id === referrer.id ? updatedReferrer : c);
            persist.customer(referrer.id, updatedReferrer as unknown as Record<string, unknown>);
            newCustomer.loyaltyPoints = REFERRAL_BONUS;
            toast(
              lang === 'es'
                ? `Referido válido — +${REFERRAL_BONUS} pts para ambos`
                : `Valid referral — +${REFERRAL_BONUS} pts awarded to both`,
              'success',
            );
          }
        }

        const finalCustomers = [...workingCustomers, newCustomer];
        customersRef.current = finalCustomers;
        setCustomers(finalCustomers);
        persist.customer(newCustomer.id, newCustomer as unknown as Record<string, unknown>);
        if (!usedCode || !settings.loyaltyEnabled) {
          toast(lang === 'es' ? 'Cliente agregado' : 'Customer added!', 'success');
        }
      }
      setShowModal(false);
      setEditCustomer(null);
    },
    [editCustomer, customers, settings, lang, L, setCustomers, toast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const cust = customers.find((c) => c.id === id);
      if (!cust) return;

      // Check for active ties before allowing delete
      const phone = normalizePhone(cust.phone || '');
      const hasStoreCredit = (cust.storeCredit || 0) > 0;
      const hasLoyalty     = (cust.loyaltyPoints || 0) > 0;
      const activeRepairs  = repairs.filter((r) =>
        ((r as any).customerId === id || normalizePhone(r.customerPhone) === phone) &&
        !['Complete', 'completed', 'Cancelled', 'cancelled'].includes(r.status || '')
      ).length;
      const activeLayaways = layaways.filter((l) =>
        ((l as any).customerId === id || normalizePhone(l.customerPhone) === phone) &&
        l.status === 'active'
      ).length;
      const activeUnlocks = unlocks.filter((u) =>
        ((u as any).customerId === id || normalizePhone(u.customerPhone) === phone) &&
        !['completed', 'Complete', 'failed', 'cancelled', 'Cancelled'].includes(u.status || '')
      ).length;

      const warnings: string[] = [];
      if (hasStoreCredit) warnings.push(`• ${formatCurrency(cust.storeCredit || 0)} ${lang === 'es' ? 'en crédito de tienda' : 'in store credit'}`);
      if (hasLoyalty)     warnings.push(`• ${cust.loyaltyPoints} ${lang === 'es' ? 'puntos de lealtad' : 'loyalty points'}`);
      if (activeRepairs)  warnings.push(`• ${activeRepairs} ${lang === 'es' ? 'reparación(es) activa(s)' : 'active repair(s)'}`);
      if (activeLayaways) warnings.push(`• ${activeLayaways} ${lang === 'es' ? 'apartado(s) activo(s)' : 'active layaway(s)'}`);
      if (activeUnlocks)  warnings.push(`• ${activeUnlocks} ${lang === 'es' ? 'desbloqueo(s) activo(s)' : 'active unlock(s)'}`);

      if (warnings.length > 0) {
        const msg = lang === 'es'
          ? `⚠️ ATENCIÓN: Este cliente tiene:\n\n${warnings.join('\n')}\n\nSi lo eliminas, se perderá esta información. ¿Continuar de todos modos?`
          : `⚠️ WARNING: This customer has:\n\n${warnings.join('\n')}\n\nDeleting will lose this information. Continue anyway?`;
        setDeleteWarningMsg(msg);
        return; // Wait for ConfirmDialog
      }

      // No warnings — delete directly
      const nextCustomers = customersRef.current.filter((c) => c.id !== id);
      customersRef.current = nextCustomers;
      setCustomers(nextCustomers);
      remove.customer(id);
      setDeleteConfirm(null);
      toast(lang === 'es' ? 'Eliminado' : 'Deleted', 'info');
    },
    [customers, repairs, layaways, unlocks, setCustomers, toast, lang],
  );

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">👤 {L.customers}</h1>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // Build CSV for TextMagic / any SMS platform.
                // Clients with multiple phones get one row per number (so bulk SMS
                // reaches all their lines, not just the primary).
                const rows = [['First Name', 'Last Name', 'Phone', 'Email', 'SMS Consent', 'Carrier', 'Plan', 'Store Credit']];
                customers.forEach((c) => {
                  // Collect every phone: primary + phones[] array, dedup
                  const allPhones = new Set<string>();
                  if (c.phone) allPhones.add(String(c.phone).replace(/\D/g, ''));
                  const extra = (c as any).phones;
                  if (Array.isArray(extra)) {
                    for (const p of extra) {
                      if (p) allPhones.add(String(p).replace(/\D/g, ''));
                    }
                  }
                  const carriers = (c as any).carriers || [];
                  let idx = 0;
                  for (let phone of allPhones) {
                    if (!phone) { idx++; continue; }
                    if (phone.length === 10) phone = '+1' + phone;
                    else if (phone.length === 11 && phone[0] === '1') phone = '+' + phone;
                    rows.push([
                      c.firstName || (c.name || '').split(' ')[0] || '',
                      c.lastName || (c.name || '').split(' ').slice(1).join(' ') || '',
                      phone,
                      c.email || '',
                      c.smsConsent ? 'Yes' : 'No',
                      carriers[idx] || (c as any).carrier || '',
                      (c as any).plan || '',
                      ((c.storeCredit || 0) / 100).toFixed(2),
                    ]);
                    idx++;
                  }
                });
                const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast(lang === 'es' ? 'CSV exportado' : 'CSV exported', 'success');
              }}
              className="btn btn-secondary"
            >
              ⬇ {lang === 'es' ? 'Exportar CSV' : 'Export CSV'}
            </button>
            <button onClick={() => { setEditCustomer(null); setShowModal(true); }} className="btn btn-primary">
              + {lang === 'es' ? 'Nuevo Cliente' : 'New Customer'}
            </button>
          </div>
        </div>

        {/* Stats — hybrid 4-card: Total / Lapsed / StoreCredit / Revenue */}
        <div className="grid grid-cols-4 gap-4">
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{L.totalCustomers}</p>
            <p className="text-2xl font-bold text-white mt-1">{customers.length}</p>
          </div>
          <div className="stat-card" style={{ cursor: lapsedCustomers.length > 0 ? 'pointer' : 'default' }} onClick={() => lapsedCustomers.length > 0 && setShowLapsedOnly(!showLapsedOnly)}>
            <p className="text-xs text-slate-400 uppercase">{lang === 'es' ? 'Sin visita 30+ días' : 'Lapsed 30+ days'}</p>
            <p className={`text-2xl font-bold mt-1 ${lapsedCustomers.length > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
              {lapsedCustomers.length}
            </p>
            {lapsedCustomers.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">{lang === 'es' ? 'Clic para filtrar' : 'Click to filter'}</p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{lang === 'es' ? 'Crédito en Tienda' : 'Store Credit'}</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              {formatCurrency(customers.reduce((sum, c) => sum + (c.storeCredit || 0), 0))}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {customers.filter((c) => (c.storeCredit || 0) > 0).length} {lang === 'es' ? 'clientes' : 'customers'}
            </p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{lang === 'es' ? 'Ingresos Totales' : 'Total Revenue'}</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">
              {formatCurrency(sales.filter((s) => s.status === 'completed').reduce((sum, s) => sum + (s.total || 0), 0))}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            {/* r-global-search: SYNCED mode — local `search` state still
                drives the filtered list (preserving secondary phones[] match
                logic in the memo below) AND the dropdown opens for the other
                7 collections. excludeCollection='customers' avoids redundancy. */}
            <GlobalSearchBar
              localValue={search}
              onLocalChange={setSearch}
              excludeCollection="customers"
              placeholder={L.searchPlaceholder}
            />
          </div>
          {lapsedCustomers.length > 0 && (
            <button
              onClick={() => setShowLapsedOnly(!showLapsedOnly)}
              style={{
                padding: '0.5rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.8rem', fontWeight: 600,
                border: `1px solid ${showLapsedOnly ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'}`,
                background: showLapsedOnly ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                color: showLapsedOnly ? '#fbbf24' : '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              ⏰ {lang === 'es' ? `Inactivos (${lapsedCustomers.length})` : `Lapsed (${lapsedCustomers.length})`}
            </button>
          )}
        </div>

        {/* Table */}
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>{L.name || 'NAME'}</th>
                <th>{lang === 'es' ? 'TELÉFONO' : 'PHONE'}</th>
                <th>{lang === 'es' ? 'COMPAÑÍA' : 'CARRIER'}</th>
                <th>{lang === 'es' ? 'PLAN' : 'PLAN'}</th>
                <th className="text-right">{lang === 'es' ? 'TOTAL GASTADO' : 'TOTAL SPENT'}</th>
                <th className="text-center">{lang === 'es' ? 'VISITAS' : 'VISITS'}</th>
                <th>{lang === 'es' ? 'ÚLTIMA VISITA' : 'LAST VISIT'}</th>
                <th className="text-right">{lang === 'es' ? 'ACCIONES' : 'ACTIONS'}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-500">{lang === 'es' ? 'No se encontraron clientes' : 'No customers found'}</td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id}
                    ref={isHighlighted(c.id) ? highlightRef : null}
                    style={isHighlighted(c.id) ? { outline: '2px solid #667eea', background: 'rgba(102,126,234,0.1)' } : undefined}>
                    <td>
                      <p className="text-sm text-white font-medium">{c.name}</p>
                      {(() => {
                        const stats = customerStats.get(c.id);
                        // r-audit-r3: only show lapsed badge when there IS purchase history.
                        // Customers with no v2 sales show nothing instead of misleading "999d".
                        if (!stats?.lastVisit) return null;
                        const daysAgo = Math.floor((Date.now() - new Date(stats.lastVisit).getTime()) / (24 * 60 * 60 * 1000));
                        if (daysAgo >= 30) {
                          return <p className="text-xs text-amber-500 mt-0.5">⏰ {daysAgo}d</p>;
                        }
                      })()}
                    </td>
                    <td className="text-sm text-slate-300">{formatPhone(c.phone)}</td>
                    <td className="text-sm text-slate-400">{c.carrier || '—'}</td>
                    <td className="text-sm text-slate-400">{c.plan || '—'}</td>
                    <td className="text-right">
                      {(() => {
                        const stats = customerStats.get(c.id);
                        const spent = stats?.totalSpent || 0;
                        return spent > 0
                          ? <span className="text-emerald-400 font-semibold">{formatCurrency(spent)}</span>
                          : <span className="text-slate-600">—</span>;
                      })()}
                    </td>
                    <td className="text-center">
                      {(() => {
                        const v = customerStats.get(c.id)?.visits || 0;
                        return v > 0
                          ? <span style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>{v}</span>
                          : <span className="text-slate-600">—</span>;
                      })()}
                    </td>
                    <td className="text-sm text-slate-400">{customerStats.get(c.id)?.lastVisit || '—'}</td>
                    <td className="text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            dispatch({ type: 'SET_PENDING_PHONE_PAYMENT_CUSTOMER', payload: c.id });
                            dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
                          }}
                          title={lang === 'es' ? 'Pago de teléfono' : 'Phone Payment'}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 800, background: 'rgba(34,197,94,0.3)', color: '#22c55e' }}
                        >$</button>
                        <button
                          onClick={() => {
                            const phone = (c.phone || '').replace(/\D/g, '');
                            if (phone) window.open(`https://wa.me/1${phone}`, '_blank');
                          }}
                          title="WhatsApp"
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(59,130,246,0.3)', color: '#3b82f6' }}
                        >💬</button>
                        <button
                          onClick={() => setViewHistory(c)}
                          title={lang === 'es' ? 'Ver historial' : 'View history'}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(139,92,246,0.3)', color: '#8b5cf6' }}
                        >👁</button>
                        <button
                          onClick={() => { setEditCustomer(c); setShowModal(true); }}
                          title={lang === 'es' ? 'Editar' : 'Edit'}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(245,158,11,0.25)', color: '#f59e0b' }}
                        >✏️</button>
                        <button
                          onClick={() => setDeleteConfirm(c.id)}
                          title={lang === 'es' ? 'Eliminar' : 'Delete'}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(239,68,68,0.25)', color: '#ef4444' }}
                        >🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <CustomerFormModal
          customer={editCustomer}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditCustomer(null); }}
          lang={lang} L={L}
          toast={toast}
          confirmDialog={confirmDialog}
          setConfirmDialog={setConfirmDialog}
        />
      )}

      {/* History Modal */}
      {viewHistory && (() => {
        const history = getCustomerHistory(viewHistory);
        return (
          <CustomerHistoryModal
            customer={viewHistory}
            sales={history.sales}
            repairs={history.repairs}
            layaways={history.layaways}
            unlocks={history.unlocks}
            specialOrders={history.specialOrders}
            returns={history.returns}
            appointments={history.appointments}
            onClose={() => setViewHistory(null)}
            lang={lang} L={L} settings={settings}
          />
        );
      })()}

      <ConfirmDialog
        open={!!deleteConfirm || !!deleteWarningMsg}
        title={L.delete || 'Delete'}
        message={deleteWarningMsg || (lang === 'es' ? '¿Eliminar este cliente?' : 'Delete this customer?')}
        variant="danger"
        confirmLabel={lang === 'es' ? 'Eliminar' : 'Delete'}
        cancelLabel={lang === 'es' ? 'Cancelar' : 'Cancel'}
        onConfirm={() => {
          if (deleteWarningMsg && deleteConfirm) {
            // User confirmed after seeing warnings — proceed with delete
            const nextCustomers = customersRef.current.filter((c) => c.id !== deleteConfirm);
            customersRef.current = nextCustomers;
            setCustomers(nextCustomers);
            remove.customer(deleteConfirm);
            toast(lang === 'es' ? 'Eliminado' : 'Deleted', 'info');
          } else if (deleteConfirm) {
            handleDelete(deleteConfirm);
          }
          setDeleteConfirm(null);
          setDeleteWarningMsg(null);
        }}
        onCancel={() => { setDeleteConfirm(null); setDeleteWarningMsg(null); }}
      />
      {dupConfirm && (
        <ConfirmDialog
          open
          title={lang === 'es' ? 'Cliente Duplicado' : 'Duplicate Customer'}
          message={dupConfirm.message}
          variant="warning"
          confirmLabel={lang === 'es' ? 'Actualizar Existente' : 'Update Existing'}
          cancelLabel={lang === 'es' ? 'Crear Nuevo' : 'Create New'}
          onConfirm={() => { dupConfirm.onMerge(); setDupConfirm(null); }}
          onCancel={() => { dupConfirm.onCreateNew(); setDupConfirm(null); }}
        />
      )}
    </>
  );
}

// ── Customer Form ─────────────────────────────────────────

const CARRIER_OPTIONS_LIST = ['AT&T', 'T-Mobile', 'Verizon', 'Cricket', 'Metro', 'Boost', 'Simple Mobile', 'H2O', 'Page Plus', 'Ultra Mobile', 'Tracfone', 'Other'];
const MONTHLY_PAYMENT_PRESETS = ['25.00', '30.00', '35.00', '40.00', '45.00', '50.00', '55.00', '60.00', '65.00', '70.00', '75.00', '80.00', '100.00'];
const DRAFT_KEY = 'customer_form_draft';

interface CustomerFormModalProps {
  customer: Customer | null;
  onSave: (d: Partial<Customer>) => void;
  onClose: () => void;
  lang: string;
  L: Record<string, any>;
  toast?: (msg: string, type?: 'info' | 'success' | 'error') => void;
  confirmDialog?: {
    message: string;
    title: string;
    variant?: 'danger' | 'warning' | 'default';
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  } | null;
  setConfirmDialog?: React.Dispatch<React.SetStateAction<{
    message: string;
    title: string;
    variant?: 'danger' | 'warning' | 'default';
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  } | null>>;
}

function CustomerFormModal({ customer, onSave, onClose, lang, L, toast, confirmDialog, setConfirmDialog }: CustomerFormModalProps) {
  const es = lang === 'es';

  // Build initial form state (handles: edit mode, draft restore, fresh)
  const [form, setForm] = useState(() => {
    const defaults = {
      firstName: '', lastName: '', phone: '', phones: [''] as string[],
      carrier: '', carriers: [''] as string[],
      email: '', address: '', city: '', state: '', zip: '',
      plan: '', monthlyPayment: '',
      notes: '', smsConsent: false, photo: '',
      referredBy: '',
    };

    // Edit mode — hydrate from customer
    if (customer) {
      const cAny = customer as any;
      const phones = Array.isArray(cAny.phones) && cAny.phones.length > 0
        ? cAny.phones
        : (customer.phone ? [customer.phone] : ['']);
      const carriers: string[] = [];
      const baseCarriers = Array.isArray(cAny.carriers) ? cAny.carriers : [cAny.carrier || ''];
      for (let i = 0; i < phones.length; i++) {
        carriers[i] = baseCarriers[i] || (i === 0 ? (cAny.carrier || '') : '');
      }
      return {
        ...defaults,
        firstName: customer.firstName || customer.name.split(' ')[0] || '',
        lastName:  customer.lastName  || customer.name.split(' ').slice(1).join(' ') || '',
        phone: phones[0] || '',
        phones,
        carrier: carriers[0] || '',
        carriers,
        email: customer.email || '',
        address: cAny.address || '',
        city:    cAny.city || '',
        state:   cAny.state || '',
        zip:     cAny.zip || '',
        plan:    cAny.plan || '',
        monthlyPayment: cAny.monthlyPayment != null ? String(cAny.monthlyPayment) : '',
        notes: customer.notes || '',
        smsConsent: customer.smsConsent ?? false,
        photo: cAny.photo || '',
      };
    }

    // New customer — check for draft in useEffect
    return defaults;
  });

  // Check for saved draft on mount
  useEffect(() => {
    if (customer) return;
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        setForm((prev) => ({ ...prev, ...draft }));
      } catch { localStorage.removeItem(DRAFT_KEY); }
    }
  }, []);

  // Auto-save draft (only for new customers)
  useEffect(() => {
    if (customer) return; // edit mode — no draft
    const hasContent = form.firstName || form.lastName || form.phones.some((p: string) => p);
    if (hasContent) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {}
    }
  }, [form, customer]);

  // ── Phones / Carriers array helpers ───────────────────────
  const updatePhone = (idx: number, value: string) => {
    const nextPhones = [...form.phones];
    nextPhones[idx] = value.replace(/\D/g, '');
    const primary = nextPhones.find((p) => (p || '').trim()) || '';
    const nextCarriers = [...form.carriers];
    while (nextCarriers.length < nextPhones.length) nextCarriers.push('');
    setForm({ ...form, phones: nextPhones, phone: primary, carriers: nextCarriers, carrier: nextCarriers[0] || form.carrier });
  };
  const updateCarrier = (idx: number, value: string) => {
    const nextCarriers = [...form.carriers];
    nextCarriers[idx] = value;
    setForm({ ...form, carriers: nextCarriers, carrier: nextCarriers[0] || '' });
  };
  const addPhoneField = () => {
    setForm({ ...form, phones: [...form.phones, ''], carriers: [...form.carriers, ''] });
  };
  const removePhoneField = (idx: number) => {
    let nextPhones = form.phones.filter((_: string, i: number) => i !== idx);
    let nextCarriers = form.carriers.filter((_: string, i: number) => i !== idx);
    if (nextPhones.length === 0) nextPhones = [''];
    while (nextCarriers.length < nextPhones.length) nextCarriers.push('');
    const primary = nextPhones.find((p: string) => (p || '').trim()) || '';
    setForm({ ...form, phones: nextPhones, phone: primary, carriers: nextCarriers, carrier: nextCarriers[0] || '' });
  };

  // ── Webcam for customer photo ─────────────────────────────
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      setStream(s);
      setShowCamera(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch {
      toast?.(es ? 'Cámara no disponible' : 'Camera not available', 'error');
    }
  };
  const stopCamera = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setShowCamera(false);
  };
  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const v = videoRef.current, c = canvasRef.current;
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      setForm({ ...form, photo: c.toDataURL('image/jpeg', 0.8) });
      stopCamera();
    }
  };
  useEffect(() => {
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = () => {
    const firstName = form.firstName.trim();
    const lastName  = form.lastName.trim();
    if (!firstName || !lastName) {
      toast?.(es ? 'Nombre y apellido requeridos' : 'First and last name required', 'error');
      return;
    }
    const phones = form.phones.map((p: string) => (p || '').trim()).filter(Boolean);
    if (phones.length === 0) {
      toast?.(es ? 'Al menos un teléfono es requerido' : 'At least one phone is required', 'error');
      return;
    }
    const phoneLen = phones[0].replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) {
      toast?.(es ? 'Teléfono debe ser 10 dígitos' : 'Phone must be 10 digits', 'error');
      return;
    }
    const carriers: string[] = [];
    for (let i = 0; i < phones.length; i++) {
      carriers[i] = (form.carriers[i] || (i === 0 ? form.carrier : '') || '').trim();
    }

    const patch: Partial<Customer> = {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      phone: phones[0],
      phones,
      carrier: carriers[0] || '',
      carriers,
      email: form.email,
      address: form.address,
      city: form.city,
      state: form.state,
      zip: form.zip,
      plan: form.plan,
      monthlyPayment: form.monthlyPayment || undefined,
      photo: form.photo,
      notes: form.notes,
      smsConsent: form.smsConsent,
      referredBy: form.referredBy.trim().toUpperCase() || undefined,
    };
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    onSave(patch);
  };

  const clearForm = () => {
    if (!setConfirmDialog) return;
    setConfirmDialog({
      title: es ? 'Borrar Formulario' : 'Clear Form',
      message: es ? '¿Borrar todos los campos del formulario?' : 'Clear all form fields?',
      variant: 'warning',
      confirmLabel: es ? 'Borrar' : 'Clear',
      cancelLabel: es ? 'Cancelar' : 'Cancel',
      onConfirm: () => {
        setForm({
          firstName: '', lastName: '', phone: '', phones: [''],
          carrier: '', carriers: [''],
          email: '', address: '', city: '', state: '', zip: '',
          plan: '', monthlyPayment: '', notes: '', smsConsent: false, photo: '',
          referredBy: '',
        });
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
        setConfirmDialog(null);
      },
    });
  };

  return (
    <Modal open onClose={onClose} title={`👤 ${customer ? L.edit : L.add} Customer`} size="max-w-2xl">
      <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1">
        {/* Auto-save indicator */}
        {!customer && (
          <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '0.5rem', padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: '#6ee7b7' }}>
            💾 {es ? 'Auto-guardado activado — tu progreso está seguro' : 'Auto-save enabled — your progress is safe'}
          </div>
        )}

        {/* First / Last Name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{es ? 'Nombre' : 'First Name'} *</label>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="input" autoFocus />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{es ? 'Apellido' : 'Last Name'} *</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="input" />
          </div>
        </div>

        {/* Photo / Webcam */}
        <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '0.5rem', padding: '0.75rem' }}>
          <label className="text-xs text-slate-300 font-semibold block mb-2">📸 {es ? 'Foto del Cliente' : 'Customer Photo'}</label>
          {!showCamera ? (
            form.photo ? (
              <div style={{ textAlign: 'center' }}>
                <img src={form.photo} alt="Customer" style={{ maxWidth: '160px', maxHeight: '160px', borderRadius: '8px', border: '2px solid #8b5cf6', marginBottom: '0.5rem' }} />
                <div className="flex gap-2 justify-center">
                  <button type="button" onClick={startCamera} className="btn btn-secondary btn-sm">📷 {es ? 'Volver a tomar' : 'Retake'}</button>
                  <button type="button" onClick={() => setForm({ ...form, photo: '' })} className="btn btn-ghost btn-sm text-red-400">🗑️</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={startCamera} className="btn btn-secondary" style={{ width: '100%' }}>📷 {es ? 'Tomar Foto' : 'Take Photo'}</button>
            )
          ) : (
            <div style={{ textAlign: 'center' }}>
              <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: '360px', borderRadius: '8px', marginBottom: '0.5rem', transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div className="flex gap-2 justify-center">
                <button type="button" onClick={capturePhoto} className="btn btn-primary btn-sm">✓ {es ? 'Capturar' : 'Capture'}</button>
                <button type="button" onClick={stopCamera} className="btn btn-secondary btn-sm">✕ {es ? 'Cancelar' : 'Cancel'}</button>
              </div>
            </div>
          )}
        </div>

        {/* Phones[] + Carriers[] */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{es ? 'Teléfono(s)' : 'Phone(s)'} *</label>
          {form.phones.map((p: string, idx: number) => (
            <div key={idx} style={{ marginBottom: '0.6rem', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.4rem' }}>
              <div className="flex gap-2 items-center mb-1">
                <input
                  type="tel" className="input"
                  value={formatPhone(p)}
                  onChange={(e) => updatePhone(idx, e.target.value)}
                  placeholder="(805) 555-1234"
                  style={{ flex: 1 }}
                />
                {form.phones.length > 1 && (
                  <button type="button" onClick={() => removePhoneField(idx)} className="btn btn-ghost btn-sm text-red-400" title="Remove">🗑️</button>
                )}
              </div>
              <select
                className="input"
                value={form.carriers[idx] || ''}
                onChange={(e) => updateCarrier(idx, e.target.value)}
                style={{ fontSize: '0.85rem' }}
              >
                <option value="">{es ? 'Seleccionar operador...' : 'Select carrier...'}</option>
                {CARRIER_OPTIONS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
          <button type="button" onClick={addPhoneField} className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
            + {es ? 'Agregar Teléfono' : 'Add Phone'}
          </button>
          <p className="text-xs text-slate-600 mt-1">{es ? 'Puedes guardar varios números para el mismo cliente.' : 'You can store multiple numbers for the same customer.'}</p>
        </div>

        {/* Email */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" placeholder="customer@example.com" />
        </div>

        {/* Address */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{es ? 'Dirección' : 'Address'}</label>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input" placeholder="123 Main Street" />
        </div>

        {/* City / State / Zip */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{es ? 'Ciudad' : 'City'}</label>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input" placeholder="Santa Barbara" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{es ? 'Estado' : 'State'}</label>
            <input
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
              className="input" placeholder="CA" maxLength={2}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Zip</label>
            <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value.replace(/\D/g, '').slice(0, 5) })} className="input" placeholder="93101" />
          </div>
        </div>

        {/* Plan / Monthly Payment */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{es ? 'Plan' : 'Plan'}</label>
            <input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="input" placeholder="Unlimited Plus" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{es ? 'Pago Mensual' : 'Monthly Payment'}</label>
            <input
              type="number" step="0.01"
              value={form.monthlyPayment}
              onChange={(e) => setForm({ ...form, monthlyPayment: e.target.value })}
              className="input" placeholder="55.00" list="monthly-payment-presets"
            />
            <datalist id="monthly-payment-presets">
              {MONTHLY_PAYMENT_PRESETS.map((v) => <option key={v} value={v} />)}
            </datalist>
          </div>
        </div>

        {/* Referral code (new customer only) */}
        {!customer && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {es ? '¿Código de referido? (opcional)' : 'Referral code? (optional)'}
            </label>
            <input
              value={form.referredBy}
              onChange={(e) => setForm({ ...form, referredBy: e.target.value.toUpperCase() })}
              className="input font-mono"
              placeholder={es ? 'Ej: GC1234' : 'e.g. GC1234'}
              maxLength={10}
            />
            <p className="text-xs text-slate-600 mt-1">
              {es ? '+50 pts para el cliente y quien lo refirió' : '+50 pts for both customer and referrer'}
            </p>
          </div>
        )}

        {/* SMS consent */}
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={form.smsConsent} onChange={(e) => setForm({ ...form, smsConsent: e.target.checked })} className="rounded border-white/20 bg-white/5" />
          {es ? 'Consiente recibir SMS' : 'SMS consent'}
        </label>

        {/* Notes */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{L.notes || 'Notes'}</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="textarea" rows={2} />
        </div>
      </div>

      <div className="flex gap-3 mt-4 pt-4 border-t border-white/10">
        <button onClick={onClose} className="btn btn-secondary flex-1">{L.cancel}</button>
        {!customer && (
          <button onClick={clearForm} className="btn btn-ghost" style={{ flex: 0.6 }}>🗑️ {es ? 'Limpiar' : 'Clear'}</button>
        )}
        <button onClick={handleSubmit} className="btn btn-primary flex-1">{customer ? L.save : L.create}</button>
      </div>

      {confirmDialog && (
        <ConfirmDialog
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog?.(null); }}
          onCancel={() => setConfirmDialog?.(null)}
        />
      )}
    </Modal>
  );
}

// ── Customer History ──────────────────────────────────────

function CustomerHistoryModal({ customer, sales, repairs, layaways, unlocks, specialOrders, returns, appointments, onClose, lang, L, settings }: {
  customer: Customer;
  sales: Sale[];
  repairs: any[];
  layaways: any[];
  unlocks: any[];
  specialOrders: any[];
  returns: any[];
  appointments: any[];
  onClose: () => void;
  lang: string;
  L: Record<string, any>;
  settings: any;
}) {
  const es = lang === 'es';
  const grossSpent       = sales.reduce((s, x) => s + (x.total || 0), 0);
  // NOTE: returns live in localStorage as dollars; sales live in store as cents.
  // Convert refund amounts to cents before subtracting so the math is consistent.
  // Round 18 fix: real field is `r.total` (verified vs ReturnsModule.tsx schema).
  // Old code read `r.refundAmount || r.amount` which never existed → totalRefundedCents
  // was always 0 → totalSpent ignored all refunds.
  const totalRefundedCents = returns.reduce((s, r: any) => {
    const amt = r.total || 0;
    return s + Math.round(amt * 100);
  }, 0);
  const totalSpent       = Math.max(0, grossSpent - totalRefundedCents);
  const totalTransactions = sales.length + repairs.length + layaways.length +
    unlocks.length + specialOrders.length + returns.length + appointments.length;

  const Badge = ({ status }: { status: string }) => {
    const cls = ['complete','completed','ready','picked_up'].includes((status||'').toLowerCase())
      ? 'badge-success'
      : ['cancelled','cancelled'].includes((status||'').toLowerCase())
        ? 'badge-danger'
        : 'badge-info';
    return <span className={`badge ${cls}`}>{status}</span>;
  };

  const Row = ({ left, right, sub }: { left: string; right: string; sub?: string }) => (
    <div className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm">
      <div>
        <span className="text-slate-300">{left}</span>
        {sub && <span className="text-slate-500 ml-2 text-xs">{sub}</span>}
      </div>
      <span className="text-emerald-400 font-medium shrink-0 ml-2">{right}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`📋 ${customer.name}`} size="max-w-2xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{es ? 'Total Gastado' : 'Total Spent'}</p>
            <p className="text-lg font-bold text-emerald-400">{formatCurrency(totalSpent)}</p>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{es ? 'Crédito en Tienda' : 'Store Credit'}</p>
            <p className="text-lg font-bold text-blue-400">{formatCurrency(customer.storeCredit || 0)}</p>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{es ? 'Total Transacciones' : 'Total Transactions'}</p>
            <p className="text-lg font-bold text-white">{totalTransactions}</p>
          </div>
        </div>

        {/* 💰 Sales */}
        <Section title={`💰 ${es ? 'Ventas' : 'Sales'}`} count={sales.length}>
          {sales.length === 0
            ? <Empty es={es} />
            : sales.slice(0, 20).map((s) => (
                <div key={s.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm">
                  <div>
                    <span className="text-brand-400 font-mono">{s.invoiceNumber}</span>
                    <span className="text-slate-500 ml-2">{formatDate(s.createdAt)}</span>
                    <span className="text-slate-400 ml-2">{s.items?.length || 0} items</span>
                  </div>
                  <span className="text-emerald-400 font-medium">{formatCurrency(s.total)}</span>
                </div>
              ))
          }
        </Section>

        {/* 🔧 Repairs */}
        <Section title={`🔧 ${es ? 'Reparaciones' : 'Repairs'}`} count={repairs.length}>
          {repairs.length === 0
            ? <Empty es={es} />
            : repairs.slice(0, 10).map((r) => (
                <div key={r.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300">{r.device || `${r.brand || ''} ${r.model || ''}`.trim()}</span>
                    {r.issue && <span className="text-slate-500 ml-2 text-xs truncate">{r.issue}</span>}
                    <div className="text-xs text-slate-600">{formatDate(r.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(r.balance || 0) > 0 && <span className="text-amber-400 text-xs">{formatCurrency(r.balance)}</span>}
                    <Badge status={r.status} />
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 📦 Layaways */}
        <Section title={`🏷️ ${es ? 'Apartados' : 'Layaways'}`} count={layaways.length}>
          {layaways.length === 0
            ? <Empty es={es} />
            : layaways.slice(0, 10).map((l) => (
                <div key={l.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300">{l.itemDescription || l.items?.[0]?.name || '—'}</span>
                    <div className="text-xs text-slate-600">{formatDate(l.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(l.balance || 0) > 0 && <span className="text-amber-400 text-xs">{formatCurrency(l.balance)}</span>}
                    <Badge status={l.status} />
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 🔓 Unlocks */}
        <Section title={`🔓 ${es ? 'Desbloqueos' : 'Unlocks'}`} count={unlocks.length}>
          {unlocks.length === 0
            ? <Empty es={es} />
            : unlocks.slice(0, 10).map((u) => (
                <div key={u.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300">{u.device}</span>
                    <span className="text-slate-500 ml-2 text-xs">{u.carrier}</span>
                    {u.imei && <span className="text-slate-600 ml-2 text-xs font-mono">{u.imei}</span>}
                    <div className="text-xs text-slate-600">{formatDate(u.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-slate-300 text-xs">{formatCurrency(u.price || 0)}</span>
                    <Badge status={u.status} />
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 🛍️ Special Orders */}
        <Section title={`🛍️ ${es ? 'Pedidos Especiales' : 'Special Orders'}`} count={specialOrders.length}>
          {specialOrders.length === 0
            ? <Empty es={es} />
            : specialOrders.slice(0, 10).map((o) => (
                <div key={o.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300">{o.itemDescription}</span>
                    {o.supplier && <span className="text-slate-500 ml-2 text-xs">{o.supplier}</span>}
                    <div className="text-xs text-slate-600">{formatDate(o.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(o.balance || 0) > 0 && <span className="text-amber-400 text-xs">{formatCurrency(o.balance)}</span>}
                    <Badge status={o.status} />
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 🔄 Returns */}
        {returns.length > 0 && (
          <Section title={`🔄 ${es ? 'Devoluciones' : 'Returns'}`} count={returns.length}>
            {returns.slice(0, 10).map((r: any) => {
              // Returns in localStorage are in dollars; formatCurrency expects cents.
              // Round 18 fix: real field is `r.total` not `r.refundAmount`. Label uses
              // first item name if present, fallback to reason then generic label.
              const refundCents = Math.round((r.total || 0) * 100);
              const label = (Array.isArray(r.items) && r.items[0] && r.items[0].name)
                || r.reason
                || (es ? 'Devolución' : 'Return');
              return (
                <Row
                  key={r.id}
                  left={label}
                  right={formatCurrency(refundCents)}
                  sub={formatDate(r.createdAt)}
                />
              );
            })}
          </Section>
        )}

        {/* 📅 Appointments */}
        {appointments.length > 0 && (
          <Section title={`📅 ${es ? 'Citas' : 'Appointments'}`} count={appointments.length}>
            {appointments.slice(0, 10).map((a: any) => (
              <div key={a.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-slate-300">{a.title || a.service || (es ? 'Cita' : 'Appointment')}</span>
                  <div className="text-xs text-slate-600">
                    {a.date || formatDate(a.scheduledAt || a.createdAt)}
                    {a.time && ` · ${a.time}`}
                  </div>
                </div>
                {a.status && <Badge status={a.status} />}
              </div>
            ))}
          </Section>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-2">{title} <span className="text-slate-500 font-normal">({count})</span></h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty({ es }: { es: boolean }) {
  return <p className="text-sm text-slate-600 px-3">{es ? 'Sin registros' : 'No records'}</p>;
}

export { CustomerFormModal };
export type { CustomerFormModalProps };
