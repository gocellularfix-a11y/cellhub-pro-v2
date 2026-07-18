// ============================================================
// R-GLOBAL-CART-TRAY-OVERLAP-FIX — layout contract.
//
// The collapsed cart pill must be anchored to the BOTTOM-right, a
// collision-free corner, so it can never occupy the top-right zone where
// TicketListLayout renders primary controls (New Special Order / Add Item /
// headerActions). Practical layout-contract test on the exported position.
// ============================================================

import { describe, it, expect } from 'vitest';
import { COLLAPSED_CART_PILL_POSITION } from './cartTrayLayout';

describe('GlobalCartTray collapsed pill position', () => {
  it('is bottom-anchored, never top-anchored (clears every TicketListLayout header)', () => {
    expect(COLLAPSED_CART_PILL_POSITION).toHaveProperty('bottom');
    expect(COLLAPSED_CART_PILL_POSITION).not.toHaveProperty('top');
  });
  it('stays pinned to the right gutter', () => {
    expect(COLLAPSED_CART_PILL_POSITION.right).toBe('20px');
  });
});
