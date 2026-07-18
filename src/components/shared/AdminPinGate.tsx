import { useState, useCallback, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { authorizeAdminPin, adminPinNotConfiguredMessage, adminPinInvalidMessage } from './adminPinAuth';

interface AdminPinGateProps {
  open: boolean;
  adminPin: string;
  onSuccess: () => void;
  onCancel: () => void;
  // SPECIAL-ORDERS-FRESH-PIN: destructive-action mode. When set, the entered
  // PIN is cleared every time the gate opens so a prior entry can never carry
  // over (fresh challenge each attempt). AdminPinGate already has NO role and
  // NO session bypass; this is opt-in and does not change behavior for other
  // callers (default false). `lang` localizes the messages.
  requireFreshEntry?: boolean;
  lang?: string;
}

export default function AdminPinGate({
  open,
  adminPin,
  onSuccess,
  onCancel,
  requireFreshEntry,
  lang,
}: AdminPinGateProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState(adminPinInvalidMessage(lang));

  // SPECIAL-ORDERS-FRESH-PIN: clear the entry whenever the gate (re)opens, so a
  // fresh PIN must be typed for every destructive attempt — no remembered
  // digits, no reuse. Safe for all callers (a reopened gate starting empty is
  // always correct).
  useEffect(() => {
    if (open) { setPin(''); setError(false); }
  }, [open, requireFreshEntry]);

  const submit = useCallback(() => {
    // Route through the pure authorization contract: no role bypass, no
    // session bypass, and an unconfigured (blank) admin PIN can NEVER approve.
    const result = authorizeAdminPin(pin, adminPin);
    if (result === 'not_configured') {
      setError(true);
      // Destructive/fresh callers get the action-specific localized message;
      // other callers keep the original generic guidance (unchanged behavior).
      setErrorMsg(requireFreshEntry
        ? adminPinNotConfiguredMessage(lang)
        : 'No admin PIN is configured. Set one in Settings → Store Info first.');
      setPin('');
      return;
    }
    if (result === 'ok') {
      setPin('');
      setError(false);
      setErrorMsg(adminPinInvalidMessage(lang));
      onSuccess();
    } else {
      setError(true);
      setErrorMsg(adminPinInvalidMessage(lang));
      setPin('');
    }
  }, [pin, adminPin, lang, onSuccess]);

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
