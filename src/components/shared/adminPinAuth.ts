// ============================================================
// Admin PIN authorization — pure, testable contract.
//
// FRESH re-authentication for destructive actions. There is NO role bypass,
// NO session/cached bypass, and NO empty-PIN approval: authorization depends
// ONLY on the entered PIN matching the CONFIGURED admin PIN. An unconfigured
// (blank) admin PIN can NEVER authorize — it returns 'not_configured', closing
// the comparePin('', '') empty-vs-empty loophole. Unit-tested; the UI (and any
// destructive gate) routes its decision through this function.
// ============================================================

import { comparePin } from '@/utils/pinHash';

export type AdminPinAuthResult = 'ok' | 'invalid' | 'not_configured';

/** Authorize an entered PIN against the configured admin PIN. Never 'ok' when
 *  the configured PIN is blank/missing (even if the entry is also blank). */
export function authorizeAdminPin(entered: string, configured: string | null | undefined): AdminPinAuthResult {
  if (!configured || String(configured).trim() === '') return 'not_configured';
  return comparePin(entered, configured) ? 'ok' : 'invalid';
}

export function adminPinNotConfiguredMessage(lang?: string): string {
  return lang === 'es' ? 'Debe configurar un PIN de administrador antes de cancelar una orden.'
    : lang === 'pt' ? 'É necessário configurar um PIN de administrador antes de cancelar um pedido.'
    : 'An administrator PIN must be configured before an order can be cancelled.';
}

export function adminPinInvalidMessage(lang?: string): string {
  return lang === 'es' ? 'PIN incorrecto. Inténtalo de nuevo.'
    : lang === 'pt' ? 'PIN incorreto. Tente novamente.'
    : 'Invalid PIN. Try again.';
}
