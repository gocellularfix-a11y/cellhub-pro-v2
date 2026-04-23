// ============================================================
// CellHub Pro — SMS Provider Metadata + Validators
// R-SMS-PROVIDERS-CORE
//
// Pure data + credential validators for the 4 supported providers
// (Textbelt, Twilio, Telnyx, Plivo). NO UI logic — consumed by the
// settings form and the send router.
// ============================================================

export type SmsProviderId =
  | 'none'
  | 'textbelt'
  | 'twilio'
  | 'telnyx'
  | 'plivo'
  | 'messagebird'   // legacy, not implemented
  | 'nexmo';        // legacy, not implemented

export interface SmsProviderCredField {
  key: string;
  label: { en: string; es: string };
  placeholder: string;
  secret: boolean;
  validate?: (value: string) => string | null;
}

export interface SmsProviderMeta {
  id: SmsProviderId;
  name: string;
  tagline: { en: string; es: string };
  badge?: { en: string; es: string };
  difficulty: 1 | 2 | 3;
  setupMinutes: string;
  pricePerSms: string;
  monthlyFees: string;
  requires10DLC: boolean;
  credFields: SmsProviderCredField[];
  signupUrl: string;
  docsUrl: string;
  pros: { en: string; es: string }[];
  cons: { en: string; es: string }[];
}

const isTwilioSid = (v: string) => /^AC[a-f0-9]{32}$/i.test(v.trim());
const isPlivoAuthId = (v: string) => /^[A-Z0-9]{20}$/.test(v.trim());
const isUuid = (v: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.trim());
const isE164 = (v: string) => {
  const clean = v.replace(/[^\d+]/g, '');
  return clean.startsWith('+') && /^\+\d{10,15}$/.test(clean);
};

const fromNumberField: SmsProviderCredField = {
  key: 'smsFromNumber',
  label: { en: 'Phone Number', es: 'Número de teléfono' },
  placeholder: '+18055551234',
  secret: false,
  validate: (v) => (!v ? 'Required' : !isE164(v) ? 'Must be E.164 format (+1...)' : null),
};

export const SMS_PROVIDERS: Record<
  'textbelt' | 'twilio' | 'telnyx' | 'plivo',
  SmsProviderMeta
