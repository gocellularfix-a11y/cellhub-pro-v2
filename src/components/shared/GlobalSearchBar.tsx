// ============================================================
// CellHub Pro — GlobalSearchBar (r-global-search)
//
// Reusable global search component extracted from Dashboard.tsx.
// Searches 8 collections simultaneously and shows a grouped dropdown:
//   customers, inventory, repairs, unlocks, sales, specialOrders, layaways, expenses
//
// Two modes:
//   1. STANDALONE (Dashboard) — no localValue/onLocalChange. Internal state only.
//      The input drives the dropdown only. Used in Dashboard.
//
//   2. SYNCED (other modules) — caller passes localValue + onLocalChange. The
//      same input both feeds the caller's local list filter AND opens the
//      global dropdown above other modules.
//
// excludeCollection — when set, that collection's section is hidden in the
// dropdown. Modules pass their own collection so they don't see redundant
// matches (the local filtered list already shows them).
// ============================================================

import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useApp } from '@/store/AppProvider';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { SearchInput } from '@/components/ui';

// All collection keys searchable by this component. Modules pass one of these
// to `excludeCollection` to hide their own collection's matches in the dropdown.
export type SearchCollection =
  | 'customers'
  | 'inventory'
  | 'repairs'
  | 'unlocks'
  | 'sales'
  | 'specialOrders'
  | 'layaways'
  | 'expenses';

interface GlobalSearchBarProps {
  /** SYNCED mode: input value comes from caller's local state. */
  localValue?: string;
  /** SYNCED mode: keystroke handler from caller. */
  onLocalChange?: (value: string) => void;
  /** Hide a specific collection's section in the dropdown. Pass the
   *  collection of the module hosting this bar so users don't see redundant
   *  matches (their local list already shows them). */
  excludeCollection?: SearchCollection;
  /** Override the input placeholder. Defaults to L.searchPlaceholder. */
  placeholder?: string;
  /** Width of the wrapper. Default '100%'. Dashboard uses '320px'. */
  width?: string;
  /** Show the "Tip:" footer below the input. Only Dashboard wants this. */
  showTip?: boolean;
  /** Extra className for the wrapper. */
  className?: string;
}

// ── Internal sub-components (moved from Dashboard.tsx) ────

