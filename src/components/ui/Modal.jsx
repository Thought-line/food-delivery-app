import { createPortal } from 'react-dom';

// Generic overlay + centered box. Click the backdrop to close; clicks
// inside the box don't bubble up to it. `overlayClassName`/`modalClassName`
// carry each call site's existing look (sizing, spacing, animation).
//
// Rendered via a portal straight into <body> — a plain nested render would
// have this positioned relative to whichever ancestor happens to have an
// active `transform` (e.g. an entrance animation like the booking form's
// `fade-in-up`), which breaks `position: fixed` and squashes the overlay
// into that ancestor's box instead of covering the viewport. The portal
// sidesteps that regardless of where a call site renders this.
export default function Modal({ onClose, overlayClassName, modalClassName, children }) {
  return createPortal(
    <div className={overlayClassName} onClick={onClose}>
      <div className={modalClassName} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
