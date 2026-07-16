// ============================================================
// CellHub Pro — LAN Print Bridge Listener (LAN-HARDWARE-BRIDGE-FOUNDATION-V1)
//
// The print funnel (usePrint.openPrintWindow) is non-React, so when it forwards
// a receipt to the Primary it emits a window event with the result. This global
// component turns that into a friendly, localized toast — so a Secondary feels
// like it printed locally (one click → toast), without exposing network detail.
// Mount once near the app root. Renders nothing.
//
// R-PRINT-SERVER-V1: also narrates print-server job progress (Queued (N
// ahead) → Printing → Completed / Failed / Cancelled) and starts the
// printer-cache watcher that refreshes the Primary's printer inventory
// whenever this Secondary (re)connects.
// ============================================================
import { useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useApp } from '@/store/AppProvider';
import { LAN_PRINT_RESULT_EVENT, type LanPrintResultDetail } from '@/services/lan/lanService';
import { startPrinterCacheWatcher } from '@/services/lan/printServerClient';

export default function LanPrintBridgeListener() {
  const { toast } = useToast();
  const { state: { lang } } = useApp();
  const es = lang === 'es';
  const pt = lang === 'pt';
  const tr = (en: string, esT: string, ptT: string) => (es ? esT : pt ? ptT : en);

  // R-PRINT-SERVER-V1: refresh the Primary printer inventory on (re)connect.
  useEffect(() => startPrinterCacheWatcher(), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LanPrintResultDetail>).detail || { ok: false };

      // ── R-PRINT-SERVER-V1: queue progress states ──
      if (detail.state === 'queued') {
        const n = detail.ahead || 0;
        toast(
          n > 0
            ? tr(`Sent to Primary — queued (${n} ahead)`, `Enviado a la Principal — en cola (${n} antes)`, `Enviado ao Principal — na fila (${n} à frente)`)
            : tr('Sent to Primary — printing…', 'Enviado a la Principal — imprimiendo…', 'Enviado ao Principal — imprimindo…'),
          'success',
        );
        return;
      }
      if (detail.state === 'printing') {
        // Quiet transition — the queued toast already said the job was sent;
        // only narrate "printing" for jobs that actually waited in the queue.
        return;
      }
      if (detail.state === 'completed') {
        toast(tr('Printed on Primary ✓', 'Impreso en la Principal ✓', 'Impresso no Principal ✓'), 'success');
        return;
      }
      if (detail.state === 'cancelled') {
        toast(tr('Print job cancelled', 'Trabajo de impresión cancelado', 'Trabalho de impressão cancelado'), 'error');
        return;
      }
      if (detail.state === 'lost') {
        toast(
          tr('Lost track of the print job — check the Primary', 'Se perdió el estado del trabajo — revisa la Principal', 'Perdemos o status do trabalho — verifique o Principal'),
          'error',
        );
        return;
      }
      // R-PRINT-SERVER-V1.1: ambiguous outcome — the Primary may have
      // accepted the job before the ACK was lost. Never auto-printed
      // locally; the operator must check the physical printer first.
      if (detail.state === 'unknown') {
        toast(
          tr('Print status is unknown. Check the printer before retrying.',
             'El estado de la impresión es desconocido. Revisa la impresora antes de reintentar.',
             'O status da impressão é desconhecido. Verifique a impressora antes de tentar novamente.'),
          'error',
        );
        return;
      }

      // ── Legacy / terminal results (silent receipt bridge + failures) ──
      if (detail.ok) {
        toast(tr('Printed on Primary ✓', 'Impreso en la Principal ✓', 'Impresso no Principal ✓'), 'success');
        return;
      }
      const err = detail.error || '';
      // Primary couldn't be reached vs. the Primary's printer failed.
      const unreachable = ['not_paired', 'unreachable', 'no_renderer', 'timeout', 'dispatch_timeout', 'dispatch_unavailable', 'bridge_error', 'not_electron'].includes(err);
      const noPrinter = err === 'no_printer' || err === 'no_receipt_printer' || err === 'printer_not_found';
      // R-2.1.4-LAN-PRINT: a Letter report with no report-printer assigned on
      // the Primary is rejected (never sent to the receipt printer) — tell the
      // operator to assign a report printer, and leave Print available to retry.
      const noReportPrinter = err === 'no_report_printer';
      const msg = unreachable
        ? tr('Primary terminal unavailable — using local printing', 'Terminal principal no disponible — usando impresión local', 'Terminal principal indisponível — usando impressão local')
        : noReportPrinter
          ? tr('Assign a report printer on the Primary (Settings → Hardware → Printer media)',
               'Asigna una impresora de reportes en la Principal (Ajustes → Hardware → Tipo de papel)',
               'Defina uma impressora de relatórios no Principal (Configurações → Hardware → Tipo de papel)')
          : noPrinter
            ? tr('Printer not available on the Primary — refresh and retry', 'Impresora no disponible en la Principal — actualiza y reintenta', 'Impressora não disponível no Principal — atualize e tente novamente')
            : tr('Printer error on Primary — you can retry', 'Error de impresora en la Principal — puedes reintentar', 'Erro de impressora no Principal — você pode tentar novamente');
      toast(msg, 'error');
    };
    window.addEventListener(LAN_PRINT_RESULT_EVENT, handler);
    return () => window.removeEventListener(LAN_PRINT_RESULT_EVENT, handler);
    // tr depends on lang; re-subscribe is a cheap add/remove.
  }, [toast, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
