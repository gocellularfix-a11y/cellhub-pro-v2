// ============================================================
// CellHub Intelligence — Shared timestamp helpers
// R-EOD-BRIEF F1: extracted from repairIntelligence.ts so multiple
// intelligence composers can share the same parsing contract.
//
// Repair/Layaway/Sale createdAt fields are typed `Timestamp | Date | string`.
// Raw `new Date(obj as string)` yields NaN when the value is a Firebase
// Timestamp object — parseTimestampSafe handles all four shapes:
//   - number (epoch ms)
//   - Firestore-like object with toDate()
//   - Date instance
//   - ISO string
// Returns null on any unparseable value so callers can branch explicitly.
// ============================================================

export function parseTimestampSafe(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  try {
    if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
      return (v as { toDate: () => Date }).toDate().getTime();
    }
    const t = new Date(v as string | Date).getTime();
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

/**
 * Returns epoch ms for midnight (00:00:00.000) of the operator's LOCAL
 * calendar day containing `nowMs`. Used to bound "today" windows in
 * the EOD brief composer and elsewhere.
 */
export function startOfDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
