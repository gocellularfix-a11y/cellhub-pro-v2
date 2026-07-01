// ============================================================
// PAYMENT DATE FINDER — F2: outreach message builder (EN/ES/PT + tones)
// ============================================================
//
// Pure, deterministic WhatsApp-message generator for the Payment Date
// Finder / Campaign Engine. Builds the "come pay before we close" message
// from the sample in the feature spec, parameterized by tone and language.
//
// Design: this is a DEDICATED builder, separate from the transactional
// DEFAULT_TEMPLATES map in services/whatsapp.ts. Those are flat per-ticket
// templates with no tone axis and different variables; adding a 4-tone
// vacation-collection message there would bloat the WaTemplate union and
// mix concerns. Instead we REUSE the sanitizeToBMP primitive (Windows
// surrogate-pair safety) and compose the message from per-tone/per-lang
// sentence fragments. The actual send still goes through openWhatsApp /
// buildWhatsAppUrl (services/whatsapp.ts) at the UI layer in F3.
//
// NOTHING is sent here — this only returns a string. No DOM, no network,
// no persistence. Estimated due dates must be surfaced as approximate
// ("around" / "aproximadamente" / "aproximadamente em"); callers pass the
// already-formatted date string and the isEstimated flag.
// ============================================================

import { sanitizeToBMP } from '@/services/whatsapp';

export type MessageTone = 'friendly' | 'professional' | 'direct' | 'urgent';
export type MsgLang = 'en' | 'es' | 'pt';

export interface PaymentMessageParams {
  /** Customer full name — only the first token is used in the greeting. */
  customerName: string;
  /** Store/business name for intro + sign-off. */
  storeName: string;
  /** Display-formatted due date (already localized by the caller). Optional. */
  dueDate?: string;
  /** When true, the due date is an estimate → phrased as approximate. */
  isEstimated?: boolean;
  /** Display-formatted closure/vacation window start. Optional. */
  closureStart?: string;
  /** Display-formatted closure/vacation window end. Optional. */
  closureEnd?: string;
}

// Per-language / per-tone sentence fragments. Each returns '' when its input
// is missing so the assembler can drop the clause cleanly. Spanish uses
// tuteo (no voseo).
interface Fragments {
  greeting: (firstName: string) => string;
  intro: (store: string) => string;
  due: (date: string, estimated: boolean) => string;
  closure: (start: string, end: string) => string;
  ask: () => string;
  signoff: (store: string) => string;
}

