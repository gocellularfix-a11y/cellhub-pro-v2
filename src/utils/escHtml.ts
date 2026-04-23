// ============================================================
// CellHub Pro — HTML Escape Helper
// Single source of truth for escaping user data / settings fields
// interpolated into print HTML template strings.
//
// Use for string HTML templates (printHtml / openPrintWindow).
// NOT needed for JSX — React escapes by default.
// ============================================================

/**
 * Escape HTML special chars to prevent XSS / markup injection
 * when interpolating strings into print HTML templates.
 *
 * Covers the 5 canonical HTML entities:
 *   & → &amp;   (MUST be first to avoid double-encoding)
 *   < → &lt;
 *   > → &gt;
 *   " → &quot;  (required inside attribute contexts)
 *   ' → &#39;   (required inside attribute contexts)
 *
 * Null/undefined coerced to empty string so templates never show "undefined".
 */
export function escHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
