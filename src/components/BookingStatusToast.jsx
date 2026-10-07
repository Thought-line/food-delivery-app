import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingNotifications } from '../lib/useBookingNotifications';
import CloseButton from './ui/CloseButton';
import './BookingStatusToast.css';

const TOAST_EXIT_MS = 250;
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
      />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function ToastCard({ event, onDismiss }) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  function handleClose(e) {
    e.stopPropagation(); // don't also trigger the card's own click-through
    setLeaving(true);
    setTimeout(onDismiss, TOAST_EXIT_MS);
  }

  function handleOpen() {
    onDismiss();
    navigate('/my-bookings');
  }

  return (
    <div
      className={`booking-toast booking-toast-${event.type}${leaving ? ' is-leaving' : ''}`}
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleOpen();
      }}
    >
      <span className="booking-toast-icon">
        <BellIcon />
      </span>

      <div className="booking-toast-body">
        <div className="booking-toast-header">
          <span className="booking-toast-title">{event.title}</span>
          <CloseButton className="booking-toast-close" label="Dismiss" onClick={handleClose} />
        </div>
        <p className="booking-toast-text">{event.message}</p>
      </div>
    </div>
  );
}
export default function BookingStatusToast() {
  const { events, dismissEvent } = useBookingNotifications();

  if (!events || events.length === 0) return null;

  return (
    <div className="booking-toast-stack">
      {events.map((event) => (
        <ToastCard key={event.id} event={event} onDismiss={() => dismissEvent(event.id)} />
      ))}
    </div>
  );
}
