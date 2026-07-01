// ============================================================
// CellHub Pro — International Top-Up Modal
// Adapted from GOCELLULARAPP.html lines 4028-4387
// Provider selector + sender + multi-line recipients with frequent suggestions
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { generateId } from '@/utils/dates';
import { updateNickname } from '@/utils/topUpHistory';
import CustomerPicker from '@/components/shared/CustomerPicker';
import { persist } from '@/services/persist';
import { openExternalIfOnline } from '@/hooks/useOnlineStatus';
import { normalizePhone } from '@/utils/normalize';
import type { CartItem, Sale, Customer } from '@/store/types';

type TFn = (key: string, ...args: any[]) => string;

/** Relative date label — e.g. "hace 3 días" / "3 days ago" / "há 3 dias" */
function relativeDate(isoStr: string | undefined, t: TFn): string {
  if (!isoStr) return '';
  try {
    const ms = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return t('topUpModal.justNow');
    if (mins < 60) return t('topUpModal.minutesAgo', mins);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('topUpModal.hoursAgo', hrs);
    const days = Math.floor(hrs / 24);
    if (days < 30) return t('topUpModal.daysAgo', days);
    const months = Math.floor(days / 30);
    return t('topUpModal.monthsAgo', months);
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

// R-CREDENTIAL-TOPUP-COPY-BARCODE-FIX: robust clipboard write mirroring
// PhonePaymentModal.autoCopyPhone. navigator.clipboard.writeText silently fails
// in Chromium/Electron when called without an active user gesture (e.g. from a
// prefill effect), so fall back to the textarea + execCommand path which has no
// gesture requirement. `onSuccess` runs only when the copy actually succeeded.
function robustCopy(text: string, onSuccess: () => void): void {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      const prevActive = document.activeElement as HTMLElement | null;
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
      if (ok) onSuccess();
    } catch { /* clipboard genuinely unavailable */ }
  };
  try {
    const p = navigator.clipboard?.writeText(text);
    if (p && typeof p.then === 'function') p.then(onSuccess).catch(fallback);
    else fallback();
  } catch { fallback(); }
}

