import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/useAuth';
import PasswordToggleButton from '../components/PasswordToggleButton';
import AuthField from '../components/ui/AuthField';
import './SignupPage.css';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Each rule checks one requirement and has the message to show if it fails
const PASSWORD_RULES = [
  { test: (p) => p.length >= 8 && p.length <= 15, message: 'Be 8-15 characters.' },
  { test: (p) => /[a-z]/.test(p), message: 'Include a lowercase letter.' },
  { test: (p) => /[A-Z]/.test(p), message: 'Include an uppercase letter.' },
  { test: (p) => /[0-9]/.test(p), message: 'Include a number.' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), message: 'Include a symbol.' },
];
// Returns the list of rules the password still fails (checklist shrinks as they're fixed)
function getPasswordErrors(password) {
  if (!password) return PASSWORD_RULES.map((rule) => rule.message);
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.message);
}
// Full name must be non-empty and letters only, with single spaces allowed between words
function getFullNameError(fullName) {
  const trimmed = fullName.trim();
  if (!trimmed) return 'Full name is required.';
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(trimmed)) return 'Enter only letters, no numbers or symbols.';
  return undefined;
}

export default function SignupPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Carried through from /login only to pass along to the Log in link below
  // (switching forms mid-flow) — login/signup themselves always land on the
  // home page now, never back on whatever page prompted the sign-in.
  const next = searchParams.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [fieldErrors, setFieldErrors] = useState({}); // errors shown under each field
  const [error, setError] = useState(null); // error from the signup attempt itself
  const [message, setMessage] = useState(null); // success message after signing up
  const [submitting, setSubmitting] = useState(false);
  // Already logged in, so skip this page — home, not `next` (see above).
  if (!authLoading && user) return <Navigate to="/" replace />;
  // Checks every field and returns an object of error messages
  function validate() {
    const errors = {};
    const fullNameError = getFullNameError(fullName);
    if (fullNameError) errors.fullName = fullNameError;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) errors.email = 'Email is required.';
    else if (!EMAIL_RE.test(trimmedEmail)) errors.email = 'Enter a valid email address.';
    
    const passwordErrors = getPasswordErrors(password);
    if (passwordErrors.length > 0) errors.password = passwordErrors;

    if (!confirmPassword) errors.confirmPassword = 'Please re-enter your password.';
    else if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';

    return errors;
  }
  // Note: there's no "sign up as admin" option. Admin status lives in
  async function handleSubmit(e) {
    e.preventDefault(); // don't reload the page
    setError(null);
    setMessage(null);
    // Check every field first, stop here if anything is wrong
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    // Create the account in Supabase
    setSubmitting(true);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
      },
    });
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    supabase.functions
      .invoke('send-login-email', {
        body: { email: email.trim(), name: fullName.trim() },
      })
      .catch(() => {}); // best-effort — never block signup on email delivery

    // With email confirmation disabled, signUp returns an active session
    // right away — the user is already logged in, so send them straight to
    // the home page (never `next`, see the comment above).
    if (signUpData.session) {
      navigate('/');
      return;
    }
    setMessage('Account created. Check your email to confirm, then log in.');
    setTimeout(() => navigate('/login'), 1500);
  }
  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h2>Create an account</h2>
        <AuthField
          legend="Full name"
          value={fullName}
          onChange={(e) => {
            const value = e.target.value;
            setFullName(value);
            // Only re-check as they type if it's already showing an error
            if (fieldErrors.fullName) {
              setFieldErrors((prev) => ({ ...prev, fullName: getFullNameError(value) }));
            }
          }}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, fullName: getFullNameError(fullName) }))}
          placeholder="Enter your full name"
          error={fieldErrors.fullName}
          errorPrefix="* "
        />
        <AuthField
          legend="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          error={fieldErrors.email}
          errorPrefix="* "
        />
      {/* Password field — checks live on every keystroke so the checklist below updates as you type */}
        <AuthField
          legend="Password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) =>{
            const value = e.target.value;
            setPassword(value);
            setFieldErrors((prev) => ({ ...prev, password: getPasswordErrors(value) }));
            // If the password box is cleared, clear "confirm password" too so they don't go out of sync
            if (!value) {
              setConfirmPassword('');
              setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
            }
          }}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, password: getPasswordErrors(password) }))}
          placeholder="Enter your password"
          error={fieldErrors.password?.length > 0 ? fieldErrors.password : undefined}
          endSlot={
            <PasswordToggleButton visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
          }
        />

        {/* Only show "Confirm password" once the user has started typing a password */}
        {password && (
          <AuthField
            legend="Confirm password"
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            error={fieldErrors.confirmPassword}
            errorPrefix="* "
            endSlot={
              <PasswordToggleButton
                visible={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((v) => !v)}
              />
            }
          />
        )}

        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="hint">{message}</p>}
  
        <button type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : 'Sign up'}
        </button>

        <Link
          to={next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="link"
        >
          Have an account? Log in
        </Link>
      </form>
    </div>
  );
}