> = {
  textbelt: {
    id: 'textbelt',
    name: 'Textbelt',
    tagline: {
      en: 'Easiest — 1 free SMS/day, paid plans for more',
      es: 'El más fácil — 1 SMS gratis/día',
    },
    badge: { en: 'Easiest', es: 'Más fácil' },
    difficulty: 1,
    setupMinutes: '2 min',
    pricePerSms: '$0.006-$0.010/msg',
    monthlyFees: 'None',
    requires10DLC: false,
    credFields: [
      {
        key: 'smsApiKey',
        label: { en: 'API Key', es: 'Clave API' },
        placeholder: 'textbelt or xxxx_key',
        secret: true,
        validate: (v) => (!v ? 'Required' : null),
      },
    ],
    signupUrl: 'https://textbelt.com',
    docsUrl: 'https://docs.textbelt.com',
    pros: [
      { en: 'No phone number needed', es: 'No requiere número' },
      { en: 'No 10DLC registration', es: 'Sin registro 10DLC' },
      { en: 'Free tier for testing', es: 'Capa gratis para probar' },
    ],
    cons: [
      { en: 'Higher cost at volume', es: 'Más caro a volumen' },
      { en: 'Less delivery visibility', es: 'Menos visibilidad de entrega' },
    ],
  },

  twilio: {
    id: 'twilio',
    name: 'Twilio',
    tagline: {
      en: 'Industry standard — best docs, most reliable',
      es: 'Estándar de la industria',
    },
    badge: { en: 'Most Popular', es: 'Más popular' },
    difficulty: 3,
    setupMinutes: '15-30 min + ~1wk approval',
    pricePerSms: '$0.0083/msg + carrier fees',
    monthlyFees: '$1.15/number + 10DLC fees',
    requires10DLC: true,
    credFields: [
      {
        key: 'smsAccountSid',
        label: { en: 'Account SID', es: 'Account SID' },
        placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        secret: false,
        validate: (v) =>
          !v ? 'Required' : !isTwilioSid(v) ? 'Must be AC + 32 hex chars' : null,
      },
      {
        key: 'smsAuthToken',
        label: { en: 'Auth Token', es: 'Auth Token' },
        placeholder: '32-char auth token',
        secret: true,
        validate: (v) =>
          !v ? 'Required' : v.trim().length < 20 ? 'Token too short' : null,
      },
      fromNumberField,
    ],
    signupUrl: 'https://www.twilio.com/try-twilio',
    docsUrl: 'https://www.twilio.com/docs/messaging',
    pros: [
      { en: 'Best documentation', es: 'Mejor documentación' },
      { en: 'Most reliable US delivery', es: 'Más confiable en US' },
      { en: 'Huge ecosystem', es: 'Ecosistema enorme' },
    ],
    cons: [
      { en: 'Most expensive per-message', es: 'Más caro por mensaje' },
      { en: '10DLC registration required', es: 'Requiere 10DLC' },
      { en: 'Paid support $250/mo+', es: 'Soporte pagado $250/mes+' },
    ],
  },

  telnyx: {
    id: 'telnyx',
    name: 'Telnyx',
    tagline: {
      en: 'Twilio alternative — 30-70% cheaper',
      es: 'Alternativa a Twilio — 30-70% más barato',
    },
    badge: { en: 'Best Value', es: 'Mejor valor' },
    difficulty: 3,
    setupMinutes: '15-30 min + ~1wk approval',
    pricePerSms: '$0.004/msg',
    monthlyFees: '$1.00/number + 10DLC fees',
    requires10DLC: true,
    credFields: [
      {
        key: 'smsApiKey',
        label: { en: 'API Key (v2)', es: 'API Key (v2)' },
        placeholder: 'KEY01XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        secret: true,
        validate: (v) =>
          !v ? 'Required' : !/^KEY[A-Z0-9]{20,}$/i.test(v.trim()) ? 'Must start with KEY' : null,
      },
      {
        key: 'smsMessagingProfileId',
        label: { en: 'Messaging Profile ID', es: 'Messaging Profile ID' },
        placeholder: '400190ff-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        secret: false,
        validate: (v) => (!v ? 'Required' : !isUuid(v) ? 'Must be a UUID' : null),
      },
      fromNumberField,
    ],
    signupUrl: 'https://telnyx.com/sign-up',
    docsUrl: 'https://developers.telnyx.com/docs/messaging',
    pros: [
      { en: '30-70% cheaper than Twilio', es: '30-70% más barato que Twilio' },
      { en: 'Free 24/7 support', es: 'Soporte 24/7 gratis' },
      { en: 'Private global IP network', es: 'Red IP privada global' },
    ],
    cons: [
      { en: '10DLC registration required', es: 'Requiere 10DLC' },
      { en: 'Smaller ecosystem than Twilio', es: 'Ecosistema más chico' },
    ],
  },

  plivo: {
    id: 'plivo',
    name: 'Plivo',
    tagline: {
      en: 'Budget Twilio-like — simple pricing',
      es: 'Alternativa económica estilo Twilio',
    },
    difficulty: 3,
    setupMinutes: '15-30 min + ~1wk approval',
    pricePerSms: '$0.005/msg',
    monthlyFees: '$0.80/number + 10DLC fees',
    requires10DLC: true,
    credFields: [
      {
        key: 'smsAccountSid',
        label: { en: 'Auth ID', es: 'Auth ID' },
        placeholder: 'MAXXXXXXXXXXXXXXXXXX',
        secret: false,
        validate: (v) =>
          !v ? 'Required' : !isPlivoAuthId(v) ? 'Must be 20 uppercase alphanumeric' : null,
      },
      {
        key: 'smsAuthToken',
        label: { en: 'Auth Token', es: 'Auth Token' },
        placeholder: '40-char auth token',
        secret: true,
        validate: (v) =>
          !v ? 'Required' : v.trim().length < 30 ? 'Token too short' : null,
      },
      fromNumberField,
    ],
    signupUrl: 'https://console.plivo.com/accounts/register/',
    docsUrl: 'https://www.plivo.com/docs/sms',
    pros: [
      { en: 'Cheaper than Twilio', es: 'Más barato que Twilio' },
      { en: 'Twilio-like API', es: 'API estilo Twilio' },
      { en: 'Lowest number fee ($0.80)', es: 'Fee más bajo ($0.80)' },
    ],
    cons: [
      { en: '10DLC registration required', es: 'Requiere 10DLC' },
      { en: 'Support less responsive', es: 'Soporte menos responsivo' },
    ],
  },
};

export const SMS_PROVIDER_ORDER: Array<'textbelt' | 'twilio' | 'telnyx' | 'plivo'> = [
  'textbelt',
  'twilio',
  'telnyx',
  'plivo',
];

export function getProviderMeta(
  id: SmsProviderId,
): SmsProviderMeta | null {
  if (id === 'none' || id === 'messagebird' || id === 'nexmo') return null;
  return SMS_PROVIDERS[id] ?? null;
}

export function isLegacyProvider(id: SmsProviderId): boolean {
  return id === 'messagebird' || id === 'nexmo';
}
