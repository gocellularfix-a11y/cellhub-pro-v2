// ============================================================
// CellHub Pro — WhatsApp wa.me Service
// Opens WhatsApp Web/App with a pre-filled message.
// No API, no cost, no approval needed.
// The employee just clicks → WhatsApp opens → hits Send.
// ============================================================

// R-OFFLINE-MODE-GUARD-V1: gate the external WhatsApp open on connectivity.
import { guardOnline } from '@/hooks/useOnlineStatus';

// R-COMMS-WHATSAPP-EMOJI-FIX-V2: strip non-BMP code points (U+10000+)
// before encoding. Electron's shell.openExternal on Windows mangles
// non-BMP UTF-16 surrogate pairs to U+FFFD (�) in the resulting URL.
// Whitelisted BMP symbols (✓, ☺, ★, etc.) survive this path intact.
// R-COMMS-WHATSAPP-EMOJI-FIX-V2.1: exported so Settings can sanitize at
// the persistence boundary (custom templates) — not just at send time.
export function sanitizeToBMP(input: string): string {
  return input.replace(/[\u{10000}-\u{10FFFF}]/gu, '');
}

/**
 * Build a wa.me URL for click-to-chat.
 * Phone must include country code (digits only).
 * e.g. "+1 (805) 555-1234" → "18055551234"
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  // Add US country code if 10 digits and no leading 1
  const e164 = digits.length === 10 ? `1${digits}` : digits;
  const safeMessage = sanitizeToBMP(message);
  if (import.meta.env.DEV && safeMessage !== message) {
    // eslint-disable-next-line no-console
    console.warn('[whatsapp] Non-BMP characters stripped from message', { original: message, safe: safeMessage });
  }
  const encoded = encodeURIComponent(safeMessage);
  return `https://wa.me/${e164}?text=${encoded}`;
}

/**
 * Open WhatsApp with a pre-filled message.
 * Works on desktop (WhatsApp Web) and mobile (WhatsApp app).
 */
