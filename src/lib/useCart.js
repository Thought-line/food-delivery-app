import { useContext } from 'react';
import { CartContext } from './cartState';

export function useCart() {
  return useContext(CartContext);
}
