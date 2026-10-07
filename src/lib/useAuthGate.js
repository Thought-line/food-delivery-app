import { useContext } from 'react';
import { AuthGateContext } from './authGateState';

// Access the shared "must be logged in" gate: `const { requireAuth } = useAuthGate();`
// requireAuth(nextPath, reason?) returns true when the user is signed in, or
// false after popping the login/sign-up prompt (wired to return to
// nextPath). `reason` is an optional `{ title, message }` overriding the
// prompt's default booking copy — e.g. for wishlist: requireAuth(next,
// { title: 'Login required to save to wishlist', message: '...' }).
export function useAuthGate() {
  return useContext(AuthGateContext);
}
