// Companion — Daily report snapshot sync (desktop → bridge).
// R-COMPANION-CLOUD-REPORTS-V2
// Pushes a pre-built DailyReportSnapshot to the Railway bridge for
// the companion mobile app to poll.

import { apiPost } from '@/services/companion/apiClient';
import type { CompanionDesktopSession, DailyReportSnapshot } from '@/types/companion';

export async function pushDailyReportSnapshot(
  session: CompanionDesktopSession,
  snapshot: DailyReportSnapshot,
): Promise<void> {
  await apiPost<{ ok: boolean }>(
    { bridgeUrl: session.bridgeUrl, token: session.posToken },
    `/store/${encodeURIComponent(session.storeId)}/reports/daily`,
    snapshot,
  );
}
