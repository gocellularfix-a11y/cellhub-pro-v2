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
  // Round 15b.1 F2: optional busy semantics for the confirm button.
  busy?: boolean;
  confirmClassName?: string;
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
  const effectiveLabel = busy && confirmBusyLabel ? confirmBusyLabel : confirmLabel;

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
