import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthGateContext } from './authGateState';
import { useAuth } from './useAuth';
import LoginRequiredModal from '../components/LoginRequiredModal';

// Wraps the app with a single, reusable "must be logged in to do this" gate.
// Call sites do:  if (!requireAuth(nextPath)) return;
// or, to explain what they're gating (shown by LoginRequiredModal instead of
// its default booking copy):  if (!requireAuth(nextPath, { title, message })) return;
// - signed in  -> returns true, nothing happens
// - signed out -> returns false and pops LoginRequiredModal, whose Login /
//   Sign Up buttons navigate to /login|/signup?next=<nextPath>. `next` is
//   only threaded through those two pages' own Login<->Sign Up links now —
//   login/signup always land on the home page afterward, not on `next`.
export function AuthGateProvider({ children }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [pendingGate, setPendingGate] = useState(null); // { next, title?, message? } | null

  const requireAuth = useCallback(
    (nextPath, reason) => {
      if (user) return true;
      setPendingGate({ next: nextPath ?? null, ...reason });
      return false;
    },
    [user]
  );

  const closeGate = useCallback(() => setPendingGate(null), []);

  // Drop the prompt whenever the route changes — e.g. its own Login / Sign Up
  // buttons navigating away — so it never lingers on top of another page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingGate(null);
  }, [pathname]);

  const value = useMemo(() => ({ requireAuth }), [requireAuth]);

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      {pendingGate !== null && (
        <LoginRequiredModal
          next={pendingGate.next}
          title={pendingGate.title}
          message={pendingGate.message}
          onClose={closeGate}
        />
      )}
    </AuthGateContext.Provider>
  );
}
