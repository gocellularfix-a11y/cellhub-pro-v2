// ============================================================
// CellHub Pro — WhatsApp wa.me Service
// Opens WhatsApp Web/App with a pre-filled message.
// No API, no cost, no approval needed.
// The employee just clicks → WhatsApp opens → hits Send.
// ============================================================

/**
 * Build a wa.me URL for click-to-chat.
 * Phone must include country code (digits only).
 * e.g. "+1 (805) 555-1234" → "18055551234"
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  // Add US country code if 10 digits and no leading 1
  const e164 = digits.length === 10 ? `1${digits}` : digits;
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${e164}?text=${encoded}`;
}

/**
 * Open WhatsApp with a pre-filled message.
 * Works on desktop (WhatsApp Web) and mobile (WhatsApp app).
 */
export function openWhatsApp(phone: string, message: string): void {
  if (!phone?.trim()) return;
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
  lang: 'en' | 'es' = 'en',
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

export const DEFAULT_TEMPLATES: Record<WaTemplate, { en: string; es: string }> = {
  repairReady: {
    en: `Hi {name}! 🎉 Your {device} is ready for pickup at {store}. Balance due: {balance}. Come by anytime! — {store}`,
    es: `¡Hola {nombre}! 🎉 Tu {dispositivo} ya está listo para recoger en {tienda}. Balance pendiente: {balance}. ¡Te esperamos! — {tienda}`,
  },
  repairReceived: {
    en: `Hi {name}, we received your {device} for repair. Ticket #{ticket}. We'll message you with updates. — {store}`,
    es: `Hola {nombre}, recibimos tu {dispositivo} para reparación. Ticket #{ticket}. Te avisaremos con actualizaciones. — {tienda}`,
  },
  repairInProgress: {
    en: `Hi {name}, we're working on your {device}. Ticket #{ticket}. We'll notify you when it's ready. — {store}`,
    es: `Hola {nombre}, ya estamos trabajando en tu {dispositivo}. Ticket #{ticket}. Te avisamos cuando esté listo. — {tienda}`,
  },
  balanceDue: {
    en: `Hi {name}, you have a balance of {balance} due for your {device}. Stop by when you can! — {store}`,
    es: `Hola {nombre}, tienes un saldo pendiente de {balance} por tu {dispositivo}. ¡Pasa cuando puedas! — {tienda}`,
  },
  specialOrderReady: {
    en: `Hi {name}! 📦 Your order ({item}) has arrived at {store}. Balance: {balance}. Come pick it up! — {store}`,
    es: `¡Hola {nombre}! 📦 Tu pedido ({articulo}) llegó a {tienda}. Balance: {balance}. ¡Pasa a recogerlo! — {tienda}`,
  },
  layawayReminder: {
    en: `Hi {name}, reminder: your layaway for {item} has a balance of {balance}. Stop by anytime. — {store}`,
    es: `Hola {nombre}, recuerda que tu apartado de {articulo} tiene un saldo de {balance}. Pasa cuando puedas. — {tienda}`,
  },
  appointmentReminder: {
    en: `Hi {name}, reminder: you have an appointment at {store} on {date} at {time}. See you then! — {store}`,
    es: `Hola {nombre}, recuerda tu cita en {tienda} el {date} a las {time}. ¡Te esperamos! — {tienda}`,
  },
  thankYou: {
    en: `Hi {name}, thank you for visiting {store}! We appreciate your business. See you next time! 😊`,
    es: `¡Hola {nombre}, gracias por visitarnos en {tienda}! Apreciamos tu preferencia. ¡Hasta la próxima! 😊`,
  },
  custom: {
    en: `Hi {name},`,
    es: `Hola {nombre},`,
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
