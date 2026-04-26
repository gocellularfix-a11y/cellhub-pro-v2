// ============================================================
// CellHub Pro — Customer Picker (r28)
// Reusable customer search + select dropdown. Used by TopUpModal
// in r28b. PhonePaymentModal still uses its own inline picker —
// it can be migrated to this shared component in a future round.
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import type { Customer } from '@/store/types';

interface CustomerPickerProps {
  customers: Customer[];
  selectedCustomer: Customer | null;
  onSelect: (customer: Customer | null) => void;
  lang: 'en' | 'es' | 'pt';
  /** Optional placeholder for the search input */
  placeholder?: string;
  /** When true, shows a "Walk-in (no customer)" clear chip when one is selected */
  allowClear?: boolean;
  /** Optional — when provided, shows a "+ New Customer" button that creates inline */
  onCreateCustomer?: (customer: Customer) => void;
}

export default function CustomerPicker({
  customers,
  selectedCustomer,
  onSelect,
  lang,
  placeholder,
  allowClear = true,
  onCreateCustomer,
}: CustomerPickerProps) {
  const es = lang === 'es';
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const handleCreateCustomer = useCallback(() => {
    const firstName = newFirst.trim();
    const lastName = newLast.trim();
    const phone = newPhone.replace(/\D/g, '').trim();
    if (!firstName || !phone) return;
    const now = new Date().toISOString();
    const newCustomer: Customer = {
      id: `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      phone,
      phones: [phone],
      email: '',
      loyaltyPoints: 0,
      storeCredit: 0,
      customerNumber: '',
      notes: '',
      communicationConsent: false,
      createdAt: now,
    };
    onCreateCustomer?.(newCustomer);
    onSelect(newCustomer);
    setShowNewForm(false);
    setNewFirst('');
    setNewLast('');
    setNewPhone('');
    setQuery('');
    setShowDropdown(false);
  }, [newFirst, newLast, newPhone, onCreateCustomer, onSelect]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => {
        const name = (c.name || `${c.firstName || ''} ${c.lastName || ''}`).toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const phones = (c.phones || []).join(' ').toLowerCase();
        const email = (c.email || '').toLowerCase();
        const num = (c.customerNumber || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || phones.includes(q) || email.includes(q) || num.includes(q);
      })
      .slice(0, 8);
  }, [query, customers]);

  // Selected state — show chip + clear button instead of search input
  if (selectedCustomer) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.6rem 0.75rem',
        background: 'rgba(102,126,234,0.1)',
        border: '1px solid rgba(102,126,234,0.3)',
        borderRadius: '0.5rem',
      }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #818cf8, #6366f1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: '0.9rem', flexShrink: 0,
        }}>
          {(selectedCustomer.firstName || selectedCustomer.name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedCustomer.name || `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim()}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
            {selectedCustomer.phone || (selectedCustomer.phones && selectedCustomer.phones[0]) || ''}
          </div>
        </div>
        {allowClear && (
          <button
            onClick={() => { onSelect(null); setQuery(''); }}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '0.4rem',
              color: '#cbd5e1',
              padding: '0.3rem 0.6rem',
              fontSize: '0.72rem',
              cursor: 'pointer',
            }}
            title={es ? 'Quitar cliente' : 'Clear customer'}
          >
            ✕ {es ? 'Walk-in' : 'Walk-in'}
          </button>
        )}
      </div>
    );
  }

  // Empty state — search input + dropdown
  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={placeholder || (es ? 'Buscar cliente por nombre, teléfono…' : 'Search customer by name, phone…')}
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '0.5rem',
          padding: '0.55rem 0.75rem',
          color: '#e2e8f0',
          fontSize: '0.85rem',
          outline: 'none',
        }}
      />
      {showDropdown && filtered.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 0.25rem)',
          left: 0, right: 0,
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '0.5rem',
          zIndex: 100,
          maxHeight: '280px',
          overflowY: 'auto',
          boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
        }}>
          {filtered.map((c) => (
            <button
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(c); setQuery(''); setShowDropdown(false); }}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.6rem 0.75rem',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                color: '#e2e8f0',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '0.82rem',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(102,126,234,0.08)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                background: 'rgba(102,126,234,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#a5b4fc', fontWeight: 700, fontSize: '0.78rem', flexShrink: 0,
              }}>
                {(c.firstName || c.name || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim()}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>
                  {c.phone || (c.phones && c.phones[0]) || ''}
                  {c.topUpHistory && c.topUpHistory.length > 0 && (
                    <span style={{ marginLeft: '0.5rem', color: '#67e8f9' }}>
                      · {c.topUpHistory.length} {es ? 'recipients' : 'recipients'}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {showDropdown && query.trim() && filtered.length === 0 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 0.25rem)',
          left: 0, right: 0,
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '0.5rem',
          padding: '0.75rem',
          color: '#94a3b8',
          fontSize: '0.78rem',
          textAlign: 'center',
          zIndex: 100,
        }}>
          {es ? 'No se encontraron clientes' : 'No customers found'}
        </div>
      )}

      {/* "+ New Customer" inline button — only when onCreateCustomer is provided */}
      {onCreateCustomer && !selectedCustomer && !showNewForm && (
        <button
          onClick={() => { setShowNewForm(true); setShowDropdown(false); }}
          style={{
            marginTop: '0.4rem', fontSize: '0.72rem', fontWeight: 600,
            color: '#67e8f9', background: 'none', border: 'none',
            cursor: 'pointer', padding: '0.2rem 0',
          }}
        >
          + {es ? 'Nuevo Cliente' : 'New Customer'}
        </button>
      )}

      {/* Inline mini-form for quick customer creation */}
      {showNewForm && (
        <div style={{
          marginTop: '0.5rem', padding: '0.75rem',
          background: 'rgba(102,126,234,0.06)',
          border: '1px solid rgba(102,126,234,0.2)',
          borderRadius: '0.5rem',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '0.5rem' }}>
            {es ? 'Nuevo Cliente Rápido' : 'Quick New Customer'}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
            <input
              autoFocus
              type="text"
              value={newFirst}
              onChange={(e) => setNewFirst(e.target.value)}
              placeholder={es ? 'Nombre *' : 'First name *'}
              style={miniInputStyle}
            />
            <input
              type="text"
              value={newLast}
              onChange={(e) => setNewLast(e.target.value)}
              placeholder={es ? 'Apellido' : 'Last name'}
              style={miniInputStyle}
            />
          </div>
          <input
            type="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCustomer(); }}
            placeholder={es ? 'Teléfono *' : 'Phone *'}
            style={{ ...miniInputStyle, marginBottom: '0.5rem' }}
          />
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowNewForm(false); setNewFirst(''); setNewLast(''); setNewPhone(''); }}
              style={{
                fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '0.35rem',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#cbd5e1', cursor: 'pointer',
              }}
            >
              {es ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              onClick={handleCreateCustomer}
              disabled={!newFirst.trim() || !newPhone.replace(/\D/g, '').trim()}
              style={{
                fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '0.35rem',
                background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.3)',
                color: '#67e8f9', fontWeight: 600, cursor: 'pointer',
                opacity: (!newFirst.trim() || !newPhone.replace(/\D/g, '').trim()) ? 0.5 : 1,
              }}
            >
              {es ? 'Crear y Seleccionar' : 'Create & Select'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const miniInputStyle: React.CSSProperties = {
  flex: 1, width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.4rem',
  padding: '0.4rem 0.6rem',
  color: '#e2e8f0',
  fontSize: '0.78rem',
  outline: 'none',
};
