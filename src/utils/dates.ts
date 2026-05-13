import type { Timestamp } from '@/store/types';

/**
 * Convert a Firestore Timestamp, Date, or ISO string to a JS Date.
 */
export function toDate(value: Timestamp | Date | string | undefined | null): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if (typeof value === 'object' && 'seconds' in value) {
    return new Date(value.seconds * 1000);
  }
  return new Date();
}

/**
 * Format a date for display.
 * formatDate(date) → "04/02/2026"
 */
export function formatDate(
  value: Timestamp | Date | string | undefined | null,
  locale = 'en-US',
): string {
  return toDate(value).toLocaleDateString(locale, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format a time for display.
 * formatTime(date) → "2:30 PM"
 */
export function formatTime(
  value: Timestamp | Date | string | undefined | null,
  locale = 'en-US',
): string {
  return toDate(value).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format date and time together.
 */
export function formatDateTime(
  value: Timestamp | Date | string | undefined | null,
  locale = 'en-US',
): string {
  return `${formatDate(value, locale)} ${formatTime(value, locale)}`;
}

/**
 * Check if a date is today.
 *
 * R-ISTODAY-MISSING-DATE-FIX: explicit guards for missing/invalid input.
 * Without these, toDate(undefined) returns `new Date()` (NOW), which made
 * isToday(undefined) return TRUE — silently bucketing every record with a
 * missing date into "today". This caused Dashboard.todayRepairProfit and
 * todayUnlockProfit to count old completed entities that happened to be
 * missing completedAt as today's profit.
 */
export function isToday(value: Timestamp | Date | string | undefined | null): boolean {
  if (!value) return false;
  const d = toDate(value);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Get start of today (midnight).
 */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Generate a unique ID (timestamp + random).
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
