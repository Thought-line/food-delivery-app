import { useContext } from 'react';
import { WishlistContext } from './wishlistState';
export function useWishlist() {
  return useContext(WishlistContext);
}
