import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/useAuth';
import { useCart } from '../lib/useCart';
import PasswordToggleButton from '../components/PasswordToggleButton';
import AuthField from '../components/ui/AuthField';
import './LoginPage.css';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Checks the email and password, returns an object of error messages
function validate(email, password) {
  const errors ={};
  const trimmedEmail = email.trim();
  if (!trimmedEmail) errors.email = 'Email is required.';
  else if (!EMAIL_RE.test(trimmedEmail)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Password is required.';
  else if (password.length < 6) errors.password = 'Password must be at least 6 characters.';
  return errors;
}
export default function LoginPage() {
  const { user, loading: authLoading } = useAuth(); // current logged-in user, if any
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const next = searchParams.get('next') || '/'; // kept only to carry through to the Sign up link below
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false); // show/hide password text
  const [fieldErrors, setFieldErrors] = useState({}); // errors shown under each input
  const [error, setError] = useState(null); // error from the login attempt itself
  const [submitting, setSubmitting] = useState(false); // true while logging in
  const { showToast } = useCart();
  // Login/signup always land on the home page — never on `next` (an
  // already-signed-in admin lands here too, e.g. another tab or a stale
  // bookmark; Home() itself bounces an admin on to /admin, see App.jsx).
  if (!authLoading && user) return <Navigate to="/" replace />;

  // Picks up the "admins can't log in here" result signaled via the URL
  // (see the comment in handleSubmit for why plain state can't carry it) —
  // then strips the param so a refresh doesn't keep re-showing it.
  useEffect(() => {
    const denied = searchParams.get('denied');
    if (denied) {
      setError(
        denied === 'role_check_failed'
          ? "We couldn't verify your account. Please try again."
          : 'Only customers can log in here. Admins must use the Admin Login page.'
      );
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete('denied');
      setSearchParams(cleaned, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function handleSubmit(e) {
    e.preventDefault(); // don't reload the page
    setError(null);
    const errors = validate(email, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    // Try logging in
    setSubmitting(true);
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setSubmitting(false);
      setError(signInError.message);
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', signInData.user.id)
      .single();

    setSubmitting(false);

    // Fail closed, not open — if we can't confirm this account is a
    // regular customer, don't let it through as if it were one. Only a
    // successful lookup that's explicitly NOT 'admin' counts as cleared.
    if (profileError || profile?.role === 'admin') {
      await supabase.auth.signOut();
      const deniedParams = new URLSearchParams(searchParams);
      deniedParams.set('denied', profileError ? 'role_check_failed' : '1');
      navigate(`/login?${deniedParams.toString()}`, { replace: true });
      return;
    }
    // Genuine customer login — the redirect itself happens reactively (the
    // `user`-becomes-truthy check at the top of this component), so this is
    // the one place that actually knows the attempt succeeded.
    showToast('success', 'Successfully logged in');
  }
  return (
    <div className="auth-page">
      {/* noValidate: use our own error messages instead of the browser's */}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h2>Log in</h2>
        <AuthField
          legend="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          error={fieldErrors.email}
        /> 
        <AuthField
          legend="Password"
          type={showPassword ? 'text' : 'password'} // swap dots for readable text
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          error={fieldErrors.password}
          endSlot={
            <PasswordToggleButton visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
          }
        />
        {/* Error from the server, e.g. wrong password */}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : 'Log in'}
        </button>

        <Link
          to={next !== '/' ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
          className="link"
        >
          No account? Sign up
        </Link>
      </form>
    </div>
  );
}

