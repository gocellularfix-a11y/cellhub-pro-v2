// ============================================================
// CellHub Pro — Operator overlay layout (R-OPERATOR-PANEL-TWO-COLUMN-V1)
//
// Pure layout decisions for the expanded Floating Intelligence panel.
// Desktop/wide viewports get a wider two-column control-center layout;
// narrow viewports keep the original single column. NO intelligence
// logic, no suggestion logic, no drag/persistence logic lives here —
// only geometry, so the behavior is unit-testable without React.
// ============================================================

/** Original single-column width (narrow fallback — unchanged). */
export const OVERLAY_WIDTH_NARROW = 296;
/** Two-column control-center width (mandated 520–580 range). */
export const OVERLAY_WIDTH_WIDE = 560;
/** Viewport width from which the two-column layout activates. Chosen inside
 *  the mandated 700–760 band: 560px panel + 2×16 edge padding + the 110px
 *  orb + drag slack still fit comfortably at 760. */
export const OVERLAY_TWO_COLUMN_MIN_VIEWPORT = 760;
/** Mandated max-height cap (78–84vh band → 84vh, combined with the existing
 *  above/below available-space math, whichever is smaller). */
export const OVERLAY_MAX_HEIGHT_VH = 0.84;

export interface OverlayLayout {
  width: number;
  twoColumn: boolean;
}

/** Decide panel width + column mode for the current viewport. The panel
 *  never exceeds the viewport minus both edge margins. */
export function computeOverlayLayout(viewportW: number, edgePadding: number): OverlayLayout {
  const usable = Math.max(120, viewportW - edgePadding * 2);
  const twoColumn = viewportW >= OVERLAY_TWO_COLUMN_MIN_VIEWPORT;
  const width = Math.min(twoColumn ? OVERLAY_WIDTH_WIDE : OVERLAY_WIDTH_NARROW, usable);
  return { width, twoColumn };
}

/** Clamp the panel's left edge so the FULL panel stays inside the viewport
 *  with the edge margin on both sides — required now that the panel can be
 *  wider than the saved bubble position anticipated. */
export function clampOverlayLeft(
  desiredLeft: number,
  width: number,
  viewportW: number,
  edgePadding: number,
): number {
  return Math.max(edgePadding, Math.min(viewportW - width - edgePadding, desiredLeft));
}

/** Cap the panel height at OVERLAY_MAX_HEIGHT_VH of the viewport, on top of
 *  whatever space-above/space-below limit the caller already computed. */
export function capOverlayHeight(availableHeight: number, viewportH: number): number {
  return Math.min(availableHeight, Math.round(viewportH * OVERLAY_MAX_HEIGHT_VH));
}
