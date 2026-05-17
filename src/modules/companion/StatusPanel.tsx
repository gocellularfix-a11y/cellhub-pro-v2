// Companion — Status panel (desktop).
// Displays the current store snapshot. The push loop lives in
// StatusPushMount (globally mounted in AppShell) so data reaches
// the mobile even when the operator is not on this tab.

import { useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import type { CompanionDesktopSession } from '@/types/companion';
import { computeLiteSnapshot } from '@/services/companion/snapshot';

interface Props {
  session: CompanionDesktopSession;
}

export default function StatusPanel({ session }: Props) {
  void session; // kept for prop-API parity
  const { state: { sales, repairs, layaways, employees, currentEmployee } } = useApp();
  const snapshot = useMemo(
    () => computeLiteSnapshot({ sales, repairs, layaways, employees, currentEmployee }),
    [sales, repairs, layaways, employees, currentEmployee],
  );

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
        Live sync active · pushing every 10s
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
