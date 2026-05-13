// ============================================================
// CellHub Intelligence — Outreach Action Queue
// R-INTEL-AUTO-ACTION-QUEUE
//
// Persistent queue of actionable outreach tasks (WhatsApp messages, tasks)
// surfaced by the intelligence engine. Owner-facing only — no auto-send.
// Pure compute + localStorage; no React, no external APIs.
//
// Dedup: an item with the same (customerId, type) tuple created within the
// last 24h is treated as a duplicate and silently skipped. This keeps the
// queue idempotent across repeated engine.refresh() calls (one per chat
// query) without growing unbounded.
//
// Priority: higher = more urgent. The producer (IntelligenceEngine) bakes
// "high-value customer first" + "inactivity > 14 days" boosts directly into
// the priority value before enqueue. This module just sorts by it.
// ============================================================

import type { ActionQueueItem } from './types';

const QUEUE_KEY = 'cellhub_intel_action_queue';
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function readQueue(): ActionQueueItem[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActionQueueItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: ActionQueueItem[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Quota / serialization failure — non-fatal, queue is best-effort.
  }
}

/** Read the persisted queue (sorted by priority desc on write). */
export function getOutreachQueue(): ActionQueueItem[] {
  return readQueue();
}

/** Wipe the queue. Manual maintenance — not called automatically. */
export function clearOutreachQueue(): void {
  writeQueue([]);
}

/**
 * Append candidates to the queue, deduping by (customerId, type) within
 * the last 24h. Items without a customerId pass through (e.g. generic
 * 'task' entries with no customer target). Final queue is sorted by
 * priority desc. Returns the items actually inserted (skipped duplicates
 * omitted) so callers can count what they queued this run.
 */
export function enqueueOutreachActions(
  candidates: ActionQueueItem[],
): ActionQueueItem[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const queue = readQueue();
  const now = Date.now();
  const inserted: ActionQueueItem[] = [];

  for (const c of candidates) {
    if (c.customerId) {
      const dup = queue.find((q) =>
        q.customerId === c.customerId
        && q.type === c.type
        && (now - (q.createdAt || 0)) < DEDUP_WINDOW_MS,
      );
      if (dup) continue;
    }
    queue.push(c);
    inserted.push(c);
  }

  if (inserted.length === 0) return [];

  queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  writeQueue(queue);
  return inserted;
}

// ============================================================
// R-INTEL-WHATSAPP-EXECUTION-V1
// 1-click WhatsApp execution for queued intelligence actions.
// Uses wa.me deep link only — no API calls, no auto-send. The owner
// clicks an action, we open the WhatsApp link in a new window and
// mark the item as sent so it cannot execute again.
// ============================================================

/**
 * Normalize a phone number for use in a wa.me URL.
 *
 * - Strips all non-digit characters.
 * - If the cleaned number is exactly 10 digits, prefixes the US country
 *   code "1" (matches the dominant US use case for the shop).
 * - If the number already has a country code (>10 digits), returns it
 *   as-is (digits only).
 * - Returns digits only — wa.me accepts the international number with
 *   no leading "+" or formatting.
 */
export function normalizePhoneForWhatsApp(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

/**
 * Mark an action as sent. Sets status='sent' and sentAt=now. Returns
 * true if the item was found and updated, false otherwise. Standalone
 * helper for callers that mark sent without going through the wa.me
 * deep link (e.g. owner manually marking a message they sent another
 * way).
 */
export function markActionAsSent(id: string): boolean {
  const queue = readQueue();
  const item = queue.find((q) => q.id === id);
  if (!item) return false;
  item.status = 'sent';
  item.sentAt = Date.now();
  writeQueue(queue);
  return true;
}

/**
 * Execute a queued WhatsApp action: build the wa.me deep link, open it
 * in a new window, and mark the item as sent. Returns false if the
 * item is missing/invalid, lacks a phone or message, or has already
 * been sent. The caller is expected to refresh its UI after a true
 * return (queue state changed).
 *
 * No external API is called — wa.me is a URL deep link that triggers
 * the user's installed WhatsApp client (or the WhatsApp Web flow if
 * not installed). Nothing is sent until the user presses Send in
 * WhatsApp itself, so "auto-send" remains impossible.
 */
export function executeWhatsAppAction(id: string): boolean {
  const queue = readQueue();
  const item = queue.find((q) => q.id === id);
  if (!item) return false;
  if (!item.phone) return false;
  if (!item.message) return false;
  if (item.status === 'sent') return false;
  // R-INTEL-WHATSAPP-APPROVAL-GATE: pending drafts must be explicitly
  // approved before they can fire the wa.me deep link. Owner-side gate
  // for marketing / product_push campaign drafts whose default status
  // is 'pending_approval'. Items with status undefined or 'approved'
  // (e.g. who_to_contact_today entries) still execute on click.
  if (item.status === 'pending_approval') return false;

  const phone = normalizePhoneForWhatsApp(item.phone);
  if (!phone) return false;

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(item.message)}`;

  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return false;
  }
  try {
    window.open(url, '_blank');
  } catch {
    return false;
  }

  item.status = 'sent';
  item.sentAt = Date.now();
  writeQueue(queue);
  return true;
}