const FRAGMENTS: Record<MsgLang, Record<MessageTone, Fragments>> = {
  en: {
    friendly: {
      greeting: (n) => `Hi ${n}!`,
      intro: (s) => `This is ${s}.`,
      due: (d, est) => `Your phone payment is due ${est ? 'around ' : 'on '}${d}.`,
      closure: (s, e) => `We'll be out of the office from ${s} through ${e}.`,
      ask: () => `If you'd like to take care of it before then, just let us know and we'll be happy to help you before we leave.`,
      signoff: (s) => `Thank you! — ${s}`,
    },
    professional: {
      greeting: (n) => `Hello ${n},`,
      intro: (s) => `This is ${s}.`,
      due: (d, est) => `Our records show your phone payment is due ${est ? 'approximately ' : 'on '}${d}.`,
      closure: (s, e) => `Please note that we will be closed from ${s} through ${e}.`,
      ask: () => `If you would like to make your payment beforehand, kindly let us know and we will gladly assist you.`,
      signoff: (s) => `Thank you,\n${s}`,
    },
    direct: {
      greeting: (n) => `Hi ${n},`,
      intro: () => ``,
      due: (d, est) => `Your phone payment is due ${est ? 'around ' : 'on '}${d}.`,
      closure: (s, e) => `We'll be closed ${s}–${e}.`,
      ask: () => `Come in before then to pay, or let us know if you'd like help.`,
      signoff: (s) => `— ${s}`,
    },
    urgent: {
      greeting: (n) => `Hi ${n},`,
      intro: () => ``,
      due: (d, est) => `Your phone payment is due ${est ? 'around ' : 'on '}${d} and we're about to close.`,
      closure: (s, e) => `We'll be out from ${s} through ${e}.`,
      ask: () => `Please pay before then to avoid any interruption — reply now and we'll help you right away.`,
      signoff: (s) => `— ${s}`,
    },
  },
  es: {
    friendly: {
      greeting: (n) => `¡Hola ${n}!`,
      intro: (s) => `Te escribimos de ${s}.`,
      due: (d, est) => `Tu pago telefónico vence ${est ? 'aproximadamente el ' : 'el '}${d}.`,
      closure: (s, e) => `Estaremos fuera de la oficina del ${s} al ${e}.`,
      ask: () => `Si deseas realizar tu pago antes de esas fechas, con gusto podemos ayudarte antes de salir.`,
      signoff: (s) => `¡Gracias! — ${s}`,
    },
    professional: {
      greeting: (n) => `Hola ${n},`,
      intro: (s) => `Te contactamos de ${s}.`,
      due: (d, est) => `Según nuestros registros, tu pago telefónico vence ${est ? 'aproximadamente el ' : 'el '}${d}.`,
      closure: (s, e) => `Te informamos que estaremos cerrados del ${s} al ${e}.`,
      ask: () => `Si deseas realizar tu pago antes de esas fechas, por favor avísanos y con gusto te atenderemos.`,
      signoff: (s) => `Gracias,\n${s}`,
    },
    direct: {
      greeting: (n) => `Hola ${n},`,
      intro: () => ``,
      due: (d, est) => `Tu pago telefónico vence ${est ? 'aproximadamente el ' : 'el '}${d}.`,
      closure: (s, e) => `Estaremos cerrados del ${s} al ${e}.`,
      ask: () => `Pasa antes de esas fechas a pagar, o avísanos si necesitas ayuda.`,
      signoff: (s) => `— ${s}`,
    },
    urgent: {
      greeting: (n) => `Hola ${n},`,
      intro: () => ``,
      due: (d, est) => `Tu pago telefónico vence ${est ? 'aproximadamente el ' : 'el '}${d} y estamos por cerrar.`,
      closure: (s, e) => `Estaremos fuera del ${s} al ${e}.`,
      ask: () => `Por favor realiza tu pago antes de esas fechas para evitar cualquier interrupción — respóndenos y te ayudamos de inmediato.`,
      signoff: (s) => `— ${s}`,
    },
  },
  pt: {
    friendly: {
      greeting: (n) => `Oi ${n}!`,
      intro: (s) => `Aqui é da ${s}.`,
      due: (d, est) => `Seu pagamento telefônico vence ${est ? 'aproximadamente em ' : 'em '}${d}.`,
      closure: (s, e) => `Estaremos fora do escritório de ${s} até ${e}.`,
      ask: () => `Se desejar realizar o pagamento antes dessas datas, teremos prazer em ajudá-lo antes de sairmos.`,
      signoff: (s) => `Obrigado! — ${s}`,
    },
    professional: {
      greeting: (n) => `Olá ${n},`,
      intro: (s) => `Entramos em contato da ${s}.`,
      due: (d, est) => `Conforme nossos registros, seu pagamento telefônico vence ${est ? 'aproximadamente em ' : 'em '}${d}.`,
      closure: (s, e) => `Informamos que estaremos fechados de ${s} até ${e}.`,
      ask: () => `Se desejar realizar o pagamento antecipadamente, por favor nos avise e teremos prazer em atendê-lo.`,
      signoff: (s) => `Obrigado,\n${s}`,
    },
    direct: {
      greeting: (n) => `Oi ${n},`,
      intro: () => ``,
      due: (d, est) => `Seu pagamento telefônico vence ${est ? 'aproximadamente em ' : 'em '}${d}.`,
      closure: (s, e) => `Estaremos fechados de ${s} até ${e}.`,
      ask: () => `Passe antes dessas datas para pagar, ou nos avise se precisar de ajuda.`,
      signoff: (s) => `— ${s}`,
    },
    urgent: {
      greeting: (n) => `Oi ${n},`,
      intro: () => ``,
      due: (d, est) => `Seu pagamento telefônico vence ${est ? 'aproximadamente em ' : 'em '}${d} e estamos prestes a fechar.`,
      closure: (s, e) => `Estaremos fora de ${s} até ${e}.`,
      ask: () => `Por favor realize o pagamento antes dessas datas para evitar qualquer interrupção — responda agora e ajudamos você imediatamente.`,
      signoff: (s) => `— ${s}`,
    },
  },
};

/**
 * Build a ready-to-edit WhatsApp payment-collection message.
 *
 * Pure and deterministic: same inputs → same output. Clauses whose inputs
 * are missing are dropped (e.g. no closure window → no "we'll be closed"
 * sentence). The result is BMP-sanitized so it survives Electron's
 * shell.openExternal on Windows.
 */
export function buildPaymentMessage(
  params: PaymentMessageParams,
  lang: MsgLang = 'en',
  tone: MessageTone = 'friendly',
): string {
  const f = (FRAGMENTS[lang] ?? FRAGMENTS.en)[tone] ?? FRAGMENTS.en.friendly;
  const store = (params.storeName || '').trim();
  const firstName = (params.customerName || '').trim().split(/\s+/)[0] || '';

  const dueClause =
    params.dueDate && params.dueDate.trim()
      ? f.due(params.dueDate.trim(), !!params.isEstimated)
      : '';
  const closureClause =
    params.closureStart && params.closureEnd
      ? f.closure(params.closureStart.trim(), params.closureEnd.trim())
      : '';

  const body = [f.intro(store), dueClause, closureClause, f.ask()]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');

  const message = `${f.greeting(firstName)}\n\n${body}\n\n${f.signoff(store)}`;
  return sanitizeToBMP(message).trim();
}

/** All tones, for building a UI selector. */
export const MESSAGE_TONES: MessageTone[] = ['friendly', 'professional', 'direct', 'urgent'];

/** Bilingual display labels for the tone selector (EN/ES/PT). */
export const TONE_LABELS: Record<MessageTone, { en: string; es: string; pt: string }> = {
  friendly: { en: 'Friendly', es: 'Amistoso', pt: 'Amigável' },
  professional: { en: 'Professional', es: 'Profesional', pt: 'Profissional' },
  direct: { en: 'Direct', es: 'Directo', pt: 'Direto' },
  urgent: { en: 'Urgent', es: 'Urgente', pt: 'Urgente' },
};
