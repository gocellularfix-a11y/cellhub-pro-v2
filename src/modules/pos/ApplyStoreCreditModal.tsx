// ============================================================
// R-STORE-CREDIT-REDEMPTION-SYSTEM
// POS modal — apply a store credit certificate to the active cart.
// Scan / search / partial redemption.
//
// Behaviour:
//   - Cashier scans barcode or types certificate # / customer name.
//   - On match, show issued / redeemed / remaining + status badge.
//   - Cashier picks an amount up to min(remaining, cartTotal).
//   - Confirm appends a negative-priced cart line (category 'exchange_credit')
//     carrying storeCreditLedgerId + storeCreditCertNumber. The actual
//     redemption record is appended to the ledger entry inside
//     handleCompleteSale when the sale lands.
// ============================================================

import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n';
import { Modal } from '@/components/ui';
import { findCertificate } from '@/services/storeCredit/ledger';
import type { StoreCreditLedger } from '@/store/types';

interface ApplyStoreCreditModalProps {
  open: boolean;
  onClose: () => void;
  /** Maximum amount the cart can absorb in cents (cart total before credit). */
  maxCartCents: number;
  /** Live ledger from AppState. */
  ledger: StoreCreditLedger[];
  /** Existing cart lines that already redeem a cert — used to block double application. */
  alreadyAppliedLedgerIds?: string[];
  /** Confirm — caller appends the cart line and closes the modal. */
  onConfirm: (entry: StoreCreditLedger, amountCents: number) => void;
}

export default function ApplyStoreCreditModal({
  open, onClose, maxCartCents, ledger, alreadyAppliedLedgerIds, onConfirm,
}: ApplyStoreCreditModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [matched, setMatched] = useState<StoreCreditLedger | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [error, setError] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setMatched(null);
      setAmountInput('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Live search — cert id exact (case-insensitive), customer name partial,
  // customer phone tail.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || matched) return [];
    return ledger
      .filter((l) => l.status === 'active' && (l.remainingAmount || 0) > 0)
      .filter((l) => {
        if ((l.certificateNumber || '').toLowerCase().includes(q)) return true;
        if ((l.customerName || '').toLowerCase().includes(q)) return true;
        const phoneTail = (l.customerPhone || '').replace(/\D/g, '');
        if (phoneTail && phoneTail.includes(q.replace(/\D/g, ''))) return true;
        return false;
      })
      .slice(0, 8);
  }, [query, ledger, matched]);

  // Pressing Enter on an exact cert # match auto-selects it.
  const handleQueryKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const exact = findCertificate(ledger, query.trim());
    if (exact) selectEntry(exact);
  };

  const selectEntry = (entry: StoreCreditLedger) => {
    setError('');
    if (entry.status !== 'active') {
      setError(t('storeCredit.errors.notActive', entry.status));
      return;
    }
    const remaining = Math.max(0, entry.remainingAmount || 0);
    if (remaining <= 0) {
      setError(t('storeCredit.errors.depleted'));
      return;
    }
    if (alreadyAppliedLedgerIds && alreadyAppliedLedgerIds.includes(entry.id)) {
      setError(t('storeCredit.errors.alreadyApplied'));
      return;
    }
    setMatched(entry);
    const cap = Math.max(0, Math.min(remaining, maxCartCents));
    setAmountInput((cap / 100).toFixed(2));
  };

  const remaining = matched ? Math.max(0, matched.remainingAmount || 0) : 0;
  const cap = Math.max(0, Math.min(remaining, maxCartCents));
  const enteredCents = Math.round((parseFloat(amountInput) || 0) * 100);
  const overCap = enteredCents > cap;
  const valid = matched && !overCap && enteredCents > 0;

  const fc = (cents: number) => '$' + (cents / 100).toFixed(2);

  return (
    <Modal open={open} onClose={onClose} title={`🎫 ${t('storeCredit.apply.title')}`} size="max-w-md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {!matched && (
          <>
            <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
              {t('storeCredit.apply.hint')}
            </div>
            <input
              ref={inputRef}
              type="text"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleQueryKey}
              placeholder={t('storeCredit.apply.searchPlaceholder')}
              style={{ fontSize: '0.95rem' }}
              autoFocus
            />
            {suggestions.length > 0 && (
              <div style={{ maxHeight: '220px', overflowY: 'auto', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.08)' }}>
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectEntry(s)}
                    style={{ width: '100%', textAlign: 'left', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.04)', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e2e8f0', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'monospace', color: '#38bdf8', fontWeight: 600 }}>{s.certificateNumber}</span>
                      <span style={{ color: '#10b981', fontWeight: 700 }}>{fc(s.remainingAmount)}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {s.customerName || '—'}{s.customerPhone ? ` · ${s.customerPhone}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {matched && (
          <>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700 }}>{matched.certificateNumber}</span>
                <span style={{ padding: '0.1rem 0.5rem', borderRadius: '999px', background: 'rgba(16,185,129,0.15)', color: '#10b981', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>{matched.status}</span>
              </div>
              <div style={{ color: '#e2e8f0', marginTop: '0.4rem', fontWeight: 600 }}>{matched.customerName}</div>
              {matched.customerPhone && <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{matched.customerPhone}</div>}
              <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.78rem' }}>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.fields.issued')}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{fc(matched.issuedAmount)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.fields.redeemed')}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{fc(matched.redeemedAmount)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.fields.remaining')}</div>
                  <div style={{ color: '#10b981', fontWeight: 700 }}>{fc(matched.remainingAmount)}</div>
                </div>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>
                {t('storeCredit.apply.amountLabel')}
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#10b981', fontWeight: 700 }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(cap / 100).toFixed(2)}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="input"
                  style={{ paddingLeft: '1.75rem', fontSize: '1.1rem', fontWeight: 700 }}
                  autoFocus
                />
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem' }}>
                {t('storeCredit.apply.capHint', fc(cap))}
              </div>
              {overCap && (
                <div style={{ marginTop: '0.4rem', color: '#ef4444', fontSize: '0.78rem' }}>
                  {t('storeCredit.errors.exceedsCap', fc(cap))}
                </div>
              )}
            </div>
          </>
        )}

        {error && (
          <div style={{ color: '#ef4444', fontSize: '0.82rem', background: 'rgba(239,68,68,0.08)', padding: '0.5rem 0.75rem', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.5rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {matched && (
            <button className="btn btn-secondary" onClick={() => { setMatched(null); setAmountInput(''); }}>
              ← {t('storeCredit.apply.changeBtn')}
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            style={{ opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed' }}
            onClick={() => { if (valid && matched) onConfirm(matched, enteredCents); }}
          >
            ✅ {t('storeCredit.apply.confirmBtn', fc(enteredCents))}
          </button>
        </div>
      </div>
    </Modal>
  );
}
