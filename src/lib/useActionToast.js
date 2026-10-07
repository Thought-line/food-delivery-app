import { useEffect, useState } from 'react';

const VISIBLE_MS = 2500;
const EXIT_MS = 250;

// Shared show/leave/gone timer state behind the small pill toast admin
// screens use to confirm that an action went through (a booking status
// change, a camera restored, a new request arriving) — same shape as
// CartFeedback's own toast, just triggered by something other than a cart
// change. Pulled out so AdminPanel, CameraManager and AdminNotifications
// don't each reimplement the same three timers.
export function useActionToast() {
  const [event, setEvent] = useState(null); // { message, type } | null
  const [toast, setToast] = useState(null); // { message, type, leaving } | null

  useEffect(() => {
    if (!event) return undefined;
    const showTimer = setTimeout(() => setToast({ ...event, leaving: false }), 0);
    const leaveTimer = setTimeout(
      () => setToast((t) => (t ? { ...t, leaving: true } : t)),
      VISIBLE_MS
    );
    const goneTimer = setTimeout(() => {
      setToast(null);
      setEvent(null);
    }, VISIBLE_MS + EXIT_MS);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(leaveTimer);
      clearTimeout(goneTimer);
    };
  }, [event]);

  function notify(message, type = 'success') {
    setEvent({ message, type });
  }

  function close(e) {
    e?.stopPropagation();
    setToast((t) => (t ? { ...t, leaving: true } : t));
    setTimeout(() => {
      setToast(null);
      setEvent(null);
    }, EXIT_MS);
  }

  return { toast, notify, close };
}
