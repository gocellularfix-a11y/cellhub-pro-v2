// ============================================================
// Companion — Desktop "Request Approval" form.
//
// Lets the store build a real approval (type + inventory item +
// discount + reason + employee) and ship it to the manager along
// with the productContext + an opening message in the approval
// thread. Used from ApprovalsPanel via Modal.
//
// Hard rule (Companion): no imports from src/services/companion,
// src/modules/companion, or the legacy event-bus / SDK paths.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import type { InventoryItem } from '@/store/types';
import type {
  CompanionDesktopSession,
  ProductCostContext,
} from '@/types/companion';
import {
  createApproval,
  sendApprovalMessage,
} from '@/services/companion/approvalsService';

// Labels resolved via t('companion.apprType.<id>') at render time.
const APPROVAL_TYPE_IDS = [
  'discount',
  'price_override',
  'refund',
  'layaway_exception',
  'repair_discount',
  'other',
] as const;

interface Props {
  open: boolean;
  session: CompanionDesktopSession;
  onClose: () => void;
  /** Called with the new approval id after a successful create. */
  onCreated: (approvalId: string) => void;
  /** Optional inventory item to preselect (e.g. when launched from the
   *  Inventory module's per-row approval button). User can still clear
   *  it and pick a different item or send a manual approval. */
  prefilledItem?: InventoryItem | null;
}

