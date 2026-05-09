// ============================================================
// CellHub Pro — Approval PIN Modal (R-APPROVAL-PIN-V1)
// Reusable manager-PIN gate. Pure UI: holds a 6-digit pin in
// component state ONLY. Never persists, logs, or caches the PIN.
//
// Decoupled from the approval-guard: the parent owns the
// resolve/reject promise and feeds (open, error, onSubmit, onCancel).
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import Modal from '@/components/ui/Modal';

// 35s of inactivity → auto-cancel (clears state + closes modal).
// Sits in the auditor-locked 30–45s window.
const INACTIVITY_TIMEOUT_MS = 35_000;

const PIN_LENGTH = 6;

export type ApprovalPinModalLang = 'en' | 'es' | 'pt';

export interface ApprovalPinModalProps {
  open: boolean;
  /** Display language for built-in copy. Falls back to 'en'. */
  lang?: ApprovalPinModalLang;
  /** Localised label of the action being approved (e.g., "Cancel layaway"). */
  actionLabel: string;
  /** Optional name of the employee that triggered the action. */
  attemptedByName?: string;
  /** Externally controlled error message — shown below the input. */
  errorMessage?: string | null;
  /** Called with the typed PIN when the user submits (Enter / Authorize). */
  onSubmit: (pin: string) => void;
  /** Called when the user cancels (X / ESC / Cancel button / inactivity timeout). */
  onCancel: (reason: 'cancelled' | 'timeout') => void;
}

const COPY = {
  en: {
    title: 'Manager Authorization Required',
    actionLine: 'Action',
    attemptedBy: 'Requested by',
    placeholder: 'Enter 6-digit PIN',
    cancel: 'Cancel',
    authorize: 'Authorize',
    keypadClear: 'Clear',
    keypadBack: '⌫',
  },
  es: {
    title: 'Autorización de Gerente Requerida',
    actionLine: 'Acción',
    attemptedBy: 'Solicitado por',
    placeholder: 'Ingresa PIN de 6 dígitos',
    cancel: 'Cancelar',
    authorize: 'Autorizar',
    keypadClear: 'Borrar',
    keypadBack: '⌫',
  },
  pt: {
    title: 'Autorização do Gerente Necessária',
    actionLine: 'Ação',
    attemptedBy: 'Solicitado por',
    placeholder: 'Digite PIN de 6 dígitos',
    cancel: 'Cancelar',
    authorize: 'Autorizar',
    keypadClear: 'Limpar',
    keypadBack: '⌫',
  },
} as const;

export default function ApprovalPinModal({
  open,
  lang,
  actionLabel,
  attemptedByName,
  errorMessage,
  onSubmit,
  onCancel,
}: ApprovalPinModalProps) {
  const t = COPY[lang || 'en'] || COPY.en;
  const [pin, setPin] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset PIN whenever the modal opens. We never carry a typed value across
  // separate approval requests — security + UX both require a clean slate.
  useEffect(() => {
    if (open) {
      setPin('');
      // Re-focus on next tick — Modal mounts the body just-in-time.
      const tid = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(tid);
    }
    return undefined;
  }, [open]);

  // Inactivity timer. Resets on any input/keystroke; fires onCancel('timeout').
  const armTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPin('');
      onCancel('timeout');
    }, INACTIVITY_TIMEOUT_MS);
  }, [onCancel]);

  useEffect(() => {
    if (!open) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return undefined;
    }
    armTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, armTimer]);

  const submit = useCallback(() => {
    if (pin.length !== PIN_LENGTH) return;
    onSubmit(pin);
    // Parent decides whether to close (success) or keep open with error.
  }, [pin, onSubmit]);

  // Modal-level keyboard handlers — captures even when the input is unfocused.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      armTimer();
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel('cancelled');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel, armTimer]);

  const tap = useCallback((digit: string) => {
    armTimer();
    setPin((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit));
  }, [armTimer]);

  const back = useCallback(() => {
    armTimer();
    setPin((prev) => prev.slice(0, -1));
  }, [armTimer]);

  const clear = useCallback(() => {
    armTimer();
    setPin('');
  }, [armTimer]);

  return (
    <Modal
      open={open}
      onClose={() => onCancel('cancelled')}
      title={`🔐 ${t.title}`}
      size="max-w-sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => onCancel('cancelled')}>
            {t.cancel}
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={pin.length !== PIN_LENGTH}
          >
            {t.authorize}
          </button>
        </>
      }
    >
      <div className="space-y-4" onMouseDown={armTimer} onTouchStart={armTimer}>
        <div style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5 }}>
          <div><strong style={{ color: '#cbd5e1' }}>{t.actionLine}:</strong> {actionLabel}</div>
          {attemptedByName && (
            <div><strong style={{ color: '#cbd5e1' }}>{t.attemptedBy}:</strong> {attemptedByName}</div>
          )}
        </div>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          value={pin}
          onChange={(e) => {
            armTimer();
            setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t.placeholder}
          className={`input text-center text-2xl tracking-widest ${
            errorMessage ? 'border-red-500 ring-1 ring-red-500/50' : ''
          }`}
          style={{ fontFamily: 'Courier New, monospace', letterSpacing: '0.5em' }}
        />

        {errorMessage && (
          <p className="text-red-400 text-sm text-center" role="alert">{errorMessage}</p>
        )}

        {/* Numeric keypad — touch-first, but keyboard still works via the input. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem', marginTop: '0.25rem' }}>
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => tap(d)}
              style={{
                padding: '0.65rem 0',
                borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.04)',
                color: '#e2e8f0',
                fontSize: '1.1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={clear}
            style={{
              padding: '0.65rem 0', borderRadius: '0.5rem',
              border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)',
              color: '#fca5a5', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t.keypadClear}
          </button>
          <button
            type="button"
            onClick={() => tap('0')}
            style={{
              padding: '0.65rem 0', borderRadius: '0.5rem',
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
              color: '#e2e8f0', fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            0
          </button>
          <button
            type="button"
            onClick={back}
            style={{
              padding: '0.65rem 0', borderRadius: '0.5rem',
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
              color: '#e2e8f0', fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t.keypadBack}
          </button>
        </div>
      </div>
    </Modal>
  );
}
