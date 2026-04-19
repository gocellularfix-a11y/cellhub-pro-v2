// ============================================================
// CellHub Pro — Top-Up History helper (r28)
// Updates Customer.topUpHistory[] when a top-up sale completes.
// Pure function — does NOT touch persistence directly. Returns
// the updated Customer object for the caller to persist via the
// existing customersRef anti-stale pattern.
// ============================================================

import type { Customer, TopUpHistoryEntry } from '@/store/types';

/**
 * Parse a SaleItem.notes string in the canonical top-up format
 * (`Provider: X | Sender: Y | Recipient: Z`) and extract the recipient
 * phone + provider. Returns null if the notes don't match the format.
 *
 * Why parse from notes instead of carrying the recipient on the cart item?
 * The cart item shape is shared with all categories and has no recipient
 * field. The notes string is the existing source of truth and parsing it
 * keeps the change surgical — no schema migration needed.
 */
export function parseTopUpNotes(notes: string | undefined | null): {
  provider: string;
  recipient: string;
} | null {
  if (!notes) return null;
  const provMatch = notes.match(/Provider:\s*([^|]+?)(?:\s*\||$)/);
  const recMatch  = notes.match(/Recipient:\s*(\d+)/);
  if (!recMatch) return null;
  return {
    provider: (provMatch?.[1] || '').trim(),
    recipient: recMatch[1],
  };
}

/**
 * Pure update — given a Customer and a list of top-up SaleItems from a
 * just-completed sale, return a NEW Customer with topUpHistory updated.
 * Idempotent at the entry level: if a recipient already exists in history,
 * its `lastAmount` / `lastAt` / `provider` are refreshed and `count` is
 * incremented. New recipients are appended.
 *
 * Items must already be filtered to category === 'top_up'. Each item
 * contributes ONE entry update (regardless of qty — top-ups always have qty=1).
 *
 * Returns the original customer unchanged if no items contribute.
 */
export function recordTopUpsToCustomer(
  customer: Customer,
  topUpItems: Array<{ price: number; notes?: string; qty?: number }>,
  nowIso: string,
): Customer {
  if (!topUpItems || topUpItems.length === 0) return customer;

  // Build a working copy of the history map keyed by recipient for fast lookup
  const existing: TopUpHistoryEntry[] = Array.isArray(customer.topUpHistory)
    ? [...customer.topUpHistory]
    : [];
  const byRecipient = new Map<string, TopUpHistoryEntry>();
  for (const e of existing) byRecipient.set(e.recipient, e);

  let mutated = false;
  for (const item of topUpItems) {
    const parsed = parseTopUpNotes(item.notes);
    if (!parsed || !parsed.recipient) continue;

    const prev = byRecipient.get(parsed.recipient);
    if (prev) {
      byRecipient.set(parsed.recipient, {
        ...prev,
        provider: parsed.provider || prev.provider,
        nickname: prev.nickname,   // preserve user-assigned nickname
        lastAmount: item.price,    // CENTS — already from SaleItem
        lastAt: nowIso,
        count: (prev.count || 0) + 1,
      });
    } else {
      byRecipient.set(parsed.recipient, {
        recipient: parsed.recipient,
        provider: parsed.provider,
        lastAmount: item.price,
        lastAt: nowIso,
        count: 1,
      });
    }
    mutated = true;
  }

  if (!mutated) return customer;

  // Sort by most-recently-used so the modal can render in MRU order
  const updated = Array.from(byRecipient.values()).sort((a, b) => {
    if (b.lastAt !== a.lastAt) return (b.lastAt || '').localeCompare(a.lastAt || '');
    return b.count - a.count;
  });

  return { ...customer, topUpHistory: updated };
}

/**
 * Pure update — set or clear the nickname for a specific recipient in a
 * customer's topUpHistory. Returns a new Customer with the updated history,
 * or the original customer unchanged if the recipient wasn't found.
 */
export function updateNickname(
  customer: Customer,
  recipientNumber: string,
  nickname: string,
): Customer {
  if (!customer.topUpHistory || customer.topUpHistory.length === 0) return customer;

  const idx = customer.topUpHistory.findIndex((e) => e.recipient === recipientNumber);
  if (idx < 0) return customer;

  const updated = [...customer.topUpHistory];
  updated[idx] = { ...updated[idx], nickname: nickname.trim() || undefined };
  return { ...customer, topUpHistory: updated };
}
