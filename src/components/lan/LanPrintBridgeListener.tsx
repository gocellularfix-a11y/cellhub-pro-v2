// ============================================================
// CellHub Pro — LAN Print Bridge Listener (LAN-HARDWARE-BRIDGE-FOUNDATION-V1)
//
// The print funnel (usePrint.openPrintWindow) is non-React, so when it forwards
// a receipt to the Primary it emits a window event with the result. This global
// component turns that into a friendly, localized toast — so a Secondary feels
// like it printed locally (one click → toast), without exposing network detail.
// Mount once near the app root. Renders nothing.
// ============================================================
import { useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useApp } from '@/store/AppProvider';
import { LAN_PRINT_RESULT_EVENT, type LanPrintResultDetail } from '@/services/lan/lanService';

export default function LanPrintBridgeListener() {
  const { toast } = useToast();
  const { state: { lang } } = useApp();
  const es = lang === 'es';
  const pt = lang === 'pt';
  const tr = (en: string, esT: string, ptT: string) => (es ? esT : pt ? ptT : en);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LanPrintResultDetail>).detail || { ok: false };
      if (detail.ok) {
        toast(tr('Printed on Primary ✓', 'Impreso en la Principal ✓', 'Impresso no Principal ✓'), 'success');
        return;
      }
      const err = detail.error || '';
      // Primary couldn't be reached vs. the Primary's printer failed.
      const unreachable = ['not_paired', 'unreachable', 'no_renderer', 'timeout', 'dispatch_timeout', 'dispatch_unavailable', 'bridge_error', 'not_electron'].includes(err);
      const noPrinter = err === 'no_printer';
      const msg = unreachable
        ? tr('Primary terminal unavailable', 'Terminal principal no disponible', 'Terminal principal indisponível')
        : noPrinter
          ? tr('No printer set on the Primary', 'No hay impresora configurada en la Principal', 'Nenhuma impressora definida no Principal')
          : tr('Printer error on Primary', 'Error de impresora en la Principal', 'Erro de impressora no Principal');
      toast(msg, 'error');
    };
    window.addEventListener(LAN_PRINT_RESULT_EVENT, handler);
    return () => window.removeEventListener(LAN_PRINT_RESULT_EVENT, handler);
    // tr depends on lang; re-subscribe is a cheap add/remove.
  }, [toast, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
