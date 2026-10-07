import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/useAuth';
import { useCart } from '../lib/useCart';
import PasswordToggleButton from '../components/PasswordToggleButton';
import AuthField from '../components/ui/AuthField';
// Reuses LoginPage's own stylesheet rather than a third copy of the same
// .auth-page/.auth-form rules — this page's layout is identical, just with
// different copy and an admin-only check on submit.
import './LoginPage.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email, password) {
  const errors = {};
  const trimmedEmail = email.trim();
  if (!trimmedEmail) errors.email = 'Email is required.';
  else if (!EMAIL_RE.test(trimmedEmail)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Password is required.';
  else if (password.length < 6) errors.password = 'Password must be at least 6 characters.';
  return errors;
}
export default function AdminLoginPage() {
  const { user, role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const next = searchParams.get('next') || '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useCart();
  if (!authLoading && user && role === 'admin') return <Navigate to={next} replace />;
  useEffect(() => {
    if (searchParams.get('denied') === '1') {
      setError('Only admin can login here.');
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete('denied');
      setSearchParams(cleaned, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const errors = validate(email, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

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

    if (profileError || profile?.role !== 'admin') {
      await supabase.auth.signOut();
      // Preserve `next` (if this page was reached via a protected-route
      // redirect) rather than a bare '?denied=1' that would drop it.
      const deniedParams = new URLSearchParams(searchParams);
      deniedParams.set('denied', '1');
      navigate(`/admin/login?${deniedParams.toString()}`, { replace: true });
      return;
    }
    // Genuine admin login — same reactive redirect as LoginPage.jsx, this is
    // just the one place that actually knows the attempt succeeded.
    showToast('success', 'Successfully logged in');
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h2>Admin Login</h2>
        <AuthField
          legend="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your admin email"
          error={fieldErrors.email}
        />
        <AuthField
          legend="Password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          error={fieldErrors.password}
          endSlot={
            <PasswordToggleButton visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
          }
        />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
