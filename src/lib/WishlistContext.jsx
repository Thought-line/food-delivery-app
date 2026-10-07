import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { useCart } from './useCart';
import { fetchWishlistCameraIds, addToWishlist, removeFromWishlist } from './wishlist';
import { WishlistContext } from './wishlistState';

// Centralizes the signed-in customer's wishlisted camera ids so the navbar
// badge, the catalogue hearts (CameraList) and My Wishlist (removing a card)
// all stay in sync from one optimistic-update source instead of each keeping
// its own copy — toggling a heart on the catalogue updates the navbar count
// immediately, and removing from My Wishlist un-hearts the card if the
// customer goes back to the catalogue. Mirrors CartContext.jsx's shape.
export function WishlistProvider({ children }) {
  const { user } = useAuth();
  const { showToast } = useCart(); // reuses the app's single toast, same as cart/booking errors

  const [ids, setIds] = useState(() => new Set()); // camera ids saved by the signed-in user

  // Load the signed-in user's saved cameras once on login; clear it on
  // logout so a shared device doesn't keep showing the previous user's hearts.
  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIds(new Set());
      return;
    }
    let cancelled = false;
    fetchWishlistCameraIds(user.id)
      .then((fetched) => {
        if (!cancelled) setIds(new Set(fetched));
      })
      .catch(() => {}); // non-critical — hearts just start unfilled if this fails
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Add/remove a single camera id — used by the catalogue heart button.
  // Optimistic update, confirmed with a success toast or reverted (with a
  // warning toast) if the write fails. Returns the write's promise so a
  // caller with its own local copy of the data (e.g. WishlistPage's full
  // camera rows) can revert that too.
  function toggle(cameraId) {
    const wasWishlisted = ids.has(cameraId);

    setIds((prev) => {
      const next = new Set(prev);
      if (wasWishlisted) next.delete(cameraId);
      else next.add(cameraId);
      return next;
    });

    const write = wasWishlisted ? removeFromWishlist : addToWishlist;
    return write(user.id, cameraId)
      .then(() => {
        showToast('success', wasWishlisted ? 'Removed from wishlist' : 'Added to wishlist');
      })
      .catch((err) => {
        setIds((prev) => {
          const reverted = new Set(prev);
          if (wasWishlisted) reverted.add(cameraId);
          else reverted.delete(cameraId);
          return reverted;
        });
        showToast('warning', 'Could not update your wishlist. Please try again.');
        throw err;
      });
  }

  // Explicit remove — used by My Wishlist, where a card is always already
  // wishlisted (no need to check `ids` first, unlike the catalogue's toggle).
  function remove(cameraId) {
    setIds((prev) => {
      const next = new Set(prev);
      next.delete(cameraId);
      return next;
    });
    return removeFromWishlist(user.id, cameraId)
      .then(() => {
        showToast('success', 'Removed from wishlist');
      })
      .catch((err) => {
        setIds((prev) => new Set(prev).add(cameraId));
        showToast('warning', 'Could not remove from wishlist. Please try again.');
        throw err;
      });
  }

  return (
    <WishlistContext.Provider value={{ ids, count: ids.size, toggle, remove }}>
      {children}
    </WishlistContext.Provider>
  );
}
