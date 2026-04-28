// ============================================================
// GlobalSearch — Command Palette (Cmd+K / Ctrl+K)
//
// Searches across ALL data in the app simultaneously:
//   customers, inventory, repairs, unlocks, layaways,
//   special orders, sales/invoices, expenses, purchase orders
//
// Results are grouped by category. Clicking any result
// navigates to the correct module and (where possible)
// opens that record directly.
//
// Triggered by:
//   - Cmd+K / Ctrl+K keyboard shortcut (anywhere in app)
//   - Clicking the search icon in the Sidebar
// ============================================================

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { formatPhone } from '@/utils/normalize';
import { useTranslation } from '@/i18n';

interface SearchResult {
  id: string;
  icon: string;
  primary: string;
  secondary: string;
  tertiary?: string;
  tab: string;
  badge?: string;
  badgeColor?: string;
}

const STATUS_COLORS: Record<string, string> = {
  'open': '#f59e0b',
  'in_progress': '#3b82f6',
  'complete': '#22c55e',
  'completed': '#22c55e',
  'picked_up': '#22c55e',
  'cancelled': '#ef4444',
  'pending': '#f59e0b',
  'received': '#a78bfa',
  'ordered': '#38bdf8',
  'ready': '#34d399',
  'active': '#22c55e',
};