function SearchSection({
  label, children, count,
}: { label: string; children: ReactNode; count: number }) {
  if (count === 0) return null;
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{
        fontSize: '0.65rem', color: '#64748b', letterSpacing: '0.05em',
        fontWeight: 600, marginBottom: '0.4rem', display: 'flex',
        alignItems: 'center', gap: '0.5rem',
      }}>
        {label.toUpperCase()}
        <span style={{
          background: 'rgba(102,126,234,0.2)', color: '#a5b4fc',
          padding: '0.1rem 0.4rem', borderRadius: '8px', fontSize: '0.6rem',
        }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function SearchResultBtn({
  primary, secondary, badge, badgeColor, onClick,
}: {
  primary: string; secondary?: string; badge?: string;
  badgeColor?: string; onClick: () => void;
}) {
  return (
    <button
      className="btn btn-secondary btn-sm"
      style={{
        width: '100%', justifyContent: 'space-between',
        marginBottom: '0.3rem', textAlign: 'left', gap: '0.5rem',
      }}
      onClick={onClick}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {primary}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
        {secondary && (
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{secondary}</span>
        )}
        {badge && (
          <span style={{
            fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: '6px',
            background: badgeColor || 'rgba(59,130,246,0.2)',
            color: badgeColor ? '#fff' : '#93c5fd', fontWeight: 600,
          }}>
            {badge}
          </span>
        )}
      </span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────

export default function GlobalSearchBar({
  localValue,
  onLocalChange,
  excludeCollection,
  placeholder,
  width = '100%',
  showTip = false,
  className = '',
}: GlobalSearchBarProps) {
  const {
    state: {
      customers, inventory, repairs, unlocks, sales,
      specialOrders, layaways, expenses, lang,
    },
    setActiveTab, dispatch,
  } = useApp();

  const L = getLabels(lang);
  const es = lang === 'es';

  // STANDALONE mode: own state. SYNCED mode: mirror caller's state.
  const [internalSearch, setInternalSearch] = useState('');
  const isSynced = localValue !== undefined && onLocalChange !== undefined;
  const search = isSynced ? localValue : internalSearch;

  const handleChange = (value: string) => {
    if (isSynced) {
      onLocalChange!(value);
    } else {
      setInternalSearch(value);
    }
  };

  const q = search.trim();

  // ── Dropdown dismiss: click-outside, Escape, blur ──────
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Show dropdown whenever there's a query
  useEffect(() => {
    if (q) setShowDropdown(true);
  }, [q]);

  // Click outside → close dropdown (keep search text for local filtering)
  useEffect(() => {
    if (!showDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  // Escape key → close dropdown
  useEffect(() => {
    if (!showDropdown) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDropdown(false);
        // Also blur the input so focus leaves the search bar
        if (wrapperRef.current) {
          const input = wrapperRef.current.querySelector('input');
          input?.blur();
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showDropdown]);

  // Re-open dropdown on focus if there's a query
  const handleFocus = useCallback(() => {
    if (q) setShowDropdown(true);
  }, [q]);

  // Close dropdown after navigation by clearing the search.
  const clearSearch = () => {
    setShowDropdown(false);
    if (isSynced) {
      onLocalChange!('');
    } else {
      setInternalSearch('');
    }
  };

  // ── Match memos (one per collection, skipped when excluded) ──

  const customerMatches = useMemo(() => {
    if (!q || excludeCollection === 'customers') return [];
    return customers.filter((c) =>
      matchesSearch(q, c.name, c.phone, c.email, c.customerNumber),
    ).slice(0, 5);
  }, [q, customers, excludeCollection]);

  const inventoryMatches = useMemo(() => {
    if (!q || excludeCollection === 'inventory') return [];
    return inventory.filter((i) =>
      matchesSearch(q, i.name, i.sku, i.barcode, i.imei),
    ).slice(0, 5);
  }, [q, inventory, excludeCollection]);

  const repairMatches = useMemo(() => {
    if (!q || excludeCollection === 'repairs') return [];
    return repairs.filter((r) =>
      matchesSearch(q, r.customerName, r.customerPhone, r.device, r.imei, r.id, r.issue),
    ).slice(0, 5);
  }, [q, repairs, excludeCollection]);

  const unlockMatches = useMemo(() => {
    if (!q || excludeCollection === 'unlocks') return [];
    return unlocks.filter((u) =>
      matchesSearch(q, u.customerName, u.customerPhone, u.device, u.imei, u.carrier, u.id),
    ).slice(0, 5);
  }, [q, unlocks, excludeCollection]);

  const saleMatches = useMemo(() => {
    if (!q || excludeCollection === 'sales') return [];
    return sales.filter((s) =>
      matchesSearch(q, s.invoiceNumber, s.customerName, s.employeeName),
    ).slice(0, 5);
  }, [q, sales, excludeCollection]);

  const specialOrderMatches = useMemo(() => {
    if (!q || excludeCollection === 'specialOrders') return [];
    return specialOrders.filter((so) =>
      matchesSearch(q, so.customerName, so.customerPhone, so.itemDescription, so.id),
    ).slice(0, 5);
  }, [q, specialOrders, excludeCollection]);

  const layawayMatches = useMemo(() => {
    if (!q || excludeCollection === 'layaways') return [];
    return layaways.filter((l) =>
      matchesSearch(q, l.customerName, l.customerPhone, l.id,
        ...(l.items?.map((li) => li.name) || [])),
    ).slice(0, 5);
  }, [q, layaways, excludeCollection]);

  const expenseMatches = useMemo(() => {
    if (!q || excludeCollection === 'expenses') return [];
    return expenses.filter((e) =>
      matchesSearch(q, e.vendor, e.description, e.category, e.notes),
    ).slice(0, 5);
  }, [q, expenses, excludeCollection]);

  const totalResults =
    customerMatches.length + inventoryMatches.length +
    repairMatches.length + unlockMatches.length + saleMatches.length +
    specialOrderMatches.length + layawayMatches.length + expenseMatches.length;

  // Navigate to a module, optionally pre-filling its search and highlighting a record.
  // Routing rules (preserved from the original Dashboard.tsx implementation):
  //   - 'customers' → SET_CUSTOMER_SEARCH (dedicated channel)
  //   - 'inventory' or 'pos' → SET_INVENTORY_SEARCH (dedicated channel)
  //   - everything else → SET_GLOBAL_SEARCH (consumed by other modules on mount)
  // recordId triggers a 3-second flash+scroll via useHighlightRecord on the destination.
  const goTo = (tab: string, term?: string, recordId?: string) => {
    if (term) {
      if (tab === 'customers') {
        dispatch({ type: 'SET_CUSTOMER_SEARCH', payload: term });
      } else if (tab === 'inventory' || tab === 'pos') {
        dispatch({ type: 'SET_INVENTORY_SEARCH', payload: term });
      } else {
        dispatch({ type: 'SET_GLOBAL_SEARCH', payload: term });
      }
    }
    if (recordId) {
      dispatch({ type: 'SET_HIGHLIGHT_RECORD', payload: recordId });
      setTimeout(() => dispatch({ type: 'SET_HIGHLIGHT_RECORD', payload: '' }), 3000);
    }
    setActiveTab(tab);
  };

  // Suppress unused-var warnings when isSynced flips paths.
  useEffect(() => { /* noop, isSynced is read above */ }, [isSynced]);

  return (
    <div ref={wrapperRef} className={className} style={{ position: 'relative', width }} onFocus={handleFocus}>
      <SearchInput
        value={search}
        onChange={handleChange}
        placeholder={placeholder || L.searchPlaceholder || (es
          ? 'Buscar clientes, teléfonos, accesorios, SKU…'
          : 'Search customers, phones, accessories, SKU…')}
      />

      {showTip && (
        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.35rem' }}>
          {L.globalSearchTip || (es
            ? 'Tip: Esta búsqueda es global a todos los módulos.'
            : 'Tip: This search is shared across modules.')}
        </div>
      )}

      {/* ── Dropdown ── */}
      {q !== '' && showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0,
          width: '480px', marginTop: '0.25rem', zIndex: 50,
          background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px', padding: '1rem',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          maxHeight: '500px', overflowY: 'auto',
        }}>
          {/* Results count header */}
          <div style={{
            fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.75rem',
            paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            {totalResults > 0
              ? (es
                ? `${totalResults} resultado${totalResults !== 1 ? 's' : ''} para "${q}"`
                : `${totalResults} result${totalResults !== 1 ? 's' : ''} for "${q}"`)
              : (es
                ? `Sin resultados para "${q}"`
                : `No results for "${q}"`)
            }
          </div>

          {/* ── Customers ── */}
          <SearchSection label={L.customers || 'Customers'} count={customerMatches.length}>
            {customerMatches.map((c) => (
              <SearchResultBtn key={c.id}
                primary={c.name}
                secondary={c.phone || c.customerNumber || ''}
                onClick={() => { goTo('customers', c.name, c.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {/* ── Inventory ── */}
          <SearchSection label={L.inventory || 'Inventory'} count={inventoryMatches.length}>
            {inventoryMatches.map((i) => (
              <SearchResultBtn key={i.id}
                primary={i.name}
                secondary={i.sku || ''}
                badge={i.qty > 0 ? `${i.qty} ${es ? 'en stock' : 'in stock'}` : (es ? 'Agotado' : 'Out')}
                badgeColor={i.qty > 0 ? undefined : 'rgba(239,68,68,0.3)'}
                onClick={() => { goTo(i.qty > 0 ? 'pos' : 'inventory', i.name, i.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {/* ── Repairs ── */}
          <SearchSection label={L.repairs || 'Repairs'} count={repairMatches.length}>
            {repairMatches.map((r) => (
              <SearchResultBtn key={r.id}
                primary={`${r.customerName} — ${r.device}`}
                secondary={r.id.slice(-8).toUpperCase()}
                badge={r.status}
                badgeColor={
                  r.status === 'ready' || r.status === 'Complete' ? 'rgba(34,197,94,0.3)' :
                  r.status === 'in_progress' || r.status === 'In Progress' ? 'rgba(245,158,11,0.3)' :
                  undefined
                }
                onClick={() => { goTo('repairs', r.customerName, r.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {/* ── Unlocks ── */}
          <SearchSection label={L.unlocks || 'Unlocks'} count={unlockMatches.length}>
            {unlockMatches.map((u) => (
              <SearchResultBtn key={u.id}
                primary={`${u.customerName} — ${u.device}`}
                secondary={u.carrier}
                badge={u.status}
                onClick={() => { goTo('unlocks', u.customerName, u.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {/* ── Sales ── */}
          <SearchSection label={L.recentSales || 'Sales'} count={saleMatches.length}>
            {saleMatches.map((s) => (
              <SearchResultBtn key={s.id}
                primary={s.invoiceNumber}
                secondary={s.customerName || (es ? 'Mostrador' : 'Walk-in')}
                badge={formatCurrency(s.total)}
                onClick={() => { goTo('reports', s.invoiceNumber, s.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {/* ── Special Orders ── */}
          <SearchSection label={L.specialOrders || 'Special Orders'} count={specialOrderMatches.length}>
            {specialOrderMatches.map((so) => (
              <SearchResultBtn key={so.id}
                primary={`${so.customerName} — ${so.itemDescription}`}
                badge={so.status}
                onClick={() => { goTo('specialOrders', so.customerName, so.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {/* ── Layaways ── */}
          <SearchSection label={L.layaways || 'Layaways'} count={layawayMatches.length}>
            {layawayMatches.map((l) => (
              <SearchResultBtn key={l.id}
                primary={`${l.customerName}`}
                secondary={l.items?.map((li) => li.name).join(', ')}
                badge={formatCurrency(l.balance)}
                onClick={() => { goTo('layaways', l.customerName, l.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {/* ── Expenses (NEW in r-global-search) ── */}
          {/* Note: clicking an expense routes to 'tax' because ExpensesModule
              isn't mounted as a standalone tab in AppShell yet — expenses are
              managed inside TaxReportsModule. The recordId still highlights
              the row when ExpensesModule eventually gets its own tab, since
              ExpensesModule already has useHighlightRecord wired (r-global-search). */}
          <SearchSection
            label={es ? 'Gastos' : 'Expenses'}
            count={expenseMatches.length}
          >
            {expenseMatches.map((e) => (
              <SearchResultBtn key={e.id}
                primary={e.vendor || e.description || (es ? 'Sin descripción' : 'No description')}
                secondary={e.description !== e.vendor ? e.description : ''}
                badge={formatCurrency(e.amount)}
                onClick={() => { goTo('tax', e.vendor, e.id); clearSearch(); }}
              />
            ))}
          </SearchSection>

          {totalResults === 0 && (
            <div style={{ textAlign: 'center', padding: '1rem', color: '#64748b', fontSize: '0.85rem' }}>
              {es
                ? 'No se encontraron coincidencias en ningún módulo.'
                : 'No matches found across any module.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