export default function RequestApprovalModal({ open, session, onClose, onCreated, prefilledItem }: Props) {
  const { t } = useTranslation();
  const { state: { inventory, currentEmployee } } = useApp();

  const [type, setType] = useState('discount');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(prefilledItem ?? null);
  const [discountMode, setDiscountMode] = useState<'percent' | 'dollars'>('percent');
  const [discountPercent, setDiscountPercent] = useState('15');
  const [discountDollars, setDiscountDollars] = useState('');
  const [reason, setReason] = useState('');
  const [employeeName, setEmployeeName] = useState(currentEmployee?.name ?? 'Store');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh employee default when modal re-opens (currentEmployee may change).
  useMemoOnOpen(open, () => {
    setEmployeeName(currentEmployee?.name ?? 'Store');
    setError(null);
    setBusy(false);
  });

  // Re-apply the prefilledItem whenever the modal opens (so launching
  // from Inventory with item B after a previous open with item A swaps
  // the selection cleanly).
  useEffect(() => {
    if (open) {
      setSelectedItem(prefilledItem ?? null);
      setSearchQuery('');
    }
  }, [open, prefilledItem]);

  const searchResults: InventoryItem[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.length < 2 || selectedItem) return [];
    const out: InventoryItem[] = [];
    for (const it of inventory) {
      if (out.length >= 8) break;
      const hit =
        it.sku?.toLowerCase().includes(q) ||
        it.barcode?.toLowerCase() === q ||
        it.imei?.toLowerCase() === q ||
        it.name?.toLowerCase().includes(q);
      if (hit) out.push(it);
    }
    return out;
  }, [inventory, searchQuery, selectedItem]);

  const retailCents = selectedItem?.price ?? 0;

  // Discount in cents — derived from whichever input mode is active.
  const discountCents = useMemo(() => {
    if (discountMode === 'percent') {
      const pct = parseFloat(discountPercent);
      if (!Number.isFinite(pct) || pct <= 0) return 0;
      if (selectedItem) return Math.round(retailCents * (pct / 100));
      return 0;
    }
    const dollars = parseFloat(discountDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) return 0;
    return Math.round(dollars * 100);
  }, [discountMode, discountPercent, discountDollars, retailCents, selectedItem]);

  // Mirror of the percent value when the user typed dollars (for preview).
  const effectivePercent: number | null = useMemo(() => {
    if (discountMode === 'percent') {
      const v = parseFloat(discountPercent);
      return Number.isFinite(v) ? v : null;
    }
    if (retailCents > 0 && discountCents > 0) {
      return Math.round((discountCents / retailCents) * 100);
    }
    return null;
  }, [discountMode, discountPercent, discountCents, retailCents]);

  const productContext: ProductCostContext | undefined = selectedItem ? {
    name: selectedItem.name,
    sku: selectedItem.sku,
    retailCents,
    costCents: typeof selectedItem.cost === 'number' ? selectedItem.cost : undefined,
    requestedDiscountCents: discountCents > 0 ? discountCents : undefined,
    requestedDiscountPercent: effectivePercent ?? undefined,
  } : undefined;

  const canSubmit = reason.trim().length > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    // Guard: session must be fully configured before hitting the bridge.
    if (!session?.bridgeUrl || !session?.storeId) {
      console.warn('[Companion] RequestApprovalModal: session not configured', {
        hasBridgeUrl: !!session?.bridgeUrl,
        hasStoreId: !!session?.storeId,
      });
      setError(t('companion.modal.notConfigured'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await createApproval(session, {
        type,
        reason: reason.trim(),
        employeeName: employeeName.trim() || 'Store',
        affectedAmountCents: discountCents,
        affectedItem: selectedItem?.name,
        productContext,
        expiresInMs: 15 * 60 * 1000,
      });
      // Drop the same reason as the first thread message so the manager
      // sees the question in the conversation, not just on the card.
      // Non-fatal if it fails — approval is already on the record.
      try {
        await sendApprovalMessage(session, created.id, reason.trim(), employeeName.trim() || 'Store');
      } catch { /* swallow */ }
      onCreated(created.id);
      // Reset form for the next request.
      setReason('');
      setSearchQuery('');
      setSelectedItem(null);
      setDiscountPercent('15');
      setDiscountDollars('');
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.warn('[Companion] createApproval failed:', err);
      // Translate common network/API error codes into operator-friendly messages.
      const msg =
        raw.includes('network_error') || raw.includes('Failed to fetch') || raw.includes('ERR_CONNECTION')
          ? t('companion.modal.connFailed')
          : raw.includes('timeout')
            ? t('companion.modal.timeout')
            : raw.includes('401') || raw.includes('403') || raw.includes('unauthorized')
              ? t('companion.modal.sessionExpired')
              : raw || t('companion.modal.couldNotSend');
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('companion.modal.title')}
      size="max-w-2xl"
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 16px' }}>
          {error && (
            <div style={errorBannerStyle}>
              ⚠ {error}
            </div>
          )}
          <div style={footerStyle}>
            <button onClick={onClose} style={ghostButtonStyle}>{t('companion.modal.cancel')}</button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              style={{
                ...primaryButtonStyle,
                opacity: !canSubmit ? 0.55 : 1,
                cursor: !canSubmit ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? t('companion.modal.sending') : t('companion.modal.send')}
            </button>
          </div>
        </div>
      }
    >
      <div style={bodyStyle}>
        {/* Type */}
        <Field label={t('companion.modal.fieldType')}>
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            style={inputStyle}
          >
            {APPROVAL_TYPE_IDS.map(id => (
              <option key={id} value={id}>{t(`companion.apprType.${id}`)}</option>
            ))}
          </select>
        </Field>

        {/* Inventory search / select */}
        <Field label={t('companion.modal.fieldItem')}>
          {selectedItem ? (
            <div style={selectedItemBoxStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                  {selectedItem.name}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  SKU {selectedItem.sku ?? '—'} · {t('companion.modal.retail')} ${(selectedItem.price / 100).toFixed(2)}
                  {typeof selectedItem.cost === 'number' && (
                    <> · {t('companion.modal.cost')} ${(selectedItem.cost / 100).toFixed(2)}</>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setSelectedItem(null); setSearchQuery(''); }}
                style={clearChipStyle}
              >
                {t('companion.modal.change')}
              </button>
            </div>
          ) : (
            <>
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('companion.modal.searchPlaceholder')}
                style={inputStyle}
              />
              {searchResults.length > 0 && (
                <div style={searchListStyle}>
                  {searchResults.map(it => (
                    <button
                      key={it.id}
                      onClick={() => { setSelectedItem(it); setSearchQuery(''); }}
                      style={searchResultStyle}
                    >
                      <span style={{ flex: 1, color: '#e2e8f0', fontSize: 12, textAlign: 'left' }}>
                        {it.name}
                      </span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        {it.sku ?? '—'} · ${(it.price / 100).toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <div style={{ fontSize: 11, color: '#64748b', padding: '4px 0' }}>
                  {t('companion.modal.noMatches')}
                </div>
              )}
            </>
          )}
        </Field>

        {/* Discount */}
        <Field label={t('companion.modal.fieldDiscount')}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                checked={discountMode === 'percent'}
                onChange={() => setDiscountMode('percent')}
              />
              %
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              disabled={discountMode !== 'percent'}
              value={discountPercent}
              onChange={e => setDiscountPercent(e.target.value)}
              style={{ ...inputStyle, width: 80, opacity: discountMode === 'percent' ? 1 : 0.5 }}
            />
            <span style={{ color: '#475569', fontSize: 12, margin: '0 6px' }}>{t('companion.modal.or')}</span>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                checked={discountMode === 'dollars'}
                onChange={() => setDiscountMode('dollars')}
              />
              $
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              disabled={discountMode !== 'dollars'}
              value={discountDollars}
              onChange={e => setDiscountDollars(e.target.value)}
              placeholder="0.00"
              style={{ ...inputStyle, width: 100, opacity: discountMode === 'dollars' ? 1 : 0.5 }}
            />
          </div>
        </Field>

        {/* Reason / opening message */}
        <Field label={t('companion.modal.fieldReason')}>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={t('companion.modal.reasonPlaceholder')}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
          />
        </Field>

        {/* Employee name */}
        <Field label={t('companion.modal.fieldEmployee')}>
          <input
            type="text"
            value={employeeName}
            onChange={e => setEmployeeName(e.target.value)}
            placeholder={t('companion.role.store')}
            style={inputStyle}
          />
        </Field>

        {/* Manager decision preview */}
        <DecisionPreview context={productContext} discountCents={discountCents} />
      </div>
    </Modal>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

/** Tiny shim: runs `cb` once each time `open` flips from false→true. */
function useMemoOnOpen(open: boolean, cb: () => void): void {
  useMemo(() => { if (open) cb(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ── Decision preview ───────────────────────────────────────────────

function DecisionPreview({
  context, discountCents,
}: {
  context: ProductCostContext | undefined;
  discountCents: number;
}) {
  const { t } = useTranslation();
  if (!context) {
    return (
      <div style={previewWrapperStyle}>
        <div style={previewHeaderStyle}>{t('companion.preview.header')}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {discountCents > 0
            ? t('companion.preview.manualNote', `$${(discountCents / 100).toFixed(2)}`)
            : t('companion.preview.selectItem')}
        </div>
      </div>
    );
  }

  const retail = context.retailCents;
  const cost   = context.costCents;
  const disc   = discountCents > 0 ? discountCents : (context.requestedDiscountCents ?? 0);
  const retailAfter = Math.max(0, retail - disc);

  const marginBefore = typeof cost === 'number' ? retail - cost : null;
  const marginAfter  = typeof cost === 'number' ? retailAfter - cost : null;
  const marginBeforePct = marginBefore !== null && retail > 0 ? (marginBefore / retail) * 100 : null;
  const marginAfterPct  = marginAfter !== null && retailAfter > 0 ? (marginAfter / retailAfter) * 100 : null;

  let riskLabel = t('companion.preview.riskNoCost');
  let riskColor = '#64748b';
  if (marginAfter !== null && marginBefore !== null) {
    if (marginAfter <= 0) {
      riskLabel = t('companion.preview.riskLoss'); riskColor = '#ef4444';
    } else if (marginBefore > 0 && marginAfter < marginBefore * 0.5) {
      riskLabel = t('companion.preview.riskHalved'); riskColor = '#fbbf24';
    } else {
      riskLabel = t('companion.preview.riskSafe'); riskColor = '#22c55e';
    }
  }

  return (
    <div style={previewWrapperStyle}>
      <div style={previewHeaderStyle}>
        <span>{t('companion.preview.header')}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: riskColor }}>{riskLabel}</span>
      </div>
      <div style={previewGridStyle}>
        <Row label={t('companion.preview.rowItem')} value={context.name ?? '—'} />
        <Row label={t('companion.preview.rowSku')} value={context.sku ?? '—'} muted />
        <Row label={t('companion.preview.rowRetail')} value={fmtMoney(retail)} />
        <Row label={t('companion.preview.rowCost')} value={typeof cost === 'number' ? fmtMoney(cost) : t('companion.preview.costNotAvailable')} muted={typeof cost !== 'number'} />
        <Row label={t('companion.preview.rowCurrentMargin')} value={marginBefore !== null ? `${fmtMoney(marginBefore)} (${(marginBeforePct ?? 0).toFixed(0)}%)` : '—'} />
        <Row label={t('companion.preview.rowRequestedDiscount')} value={disc > 0 ? `−${fmtMoney(disc)}` : '—'} />
        <Row label={t('companion.preview.rowMarginAfter')} value={marginAfter !== null ? `${fmtMoney(marginAfter)} (${(marginAfterPct ?? 0).toFixed(0)}%)` : '—'} valueColor={riskColor} />
      </div>
    </div>
  );
}

function Row({ label, value, muted, valueColor }: {
  label: string; value: string; muted?: boolean; valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{
        color: valueColor ?? (muted ? '#64748b' : '#e2e8f0'),
        fontWeight: 600,
        fontFamily: 'monospace',
      }}>
        {value}
      </span>
    </div>
  );
}

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

// ── Styles ─────────────────────────────────────────────────────────

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: '12px 4px',
};
const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(15,23,42,0.6)',
  border: '1px solid rgba(148,163,184,0.20)',
  borderRadius: 8,
  padding: '8px 10px',
  color: '#e2e8f0',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};
const radioLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: '#e2e8f0',
  cursor: 'pointer',
};
const selectedItemBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'rgba(56,189,248,0.08)',
  border: '1px solid rgba(56,189,248,0.30)',
  borderRadius: 8,
  padding: '8px 10px',
};
const clearChipStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(148,163,184,0.25)',
  borderRadius: 6,
  padding: '4px 8px',
  color: '#94a3b8',
  fontSize: 11,
  cursor: 'pointer',
};
const searchListStyle: React.CSSProperties = {
  marginTop: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 220,
  overflowY: 'auto',
  border: '1px solid rgba(148,163,184,0.15)',
  borderRadius: 8,
  background: 'rgba(2,6,15,0.50)',
  padding: 4,
};
const searchResultStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 8px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  borderRadius: 6,
  textAlign: 'left',
};
const previewWrapperStyle: React.CSSProperties = {
  marginTop: 4,
  background: 'rgba(15,23,42,0.6)',
  border: '1px solid rgba(56,189,248,0.30)',
  borderRadius: 10,
  padding: 12,
};
const previewHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 11,
  fontWeight: 700,
  color: '#e2e8f0',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 8,
  paddingBottom: 6,
  borderBottom: '1px solid rgba(148,163,184,0.15)',
};
const previewGridStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};
const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  justifyContent: 'flex-end',
};
const errorBannerStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#fca5a5',
  background: 'rgba(239,68,68,0.10)',
  border: '1px solid rgba(239,68,68,0.30)',
  borderRadius: 6,
  padding: '6px 10px',
  lineHeight: 1.4,
};
const primaryButtonStyle: React.CSSProperties = {
  background: '#38bdf8',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  color: '#000',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};
const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(148,163,184,0.25)',
  borderRadius: 8,
  padding: '8px 14px',
  color: '#94a3b8',
  fontSize: 13,
  cursor: 'pointer',
};