export function openWhatsApp(phone: string, message: string): void {
  if (!phone?.trim()) return;
  // R-OFFLINE-MODE-GUARD-V1: WhatsApp needs the internet. When offline, bail out
  // (the guard surfaces the "internet required" toast) instead of opening a tab
  // that can't load. Local-first work is unaffected.
  if (!guardOnline('whatsapp')) return;
  const url = buildWhatsAppUrl(phone, message);
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Pre-built message templates ───────────────────────────

export interface WaTemplateParams {
  customerName: string;
  storeName: string;
  storePhone?: string;
  device?: string;
  balance?: string;      // formatted dollar string e.g. "$45.00"
  ticketNumber?: string;
  itemDescription?: string;
  appointmentDate?: string;
  appointmentTime?: string;
}

export function buildWaMessage(
  template: WaTemplate,
  params: WaTemplateParams,
  lang: 'en' | 'es' | 'pt' = 'en',
  customTemplate?: string,
): string {
  const firstName = params.customerName?.split(' ')[0] || params.customerName || '';

  // Use custom template if provided (from settings)
  const raw = customTemplate || DEFAULT_TEMPLATES[template][lang];

  return raw
    .replace(/{nombre}/g,       firstName)
    .replace(/{name}/g,         firstName)
    .replace(/{dispositivo}/g,  params.device || '')
    .replace(/{device}/g,       params.device || '')
    .replace(/{balance}/g,      params.balance || '$0.00')
    .replace(/{ticket}/g,       params.ticketNumber || '')
    .replace(/{articulo}/g,     params.itemDescription || '')
    .replace(/{item}/g,         params.itemDescription || '')
    .replace(/{tienda}/g,       params.storeName || '')
    .replace(/{store}/g,        params.storeName || '')
    .replace(/{telefono}/g,     params.storePhone || '')
    .replace(/{phone}/g,        params.storePhone || '')
    .replace(/{fecha}/g,        params.appointmentDate || '')
    .replace(/{date}/g,         params.appointmentDate || '')
    .replace(/{hora}/g,         params.appointmentTime || '')
    .replace(/{time}/g,         params.appointmentTime || '')
    .trim();
}

export type WaTemplate =
  | 'repairReady'
  | 'repairReceived'
  | 'repairInProgress'
  | 'balanceDue'
  | 'specialOrderReady'
  | 'layawayReminder'
  | 'appointmentReminder'
  | 'thankYou'
  | 'custom';

// R-COMMS-WHATSAPP-WINDOWS-SAFE-SYMBOLS: template default symbols
// restricted to BMP (Basic Multilingual Plane) characters because
// Electron's shell.openExternal on Windows corrupts non-BMP UTF-16
// surrogate pairs (e.g. F0 9F 98 8A → EF BF BD). See
// R-COMMS-WHATSAPP-EMOJI-RECON-FINAL for full diagnosis.
//
// User can still add non-BMP emojis to their custom templates via
// Settings → WhatsApp tab. They will display correctly when WA
// template is sent through paths NOT going through shell.openExternal,
// and may render as � otherwise. This is a known platform quirk.
export const DEFAULT_TEMPLATES: Record<WaTemplate, { en: string; es: string; pt: string }> = {
  repairReady: {
    en: `Hi {name}! ✓ Your {device} is ready for pickup at {store}. Balance due: {balance}. Come by anytime! — {store}`,
    es: `¡Hola {nombre}! ✓ Tu {dispositivo} ya está listo para recoger en {tienda}. Balance pendiente: {balance}. ¡Te esperamos! — {tienda}`,
    pt: `Oi {name}! ✓ Seu {device} está pronto para retirada em {store}. Saldo pendente: {balance}. Venha quando quiser! — {store}`,
  },
  repairReceived: {
    en: `Hi {name}, we received your {device} for repair. Ticket #{ticket}. We'll message you with updates. — {store}`,
    es: `Hola {nombre}, recibimos tu {dispositivo} para reparación. Ticket #{ticket}. Te avisaremos con actualizaciones. — {tienda}`,
    pt: `Oi {name}, recebemos seu {device} para reparo. Ticket #{ticket}. Te avisaremos com atualizações. — {store}`,
  },
  repairInProgress: {
    en: `Hi {name}, we're working on your {device}. Ticket #{ticket}. We'll notify you when it's ready. — {store}`,
    es: `Hola {nombre}, ya estamos trabajando en tu {dispositivo}. Ticket #{ticket}. Te avisamos cuando esté listo. — {tienda}`,
    pt: `Oi {name}, já estamos trabalhando no seu {device}. Ticket #{ticket}. Te avisamos quando estiver pronto. — {store}`,
  },
  balanceDue: {
    en: `Hi {name}, you have a balance of {balance} due for your {device}. Stop by when you can! — {store}`,
    es: `Hola {nombre}, tienes un saldo pendiente de {balance} por tu {dispositivo}. ¡Pasa cuando puedas! — {tienda}`,
    pt: `Oi {name}, você tem um saldo de {balance} referente ao seu {device}. Passe quando puder! — {store}`,
  },
  specialOrderReady: {
    en: `Hi {name}! ✓ Your order ({item}) has arrived at {store}. Balance: {balance}. Come pick it up! — {store}`,
    es: `¡Hola {nombre}! ✓ Tu pedido ({articulo}) llegó a {tienda}. Balance: {balance}. ¡Pasa a recogerlo! — {tienda}`,
    pt: `Oi {name}! ✓ Seu pedido ({item}) chegou em {store}. Saldo: {balance}. Venha buscar! — {store}`,
  },
  layawayReminder: {
    en: `Hi {name}, reminder: your layaway for {item} has a balance of {balance}. Stop by anytime. — {store}`,
    es: `Hola {nombre}, recuerda que tu apartado de {articulo} tiene un saldo de {balance}. Pasa cuando puedas. — {tienda}`,
    pt: `Oi {name}, lembrete: seu pagamento parcelado de {item} tem saldo de {balance}. Passe quando puder. — {store}`,
  },
  appointmentReminder: {
    en: `Hi {name}, reminder: you have an appointment at {store} on {date} at {time}. See you then! — {store}`,
    es: `Hola {nombre}, recuerda tu cita en {tienda} el {date} a las {time}. ¡Te esperamos! — {tienda}`,
    pt: `Oi {name}, lembrete: você tem um agendamento em {store} no dia {date} às {time}. Te esperamos! — {store}`,
  },
  thankYou: {
    en: `Hi {name}, thank you for visiting {store}! We appreciate your business. See you next time!`,
    es: `¡Hola {nombre}, gracias por visitarnos en {tienda}! Apreciamos tu preferencia. ¡Hasta la próxima!`,
    pt: `Oi {name}, obrigado por visitar {store}! Agradecemos sua preferência. Até a próxima!`,
  },
  custom: {
    en: `Hi {name},`,
    es: `Hola {nombre},`,
    pt: `Oi {name},`,
  },
};

/**
 * Human-readable template variable reference for the settings UI.
 */
export const TEMPLATE_VARIABLES = [
  { key: '{name} / {nombre}',      desc: 'Customer first name' },
  { key: '{device} / {dispositivo}', desc: 'Device (e.g. iPhone 14)' },
  { key: '{balance}',               desc: 'Balance due ($X.XX)' },
  { key: '{ticket}',                desc: 'Ticket number' },
  { key: '{item} / {articulo}',    desc: 'Item / order description' },
  { key: '{store} / {tienda}',     desc: 'Store name' },
  { key: '{phone} / {telefono}',   desc: 'Store phone number' },
  { key: '{date} / {fecha}',       desc: 'Appointment date' },
  { key: '{time} / {hora}',        desc: 'Appointment time' },
];
