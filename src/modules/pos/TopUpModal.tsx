// ============================================================
// CellHub Pro — International Top-Up Modal
// Adapted from GOCELLULARAPP.html lines 4028-4387
// Provider selector + sender + multi-line recipients with frequent suggestions
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import { Modal } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { formatCurrency } from '@/utils/currency';
import { generateId } from '@/utils/dates';
import { updateNickname } from '@/utils/topUpHistory';
import CustomerPicker from '@/components/shared/CustomerPicker';
import { persist } from '@/services/persist';
import type { CartItem, Sale, Customer } from '@/store/types';

/** Relative date label — e.g. "hace 3 días" / "3 days ago" */
function relativeDate(isoStr: string | undefined, esLang: boolean): string {
  if (!isoStr) return '';
  try {
    const ms = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return esLang ? 'ahora' : 'just now';
    if (mins < 60) return esLang ? `hace ${mins} min` : `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return esLang ? `hace ${hrs}h` : `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return esLang ? `hace ${days} día${days > 1 ? 's' : ''}` : `${days}d ago`;
    const months = Math.floor(days / 30);
    return esLang ? `hace ${months} mes${months > 1 ? 'es' : ''}` : `${months}mo ago`;
  } catch { return ''; }
}

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
  onAddToCart: (items: CartItem[], customer?: Customer | null) => void;
}

interface TopUpLine {
  recipient: string;
  amount: string;
}

