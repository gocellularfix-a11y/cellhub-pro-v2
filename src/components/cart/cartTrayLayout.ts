// ============================================================
// Global Cart Tray — layout contract (standalone, no React/store imports).
//
// R-GLOBAL-CART-TRAY-OVERLAP-FIX: the collapsed cart pill anchors to the
// BOTTOM-right — a collision-free corner — so it can never occupy the
// top-right zone where TicketListLayout renders primary controls (New Special
// Order / Add Item / headerActions). Kept dependency-free so the layout
// contract is unit-testable without mounting the component.
// ============================================================

export const COLLAPSED_CART_PILL_POSITION = { bottom: '20px', right: '20px' } as const;
