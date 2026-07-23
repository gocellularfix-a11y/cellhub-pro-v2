// ============================================================
// CellHub Pro — Store Credit Center focus hand-off (P1-SC-CENTER)
//
// Tiny session-scoped mailbox so contextual views (Customer 360's
// certificate section) can open a specific certificate inside the Store
// Credit Center WITHOUT extending the global store: the caller sets the
// certificate id + switches tabs; the Center consumes it on mount.
// Consume-once semantics — a later manual visit starts clean.
// ============================================================

let pendingCertId: string | null = null;

export function setPendingCertificateFocus(ledgerId: string): void {
  pendingCertId = ledgerId || null;
}

export function consumePendingCertificateFocus(): string | null {
  const id = pendingCertId;
  pendingCertId = null;
  return id;
}
