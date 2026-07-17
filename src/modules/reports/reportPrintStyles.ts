// ============================================================
// CELLHUB-PRINT — Reports print stylesheet (letter/A4 documents).
//
// CONTRAST CONTRACT (CELLHUB-PRINT-REPORT-CONTRAST-REGRESSION): the printed
// report must stay sharp on inexpensive office printers and legible in
// grayscale. The R-REPORT-PRINT-REDESIGN template shipped screen-ish grays
// (#666/#888/#aaa/#555) at 7pt with slate-100 borders — nearly invisible on
// paper. Rules here are PRINT-SAFE:
//   - primary text  #111111 (near-black), minimum weight 500 in table bodies
//   - secondary     #374151 (dark gray that survives cheap printers)
//   - borders       #9ca3af row separators / #64748b strong dividers
//   - financial     green #15803d / red #b91c1c (dark tones; negatives keep
//                   their minus sign so grayscale never relies on color)
//   - no opacity, no rgba alpha, no transform/zoom/filter (vector text only)
//   - backgrounds forced via print-color-adjust: exact
// Shared by every Reports-module print view (sales / providers / activations
// / categories / employees). The 80mm receipt path is NOT this file.
// ============================================================

export const REPORT_PRINT_CSS = `
@page { size: letter; margin: 0.5in; }
* { box-sizing: border-box; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #111111; margin: 0; line-height: 1.35; }

.report-header { margin-bottom: 16px; border-bottom: 2px solid #111111; padding-bottom: 8px; }
.report-title { font-size: 18pt; font-weight: 900; margin: 0; color: #111111; }
.report-meta { font-size: 8.5pt; color: #374151; margin-top: 2px; font-weight: 500; }

.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; page-break-inside: avoid; break-inside: avoid; }
.summary-card { border: 1px solid #9ca3af; border-radius: 6px; padding: 8px 10px; }
.summary-card .label { font-size: 7.5pt; color: #374151; text-transform: uppercase; font-weight: 700; margin-bottom: 2px; }
/* No color here — inherits near-black from body; an explicit color would
   out-specify .value-green/.value-red and kill the semantic card colors. */
.summary-card .value { font-size: 14pt; font-weight: 900; }
.summary-card .sub { font-size: 7.5pt; color: #374151; margin-top: 2px; font-weight: 500; }
.value-green { color: #15803d; }
.value-red { color: #b91c1c; }
.value-blue { color: #1d4ed8; }

.meta-row { display: flex; gap: 24px; margin-bottom: 16px; font-size: 8.5pt; color: #374151; font-weight: 500; }
.meta-row span { font-weight: 700; color: #111111; }

.section { margin-bottom: 16px; }
.section-header { background: #1a1a2e; color: #ffffff; padding: 6px 10px; border-radius: 4px 4px 0 0; font-size: 9.5pt; font-weight: 700; margin-bottom: 0; page-break-after: avoid; break-after: avoid; }

table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
thead { display: table-header-group; }
th { background: #f1f5f9; padding: 5px 8px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 7.5pt; color: #1f2937; border-bottom: 1px solid #64748b; }
td { padding: 5px 8px; border-bottom: 1px solid #9ca3af; color: #111111; font-weight: 500; }
tr:last-child td { border-bottom: none; }
.row-total td { font-weight: 900; background: #f8fafc; border-top: 2px solid #111111; }
.row-total { page-break-before: avoid; break-before: avoid; }
.text-right { text-align: right; }
.text-green { color: #15803d; font-weight: 700; }
.text-red { color: #b91c1c; font-weight: 700; }

/* R-2.1.4 Phase 3: per-transaction rows under each provider summary. */
.pp-detail td { font-size: 7.5pt; color: #374151; padding: 2px 8px; background: #f8fafc; font-weight: 500; }
.pp-detail .pp-detail-meta { padding-left: 18px; }
/* Keep each row intact across page breaks (provider blocks stay readable). */
tbody tr { page-break-inside: avoid; }

.net-banner { background: #1a1a2e; color: #ffffff; padding: 10px 16px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 12pt; font-weight: 900; page-break-inside: avoid; break-inside: avoid; }

.report-footer { text-align: center; margin-top: 12px; font-size: 7.5pt; color: #4b5563; font-weight: 500; }
`;
