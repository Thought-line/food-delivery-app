import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { AuthContext } from './authState';

// Auto-logout after this long with no user activity
const IDLE_TIMEOUT_MS = 5 * 60 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'customer' | 'admin' | null
  const [loading, setLoading] = useState(true);
  const knownUserId = useRef(null); // id `role` was last fetched for

  async function handleSession(session) {
    if (!session?.user) {
      knownUserId.current = null;
      setUser(null);
      setRole(null);
      setLoading(false);
      return;
    }
    setUser(session.user);
    // Same signed-in user as before (e.g. a token refresh) — role is
    // already known, so there's no need to refetch it or reopen the
    // loading gate below.
    if (knownUserId.current === session.user.id) {
      setLoading(false);
      return;
    }
    // A brand-new sign-in: hold `loading` until role is known too. Without
    // this, `user` goes truthy a tick before `role` does — long enough for
    // LoginPage's post-login redirect and ProtectedRoute's role check to
    // both run against the still-stale (null) role and bounce a fresh
    // customer/admin login back to "/" before the real role ever arrives.
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();
    knownUserId.current = session.user.id;
    setRole(error ? null : data.role);
    setLoading(false);
  }
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      handleSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);
  async function signOut() {
    await supabase.auth.signOut();
  }
  // Signs the user out after IDLE_TIMEOUT_MS of no mouse/keyboard/touch/scroll
  // activity, so an unattended, signed-in session doesn't stay open forever.
  const idleTimerRef = useRef(null);
  useEffect(() => {
    if (!user) return;
    function resetIdleTimer() {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        supabase.auth.signOut();
      }, IDLE_TIMEOUT_MS);
    }
    resetIdleTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetIdleTimer));
    return () => {
      clearTimeout(idleTimerRef.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetIdleTimer));
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
