// ============================================================
// Business Manager — notification contracts (I4 Part 11).
//
// CONTRACTS ONLY: deterministic finding/action → notification mapping for a
// future delivery surface. No scheduling, no push, no storage.
// ============================================================

import type { InsightFinding } from '../insights/types';
import type { NotificationContract, NotificationKind } from './types';

function kindFor(f: InsightFinding): NotificationKind | null {
  if (f.severity === 'critical') return 'critical_warning';
  if (f.severity === 'warning') return 'alert';
  if (f.kind === 'customer_returning_after_absence') return 'recovery';
  if (f.severity === 'opportunity') return 'opportunity';
  if (f.kind === 'metric_trend' && f.data.direction === 'up') return 'success';
  if (f.kind === 'customer_inactive' || f.kind === 'customer_declining') return 'reminder';
  return null;
}

export function buildNotificationContracts(findings: InsightFinding[]): NotificationContract[] {
  const out: NotificationContract[] = [];
  for (const f of findings) {
    const kind = kindFor(f);
    if (!kind) continue;
    out.push({
      id: `${kind}:${f.id}`,
      kind,
      severity: f.severity,
      sourceFindingId: f.id,
      dateYMD: f.dateRange.endYMD,
      data: { ...f.data },
    });
  }
  return out;
}
