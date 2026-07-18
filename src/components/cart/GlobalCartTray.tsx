// ============================================================
// CellHub Pro — Global Cart Tray (R-GLOBAL-CART-TRAY-V1, Phase A)
//
// A persistent floating cart button + slide-in drawer, available from EVERY
// module (Dashboard, Repairs, Unlocks, Customers, Inventory, Layaways, Special
// Orders, Carrier Payments, Top-Up, Reports…). It reads the ALREADY-GLOBAL cart
// (`state.cart` in AppProvider — un-filtered, single source of truth) so there
// is NO second cart and NO duplicated state.
//
// Totals are computed with the SAME `calculateCartTotals` POS uses (no money
// math is re-implemented here). The drawer is a read/edit view: remove line,
// adjust qty, clear (with confirm). "Continue to Checkout" ROUTES to POS with
// the current cart — it never finalizes a sale here, so LAN/Secondary checkout
// forwarding + payment-method selection stay owned by POS (finalizeSaleCore /
// completeOrForwardSale untouched).
//
// Not rendered on the POS tab (POS shows its own cart panel) or when the cart
// is empty (nothing to show).
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useGlobalCart } from '@/hooks/useGlobalCart';
import { calculateCartTotals } from '@/modules/pos/types';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// R-GLOBAL-CART-TRAY-OVERLAP-FIX: collapsed pill anchored BOTTOM-right (a
// collision-free corner). Previously top:16/right:20 overlapped every
// TicketListLayout header (New Special Order / Add Item / headerActions).
// The position lives in a dependency-free module so it stays unit-testable.
export { COLLAPSED_CART_PILL_POSITION } from './cartTrayLayout';
import { COLLAPSED_CART_PILL_POSITION } from './cartTrayLayout';

