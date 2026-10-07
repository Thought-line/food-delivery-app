import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './useAuth';
import { CartContext } from './cartState';

const STORAGE_KEY = 'dream-capture-cart';

function loadInitialCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Items saved before quantity support existed won't have a `quantity`
    // field — default those to 1 so the stepper/math never sees `undefined`.
    return parsed.map((item) => ({ ...item, quantity: item.quantity ?? 1 }));
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState(loadInitialCart);
  // The single, centralized notification for the whole app — no per-card
  // toasts. A new call always replaces whatever's currently showing.
  // { type: 'success' | 'warning', message: string, showFab: boolean, ts } | null
  const [toast, setToast] = useState(null);
  // Whether the slide-in cart drawer is open — shared so the navbar cart
  // icon, the "Go to Cart" FAB, etc. can all open the same drawer.
  const [isCartOpen, setIsCartOpen] = useState(false);
  // The drawer's own "Max quantity of N reached for this item" toast. It's
  // shared (not local to CartDrawer) so a blocked "+" click on a product
  // card can trigger it too — that action opens the drawer AND raises this
  // toast together, in the same call.
  // { message: string, ts: number } | null
  const [maxQuantityToast, setMaxQuantityToast] = useState(null);
  // The "Item at Max Quantity" recommendations drawer — opened when a
  // product-card "+" click is blocked by the stock limit. Carries the
  // camera that hit its limit and the rental dates that were selected, so
  // the drawer can show that item plus in-stock alternatives for the same
  // dates. null means the drawer is closed.
  const [maxQuantityContext, setMaxQuantityContext] = useState(null);
  // Camera ids currently in the cart that an admin has since retired/removed
  // (cameras_public_read only returns status='active' rows to a customer, so
  // any cart camera id missing from that select is gone, regardless of
  // whether it was soft-retired or hard-deleted) — surfaced everywhere the
  // cart is shown (Navbar badge, CartDrawer, CartPage) instead of each
  // re-deriving it. The camera object itself stays in `items` unchanged
  // (cart items are a snapshot; only the id set here is live).
  const [removedCameraIds, setRemovedCameraIds] = useState(() => new Set());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // Clears the cart on an actual logout (user goes from signed-in to
  // signed-out) — a leftover cart otherwise survives in localStorage
  // indefinitely, which let a signed-out visitor still see quantity
  // steppers/a non-zero cart badge for items from a previous session, and
  // would leak one account's cart into a different account signing in on
  // the same browser afterward. `prevUser` distinguishes that transition
  // from simply loading the app already-signed-out (nothing to clear) or
  // logging in (a guest cart should carry over, not be wiped).
  const prevUserRef = useRef(user);
  useEffect(() => {
    if (prevUserRef.current && !user) {
      setItems([]);
    }
    prevUserRef.current = user;
  }, [user]);

  const cartCameraIds = items.map((item) => item.camera.id);
  const cartCameraIdsKey = cartCameraIds.slice().sort().join(',');

  useEffect(() => {
    let cancelled = false;

    async function checkRemoved() {
      if (cartCameraIds.length === 0) {
        if (!cancelled) setRemovedCameraIds(new Set());
        return;
      }
      const { data, error } = await supabase.from('cameras').select('id').in('id', cartCameraIds);
      if (cancelled || error) return;
      const stillActive = new Set(data.map((row) => row.id));
      setRemovedCameraIds(new Set(cartCameraIds.filter((id) => !stillActive.has(id))));
    }

    checkRemoved();

    // Live updates too — an admin retiring/removing a camera while the
    // customer already has the cart open shouldn't need a page reload to
    // show up as unavailable.
    const channel = supabase
      .channel('cart-camera-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => checkRemoved())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartCameraIdsKey]);

  function openCart() {
    setMaxQuantityContext(null); // only one drawer at a time
    setIsCartOpen(true);
  }

  function closeCart() {
    setIsCartOpen(false);
  }

  // Exposed so callers can also raise the "blocked" toast (e.g. hitting the
  // stock limit) — that case never touches cart state, so it can't be
  // inferred from a mutation the way the other messages are below.
  function showToast(type, message, showFab = false) {
    setToast({ type, message, showFab, ts: Date.now() });
  }

  function dismissToast() {
    setToast(null);
  }

  function showMaxQuantityToast(message) {
    setMaxQuantityToast({ message, ts: Date.now() });
  }

  function dismissMaxQuantityToast() {
    setMaxQuantityToast(null);
  }

  function openMaxQuantityDrawer(camera, dates) {
    setIsCartOpen(false); // only one drawer at a time
    setMaxQuantityContext({ camera, dates });
  }

  function closeMaxQuantityDrawer() {
    setMaxQuantityContext(null);
  }

  // `dates` are the rental dates picked in the navbar at the moment this is
  // called — captured onto the item so it keeps its own dates from here on.
  // Changing the navbar picker afterward only affects browsing/new adds, not
  // items already sitting in the cart. If this camera is already in the
  // cart, re-adding it updates its quantity and dates in place instead of
  // creating a second entry.
  function addItem(camera, dates, quantity = 1) {
    const existing = items.find((item) => item.camera.id === camera.id);
    const prevQty = existing?.quantity ?? 0;
    setItems((prev) => {
      const nextItem = {
        camera,
        quantity: Math.max(1, quantity),
        startDate: dates?.start ?? '',
        endDate: dates?.end ?? '',
      };
      return existing
        ? prev.map((item) => (item.camera.id === camera.id ? nextItem : item))
        : [...prev, nextItem];
    });
    showToast('success', prevQty === 0 ? 'Item added to cart' : 'Quantity updated in cart', true);
  }

  // Lets a customer change one cart item's rental dates independently of
  // every other item — e.g. from the date picker on the /cart page. Doesn't
  // touch quantity or raise a toast; the picker itself is the feedback.
  function updateDates(cameraId, dates) {
    setItems((prev) =>
      prev.map((item) =>
        item.camera.id === cameraId
          ? { ...item, startDate: dates?.start ?? '', endDate: dates?.end ?? '' }
          : item
      )
    );
  }

  // Setting quantity to 0 or below removes the item, same as clicking Remove.
  // Covers both increases (1→2, 2→3...) and decreases that don't reach zero
  // (3→2) — both just say "Quantity updated in cart" per the trigger table.
  function updateQuantity(cameraId, quantity) {
    if (quantity <= 0) {
      removeItem(cameraId);
      return;
    }
    const existing = items.find((item) => item.camera.id === cameraId);
    if (!existing) return;
    setItems((prev) =>
      prev.map((item) => (item.camera.id === cameraId ? { ...item, quantity } : item))
    );
    showToast('success', 'Quantity updated in cart', quantity > existing.quantity);
  }

  function removeItem(cameraId) {
    const existed = items.some((item) => item.camera.id === cameraId);
    setItems((prev) => prev.filter((item) => item.camera.id !== cameraId));
    if (existed) showToast('success', 'Item removed from cart');
  }

  function clearCart() {
    setItems([]);
  }

  return (
    <CartContext.Provider
      value={{
        items,
        removedCameraIds,
        addItem,
        updateQuantity,
        updateDates,
        removeItem,
        clearCart,
        toast,
        showToast,
        dismissToast,
        isCartOpen,
        openCart,
        closeCart,
        maxQuantityToast,
        showMaxQuantityToast,
        dismissMaxQuantityToast,
        maxQuantityContext,
        openMaxQuantityDrawer,
        closeMaxQuantityDrawer,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}
