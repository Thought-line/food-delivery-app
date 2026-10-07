import { useEffect, useMemo, useRef, useState } from 'react';
import { RentalRangeContext } from './rentalRangeState';
import { useAuth } from './useAuth';
import { todayISO, addDaysISO } from './dateUtils';

function defaultRange() {
  return { start: todayISO(), end: addDaysISO(todayISO(), 1) };
}

// Shared "what dates am I renting for" state, picked once in the navbar
// (see Navbar.jsx) and read wherever the catalogue needs to filter by it
// (CameraList). Lives above <AppLayout> so both can reach it.
export function RentalRangeProvider({ children }) {
  const { user } = useAuth();
  const [range, setRangeState] = useState(defaultRange);
  // Whether the customer has actually chosen a range yet, vs. this still
  // being the today/tomorrow default seeded above — the navbar pill uses
  // this to stay blank ("Start Date"/"End Date", no value) until a real
  // pick happens, even though `range` itself already has valid dates for
  // CameraList/BookingForm to filter/prefill against from the start.
  const [hasPicked, setHasPicked] = useState(false);

  function setRange(next) {
    setHasPicked(true);
    setRangeState(next);
  }

  // Clears a chosen date range on an actual logout (same transition-only
  // logic as CartContext's cart-clear) — the picker goes back to blank
  // ("Start Date"/"End Date") instead of still showing a previous session's
  // dates to a now-signed-out visitor.
  const prevUserRef = useRef(user);
  useEffect(() => {
    if (prevUserRef.current && !user) {
      setRangeState(defaultRange());
      setHasPicked(false);
    }
    prevUserRef.current = user;
  }, [user]);

  const value = useMemo(() => ({ range, setRange, hasPicked }), [range, hasPicked]);

  return <RentalRangeContext.Provider value={value}>{children}</RentalRangeContext.Provider>;
}