export default function GlobalCartTray() {
  const { state, setActiveTab, dispatch } = useApp();
  const { cart, settings, lang, activeTab, customers, pendingPosCustomer } = state;
  // R-GLOBAL-CART-UNIFY-V1: the drawer's own edits go through the shared hook
  // too (no direct setCart). commitCart(openDrawer:false) = write without popping
  // the drawer (it's already open).
  const { commitCart, remove, clear, detachCustomer } = useGlobalCart();
  const es = lang === 'es';
  const pt = lang === 'pt';

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Neutral totals: no manual discount, no card fee — this is the base cart
  // total the operator sees before choosing a payment method in POS. The
  // authoritative total (with any discount/card surcharge) is finalized in POS.
  const totals = useMemo(
    () => calculateCartTotals(cart, settings, { amount: 0, type: 'dollar', reason: '' }, 'Cash', false),
    [cart, settings],
  );
  const count = useMemo(() => cart.reduce((n, i) => n + (i.qty || 1), 0), [cart]);

  // R-GLOBAL-CART-CUSTOMER-VISIBILITY-V1: the customer a module attached to the
  // cart lives in the global `pendingPosCustomer` id (set by Repairs/Unlocks/…;
  // POS consumes+clears it on mount). Surface WHO owns the cart before checkout.
  const cartCustomer = pendingPosCustomer ? customers.find((c) => c.id === pendingPosCustomer) : null;

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDrawerOpen(false); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // R-GLOBAL-CART-TRAY-V1-FIX-1: modules pop the drawer open right after they
  // add to the global cart (Repairs balance/deposit add) so the operator gets
  // immediate feedback instead of a "Go to POS" instruction. The component
  // stays mounted even when it renders null, so this listener is always live.
  useEffect(() => {
    const onOpen = () => setDrawerOpen(true);
    window.addEventListener('cellhub:open-cart-tray', onOpen);
    return () => window.removeEventListener('cellhub:open-cart-tray', onOpen);
  }, []);

  // POS owns its own cart panel; don't double up there.
  if (activeTab === 'pos') return null;
  // Nothing to surface when the cart is empty and the drawer is closed.
  if (count === 0 && !drawerOpen) return null;

  const removeItem = (id: string) => remove(id);
  const changeQty = (id: string, delta: number) =>
    commitCart(cart.map((i) => (i.id === id ? { ...i, qty: Math.max(1, (i.qty || 1) + delta) } : i)), { openDrawer: false });
  const goCheckout = () => { setDrawerOpen(false); setActiveTab('pos'); };
  const doClear = () => { clear(); setConfirmClear(false); setDrawerOpen(false); };
  const openProfile = () => {
    if (!cartCustomer) return;
    setDrawerOpen(false);
    dispatch({ type: 'SET_PENDING_CUSTOMER_HISTORY', payload: cartCustomer.id });
    setActiveTab('customers');
  };
  const clearCustomer = () => detachCustomer();

  const taxTotal = totals.salesTax + totals.utilityTax + totals.mobileSurcharge;
  const feeTotal = totals.cbeFee + totals.screenFee;

  const L = {
    cart: es ? 'Carrito' : pt ? 'Carrinho' : 'Cart',
    items: es ? 'artículos' : pt ? 'itens' : 'items',
    empty: es ? 'El carrito está vacío' : pt ? 'O carrinho está vazio' : 'Cart is empty',
    subtotal: es ? 'Subtotal' : 'Subtotal',
    tax: es ? 'Impuesto' : pt ? 'Imposto' : 'Tax',
    fees: es ? 'Cargos' : pt ? 'Taxas' : 'Fees',
    total: es ? 'Total' : 'Total',
    checkout: es ? 'Continuar al Pago' : pt ? 'Continuar para Pagamento' : 'Continue to Checkout',
    clear: es ? 'Vaciar carrito' : pt ? 'Limpar carrinho' : 'Clear cart',
    close: es ? 'Cerrar' : pt ? 'Fechar' : 'Close',
    remove: es ? 'Quitar' : pt ? 'Remover' : 'Remove',
    clearTitle: es ? 'Vaciar carrito' : pt ? 'Limpar carrinho' : 'Clear cart',
    clearMsg: es ? '¿Quitar todos los artículos del carrito?' : pt ? 'Remover todos os itens do carrinho?' : 'Remove all items from the cart?',
    cancel: es ? 'Cancelar' : 'Cancel',
    checkoutHint: es ? 'Abre POS con este carrito' : pt ? 'Abre o POS com este carrinho' : 'Opens POS with this cart',
    openProfile: es ? 'Ver perfil del cliente' : pt ? 'Ver perfil do cliente' : 'Open customer profile',
    clearCustomer: es ? 'Quitar cliente del carrito' : pt ? 'Remover cliente do carrinho' : 'Clear customer',
  };

  return (
    <>
      {/* Floating pill button — shown on every non-POS module when cart has items. */}
      {!drawerOpen && count > 0 && (
        <button
          onClick={() => setDrawerOpen(true)}
          title={`${L.cart}: ${count} ${L.items} · ${money(totals.total)}`}
          style={{
            position: 'fixed', ...COLLAPSED_CART_PILL_POSITION, zIndex: 55,
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 0.9rem', borderRadius: '999px',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 8px 24px rgba(79,70,229,0.4)',
            color: '#fff', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '1rem' }}>🛒</span>
          <span style={{
            background: 'rgba(255,255,255,0.22)', borderRadius: '999px',
            padding: '0.05rem 0.5rem', fontSize: '0.78rem', fontWeight: 800,
          }}>
            {count}
          </span>
          <span style={{ opacity: 0.85 }}>·</span>
          <span>{money(totals.total)}</span>
        </button>
      )}

      {/* Drawer + backdrop */}
      {drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 }}
          />
          <div
            style={{
              position: 'fixed', top: 0, right: 0, height: '100vh', width: '380px', maxWidth: '92vw',
              background: '#0f172a', borderLeft: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '-16px 0 48px rgba(0,0,0,0.5)', zIndex: 61,
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1rem 1.1rem', borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#e2e8f0', fontWeight: 700 }}>
                <span style={{ fontSize: '1.15rem' }}>🛒</span>
                {L.cart}
                <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: '0.8rem' }}>
                  ({count} {L.items})
                </span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                title={L.close}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '0.4rem', color: '#cbd5e1', padding: '0.25rem 0.55rem', cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Attached customer — who owns this cart (R-GLOBAL-CART-CUSTOMER-VISIBILITY-V1) */}
            {cartCustomer && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.6rem 1.1rem', background: 'rgba(99,102,241,0.09)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{
                  width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #818cf8, #6366f1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                }}>
                  {(cartCustomer.firstName || cartCustomer.name || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cartCustomer.name || `${cartCustomer.firstName || ''} ${cartCustomer.lastName || ''}`.trim()}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                    {cartCustomer.phone || (cartCustomer.phones && cartCustomer.phones[0]) || ''}
                  </div>
                </div>
                <button onClick={openProfile} title={L.openProfile} style={chipBtnStyle(false)}>👤</button>
                <button onClick={clearCustomer} title={L.clearCustomer} style={chipBtnStyle(true)}>✕</button>
              </div>
            )}

            {/* Items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1.1rem' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '2rem 0', fontSize: '0.85rem' }}>
                  {L.empty}
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.55rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                        {money(item.price)} {item.qty > 1 ? `× ${item.qty} = ${money(item.price * item.qty)}` : ''}
                      </div>
                    </div>
                    {/* Qty controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <button
                        onClick={() => changeQty(item.id, -1)}
                        disabled={item.qty <= 1}
                        style={qtyBtnStyle(item.qty <= 1)}
                      >−</button>
                      <span style={{ color: '#e2e8f0', fontSize: '0.8rem', minWidth: '1.1rem', textAlign: 'center' }}>{item.qty}</span>
                      <button onClick={() => changeQty(item.id, 1)} style={qtyBtnStyle(false)}>+</button>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      title={L.remove}
                      style={{
                        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
                        borderRadius: '0.35rem', color: '#fca5a5', padding: '0.2rem 0.45rem',
                        cursor: 'pointer', fontSize: '0.75rem',
                      }}
                    >✕</button>
                  </div>
                ))
              )}
            </div>

            {/* Totals + actions */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '0.9rem 1.1rem' }}>
              <TotalRow label={L.subtotal} value={money(totals.subtotal)} />
              {taxTotal > 0 && <TotalRow label={L.tax} value={money(taxTotal)} />}
              {feeTotal > 0 && <TotalRow label={L.fees} value={money(feeTotal)} />}
              <div style={{
                display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', paddingTop: '0.4rem',
                borderTop: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontWeight: 800, fontSize: '1rem',
              }}>
                <span>{L.total}</span><span>{money(totals.total)}</span>
              </div>

              <button
                onClick={goCheckout}
                disabled={cart.length === 0}
                title={L.checkoutHint}
                style={{
                  width: '100%', marginTop: '0.8rem', padding: '0.7rem',
                  borderRadius: '0.6rem', border: 'none', cursor: cart.length === 0 ? 'default' : 'pointer',
                  background: cart.length === 0 ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  color: '#fff', fontWeight: 700, fontSize: '0.9rem', opacity: cart.length === 0 ? 0.6 : 1,
                }}
              >
                {L.checkout} →
              </button>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  onClick={() => setConfirmClear(true)}
                  disabled={cart.length === 0}
                  style={{
                    flex: 1, padding: '0.5rem', borderRadius: '0.5rem',
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                    color: '#fca5a5', fontSize: '0.78rem', fontWeight: 600,
                    cursor: cart.length === 0 ? 'default' : 'pointer', opacity: cart.length === 0 ? 0.5 : 1,
                  }}
                >
                  {L.clear}
                </button>
                <button
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    flex: 1, padding: '0.5rem', borderRadius: '0.5rem',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                    color: '#cbd5e1', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {L.close}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        title={L.clearTitle}
        message={L.clearMsg}
        confirmLabel={L.clear}
        cancelLabel={L.cancel}
        variant="danger"
        onConfirm={doClear}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.82rem', marginBottom: '0.2rem' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

function qtyBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '1.4rem', height: '1.4rem', borderRadius: '0.3rem',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    color: disabled ? '#475569' : '#cbd5e1', cursor: disabled ? 'default' : 'pointer',
    fontSize: '0.9rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

function chipBtnStyle(danger: boolean): React.CSSProperties {
  return {
    background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${danger ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.12)'}`,
    borderRadius: '0.35rem', color: danger ? '#fca5a5' : '#cbd5e1',
    padding: '0.25rem 0.45rem', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1,
  };
}
