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
}: ConfirmDialogProps) {
  const btnClass =
    variant === 'danger'
      ? 'btn btn-danger'
      : variant === 'warning'
        ? 'btn btn-warning'
        : 'btn btn-primary';

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
          <button className={btnClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-slate-300">{message}</p>
    </Modal>
  );
}
