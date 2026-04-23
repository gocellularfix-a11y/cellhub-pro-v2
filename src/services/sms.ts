// ============================================================
// CellHub Pro — SMS Service
// R-SMS-PROVIDERS-CORE: routes sends to Textbelt | Twilio | Telnyx | Plivo
// Legacy providers (messagebird, nexmo) return "not implemented".
// ============================================================

import type { StoreSettings } from '@/store/types';

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  providerResponse?: unknown;
}

// Normalize phone to E.164 (+1XXXXXXXXXX for US)
function toE164US(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

// ── Textbelt ────────────────────────────────────────────────────
async function sendTextbelt(
  phone: string,
  message: string,
  settings: StoreSettings,
): Promise<SendSmsResult> {
  const apiKey = settings.smsApiKey;
  if (!apiKey) return { success: false, error: 'Textbelt API key not configured' };
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ phone, message, key: apiKey }).toString(),
    });
    const data = (await res.json()) as {
      success: boolean;
      textId?: string;
      error?: string;
    };
    if (!data.success) {
      return {
        success: false,
        error: data.error || 'Textbelt send failed',
        providerResponse: data,
      };
    }
    return { success: true, messageId: data.textId, providerResponse: data };
  } catch (err) {
    return {
      success: false,
      error: `Textbelt network error: ${(err as Error).message}`,
    };
  }
}

// ── Twilio ──────────────────────────────────────────────────────
async function sendTwilio(
  phone: string,
  message: string,
  settings: StoreSettings,
): Promise<SendSmsResult> {
  const sid = settings.smsAccountSid;
  const token = settings.smsAuthToken;
  const from = settings.smsFromNumber;
  if (!sid || !token || !from) {
    return { success: false, error: 'Twilio credentials not configured' };
  }
  try {
    const body = new URLSearchParams({
      From: from,
      To: toE164US(phone),
      Body: message,
    });
    const auth = btoa(`${sid}:${token}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: body.toString(),
      },
    );
    const data = (await res.json()) as {
      sid?: string;
      message?: string;
      code?: number;
    };
    if (!res.ok) {
      return {
        success: false,
        error: data.message || `Twilio HTTP ${res.status}`,
        providerResponse: data,
      };
    }
    return { success: true, messageId: data.sid, providerResponse: data };
  } catch (err) {
    return {
      success: false,
      error: `Twilio network error: ${(err as Error).message}`,
    };
  }
}

// ── Telnyx ──────────────────────────────────────────────────────
async function sendTelnyx(
  phone: string,
  message: string,
  settings: StoreSettings,
): Promise<SendSmsResult> {
  const key = settings.smsApiKey;
  const profile = settings.smsMessagingProfileId;
  const from = settings.smsFromNumber;
  if (!key || !from) {
    return { success: false, error: 'Telnyx credentials not configured' };
  }
  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from,
        to: toE164US(phone),
        text: message,
        ...(profile ? { messaging_profile_id: profile } : {}),
      }),
    });
    const data = (await res.json()) as {
      data?: { id?: string };
      errors?: Array<{ detail?: string; title?: string }>;
    };
    if (!res.ok || data.errors) {
      const err = data.errors?.[0];
      return {
        success: false,
        error: err?.detail || err?.title || `Telnyx HTTP ${res.status}`,
        providerResponse: data,
      };
    }
    return { success: true, messageId: data.data?.id, providerResponse: data };
  } catch (err) {
    return {
      success: false,
      error: `Telnyx network error: ${(err as Error).message}`,
    };
  }
}

// ── Plivo ───────────────────────────────────────────────────────
async function sendPlivo(
  phone: string,
  message: string,
  settings: StoreSettings,
): Promise<SendSmsResult> {
  const authId = settings.smsAccountSid;
  const authToken = settings.smsAuthToken;
  const from = settings.smsFromNumber;
  if (!authId || !authToken || !from) {
    return { success: false, error: 'Plivo credentials not configured' };
  }
  try {
    const auth = btoa(`${authId}:${authToken}`);
    const res = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Message/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          src: from,
          dst: toE164US(phone),
          text: message,
        }),
      },
    );
    const data = (await res.json()) as {
      message_uuid?: string[];
      error?: string;
      message?: string;
    };
    if (!res.ok || data.error) {
      return {
        success: false,
        error: data.error || data.message || `Plivo HTTP ${res.status}`,
        providerResponse: data,
      };
    }
    return {
      success: true,
      messageId: data.message_uuid?.[0],
      providerResponse: data,
    };
  } catch (err) {
    return {
      success: false,
      error: `Plivo network error: ${(err as Error).message}`,
    };
  }
}

// ── Public API ──────────────────────────────────────────────────
export async function sendSms(
  phone: string,
  message: string,
  settings: StoreSettings,
): Promise<SendSmsResult> {
  const provider = settings.smsProvider || 'none';

  switch (provider) {
    case 'none':
      return { success: false, error: 'SMS provider not configured' };
    case 'textbelt':
      return sendTextbelt(phone, message, settings);
    case 'twilio':
      return sendTwilio(phone, message, settings);
    case 'telnyx':
      return sendTelnyx(phone, message, settings);
    case 'plivo':
      return sendPlivo(phone, message, settings);
    case 'messagebird':
    case 'nexmo':
      return {
        success: false,
        error: `Provider "${provider}" not implemented. Please migrate to Twilio, Telnyx, or Plivo via Settings.`,
      };
    default:
      return { success: false, error: `Unknown SMS provider: ${provider}` };
  }
}

// Test-send helper (used by Wizard in R3)
export async function testSms(
  phone: string,
  settings: StoreSettings,
): Promise<SendSmsResult> {
  const storeName = settings.storeName || 'CellHub Pro';
  const message = `${storeName}: SMS test successful. If you got this, your setup works.`;
  return sendSms(phone, message, settings);
}
