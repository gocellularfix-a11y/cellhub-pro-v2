import { useState, useCallback } from 'react';
import Modal from '@/components/ui/Modal';
import { comparePin } from '@/utils/pinHash';

interface AdminPinGateProps {
  open: boolean;
  adminPin: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function AdminPinGate({
  open,
  adminPin,
  onSuccess,
  onCancel,
}: AdminPinGateProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('Invalid PIN. Try again.');

  // r27 B2: no admin PIN configured → block access entirely.
  // The previous behavior silently allowed '1234' as a fallback, which
  // meant any unconfigured install had a known admin password.
  const noAdminPinConfigured = !adminPin || adminPin.trim() === '';

  const submit = useCallback(() => {
    if (noAdminPinConfigured) {
      setError(true);
      setErrorMsg('No admin PIN is configured. Set one in Settings → Store Info first.');
      setPin('');
      return;
    }
    // r27 B2: hashed compare via bcryptjs (legacy plaintext still works
    // during the migration window — see pinHash.ts comparePin).
    if (comparePin(pin, adminPin)) {
      setPin('');
      setError(false);
      setErrorMsg('Invalid PIN. Try again.');
      onSuccess();
    } else {
      setError(true);
      setErrorMsg('Invalid PIN. Try again.');
      setPin('');
    }
  }, [pin, adminPin, noAdminPinConfigured, onSuccess]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') submit();
    },
    [submit],
  );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="🔐 Admin Authorization Required"
      size="max-w-sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Authorize
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-slate-400 text-sm">
          Enter the admin PIN to access this feature.
        </p>
        <input
          type="password"
          maxLength={8}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter PIN"
          className={`input text-center text-2xl tracking-widest ${
            error ? 'border-red-500 ring-1 ring-red-500/50' : ''
          }`}
          autoFocus
        />
        {error && (
          <p className="text-red-400 text-sm text-center">{errorMsg}</p>
        )}
      </div>
    </Modal>
  );
}
