// ============================================================
// CellHub Pro — LAN Read-Only Guard Listener (LOCAL-LAN-READONLY-GUARD-V1)
//
// The persist layer (src/services/persist.ts) is dependency-free, so when it
// blocks a write on a read-only LAN Secondary it just emits a window event.
// This component is the single place that turns that signal into a friendly,
// localized toast (it has toast + lang access). Throttled so a burst of blocked
// writes shows only one message. Mount once near the app root. Renders nothing.
// ============================================================
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useApp } from '@/store/AppProvider';
import { READONLY_BLOCKED_EVENT } from '@/services/persist';

export default function LanReadOnlyGuardListener() {
  const { toast } = useToast();
  const { state: { lang } } = useApp();
  // Keep lang fresh without re-arming the listener.
  const langRef = useRef(lang);
  langRef.current = lang;
  const lastShown = useRef(0);

  useEffect(() => {
    const handler = () => {
      const now = Date.now();
      // Throttle: a single user action can trigger several blocked writes.
      if (now - lastShown.current < 4000) return;
      lastShown.current = now;
      const l = langRef.current;
      const msg = l === 'es'
        ? 'Terminal secundaria de solo lectura. Las ventas, pagos, cambios de inventario y ediciones deben hacerse en la Principal por ahora.'
        : l === 'pt'
          ? 'Terminal secundário somente leitura. Vendas, pagamentos, alterações de inventário e edições devem ser feitas no Principal por enquanto.'
          : 'Read-only secondary terminal. Sales, payments, inventory changes, and edits must be done on the Primary for now.';
      toast(msg, 'warning');
    };
    window.addEventListener(READONLY_BLOCKED_EVENT, handler);
    return () => window.removeEventListener(READONLY_BLOCKED_EVENT, handler);
  }, [toast]);

  return null;
}
