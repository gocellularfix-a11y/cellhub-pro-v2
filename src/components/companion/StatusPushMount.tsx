// Companion — Global status push mount.
//
// Headless component mounted at AppShell level (always alive). Pushes the
// store snapshot to the bridge every 10s regardless of which tab the operator
// is on. Previously this lived inside StatusPanel, which only mounted while
// the operator was on the Companion tab — causing the mobile to see stale
// data the moment they navigated away.
//
// StatusPanel keeps the display (last-push timestamp, stat cards); this
// component owns the push loop.

import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { loadDesktopSession } from '@/services/companion/identityStore';
import { pushStoreStatus } from '@/services/companion/storeStatusService';
import { computeLiteSnapshot } from '@/services/companion/snapshot';
import { backfillRecentSnapshots } from '@/services/companion/reports/reportSnapshotBackfill';
import { buildDailyReportSnapshot } from '@/services/companion/reports/reportSnapshotBuilder';
import { pushDailyReportSnapshot } from '@/services/companion/reports/reportSnapshotSync';

const PUSH_MS = 10_000;

function localDateStr(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const y  = parts.find(p => p.type === 'year')?.value  ?? '';
    const m  = parts.find(p => p.type === 'month')?.value ?? '';
    const dy = parts.find(p => p.type === 'day')?.value   ?? '';
    return `${y}-${m}-${dy}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export default function StatusPushMount() {
  const { state: { sales, repairs, layaways, employees, currentEmployee, settings } } = useApp();

  const snapshot = useMemo(
    () => computeLiteSnapshot({ sales, repairs, layaways, employees, currentEmployee }),
    [sales, repairs, layaways, employees, currentEmployee],
  );

  const inFlightRef    = useRef(false);
  const snapshotRef    = useRef(snapshot);
  const salesRef       = useRef(sales);
  const settingsRef    = useRef(settings);
  const backfillDoneRef = useRef(false);

  snapshotRef.current = snapshot;
  salesRef.current    = sales;
  settingsRef.current = settings;

  useEffect(() => {
    const send = async () => {
      const session = loadDesktopSession();
      if (!session || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await pushStoreStatus(session, {
          ...snapshotRef.current,
          pendingApprovalsCount: 0,
        });
        const tz = settingsRef.current.timezone || 'UTC';
        // Fire backfill once on first successful push — non-blocking.
        if (!backfillDoneRef.current) {
          backfillDoneRef.current = true;
          void backfillRecentSnapshots(salesRef.current, session, tz).catch(() => {});
        }
        // Push today's snapshot every cycle so weekly/range reports stay current.
        const todayDate = localDateStr(new Date(), tz);
        const todaySnap = buildDailyReportSnapshot(salesRef.current, todayDate, session.storeId, tz);
        void pushDailyReportSnapshot(session, todaySnap).catch(() => {});
      } catch {
        // transient — retry next interval
      } finally {
        inFlightRef.current = false;
      }
    };
    void send();
    const handle = setInterval(send, PUSH_MS);
    return () => clearInterval(handle);
  }, []);

  return null;
}
