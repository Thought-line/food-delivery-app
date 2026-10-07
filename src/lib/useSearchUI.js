import { useContext } from 'react';
import { SearchUIContext } from './searchUIState';

// Whether the catalogue's search box (CameraList.jsx) is open — it's hidden
// by default and toggled from the navbar's search icon (Navbar.jsx).
export function useSearchUI() {
  return useContext(SearchUIContext);
}
