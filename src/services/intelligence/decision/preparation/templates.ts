// ============================================================
// R-INTELLIGENCE-F4A: deterministic draft template registry.
//
// One template per PreparedActionType. Templates are PURE string builders:
// same TemplateContext → same string, no Date, no randomness, no AI/LLM, no
// I/O. Bilingual EN/ES/PT (no voseo). Customer-contact templates personalize
// with a deterministic greeting; GENERIC produces an internal action note (no
// customer message).
//
// These produce DRAFTS only — nothing here sends, queues, or contacts anyone.
// ============================================================

import type { Lang3 } from '@/services/intelligence/chat/handlers';
import type { PreparedActionType } from './PreparedAction';

/** Deterministic, explicit inputs a template may read. No engine, no Date. */
export interface TemplateContext {
  lang: Lang3;
  /** Customer/entity display name when the source carried one. */
  customerName?: string;
  /** Decision headline (already translated). */
  title: string;
  /** Decision reason/observation (already translated). */
  reason: string;
  /** Decision recommended action (already translated). */
  action: string;
}

export type DraftTemplate = (ctx: TemplateContext) => string;

/** Deterministic greeting; falls back to a name-less salutation. */
function greeting(name: string | undefined, lang: Lang3): string {
  const safe = (name ?? '').trim();
  if (lang === 'es') return safe ? `Hola ${safe},` : 'Hola,';
  if (lang === 'pt') return safe ? `Olá ${safe},` : 'Olá,';
  return safe ? `Hi ${safe},` : 'Hi,';
}

const READY_PICKUP: DraftTemplate = ({ customerName, lang }) => {
  const g = greeting(customerName, lang);
  if (lang === 'es')
    return `${g} tu equipo ya está reparado y listo para recoger. Pasa cuando puedas — ¡gracias por tu preferencia!`;
  if (lang === 'pt')
    return `${g} seu aparelho já está reparado e pronto para retirada. Passe quando puder — obrigado pela preferência!`;
  return `${g} your device is repaired and ready for pickup. Stop by whenever you can — thank you!`;
};

const STALE_REPAIR: DraftTemplate = ({ customerName, lang }) => {
  const g = greeting(customerName, lang);
  if (lang === 'es')
    return `${g} te damos una actualización sobre tu reparación. Seguimos trabajando en ella y te avisamos en cuanto esté lista.`;
  if (lang === 'pt')
    return `${g} segue uma atualização sobre o seu reparo. Continuamos trabalhando nele e avisaremos assim que estiver pronto.`;
  return `${g} a quick update on your repair. We're still working on it and will let you know the moment it's ready.`;
};

const OVERDUE_LAYAWAY: DraftTemplate = ({ customerName, lang }) => {
  const g = greeting(customerName, lang);
  if (lang === 'es')
    return `${g} te recordamos que tienes un saldo pendiente. Avísanos cómo te podemos ayudar a completar tu pago — guardamos tu apartado.`;
  if (lang === 'pt')
    return `${g} lembramos que você tem um saldo em aberto. Diga como podemos ajudar a concluir o pagamento — guardamos o seu item.`;
  return `${g} a friendly reminder that you have a remaining balance. Let us know how we can help you complete it — we're holding your item.`;
};

const OUTREACH: DraftTemplate = ({ customerName, lang }) => {
  const g = greeting(customerName, lang);
  if (lang === 'es')
    return `${g} hace tiempo que no te vemos. Pasa a saludar — tenemos novedades y ofertas que te pueden interesar.`;
  if (lang === 'pt')
    return `${g} faz tempo que não o vemos. Apareça para um oi — temos novidades e ofertas que podem lhe interessar.`;
  return `${g} it's been a while! Come say hi — we've got new arrivals and offers you might like.`;
};

const PAYMENT_OPPORTUNITY: DraftTemplate = ({ customerName, lang }) => {
  const g = greeting(customerName, lang);
  if (lang === 'es')
    return `${g} tenemos una opción de pago/promoción que te puede convenir. Pregúntanos los detalles cuando gustes.`;
  if (lang === 'pt')
    return `${g} temos uma opção de pagamento/promoção que pode lhe interessar. Pergunte os detalhes quando quiser.`;
  return `${g} we have a payment/promo option that could be a good fit for you. Ask us for the details anytime.`;
};

/** Internal action note (no customer message). Echoes the decision's own action. */
const GENERIC: DraftTemplate = ({ action, title, lang }) => {
  const body = (action || title || '').trim();
  if (lang === 'es') return `Acción interna preparada: ${body}`;
  if (lang === 'pt') return `Ação interna preparada: ${body}`;
  return `Internal action prepared: ${body}`;
};

/** Central registry — exactly one template per PreparedActionType. */
export const PREPARATION_TEMPLATES: Record<PreparedActionType, DraftTemplate> = {
  READY_PICKUP,
  STALE_REPAIR,
  OVERDUE_LAYAWAY,
  OUTREACH,
  PAYMENT_OPPORTUNITY,
  GENERIC,
};

/** Render a draft for a given type. Pure passthrough to the registry. */
export function renderDraft(type: PreparedActionType, ctx: TemplateContext): string {
  return PREPARATION_TEMPLATES[type](ctx);
}
