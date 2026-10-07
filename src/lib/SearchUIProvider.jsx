import { useCallback, useMemo, useState } from 'react';
import { SearchUIContext } from './searchUIState';

// Shared open/closed flag for the catalogue's search box. The box itself
// (and the actual filtering) lives in CameraList.jsx; the navbar only needs
// to know whether to show it.
export function SearchUIProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const value = useMemo(() => ({ isOpen, setIsOpen, toggle }), [isOpen]);

  return <SearchUIContext.Provider value={value}>{children}</SearchUIContext.Provider>;
}
