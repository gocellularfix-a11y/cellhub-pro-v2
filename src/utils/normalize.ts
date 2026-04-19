/**
 * Normalize a carrier name to a canonical form.
 * Handles common variations: "at&t" → "AT&T", "tmobile" → "T-Mobile", etc.
 */
export function normalizeCarrier(raw: string): string {
  if (!raw) return '';
  const lower = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  const map: Record<string, string> = {
    att: 'AT&T',
    atandt: 'AT&T',
    tmobile: 'T-Mobile',
    verizon: 'Verizon',
    simplemobile: 'Simple Mobile',
    h2o: 'H2O',
    h2owireless: 'H2O',
    pageplus: 'Page Plus',
    cricket: 'Cricket',
    ultramobile: 'Ultra Mobile',
    tracfone: 'Tracfone',
    boost: 'Boost Mobile',
    metro: 'Metro by T-Mobile',
    metropcs: 'Metro by T-Mobile',
    metrobytmobile: 'Metro by T-Mobile',
    mint: 'Mint Mobile',
    mintmobile: 'Mint Mobile',
    visible: 'Visible',
  };

  return map[lower] || raw.trim();
}

/**
 * Normalize a phone number to 10-digit format.
 * Strips all non-digits, takes last 10.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  // If 11 digits starting with 1, strip the 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits.slice(-10);
}

/**
 * Format a 10-digit phone number for display.
 * "8058455855" → "(805) 845-5855"
 */
export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Validate a phone number has exactly 10 digits (or is empty).
 */
export function isValidPhone(phone: string): boolean {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length === 0 || digits.length === 10;
}

/**
 * Extract only digits from a phone number.
 */
export function phoneDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}
