// ============================================================
// CellHub Pro — SMS Service
// Sends SMS via Textbelt (through Pipedream proxy) or direct providers.
// ============================================================

import type { StoreSettings } from '@/store/types';

interface SendSmsResult {
  success: boolean;
  error?: string;
}

/**
 * Send an SMS message using the configured provider.
 */
export async function sendSms(
  to: string,
  message: string,
  settings: StoreSettings,
): Promise<SendSmsResult> {
  if (settings.smsProvider === 'none' || !settings.smsApiKey) {
    return { success: false, error: 'SMS not configured' };
  }

  try {
    if (settings.smsProvider === 'textbelt') {
      return await sendViaTextbelt(to, message, settings.smsApiKey);
    }

    // Add other providers here as needed
    return { success: false, error: `Unsupported SMS provider: ${settings.smsProvider}` };
  } catch (err) {
    console.error('[SMS] Send error:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Send via Textbelt API (or Pipedream proxy).
 */
async function sendViaTextbelt(
  to: string,
  message: string,
  apiKey: string,
): Promise<SendSmsResult> {
  const proxyUrl = import.meta.env.VITE_SMS_PROXY_URL;
  const url = proxyUrl || 'https://textbelt.com/text';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: to,
      message,
      key: apiKey,
    }),
  });

  const data = await res.json();

  if (data.success) {
    return { success: true };
  } else {
    return { success: false, error: data.error || 'Textbelt error' };
  }
}

/**
 * Send bulk SMS to multiple recipients.
 */
export async function sendBulkSms(
  recipients: Array<{ phone: string; message: string }>,
  settings: StoreSettings,
  onProgress?: (sent: number, total: number) => void,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i++) {
    const { phone, message } = recipients[i];
    const result = await sendSms(phone, message, settings);

    if (result.success) {
      sent++;
    } else {
      failed++;
    }

    onProgress?.(i + 1, recipients.length);

    // Rate limit: 200ms between messages
    if (i < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { sent, failed };
}
