// ============================================================
// CellHub Pro — Customer note helper (LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1)
//
// Appends a timestamped note line to the customer's existing `notes` string
// (the app's single notes field). Shared by the Primary-local add path and the
// forwarded-operation dispatcher so both produce identical formatting.
// Pure — no I/O, no money, no side effects.
// ============================================================

/** Append `text` as a timestamped line to `existing`. Empty text → unchanged. */
export function appendCustomerNote(existing: string | undefined, text: string, tsMs?: number): string {
  const clean = (text || '').trim();
  const base = (existing || '').trim();
  if (!clean) return base;
  let stamp = '';
  try { stamp = new Date(typeof tsMs === 'number' ? tsMs : Date.now()).toLocaleString(); }
  catch { stamp = ''; }
  const line = stamp ? `[${stamp}] ${clean}` : clean;
  return base ? `${base}\n${line}` : line;
}
