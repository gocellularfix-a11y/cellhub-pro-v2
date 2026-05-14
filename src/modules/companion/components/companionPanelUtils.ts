// Shared display helpers for Companion panel sub-components.

export function auditRelTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)    return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function auditFmtAmt(cents: number | undefined): string {
  if (!cents || cents === 0) return '';
  return ` — $${(cents / 100).toFixed(2)}`;
}
