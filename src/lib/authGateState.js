import { createContext } from 'react';

// Context for the "you must be logged in to do this" gate. Split from the
// provider so a fast-refresh edit to the provider doesn't blow away the
// context identity — same pattern as authState.js / cartState.js.
export const AuthGateContext = createContext(null);
