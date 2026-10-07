// Small "×" dismiss button reused by drawers, toasts, and photo previews.
// `className` carries each call site's existing visual styling (position,
// size, colors) so this only centralizes the repeated markup, not the look.
export default function CloseButton({ onClick, className, label = 'Close', disabled = false }) {
  return (
    <button type="button" className={className} aria-label={label} onClick={onClick} disabled={disabled}>
      ×
    </button>
  );
}
