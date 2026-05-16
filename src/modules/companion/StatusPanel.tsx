// Companion — Status panel (desktop).
// Computes the snapshot from POS state + pushes it every 10s while
// the panel is mounted. Shows the operator what's being pushed.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import type { CompanionDesktopSession } from '@/types/companion';
import { pushStoreStatus } from '@/services/companion/storeStatusService';
import { computeLiteSnapshot } from '@/services/companion/snapshot';

const PUSH_MS = 10_000;

interface Props {
  session: CompanionDesktopSession;
}

export default function StatusPanel({ session }: Props) {
  const { state: { sales, repairs, layaways, employees, currentEmployee } } = useApp();
  const snapshot = useMemo(
    () => computeLiteSnapshot({ sales, repairs, layaways, employees, currentEmployee }),
    [sales, repairs, layaways, employees, currentEmployee],
  );

  const [lastPushAt, setLastPushAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Push immediately when the snapshot changes (debounced via useMemo) + at a
  // steady interval so the mobile sees fresh values even if nothing in the
  // POS state changed.
  useEffect(() => {
    let cancelled = false;
    const send = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await pushStoreStatus(session, {
          ...snapshot,
          pendingApprovalsCount: 0, // approval count merged server-side in step 7's flow
        });
        if (!cancelled) {
          setLastPushAt(new Date().toISOString());
          setLastError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLastError(err instanceof Error ? err.message : 'Push failed');
        }
      } finally {
        inFlightRef.current = false;
      }
    };
    void send();
    const handle = setInterval(send, PUSH_MS);
    return () => { cancelled = true; clearInterval(handle); };
  }, [session, snapshot]);

  return (
    <div>
      <div style={statsGridStyle}>
        <StatCard label="Today's revenue" value={`$${(snapshot.todayRevenueCents / 100).toFixed(2)}`} />
        <StatCard label="Sales today" value={String(snapshot.todaySalesCount)} />
        <StatCard label="Open repairs" value={String(snapshot.openRepairsCount)} />
        <StatCard label="Pending layaways" value={String(snapshot.pendingLayawaysCount)} />
        <StatCard label="On shift" value={String(snapshot.clockedInCount)} />
        <StatCard label="" value={snapshot.clockedInNames.join(', ') || '—'} span2 small />
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#64748b' }}>
        {lastError
          ? <span style={{ color: '#fca5a5' }}>⚠ {lastError}</span>
          : lastPushAt
            ? `Last push ${new Date(lastPushAt).toLocaleTimeString()} · pushing every ${PUSH_MS / 1000}s`
            : 'Pushing…'
        }
      </div>
    </div>
  );
}

function StatCard({ label, value, span2, small }: { label: string; value: string; span2?: boolean; small?: boolean }) {
  return (
    <div style={{
      gridColumn: span2 ? '1 / -1' : undefined,
      background: 'rgba(15,23,42,0.6)',
      border: '1px solid rgba(148,163,184,0.15)',
      borderRadius: 10,
      padding: '10px 12px',
    }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label || ' '}
      </div>
      <div style={{ fontSize: small ? 12 : 20, fontWeight: small ? 500 : 800, color: small ? '#cbd5e1' : '#fff' }}>
        {value}
      </div>
    </div>
  );
}

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
};
