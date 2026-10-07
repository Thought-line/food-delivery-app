export default function PasswordToggleButton({ visible, onToggle }) {
  return (
    <button
      type="button"
      className="auth-field-toggle"
      onClick={onToggle}
      aria-label={visible ? 'Hide password' : 'Show password'}
    >
      {visible ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.9 4.24A11 11 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-3.11 3.94M6.1 6.1A13.16 13.16 0 0 0 1 11s4 7 11 7a10.9 10.9 0 0 0 4.24-.86"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </button>
  );
}
