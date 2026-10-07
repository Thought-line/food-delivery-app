export default function Logo({ size = 34, color = 'var(--accent)' }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ color }}>
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <g fill="currentColor">
        <path d="M21,8.4 L43,8.4 L40.5,28.9 Z" />
        <path d="M21,8.4 L43,8.4 L40.5,28.9 Z" transform="rotate(60 32 32)" />
        <path d="M21,8.4 L43,8.4 L40.5,28.9 Z" transform="rotate(120 32 32)" />
        <path d="M21,8.4 L43,8.4 L40.5,28.9 Z" transform="rotate(180 32 32)" />
        <path d="M21,8.4 L43,8.4 L40.5,28.9 Z" transform="rotate(240 32 32)" />
        <path d="M21,8.4 L43,8.4 L40.5,28.9 Z" transform="rotate(300 32 32)" />
      </g>
      <path d="M13,43 L23,26 L29,35 L37,19 L48,43 Z" fill="#1a1a1a" />
      <path
        d="M43,15 l1.6,3.4 3.4,1.6 -3.4,1.6 -1.6,3.4 -1.6,-3.4 -3.4,-1.6 3.4,-1.6 Z"
        fill="currentColor"
      />
      <path
        d="M36,22 l1,2.1 2.1,1 -2.1,1 -1,2.1 -1,-2.1 -2.1,-1 2.1,-1 Z"
        fill="currentColor"
      />
    </svg>
  );
}
