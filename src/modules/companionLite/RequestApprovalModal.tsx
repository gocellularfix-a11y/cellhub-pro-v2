// ============================================================
// Companion Lite — Desktop "Request Approval" form.
//
// Lets the store build a real approval (type + inventory item +
// discount + reason + employee) and ship it to the manager along
// with the productContext + an opening message in the approval
// thread. Used from ApprovalsPanel via Modal.
//
// Hard rule (Companion Lite): no imports from src/services/companion,
// src/modules/companion, or the legacy event-bus / SDK paths.
// ============================================================

import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useApp } from '@/store/AppProvider';
import type { InventoryItem } from '@/store/types';
import type {
  CompanionLiteDesktopSession,
  ProductCostContext,
} from '@/types/companionLite';
import {
  createApproval,
  sendApprovalMessage,
} from '@/services/companionLite/approvalsService';

const APPROVAL_TYPES: Array<{ id: string; label: string }> = [
  { id: 'discount',           label: 'Discount' },
  { id: 'price_override',     label: 'Price override' },
  { id: 'refund',             label: 'Refund' },
  { id: 'layaway_exception',  label: 'Layaway exception' },
  { id: 'repair_discount',    label: 'Repair discount' },
  { id: 'other',              label: 'Other' },
];

interface Props {
  open: boolean;
  session: CompanionLiteDesktopSession;
  onClose: () => void;
  /** Called with the new approval id after a successful create. */
  onCreated: (approvalId: string) => void;
}

export default function RequestApprovalModal({ open, session, onClose, onCreated }: Props) {
  const { state: { inventory, currentEmployee } } = useApp();

  const [type, setType] = useState('discount');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
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
      setError(err instanceof Error ? err.message : 'Could not send approval');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request approval"
      size="max-w-2xl"
      footer={
        <div style={footerStyle}>
          {error && <span style={{ flex: 1, fontSize: 12, color: '#fca5a5' }}>{error}</span>}
          <button onClick={onClose} style={ghostButtonStyle}>Cancel</button>
          <button onClick={() => void handleSubmit()} disabled={!canSubmit} style={primaryButtonStyle}>
            {busy ? 'Sending…' : 'Send approval'}
          </button>
        </div>
      }
    >
      <div style={bodyStyle}>
        {/* Type */}
        <Field label="Approval type">
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            style={inputStyle}
          >
            {APPROVAL_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </Field>

        {/* Inventory search / select */}
        <Field label="Inventory item">
          {selectedItem ? (
            <div style={selectedItemBoxStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                  {selectedItem.name}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  SKU {selectedItem.sku ?? '—'} · Retail ${(selectedItem.price / 100).toFixed(2)}
                  {typeof selectedItem.cost === 'number' && (
                    <> · Cost ${(selectedItem.cost / 100).toFixed(2)}</>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setSelectedItem(null); setSearchQuery(''); }}
                style={clearChipStyle}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search name, SKU, barcode, IMEI…"
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
                  No matches — the approval will be sent without product context.
                </div>
              )}
            </>
          )}
        </Field>

        {/* Discount */}
        <Field label="Requested discount">
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
            <span style={{ color: '#475569', fontSize: 12, margin: '0 6px' }}>or</span>
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
        <Field label="Reason (also becomes the first thread message)">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Customer is requesting a discount because…"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
          />
        </Field>

        {/* Employee name */}
        <Field label="Employee">
          <input
            type="text"
            value={employeeName}
            onChange={e => setEmployeeName(e.target.value)}
            placeholder="Store"
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
  if (!context) {
    return (
      <div style={previewWrapperStyle}>
        <div style={previewHeaderStyle}>Manager decision preview</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {discountCents > 0
            ? `Manual approval — no product attached. Manager will see the reason and the requested amount ($${(discountCents / 100).toFixed(2)}).`
            : 'Select an inventory item to compute margin impact, or send a manual approval without it.'}
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

  let riskLabel = 'No cost data';
  let riskColor = '#64748b';
  if (marginAfter !== null && marginBefore !== null) {
    if (marginAfter <= 0) {
      riskLabel = '🚫 Loss — below cost'; riskColor = '#ef4444';
    } else if (marginBefore > 0 && marginAfter < marginBefore * 0.5) {
      riskLabel = '⚠ Risky — margin halved'; riskColor = '#fbbf24';
    } else {
      riskLabel = '✓ Safe'; riskColor = '#22c55e';
    }
  }

  return (
    <div style={previewWrapperStyle}>
      <div style={previewHeaderStyle}>
        <span>Manager decision preview</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: riskColor }}>{riskLabel}</span>
      </div>
      <div style={previewGridStyle}>
        <Row label="Item" value={context.name ?? '—'} />
        <Row label="SKU" value={context.sku ?? '—'} muted />
        <Row label="Retail" value={fmtMoney(retail)} />
        <Row label="Cost" value={typeof cost === 'number' ? fmtMoney(cost) : 'Cost not available'} muted={typeof cost !== 'number'} />
        <Row label="Current margin" value={marginBefore !== null ? `${fmtMoney(marginBefore)} (${(marginBeforePct ?? 0).toFixed(0)}%)` : '—'} />
        <Row label="Requested discount" value={disc > 0 ? `−${fmtMoney(disc)}` : '—'} />
        <Row label="Margin after" value={marginAfter !== null ? `${fmtMoney(marginAfter)} (${(marginAfterPct ?? 0).toFixed(0)}%)` : '—'} valueColor={riskColor} />
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
  padding: '8px 16px',
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
