import Modal from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * When true, the confirm button is disabled, aria-busy=true, and
   * displays `confirmBusyLabel` (or '...' if unset).
   */
  busy?: boolean;
  /**
   * Additive className appended to the confirm button's base class.
   * Use for layout overrides like `min-w-[140px]`. Does NOT replace
   * the variant-driven base class.
   */
  confirmClassName?: string;
  /**
   * Label to show on the confirm button when `busy=true`. If omitted,
   * a neutral placeholder is used — callers are encouraged to pass
   * a translated string (e.g. "Eliminando..." / "Deleting...").
   */
  confirmBusyLabel?: string;
}

export default function ConfirmDialog({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  busy = false,
  confirmClassName = '',
  confirmBusyLabel,
}: ConfirmDialogProps) {
  const btnClass =
    variant === 'danger'
      ? 'btn btn-danger'
      : variant === 'warning'
        ? 'btn btn-warning'
        : 'btn btn-primary';
  const finalBtnClass = confirmClassName ? `${btnClass} ${confirmClassName}` : btnClass;
  // Round 16.1 F2A: always give visual feedback when busy — if caller did not
  // pass confirmBusyLabel, use a language-agnostic '...' so the disabled button
  // doesn't look "dead" displaying the normal label. (No `lang` in scope here;
  // callers are expected to pass a translated busy label.)
  const effectiveLabel = busy ? (confirmBusyLabel ?? '...') : confirmLabel;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="max-w-sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={finalBtnClass} onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {effectiveLabel}
          </button>
        </>
      }
    >
      <p className="text-slate-300">{message}</p>
    </Modal>
  );
}