function statusColor(s?: string) {
  if (!s) return '#64748b';
  return STATUS_COLORS[s.toLowerCase().replace(/ /g, '_')] || '#64748b';
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function GlobalSearch() {
  const { state, setActiveTab, dispatch } = useApp();
  const {
    customers, inventory, repairs, unlocks, layaways,
    specialOrders, sales, purchaseOrders,
    lang,
  } = state as any;

  const es = lang === 'es';
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Open/close via Cmd+K ─────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Also allow external trigger via custom event (from Sidebar button)
  useEffect(() => {
    const handler = () => { setOpen(true); };
    window.addEventListener('cellhub_global_search', handler);
    return () => window.removeEventListener('cellhub_global_search', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ── Search across all data ────────────────────────────────
  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim();
    if (!q || q.length < 2) return [];
    const out: SearchResult[] = [];

    // Customers
    (customers || []).forEach((c: any) => {
      if (!matchesSearch(q, c.name, c.phone, c.email, c.customerNumber)) return;
      out.push({
        id: `cust-${c.id}`, icon: '👤',
        primary: c.name,
        secondary: formatPhone(c.phone) || c.email || '',
        tertiary: c.customerNumber,
        tab: 'customers',
        badge: es ? 'Cliente' : 'Customer',
        badgeColor: '#667eea',
      });
    });

    // Inventory
    (inventory || []).forEach((i: any) => {
      if (!matchesSearch(q, i.name, i.sku, i.barcode, i.imei, i.category)) return;
      out.push({
        id: `inv-${i.id}`, icon: '📦',
        primary: i.name,
        secondary: [i.sku, i.imei].filter(Boolean).join(' · ') || i.category,
        tertiary: money(i.price || 0),
        tab: 'inventory',
        badge: i.category,
        badgeColor: '#0ea5e9',
      });
    });

    // Repairs
    (repairs || []).forEach((r: any) => {
      if (!matchesSearch(q, r.customerName, r.customerPhone, r.device, r.issue, r.id)) return;
      out.push({
        id: `rep-${r.id}`, icon: '🔧',
        primary: `${r.customerName} — ${r.device}`,
        secondary: r.issue || '',
        tertiary: formatPhone(r.customerPhone),
        tab: 'repairs',
        badge: r.status,
        badgeColor: statusColor(r.status),
      });
    });

    // Unlocks
    (unlocks || []).forEach((u: any) => {
      if (!matchesSearch(q, u.customerName, u.customerPhone, u.device, u.imei, u.carrier)) return;
      out.push({
        id: `unl-${u.id}`, icon: '🔓',
        primary: `${u.customerName} — ${u.device}`,
        secondary: [u.carrier, u.imei].filter(Boolean).join(' · '),
        tertiary: formatPhone(u.customerPhone),
        tab: 'unlocks',
        badge: u.status,
        badgeColor: statusColor(u.status),
      });
    });

    // Layaways
    (layaways || []).forEach((l: any) => {
      if (!matchesSearch(q, l.customerName, l.customerPhone, l.itemDescription)) return;
      out.push({
        id: `lay-${l.id}`, icon: '📅',
        primary: `${l.customerName} — ${l.itemDescription || ''}`,
        secondary: formatPhone(l.customerPhone),
        tertiary: l.balance ? `${es ? 'Saldo' : 'Balance'}: ${money(l.balance)}` : '',
        tab: 'layaways',
        badge: l.status,
        badgeColor: statusColor(l.status),
      });
    });

    // Special Orders
    (specialOrders || []).forEach((o: any) => {
      if (!matchesSearch(q, o.customerName, o.customerPhone, o.itemDescription, o.supplier)) return;
      out.push({
        id: `so-${o.id}`, icon: '📋',
        primary: `${o.customerName} — ${o.itemDescription || ''}`,
        secondary: o.supplier || '',
        tertiary: formatPhone(o.customerPhone),
        tab: 'specialOrders',
        badge: o.status,
        badgeColor: statusColor(o.status),
      });
    });

    // Sales / Invoices
    (sales || []).forEach((s: any) => {
      if (s.status !== 'voided' &&
          matchesSearch(q, s.invoiceNumber, s.customerName, s.customerPhone)) {
        out.push({
          id: `sale-${s.id}`, icon: '🧾',
          primary: `${es ? 'Factura' : 'Invoice'} ${s.invoiceNumber}`,
          secondary: s.customerName || '',
          tertiary: money(s.total || 0),
          tab: 'reports',
          badge: es ? 'Venta' : 'Sale',
          badgeColor: '#10b981',
        });
      }
    });

    // Purchase Orders
    (purchaseOrders || []).forEach((po: any) => {
      if (!matchesSearch(q, po.poNumber, po.vendor, po.vendorContact, po.notes)) return;
      out.push({
        id: `po-${po.id}`, icon: '🏭',
        primary: `PO ${po.poNumber} — ${po.vendor}`,
        secondary: po.vendorContact || '',
        tertiary: po.totalAmount ? money(po.totalAmount) : '',
        tab: 'purchaseOrders',
        badge: po.status,
        badgeColor: statusColor(po.status),
      });
    });

    return out.slice(0, 30);
  }, [query, customers, inventory, repairs, unlocks, layaways, specialOrders, sales, purchaseOrders, es]);

  // ── Keyboard nav ─────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[activeIdx]) { handleSelect(results[activeIdx]); }
  };

  // Keep active item in view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Reset active index on new results
  useEffect(() => { setActiveIdx(0); }, [results]);

  // ── Navigate to result ───────────────────────────────────
  const handleSelect = useCallback((r: SearchResult) => {
    setActiveTab(r.tab);
    setOpen(false);
    // Set the highlight record ID so the target module can flash+scroll to it
    const recordId = r.id.split('-').slice(1).join('-');
    dispatch({ type: 'SET_HIGHLIGHT_RECORD', payload: recordId });
    // Auto-clear after 3s so it doesn't persist
    setTimeout(() => dispatch({ type: 'SET_HIGHLIGHT_RECORD', payload: '' }), 3000);
  }, [setActiveTab, dispatch]);

  if (!open) return null;

  const placeholder = es
    ? 'Buscar clientes, productos, tickets, facturas...'
    : 'Search customers, products, tickets, invoices...';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Palette */}
      <div style={{
        position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000, width: '100%', maxWidth: '640px',
        background: '#0f172a',
        border: '1px solid rgba(102,126,234,0.35)',
        borderRadius: '1rem',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>

        {/* Input row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.875rem 1rem',
          borderBottom: query && results.length > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
        }}>
          <span style={{ fontSize: '1.1rem', opacity: 0.5 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#e2e8f0', fontSize: '1rem', fontFamily: 'inherit',
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{
              background: 'transparent', border: 'none', color: '#475569',
              cursor: 'pointer', fontSize: '0.8rem', padding: '0.2rem 0.4rem',
            }}>✕</button>
          )}
          <kbd style={{
            fontSize: '0.65rem', color: '#475569',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '4px', padding: '0.2rem 0.4rem',
          }}>esc</kbd>
        </div>

        {/* Results */}
        {query.length >= 2 && (
          <div ref={listRef} style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div style={{
                padding: '2rem', textAlign: 'center',
                color: '#475569', fontSize: '0.9rem',
              }}>
                {t('search.noResultsFor')}{' '}
                <span style={{ color: '#94a3b8' }}>"{query}"</span>
              </div>
            ) : results.map((r, i) => (
              <div
                key={r.id}
                data-idx={i}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.65rem 1rem',
                  background: i === activeIdx ? 'rgba(102,126,234,0.15)' : 'transparent',
                  cursor: 'pointer',
                  borderLeft: i === activeIdx ? '2px solid #667eea' : '2px solid transparent',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{r.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.9rem', color: '#e2e8f0', fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {r.primary}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1px' }}>
                    {r.secondary}
                    {r.tertiary && <span style={{ marginLeft: '0.5rem', color: '#475569' }}>· {r.tertiary}</span>}
                  </div>
                </div>
                {r.badge && (
                  <span style={{
                    fontSize: '0.65rem', padding: '0.2rem 0.5rem',
                    borderRadius: '999px', flexShrink: 0,
                    background: `${r.badgeColor}22`,
                    color: r.badgeColor,
                    border: `1px solid ${r.badgeColor}44`,
                    fontWeight: 600,
                  }}>
                    {r.badge}
                  </span>
                )}
                <span style={{ fontSize: '0.7rem', color: '#334155', flexShrink: 0 }}>↵</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer hints */}
        {query.length < 2 && (
          <div style={{
            padding: '1rem 1rem 0.875rem',
            display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
          }}>
            {[
              { icon: '👤', label: t('nav.customers') },
              { icon: '📦', label: t('nav.inventory') },
              { icon: '🔧', label: t('nav.repairs') },
              { icon: '🔓', label: t('nav.unlocks') },
              { icon: '🧾', label: t('invoice') },
              { icon: '📋', label: t('nav.specialOrder') },
            ].map((h) => (
              <span key={h.label} style={{
                fontSize: '0.72rem', color: '#475569',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '6px', padding: '0.2rem 0.6rem',
                display: 'flex', alignItems: 'center', gap: '0.3rem',
              }}>
                <span style={{ fontSize: '0.8rem' }}>{h.icon}</span> {h.label}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#334155', alignSelf: 'center' }}>
              ↑↓ {es ? 'navegar' : 'navigate'} · ↵ {es ? 'abrir' : 'open'}
            </span>
          </div>
        )}

        {query.length >= 2 && results.length > 0 && (
          <div style={{
            padding: '0.4rem 1rem', borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', justifyContent: 'space-between',
            fontSize: '0.68rem', color: '#334155',
          }}>
            <span>{results.length} {es ? 'resultado(s)' : `result${results.length > 1 ? 's' : ''}`}</span>
            <span>↑↓ · ↵ · esc</span>
          </div>
        )}
      </div>
    </>
  );
}
