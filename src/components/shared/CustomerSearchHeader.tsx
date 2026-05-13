// ============================================================
// CellHub Pro — Customer Search Header (r-customer-picker-sweep)
//
// Reusable header component for modals that need to lookup an existing
// customer from the customers DB and autofill the form's name/phone fields.
//
// Pattern extracted from RepairModal (existing inline implementation).
// Now mounted in: RepairModal, AppointmentsModule, UnlockModule,
// SpecialOrdersModule, LayawayModule.
//
// Behavior:
//   - Always shows a "Customer Information" header bar with a "Select Customer"
//     button on the right
//   - Clicking the button toggles an expandable search input below
//   - The search input filters customers by name/phone/customerNumber via
//     matchesSearch (same util used by GlobalSearchBar)
//   - Selecting a result fires onSelect(customer) — parent decides how to
//     map the customer into form state (typically firstName/lastName/phone)
//   - The component does NOT render the form's name/phone inputs themselves;
//     those are passed as `children` so each modal keeps its own field shape
//
// Note: Existing AutocompleteInput-based pickers in some modals (Repair,
// Unlock, SpecialOrders, Layaway) are NOT removed by this round — the
// header is additive. Modals that previously had nothing (Appointments)
// gain customer lookup for the first time.
//
// TopUpModal and PhonePaymentModal use their own customer pickers and are
// intentionally out of scope.
// ============================================================

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { matchesSearch } from '@/utils/fuzzyMatch';
import type { Customer } from '@/store/types';

interface CustomerSearchHeaderProps {
  customers: Customer[];
  lang: 'en' | 'es';
  onSelect: (customer: Customer) => void;
  /** The form's name/phone inputs (rendered below the header) */
  children: ReactNode;
  /** Optional override for the section title */
  title?: string;
}

export default function CustomerSearchHeader({
  customers,
  lang,
  onSelect,
  children,
  title,
}: CustomerSearchHeaderProps) {
  const es = lang === 'es';
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  // R-SEARCH-ARROW-NAV-FIX: arrow-key nav for the dropdown. Index is
  // clamped on every results change so it never points off the end.
  const [activeIdx, setActiveIdx] = useState(0);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return customers
      .filter((c) => matchesSearch(query, c.name, c.phone, c.customerNumber))
      .slice(0, 6);
  }, [query, customers]);

  // Keep activeIdx in bounds as the result set shrinks/grows.
  useEffect(() => {
    if (results.length === 0) return;
    if (activeIdx < 0 || activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  const handleSelect = (c: Customer) => {
    onSelect(c);
    setShowSearch(false);
    setQuery('');
    setActiveIdx(0);
  };

  // R-SEARCH-ARROW-NAV-FIX: ArrowDown/ArrowUp clamp; Enter selects the
  // highlighted (or top) result; Escape closes the search panel. Cero
  // preventDefault on Tab — focus advances naturally.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(Math.max(0, i) + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, Math.min(i, results.length - 1) - 1));
    } else if (e.key === 'Enter') {
      const safeIdx = activeIdx >= 0 && activeIdx < results.length ? activeIdx : 0;
      const c = results[safeIdx];
      if (c) {
        e.preventDefault();
        handleSelect(c);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSearch(false);
      setQuery('');
      setActiveIdx(0);
    }
  };

  return (
    <div
      style={{
        background: 'rgba(102,126,234,0.08)',
        border: '1px solid rgba(102,126,234,0.2)',
        borderRadius: '0.75rem',
        padding: '1rem',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h4
          style={{
            fontSize: '0.875rem',
            fontWeight: 700,
            color: '#a5b4fc',
            margin: 0,
          }}
        >
          👤 {title || (es ? 'Información del Cliente' : 'Customer Information')}
        </h4>
        <button
          type="button"
          onClick={() => setShowSearch(!showSearch)}
          className="btn btn-secondary btn-sm"
        >
          {es ? 'Buscar Cliente' : 'Select Customer'}
        </button>
      </div>

      {/* Expandable search bar */}
      {showSearch && (
        <div style={{ marginBottom: '0.75rem', position: 'relative' }}>
          <input
            className="input"
            placeholder={
              es ? 'Buscar por nombre o teléfono...' : 'Search by name or phone...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {results.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 50,
                background: '#1e293b',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '0.5rem',
                marginTop: '0.25rem',
                overflow: 'hidden',
                boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
              }}
            >
              {results.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c)}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.875rem',
                    background: i === activeIdx ? 'rgba(102,126,234,0.18)' : 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: i === activeIdx ? 600 : 400,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </span>
                  <span style={{ color: '#64748b', flexShrink: 0, fontSize: '0.78rem' }}>
                    {c.phone}
                  </span>
                </button>
              ))}
            </div>
          )}
          {query.trim() && results.length === 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 50,
                background: '#1e293b',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '0.5rem',
                marginTop: '0.25rem',
                padding: '0.75rem',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: '0.78rem',
              }}
            >
              {es ? 'No se encontraron clientes' : 'No customers found'}
            </div>
          )}
        </div>
      )}

      {/* Form fields rendered by parent modal */}
      {children}
    </div>
  );
}