export default function TopUpModal({ open, onClose, onAddToCart }: TopUpModalProps) {
  const { state: { lang, settings, sales, customers }, setCustomers } = useApp();
  const { t } = useTranslation();
  const { toast } = useToast();

  // R-TOPUP-AUTOCOPY-SENDER-RECIPIENT: copy field value to clipboard with
  // toast feedback. Empty field shows "nothing to copy" instead of crashing.
  const copyField = useCallback((value: string, label: string) => {
    const v = (value || '').trim();
    if (!v) {
      toast(t('topUpModal.nothingToCopy'), 'info');
      return;
    }
    // R-CREDENTIAL-TOPUP-COPY-BARCODE-FIX: was navigator.clipboard-only (no
    // fallback) → silently failed in Electron. Now uses the shared robust path.
    robustCopy(v, () => toast(t('topUpModal.copied', label), 'success'));
  }, [t, toast]);
  // R-CREDENTIAL-TOPUP-COPY-BARCODE-FIX: dedupe sentinel for sender auto-copy.
  const lastCopiedSenderRef = useRef<string | null>(null);

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

  // R-CREDENTIAL-TOPUP-COPY-BARCODE-FIX: auto-copy the sender when it is set,
  // mirroring PhonePaymentModal. Gated to a complete 10-digit number so typing
  // doesn't copy/toast on every keystroke; deduped so it fires once per sender.
  useEffect(() => {
    const digits = (sender || '').replace(/\D/g, '');
    if (digits.length !== 10) {
      if (digits.length === 0) lastCopiedSenderRef.current = null;
      return;
    }
    if (lastCopiedSenderRef.current === digits) return;
    robustCopy(digits, () => {
      lastCopiedSenderRef.current = digits;
      toast(t('topUpModal.copied', t('topUpModal.senderNumber')), 'success');
    });
  }, [sender, t, toast]);
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
      ⚠️ {t('topUpModal.rateWarning', provider)}
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

  // R-TOPUP-PORTAL-V1: open the configured recharge portal. Single global URL
  // read via double-cast (not in StoreSettings type). Mirrors PhonePaymentModal's
  // portal pattern — openExternalIfOnline guards connectivity. No money/tax math.
  const handleOpenPortal = useCallback(() => {
    const url = (((settings as any).topUpPortalUrl as string | undefined) || '').trim();
    if (!url) {
      toast(t('topUpModal.portalNotConfigured'), 'info');
      return;
    }
    openExternalIfOnline(url, 'topUpPortalWindow', 'noopener,noreferrer');
  }, [settings, t, toast]);

  const handleSubmit = () => {
    setError('');
    if (!provider) {
      setError(t('topUpModal.errorSelectProvider'));
      return;
    }
    if (!sender.trim()) {
      setError(t('topUpModal.errorEnterSender'));
      return;
    }
    if (validLines.length === 0) {
      setError(t('topUpModal.errorAtLeastOne'));
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
        name: `${provider} ${t('topUpModal.itemNameSuffix')}`,
        category: 'top_up',
        price: priceCents,
        cost: Math.round(priceCents * (1 - commissionRate)),
        qty: 1,
        taxable: false,
        cbeEligible: false,
        notes: `Provider: ${provider} | Sender: ${sender} | Recipient: ${line.recipient} | Rate: ${(commissionRate * 100).toFixed(2)}%`,
      };
    });

    // R-TOPUP-CUSTOMER-MATCH-V1: when no customer was explicitly picked, try to
    // recognize the SENDER (payer) number against existing customers by
    // normalized phone. On a match, associate that existing customer via the
    // safe existing linking path so the receipt shows their name. NEVER creates
    // or overwrites a customer. The RECIPIENT (international) number is never
    // used for matching — payer and recipient stay clearly separate.
    let saleCustomer = selectedCustomer;
    if (!saleCustomer) {
      const senderNorm = normalizePhone(sender);
      if (senderNorm) {
        const matched = customers.find((c) => {
          const phones = [c.phone, ...((c.phones as string[] | undefined) || [])];
          return phones.some((p) => normalizePhone(p || '') === senderNorm);
        });
        if (matched) {
          saleCustomer = matched;
          toast(t('topUpModal.customerMatched'), 'info');
        }
      }
    }

    onAddToCart(items, saleCustomer);
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`🌎 ${t('topUpModal.title')}`} size="max-w-2xl">
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
        💡 <strong>{t('topUpModal.multipleRecipientsTitle')}</strong>{' '}
        {t('topUpModal.multipleRecipientsBody')}
      </div>

      {/* r28b: Customer picker — selecting a customer enables persistent recipient memory */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>
          {t('topUpModal.customerOptional')}
        </label>
        <CustomerPicker
          customers={customers}
          selectedCustomer={selectedCustomer}
          onSelect={handleSelectCustomer}
          lang={lang}
          placeholder={t('topUpModal.customerPickerPlaceholder')}
          onCreateCustomer={(newCust) => {
            try {
              const updated = [...customers, newCust];
              setCustomers(updated);
              persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
            } catch (_) { /* defensive */ }
          }}
        />
        {!selectedCustomer && (
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontStyle: 'italic' }}>
            {t('topUpModal.walkInHint')}
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
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-accent-soft)' }}>
              📞 {t('topUpModal.savedRecipients')}
              <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                ({selectedCustomer.topUpHistory?.length || 0})
              </span>
            </span>
            {(selectedCustomer.topUpHistory?.length || 0) >= 4 && (
              <input
                type="text"
                value={recipientFilter}
                onChange={(e) => setRecipientFilter(e.target.value)}
                placeholder={t('topUpModal.searchByNumberOrAlias')}
                style={{
                  fontSize: '0.72rem',
                  padding: '0.25rem 0.5rem',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '0.35rem',
                  color: 'var(--text-primary)',
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
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.15rem',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(102,126,234,0.12)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-input)'; }}
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
                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{entry.provider || '—'}{entry.lastAmount > 0 ? ` · ${formatCurrency(entry.lastAmount)}` : ''}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                  <span>{relativeDate(entry.lastAt, t)}</span>
                  <span
                    role="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditingNicknameFor(entry.recipient);
                      setNicknameInput(entry.nickname || '');
                    }}
                    style={{ cursor: 'pointer', fontSize: '0.72rem', padding: '0.1rem 0.25rem' }}
                    title={t('topUpModal.editNickname')}
                  >
                    ✏️
                  </span>
                </span>
              </button>
            ))}
          </div>
          {customerRecipients.length === 0 && recipientFilter && (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem 0', margin: 0 }}>
              {t('topUpModal.noMatches')}
            </p>
          )}
        </div>
      )}

      {/* Provider selector */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>{t('topUpModal.selectProvider')} *</label>
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
                border: provider === p ? '2px solid #22d3ee' : '1px solid var(--border-default)',
                background: provider === p ? 'rgba(34,211,238,0.15)' : 'var(--bg-input)',
                color: provider === p ? '#67e8f9' : 'var(--text-primary)',
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
          {t('topUpModal.senderNumber')} *
        </label>
        {/* R-TOPUP-AUTOCOPY-SENDER-RECIPIENT: input + copy button row. */}
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch' }}>
          <input
            type="tel"
            style={{ ...inputStyle, flex: 1 }}
            value={sender}
            onChange={(e) => setSender(e.target.value.replace(/\D/g, ''))}
            placeholder={t('topUpModal.senderPlaceholder')}
          />
          <button
            type="button"
            onClick={() => copyField(sender, t('topUpModal.senderNumber'))}
            title={t('topUpModal.copy')}
            aria-label={t('topUpModal.copy')}
            style={copyBtnStyle}
          >
            📋
          </button>
        </div>
        {frequentSenders.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
              {t('topUpModal.frequentSenders')}
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
            {t('topUpModal.recipients')} *
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
            + {t('topUpModal.addLine')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {lines.map((line, idx) => (
            <div key={idx} style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
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
                  placeholder={t('topUpModal.recipientPlaceholder')}
                />
                {/* R-TOPUP-AUTOCOPY-SENDER-RECIPIENT: per-line copy button. */}
                <button
                  type="button"
                  onClick={() => copyField(line.recipient, t('topUpModal.recipientLabel'))}
                  title={t('topUpModal.copy')}
                  aria-label={t('topUpModal.copy')}
                  style={copyBtnStyle}
                >
                  📋
                </button>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  style={{ ...inputStyle, flex: 1, textAlign: 'center', fontWeight: 600 }}
                  value={line.amount}
                  onChange={(e) => handleLineChange(idx, 'amount', e.target.value)}
                  placeholder={t('topUpModal.amountPlaceholder')}
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
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    {sender ? t('topUpModal.sentFromHint', sender) : t('topUpModal.frequentLabel')}
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
              {t('topUpModal.totalToCharge')}
            </span>
            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#22c55e', fontFamily: 'ui-monospace, monospace' }}>
              {formatCurrency(Math.round(totalAmount * 100))}
            </span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            {validLines.length}{' '}
            {t('topUpModal.recipientsPlural', validLines.length)}
            {' '}· {t('topUpModal.noAdditionalFees')}
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
        {/* R-TOPUP-PORTAL-V1: portal opener, left-anchored (mirrors Phone Services). */}
        <button type="button" onClick={handleOpenPortal} className="btn btn-secondary" style={{ marginRight: 'auto' }}>
          🌐 {t('topUpModal.openPortal')}
        </button>
        <button onClick={handleClose} className="btn btn-secondary">
          {t('cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!provider || !sender.trim() || validLines.length === 0}
          className="btn btn-primary"
        >
          + {t('addToCart')}
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
              background: 'var(--bg-secondary)', borderRadius: '0.75rem',
              border: '1px solid var(--border-default)',
              padding: '1.25rem', width: '320px', maxWidth: '90vw',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700 }}>
              ✏️ {t('topUpModal.editNickname')}
            </h3>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              📞 {editingNicknameFor}
            </p>
            <input
              autoFocus
              type="text"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNickname(); }}
              placeholder={t('topUpModal.nicknamePlaceholder')}
              maxLength={40}
              style={{ ...inputStyle, marginBottom: '0.75rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setEditingNicknameFor(null); setNicknameInput(''); }}
                className="btn btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem' }}
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSaveNickname}
                className="btn btn-primary"
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem' }}
              >
                {t('save')}
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
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.75rem',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
};

// R-TOPUP-AUTOCOPY-SENDER-RECIPIENT: minimal icon button matching the
// existing POS chip aesthetic.
const copyBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  background: 'rgba(34,211,238,0.15)',
  border: '1px solid rgba(34,211,238,0.3)',
  borderRadius: '0.5rem',
  padding: '0.4rem 0.6rem',
  color: '#67e8f9',
  fontSize: '0.95rem',
  cursor: 'pointer',
  lineHeight: 1,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  color: 'var(--text-secondary)',
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
    background: active ? 'rgba(34,211,238,0.2)' : 'var(--bg-input)',
    border: `1px solid ${active ? 'rgba(34,211,238,0.4)' : 'var(--border-default)'}`,
    color: active ? '#67e8f9' : 'var(--text-primary)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 600,
  };
}
