import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';
// R-ORBITAL-CORE-IDENTITY-V1: source seal for intelligence-origin toasts.
import OrbitalCoreMark from '@/components/intelligence/OrbitalCoreMark';

// ── Types ─────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'warning' | 'info';

// R-ORBITAL-CORE-IDENTITY-V1: `intelligence: true` marks a toast as
// ORIGINATING from CellHub Intelligence — it gets the compact Orbital Core
// seal IN ADDITION to its operational type icon. Source identity and
// success/error semantics stay separate concepts; operational toasts
// never carry the seal.
export interface ToastOptions {
  intelligence?: boolean;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  intelligence?: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, opts?: ToastOptions) => void;
}

// ── Context ───────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// ── Provider ──────────────────────────────────────────────

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info', opts?: ToastOptions) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type, intelligence: opts?.intelligence }]);

    // Auto-dismiss after 3.5s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${typeClasses[t.type]}`}
            onClick={() => dismiss(t.id)}
          >
            {t.intelligence && <OrbitalCoreMark variant="seal" size={14} decorative />}
            <span className="text-lg">{typeIcons[t.type]}</span>
            <span className="text-sm text-white">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Styles ────────────────────────────────────────────────

const typeClasses: Record<ToastType, string> = {
  success: 'border-emerald-500/30',
  error: 'border-red-500/30',
  warning: 'border-amber-500/30',
  info: 'border-brand-500/30',
};

const typeIcons: Record<ToastType, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};
