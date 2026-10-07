import { createContext } from 'react';
// Creates a shared context for wishlist data — same split as cartState.js
// (plain createContext here, provider in WishlistContext.jsx, hook in
// useWishlist.js) so the navbar badge, catalogue hearts and wishlist page
// all read/write one set of ids instead of each fetching their own copy.
export const WishlistContext = createContext(null);
