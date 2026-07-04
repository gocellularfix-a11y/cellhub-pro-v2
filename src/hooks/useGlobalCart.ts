// ============================================================
// CellHub Pro — useGlobalCart (R-GLOBAL-CART-UNIFY-V1)
//
// The single, canonical entry point for writing to the ONE global cart
// (AppProvider state.cart — un-filtered source of truth). Every module that
// adds to the cart MUST go through this hook so the behavior is identical
// everywhere:
//
//   add to cart → stay in the current module → auto-open the GlobalCartTray
//   drawer → operator decides when to check out (drawer's "Continue to
//   Checkout" is the ONLY thing that routes to POS).
//
// No module navigates to POS on add anymore. No module builds cart behavior
// differently. No second cart state.
//
// Two write shapes (tax-inclusive consolidation math stays in each module —
// this hook never does money/tax math):
//   • addItem(item, opts)      — append ONE prebuilt CartItem to the current
//                                cart (Inventory, IntelligenceChat, Barcode…).
//   • commitCart(next, opts)   — commit a fully-computed cart array. Used by
//                                the repair/unlock/layaway/special-order
//                                consolidation helpers (they compute `next`
//                                from their own cartRef, tax math intact) and
//                                by the global scanner.
//
// opts (both): { customerId?, openDrawer? = true }.
//   customerId → attaches as pendingPosCustomer (POS consumes it on checkout).
//   openDrawer → pops the GlobalCartTray drawer (default true; pass false to
//                write without popping, e.g. in-drawer qty edits).
//
// The drawer is opened via the existing `cellhub:open-cart-tray` window event
// that GlobalCartTray already listens for (it stays mounted even when it
// renders null, so the listener is always live). On the POS tab the tray
// renders null, so openDrawer is a harmless no-op there.
// ============================================================

import { useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import type { CartItem } from '@/store/types';

export interface CartWriteOpts {
  /** Attach this customer as pendingPosCustomer (POS picks it up at checkout). */
  customerId?: string;
  /** Auto-open the GlobalCartTray drawer. Default true. */
  openDrawer?: boolean;
}

export function useGlobalCart() {
  const { state, setCart, dispatch } = useApp();
  const { cart } = state;

  const openDrawer = useCallback(() => {
    try { window.dispatchEvent(new CustomEvent('cellhub:open-cart-tray')); }
    catch { /* env without CustomEvent — no-op */ }
  }, []);

  const attachCustomer = useCallback((customerId: string) => {
    if (customerId) dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: customerId });
  }, [dispatch]);

  const detachCustomer = useCallback(() => {
    dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: '' });
  }, [dispatch]);

  const applyOpts = useCallback((opts?: CartWriteOpts) => {
    if (opts?.customerId) attachCustomer(opts.customerId);
    if (opts?.openDrawer !== false) openDrawer();
  }, [attachCustomer, openDrawer]);

  /** Commit a fully-computed cart array (consolidation flows + scanner). */
  const commitCart = useCallback((next: CartItem[], opts?: CartWriteOpts) => {
    setCart(next);
    applyOpts(opts);
  }, [setCart, applyOpts]);

  /** Append one prebuilt line to the current cart. */
  const addItem = useCallback((item: CartItem, opts?: CartWriteOpts) => {
    setCart([...cart, item]);
    applyOpts(opts);
  }, [cart, setCart, applyOpts]);

  /** Remove a single cart line by id. Never opens the drawer. */
  const remove = useCallback((itemId: string) => {
    setCart(cart.filter((i) => i.id !== itemId));
  }, [cart, setCart]);

  /** Empty the cart. Never opens the drawer. */
  const clear = useCallback(() => {
    setCart([]);
  }, [setCart]);

  return { addItem, commitCart, remove, clear, attachCustomer, detachCustomer, openDrawer };
}
