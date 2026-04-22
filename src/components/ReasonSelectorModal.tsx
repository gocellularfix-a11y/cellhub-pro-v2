import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import type { EditReason } from '@/services/editAudit';

interface ReasonOption {
  value: EditReason;
  labelEn: string;
  labelEs: string;
  descEn: string;
  descEs: string;
  icon: string;
}

const REASONS: ReasonOption[] = [
  {
    value: 'additional_balance',
    labelEn: 'Customer owes more',
    labelEs: 'Cliente debe más',
    descEn: 'Ticket reopens. New balance will appear for collection.',
    descEs: 'Ticket se reabre. Nuevo balance aparecerá para cobro.',
    icon: '💰',
  },
  {
    value: 'absorbed',
    labelEn: 'Store absorbs difference',
    labelEs: 'Tienda absorbe la diferencia',
    descEn: 'Price changes but no refund or additional charge. Logged as store loss.',
    descEs: 'Precio cambia pero sin reembolso ni cargo adicional. Se registra como pérdida.',
    icon: '🏪',
  },
  {
    value: 'refund',
    labelEn: 'Customer gets refund',
    labelEs: 'Cliente recibe reembolso',
    descEn: 'Ticket marked as refund pending. Process refund separately.',
    descEs: 'Ticket marcado como reembolso pendiente. Procesar por separado.',
    icon: '💸',
  },
];

interface Props {
  open: boolean;
  lang: string;
  onSelect: (reason: EditReason, note: string) => void;
  onCancel: () => void;
}

export default function ReasonSelectorModal({ open, lang, onSelect, onCancel }: Props) {
  const [selected, setSelected] = useState<EditReason | null>(null);
  const [note, setNote] = useState('');
  const es = lang === 'es';

  // Reset state when modal closes (prevents stale selection on reopen)
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setNote('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={es ? 'Razón del cambio' : 'Reason for change'}
      onClose={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #9ca3af)', margin: 0 }}>
          {es
            ? 'Campos de dinero fueron modificados. Selecciona la razón:'
            : 'Money fields were modified. Select the reason:'}
        </p>

        {REASONS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setSelected(r.value)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              padding: '0.75rem',
              border: selected === r.value
                ? '2px solid var(--accent, #3b82f6)'
                : '1px solid var(--border, #374151)',
              borderRadius: '0.5rem',
              background: selected === r.value
                ? 'rgba(59, 130, 246, 0.1)'
                : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              color: 'inherit',
            }}
          >
            <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{r.icon}</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                {es ? r.labelEs : r.labelEn}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9ca3af)' }}>
                {es ? r.descEs : r.descEn}
              </div>
            </div>
          </button>
        ))}

        {/* Optional note */}
        <div style={{ marginTop: '0.5rem' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9ca3af)', display: 'block', marginBottom: '0.25rem' }}>
            {es ? 'Nota (opcional)' : 'Note (optional)'}
          </label>
          <input
            type="text"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={es ? 'Razón adicional...' : 'Additional reason...'}
            maxLength={200}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            {es ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={!selected}
            onClick={() => {
              if (selected) onSelect(selected, note);
            }}
          >
            {es ? 'Confirmar' : 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