export default function TopUpModal({ open, onClose, onAddToCart }: TopUpModalProps) {
  const { state: { lang, settings, sales, customers }, setCustomers } = useApp();
  const es = lang === 'es';

  // r28b: customer-aware mode. When a customer is selected, the modal renders
  // their persistent topUpHistory cards. When NULL (walk-in), the legacy
  // frequentSenders/frequentRecipients chips are shown as fallback.
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [recipientFilter, setRecipientFilter] = useState('');

  // Nickname editing state — modal-based, NEVER window.prompt
  const [editingNicknameFor, setEditingNicknameFor] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');

  const [provider, setProvider] = useState('');
  const [sender, setSender] = useState('');
  const [lines, setLines] = useState<TopUpLine[]>([{ recipient: '', amount: '' }]);
  const [error, setError] = useState('');

  // Auto-fill sender when customer is selected
  const handleSelectCustomer = useCallback((c: Customer | null) => {
    setSelectedCustomer(c);
    setRecipientFilter('');
    if (c) {
      const phone = c.phone || (c.phones && c.phones[0]) || '';
      if (phone && !sender) setSender(phone.replace(/\D/g, ''));
    }
  }, [sender]);

  // Nickname save — updates customer in state + persists
  const handleSaveNickname = useCallback(() => {
    if (!selectedCustomer || !editingNicknameFor) return;
    try {
      const updated = updateNickname(selectedCustomer, editingNicknameFor, nicknameInput);
      if (updated !== selectedCustomer) {
        setSelectedCustomer(updated);
        const newCustomers = customers.map((c) => c.id === updated.id ? updated : c);
        setCustomers(newCustomers);
        persist.customer(updated.id, updated as unknown as Record<string, unknown>);
      }
    } catch (_) { /* defensive — don't crash modal */ }
    setEditingNicknameFor(null);
    setNicknameInput('');
  }, [selectedCustomer, editingNicknameFor, nicknameInput, customers, setCustomers]);

  const providers = settings.topUpProviders || [
    'Telcel', 'Movistar', 'AT&T Mexico', 'Unefon', 'International Unlimited', 'Claro',
  ];

  // r-settings-2a5: detect if the currently selected provider is using the
  // fallback commission rate (i.e. user never configured it in Settings).
  // Used to show a warning banner so the owner knows tax accuracy is at risk.
  const providerRateConfigured = !!provider && (
    ((settings as any).topUpCommissions as Record<string, number> | undefined)?.[provider] !== undefined
  );
  const showRateWarning = !!provider && !providerRateConfigured;

  // Frequent senders extracted from past sales
  const frequentSenders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sale of sales as Sale[]) {
      for (const item of sale.items || []) {
        // We stored sender in notes as "Sender: NNN | Recipient: MMM"
        const m = item.notes?.match(/Sender:\s*(\d+)/);
        if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([number, count]) => ({ number, count }));
  }, [sales]);

  // Frequent recipients (filtered by current sender if set) — WALK-IN FALLBACK
  // r28b: this useMemo is preserved verbatim. It's only rendered when
  // selectedCustomer === null. When a customer is selected, the modal renders
  // customer.topUpHistory instead (see customerRecipients below).
  const frequentRecipients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sale of sales as Sale[]) {
      for (const item of sale.items || []) {
        const recMatch = item.notes?.match(/Recipient:\s*(\d+)/);
        const senderMatch = item.notes?.match(/Sender:\s*(\d+)/);
        if (!recMatch) continue;
        if (sender && senderMatch && senderMatch[1] !== sender) continue;
        counts.set(recMatch[1], (counts.get(recMatch[1]) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([number, count]) => ({ number, count }));
  }, [sales, sender]);

  // r28b: when a customer is selected, show their persistent topUpHistory
  // (already MRU-sorted by recordTopUpsToCustomer). Filter by the recipient
  // search input when present.
  const customerRecipients = useMemo(() => {
    if (!selectedCustomer || !selectedCustomer.topUpHistory) return [];
    const q = recipientFilter.trim().toLowerCase();
    if (!q) return selectedCustomer.topUpHistory;
    return selectedCustomer.topUpHistory.filter((e) =>
      e.recipient.includes(q) || (e.nickname || '').toLowerCase().includes(q),
    );
  }, [selectedCustomer, recipientFilter]);

  const totalAmount = lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
  const validLines = lines.filter((l) => l.recipient.trim() && parseFloat(l.amount) > 0);

  // r-settings-2a5: extracted RateWarning JSX into a ref-style local component
  // so it can be rendered cleanly in the right spot. See render below.
  const RateWarningBanner = showRateWarning ? (
    <div style={{
      padding: '0.5rem 0.75rem',
      borderRadius: '0.5rem',
      background: 'rgba(251, 191, 36, 0.08)',
      border: '1px solid rgba(251, 191, 36, 0.3)',
      fontSize: '0.78rem',
      color: '#fbbf24',
      marginTop: '0.5rem',
    }}>
      ⚠️ {es
        ? `${provider} usa el rate por defecto (10%). Configurar rate real en Ajustes → Impuestos para precisión fiscal.`
        : `${provider} is using the default rate (10%). Configure the real rate in Settings → Taxes for tax accuracy.`}
    </div>
  ) : null;

  const reset = () => {
    setProvider('');
    setSender('');
    setLines([{ recipient: '', amount: '' }]);
    setError('');
    // r28b: also reset customer-aware state
    setSelectedCustomer(null);
    setRecipientFilter('');
    setEditingNicknameFor(null);
    setNicknameInput('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleAddLine = () => {
    setLines([...lines, { recipient: '', amount: '' }]);
  };

  const handleRemoveLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, field: keyof TopUpLine, value: string) => {
    const newLines = [...lines];
    if (field === 'recipient') {
      newLines[idx].recipient = value.replace(/\D/g, '');
    } else {
      newLines[idx].amount = value;
    }
    setLines(newLines);
  };

  const handleSubmit = () => {
    setError('');
    if (!provider) {
      setError(es ? 'Selecciona un proveedor' : 'Select a provider');
      return;
    }
    if (!sender.trim()) {
      setError(es ? 'Ingresa el número del remitente' : 'Enter sender phone number');
      return;
    }
    if (validLines.length === 0) {
      setError(es ? 'Ingresa al menos un destinatario con monto' : 'Enter at least one recipient with amount');
      return;
    }

    // Build cart items — one per line.
    // r-settings-2a5: commission rate is now read from settings.topUpCommissions
    // per provider, with a 0.10 fallback for unconfigured providers. The cost
    // basis is `price * (1 - rate)` so that downstream profit/dashboard/tax
    // reports compute the correct income (price - cost = commission earned).
    const commissionRate = ((settings as any).topUpCommissions as Record<string, number> | undefined)?.[provider] ?? 0.10;
    const items: CartItem[] = validLines.map((line) => {
      const amountDollars = parseFloat(line.amount);
      const priceCents = Math.round(amountDollars * 100);
      return {
        id: generateId(),
        name: `${provider} ${es ? 'Recarga' : 'Top-Up'}`,
        category: 'top_up',
        price: priceCents,
        cost: Math.round(priceCents * (1 - commissionRate)),
        qty: 1,
        taxable: false,
        cbeEligible: false,
        notes: `Provider: ${provider} | Sender: ${sender} | Recipient: ${line.recipient} | Rate: ${(commissionRate * 100).toFixed(2)}%`,
      };
    });

    onAddToCart(items, selectedCustomer);
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`🌎 ${es ? 'Recarga Internacional' : 'International Top-Up'}`} size="max-w-2xl">
      {/* Info banner */}
      <div style={{
        background: 'rgba(59,130,246,0.08)',
        border: '1px solid rgba(59,130,246,0.25)',
        borderRadius: '0.625rem',
        padding: '0.75rem 1rem',
        marginBottom: '1.25rem',
        fontSize: '0.78rem',
        color: '#93c5fd',
        lineHeight: 1.5,
      }}>
        💡 <strong>{es ? 'Múltiples destinatarios:' : 'Multiple recipients:'}</strong>{' '}
        {es
          ? 'Agrega varios números con diferentes montos en una sola transacción.'
          : 'Add multiple numbers with different amounts in one transaction.'}
      </div>

      {/* r28b: Customer picker — selecting a customer enables persistent recipient memory */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>
          {es ? 'Cliente (opcional)' : 'Customer (optional)'}
        </label>
        <CustomerPicker
          customers={customers}
          selectedCustomer={selectedCustomer}
          onSelect={handleSelectCustomer}
          lang={lang}
          placeholder={es ? 'Buscar cliente para recordar destinatarios…' : 'Search customer to remember recipients…'}
          onCreateCustomer={(newCust) => {
            try {
              const updated = [...customers, newCust];
              setCustomers(updated);
              persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
            } catch (_) { /* defensive */ }
          }}
        />
        {!selectedCustomer && (
          <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.4rem', fontStyle: 'italic' }}>
            {es
              ? 'Sin cliente: modo walk-in. Selecciona uno para guardar destinatarios.'
              : 'No customer: walk-in mode. Select one to save recipients.'}
          </p>
        )}
      </div>

      {/* r28b: Customer recipients block — only when a customer is selected with history */}
      {selectedCustomer && customerRecipients.length > 0 && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.875rem',
          background: 'rgba(102,126,234,0.06)',
          border: '1px solid rgba(102,126,234,0.2)',
          borderRadius: '0.625rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#a5b4fc' }}>
              📞 {es ? 'Destinatarios guardados' : 'Saved recipients'}
              <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: '#64748b', fontSize: '0.72rem' }}>
                ({selectedCustomer.topUpHistory?.length || 0})
              </span>
            </span>
            {(selectedCustomer.topUpHistory?.length || 0) >= 4 && (
              <input
                type="text"
                value={recipientFilter}
                onChange={(e) => setRecipientFilter(e.target.value)}
                placeholder={es ? 'Buscar por número o alias' : 'Search by number or nickname'}
                style={{
                  fontSize: '0.72rem',
                  padding: '0.25rem 0.5rem',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.35rem',
                  color: '#e2e8f0',
                  width: '120px',
                  outline: 'none',
                }}
              />
            )}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0.5rem',
            maxHeight: '180px',
            overflowY: 'auto',
          }}>
            {customerRecipients.map((entry) => (
              <button
                key={entry.recipient}
                onClick={() => {
                  // Find first empty line, fill it. If none empty, append.
                  const emptyIdx = lines.findIndex((l) => !l.recipient.trim());
                  const amountStr = entry.lastAmount > 0 ? (entry.lastAmount / 100).toFixed(2) : '';
                  if (emptyIdx >= 0) {
                    const newLines = [...lines];
                    newLines[emptyIdx] = { recipient: entry.recipient, amount: amountStr };
                    setLines(newLines);
                  } else {
                    setLines([...lines, { recipient: entry.recipient, amount: amountStr }]);
                  }
                  // Auto-fill provider if empty
                  if (!provider && entry.provider) setProvider(entry.provider);
                }}
                style={{
                  padding: '0.55rem 0.65rem',
                  borderRadius: '0.45rem',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.15rem',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(102,126,234,0.12)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
              >
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 600 }}>
                    📞 {entry.recipient}
                  </span>
                  {entry.count > 1 && (
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 700, color: '#67e8f9',
                      background: 'rgba(34,211,238,0.15)', borderRadius: '0.25rem',
                      padding: '0.1rem 0.35rem', lineHeight: 1.3,
                    }}>
                      {entry.count}×
                    </span>
                  )}
                </span>
                {entry.nickname && (
                  <span style={{ fontSize: '0.7rem', color: '#c4b5fd', fontStyle: 'italic' }}>
                    {entry.nickname}
                  </span>
                )}
                <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{entry.provider || '—'}{entry.lastAmount > 0 ? ` · ${formatCurrency(entry.lastAmount)}` : ''}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.62rem', color: '#64748b' }}>
                  <span>{relativeDate(entry.lastAt, es)}</span>
                  <span
                    role="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditingNicknameFor(entry.recipient);
                      setNicknameInput(entry.nickname || '');
                    }}
                    style={{ cursor: 'pointer', fontSize: '0.72rem', padding: '0.1rem 0.25rem' }}
                    title={es ? 'Editar alias' : 'Edit nickname'}
                  >
                    ✏️
                  </span>
                </span>
              </button>
            ))}
          </div>
          {customerRecipients.length === 0 && recipientFilter && (
            <p style={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'center', padding: '0.5rem 0', margin: 0 }}>
              {es ? 'Sin coincidencias' : 'No matches'}
            </p>
          )}
        </div>
      )}

      {/* Provider selector */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>{es ? 'Seleccionar Proveedor' : 'Select Provider'} *</label>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: '0.5rem',
        }}>
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              style={{
                padding: '0.75rem 0.5rem',
                borderRadius: '0.5rem',
                border: provider === p ? '2px solid #22d3ee' : '1px solid rgba(255,255,255,0.1)',
                background: provider === p ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.04)',
                color: provider === p ? '#67e8f9' : '#cbd5e1',
                fontSize: '0.82rem',
                fontWeight: provider === p ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        {RateWarningBanner}
      </div>

      {/* Sender */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>
          {es ? 'Número que Envía' : 'Sender Number'} *
        </label>
        <input
          type="tel"
          style={inputStyle}
          value={sender}
          onChange={(e) => setSender(e.target.value.replace(/\D/g, ''))}
          placeholder={es ? 'Número del remitente' : 'Sender phone number'}
        />
        {frequentSenders.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.4rem' }}>
              {es ? 'Remitentes frecuentes:' : 'Frequent senders:'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {frequentSenders.map((s) => (
                <button
                  key={s.number}
                  onClick={() => setSender(s.number)}
                  style={chipStyle(sender === s.number)}
                >
                  👤 {s.number}
                  {s.count > 1 && (
                    <span style={{ marginLeft: '0.3rem', opacity: 0.7, fontSize: '0.65rem' }}>
                      ({s.count}x)
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Multi-line recipients */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            {es ? 'Destinatarios' : 'Recipients'} *
          </label>
          <button
            onClick={handleAddLine}
            style={{
              fontSize: '0.72rem',
              padding: '0.35rem 0.7rem',
              borderRadius: '0.4rem',
              background: 'rgba(34,211,238,0.15)',
              border: '1px solid rgba(34,211,238,0.3)',
              color: '#67e8f9',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + {es ? 'Agregar Línea' : 'Add Line'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {lines.map((line, idx) => (
            <div key={idx} style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '0.625rem',
              padding: '0.75rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #22d3ee, #0891b2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: '#0f172a',
                  flexShrink: 0,
                }}>
                  {idx + 1}
                </div>
                <input
                  type="tel"
                  style={{ ...inputStyle, flex: 2 }}
                  value={line.recipient}
                  onChange={(e) => handleLineChange(idx, 'recipient', e.target.value)}
                  placeholder={es ? 'Número del destinatario' : 'Recipient number'}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  style={{ ...inputStyle, flex: 1, textAlign: 'center', fontWeight: 600 }}
                  value={line.amount}
                  onChange={(e) => handleLineChange(idx, 'amount', e.target.value)}
                  placeholder={es ? 'Monto' : 'Amount'}
                />
                {lines.length > 1 && (
                  <button
                    onClick={() => handleRemoveLine(idx)}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '0.4rem',
                      background: 'rgba(239,68,68,0.15)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: '#fca5a5',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Frequent recipient suggestions for empty lines */}
              {!line.recipient && frequentRecipients.length > 0 && (
                <div style={{ marginTop: '0.5rem', paddingLeft: '36px' }}>
                  <div style={{ fontSize: '0.66rem', color: '#64748b', marginBottom: '0.3rem' }}>
                    {sender
                      ? (es ? `📱 Enviados desde ${sender}:` : `📱 Sent from ${sender}:`)
                      : (es ? '📱 Frecuentes:' : '📱 Frequent:')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {frequentRecipients.slice(0, 6).map((r) => (
                      <button
                        key={r.number}
                        onClick={() => handleLineChange(idx, 'recipient', r.number)}
                        style={chipStyle(false)}
                      >
                        📞 {r.number}
                        {r.count > 1 && (
                          <span style={{ marginLeft: '0.25rem', opacity: 0.7, fontSize: '0.6rem' }}>
                            {r.count}x
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Total summary */}
      {totalAmount > 0 && (
        <div style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: '0.625rem',
          padding: '0.875rem 1rem',
          marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#86efac' }}>
              {es ? 'Total a Cobrar' : 'Total to Charge'}
            </span>
            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#22c55e', fontFamily: 'ui-monospace, monospace' }}>
              {formatCurrency(Math.round(totalAmount * 100))}
            </span>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            {validLines.length}{' '}
            {validLines.length === 1
              ? (es ? 'destinatario' : 'recipient')
              : (es ? 'destinatarios' : 'recipients')}
            {' '}· {es ? 'Sin cargos adicionales' : 'No additional fees'}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '0.5rem',
          padding: '0.6rem 0.875rem',
          marginBottom: '1rem',
          fontSize: '0.78rem',
          color: '#fca5a5',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        <button onClick={handleClose} className="btn btn-secondary">
          {es ? 'Cancelar' : 'Cancel'}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!provider || !sender.trim() || validLines.length === 0}
          className="btn btn-primary"
        >
          + {es ? 'Agregar al Carrito' : 'Add to Cart'}
        </button>
      </div>

      {/* Nickname edit modal */}
      {editingNicknameFor && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => { setEditingNicknameFor(null); setNicknameInput(''); }}
        >
          <div
            style={{
              background: '#1e293b', borderRadius: '0.75rem',
              border: '1px solid rgba(255,255,255,0.12)',
              padding: '1.25rem', width: '320px', maxWidth: '90vw',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#e2e8f0', fontWeight: 700 }}>
              ✏️ {es ? 'Editar alias' : 'Edit nickname'}
            </h3>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              📞 {editingNicknameFor}
            </p>
            <input
              autoFocus
              type="text"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNickname(); }}
              placeholder={es ? 'Ej: Mamá, Hermano, Tía Rosa' : 'E.g. Mom, Brother, Aunt Rosa'}
              maxLength={40}
              style={{ ...inputStyle, marginBottom: '0.75rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setEditingNicknameFor(null); setNicknameInput(''); }}
                className="btn btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem' }}
              >
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={handleSaveNickname}
                className="btn btn-primary"
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem' }}
              >
                {es ? 'Guardar' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Inline styles ────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.75rem',
  color: '#e2e8f0',
  fontSize: '0.85rem',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  color: '#94a3b8',
  marginBottom: '0.3rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: '0.7rem',
    padding: '0.3rem 0.55rem',
    borderRadius: '0.35rem',
    background: active ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.05)',
    border: `1px solid ${active ? 'rgba(34,211,238,0.4)' : 'rgba(255,255,255,0.1)'}`,
    color: active ? '#67e8f9' : '#cbd5e1',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 600,
  };
}
