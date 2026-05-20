// Companion — historical report snapshot backfill.
// R-COMPANION-REPORT-SNAPSHOT-BACKFILL-FIX
//
// Builds DailyReportSnapshot for every date in a range that has at
// least one countable sale, then pushes each to the Railway bridge.
// The desktop is the sole source of truth — no Companion-side calculation.

import type { Sale } from '@/store/types';
import type { CompanionDesktopSession } from '@/types/companion';
import { buildDailyReportSnapshot } from './reportSnapshotBuilder';
import { pushDailyReportSnapshot } from './reportSnapshotSync';

const BACKFILL_DAYS = 90;

function localDateStr(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const y  = parts.find(p => p.type === 'year')?.value  ?? '';
    const m  = parts.find(p => p.type === 'month')?.value ?? '';
    const dy = parts.find(p => p.type === 'day')?.value   ?? '';
    return `${y}-${m}-${dy}`;
  } catch {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

/**
 * Builds and pushes a DailyReportSnapshot for every date in [startDate, endDate]
 * that has at least one countable sale. Dates with zero sales are skipped.
 *
 * Errors on individual dates are caught and logged (dev-only) so a single
 * network hiccup doesn't abort the entire backfill.
 */
export async function buildAndSyncReportSnapshotsForRange(
  sales: Sale[],
  session: CompanionDesktopSession,
  startDate: string,
  endDate: string,
  timezone: string,
): Promise<void> {
  const isDev = import.meta.env.DEV;
  const dates = datesInRange(startDate, endDate);

  for (const date of dates) {
    const snapshot = buildDailyReportSnapshot(sales, date, session.storeId, timezone);
    if (snapshot.salesCount === 0) continue;

    try {
      await pushDailyReportSnapshot(session, snapshot);
      if (isDev) {
        console.debug(
          `[ReportBackfill] ✓ ${date} — ${snapshot.salesCount} sales` +
          ` $${(snapshot.grossRevenueCents / 100).toFixed(2)}`,
        );
      }
    } catch (err) {
      if (isDev) {
        console.debug(`[ReportBackfill] ✗ ${date}`, err);
      }
    }
  }
}

/**
 * Backfill the last BACKFILL_DAYS days (inclusive of today) for the given session.
 * Safe to fire-and-forget: errors are swallowed per-date.
 */
export async function backfillRecentSnapshots(
  sales: Sale[],
  session: CompanionDesktopSession,
  timezone: string,
): Promise<void> {
  const today = localDateStr(new Date(), timezone || 'UTC');
  const startDate = addDays(today, -(BACKFILL_DAYS - 1));
  await buildAndSyncReportSnapshotsForRange(sales, session, startDate, today, timezone);
}
