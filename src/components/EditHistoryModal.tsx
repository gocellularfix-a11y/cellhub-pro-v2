import Modal from '@/components/ui/Modal';
import type { EditEntry, OriginalSnapshot } from '@/services/editAudit';

interface Props {
  open: boolean;
  onClose: () => void;
  lang: string;
  editHistory: EditEntry[];
  originalSnapshot?: OriginalSnapshot;
}

const REASON_LABELS: Record<string, { en: string; es: string }> = {
  additional_balance: { en: 'Additional balance', es: 'Balance adicional' },
  absorbed: { en: 'Absorbed by store', es: 'Absorbido por tienda' },
  refund: { en: 'Refund', es: 'Reembolso' },
  typo_correction: { en: 'Typo correction', es: 'Corrección de texto' },
};

function money(cents: unknown): string {
  const n = Number(cents) || 0;
  return '$' + (n / 100).toFixed(2);
}

function formatDate(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleString(lang === 'es' ? 'es-MX' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  // Money fields: display as dollars
  const moneyFields = [
    'laborCost', 'estimatedCost', 'depositAmount', 'price', 'cost',
    'balance', 'total', 'refundOwedAmount', 'absorbedAmount',
  ];
  if (moneyFields.includes(field)) return money(value);
  if (field === 'taxable') return value ? 'ON' : 'OFF';
  return String(value);
}

export default function EditHistoryModal({
  open, onClose, lang, editHistory, originalSnapshot,
}: Props) {
  if (!open) return null;
  const es = lang === 'es';

  return (
    <Modal
      open={open}
      title={es ? `Historial de ediciones (${editHistory.length})` : `Edit History (${editHistory.length})`}
      onClose={onClose}
    >
      <div style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Original snapshot */}
        {originalSnapshot && (
          <div style={{
            padding: '0.75rem',
            background: 'rgba(59, 130, 246, 0.08)',
            borderRadius: '0.5rem',
            borderLeft: '3px solid var(--accent, #3b82f6)',
          }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.25rem' }}>
              {es ? 'Original' : 'Original'} ({formatDate(originalSnapshot.capturedAt, lang)})
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9ca3af)' }}>
              {Object.entries(originalSnapshot.snapshot)
                .filter(([k]) => !['id', 'createdAt', 'updatedAt', 'storeId', 'customerId', 'employeeId', 'trackingToken', 'devicePhoto'].includes(k))
                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                .slice(0, 10)
                .map(([k, v]) => `${k}: ${formatValue(k, v)}`)
                .join(' · ')}
            </div>
          </div>
        )}

        {/* Edit entries */}
        {editHistory.map((entry, i) => {
          const reasonLabel = REASON_LABELS[entry.reason] || { en: entry.reason, es: entry.reason };
          return (
            <div
              key={entry.editedAt}
              style={{
                padding: '0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--border, #374151)',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                  {es ? 'Edición' : 'Edit'} #{i + 1}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #9ca3af)' }}>
                  {formatDate(entry.editedAt, lang)}
                </span>
              </div>

              {/* Who + reason */}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9ca3af)', marginBottom: '0.5rem' }}>
                {es ? 'Por' : 'By'} {entry.editedBy}
                {entry.pinUsedBy !== entry.editedBy && ` · PIN ${entry.pinUsedBy}`}
                {' · '}
                <span style={{
                  padding: '0.125rem 0.375rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  background: entry.reason === 'refund'
                    ? 'rgba(239, 68, 68, 0.15)'
                    : entry.reason === 'additional_balance'
                      ? 'rgba(251, 191, 36, 0.15)'
                      : entry.reason === 'absorbed'
                        ? 'rgba(168, 85, 247, 0.15)'
                        : 'rgba(107, 114, 128, 0.15)',
                  color: entry.reason === 'refund'
                    ? '#f87171'
                    : entry.reason === 'additional_balance'
                      ? '#fbbf24'
                      : entry.reason === 'absorbed'
                        ? '#a78bfa'
                        : '#9ca3af',
                }}>
                  {es ? reasonLabel.es : reasonLabel.en}
                </span>
              </div>

              {/* Changed fields */}
              {entry.fieldsChanged.map((fc, j) => (
                <div key={j} style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                  <span style={{ color: 'var(--text-secondary, #9ca3af)' }}>{fc.field}:</span>{' '}
                  <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{formatValue(fc.field, fc.oldValue)}</span>
                  {' → '}
                  <span style={{ fontWeight: 600 }}>{formatValue(fc.field, fc.newValue)}</span>
                </div>
              ))}

              {/* Side effects */}
              {entry.sideEffects?.refundOwedAmount && (
                <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#f87171' }}>
                  {es ? 'Reembolso pendiente' : 'Refund owed'}: {money(entry.sideEffects.refundOwedAmount)}
                </div>
              )}
              {entry.sideEffects?.absorbedAmount && (
                <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#a78bfa' }}>
                  {es ? 'Absorbido' : 'Absorbed'}: {money(entry.sideEffects.absorbedAmount)}
                </div>
              )}
              {entry.sideEffects?.statusChange && (
                <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#fbbf24' }}>
                  Status: {entry.sideEffects.statusChange.from} → {entry.sideEffects.statusChange.to}
                </div>
              )}

              {/* Note */}
              {entry.note && (
                <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', fontStyle: 'italic', color: 'var(--text-secondary, #9ca3af)' }}>
                  "{entry.note}"
                </div>
              )}
            </div>
          );
        })}

        {editHistory.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary, #9ca3af)', padding: '2rem 0' }}>
            {es ? 'Sin ediciones registradas.' : 'No edits recorded.'}
          </p>
        )}
      </div>
    </Modal>
  );
}
