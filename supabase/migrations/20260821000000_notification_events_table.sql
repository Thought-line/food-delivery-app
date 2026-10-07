-- confirm_booking, reject_booking, and cancel_booking (remote-only RPCs,
-- not tracked in any local migration) each do:
--   insert into notification_events (booking_id, event_type) values (...)
-- right after updating a booking's status, inside the same transaction —
-- see the comment in confirm_booking: if the stock exclusion constraint
-- raises, the whole call (status update + notification insert) rolls back
-- together, so the admin never sees a half-applied confirmation.
--
-- That table was never actually created, so every one of those three
-- actions has been failing with `relation "notification_events" does not
-- exist`. This creates it with the two columns those functions actually
-- insert, plus standard id/created_at.

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id),
  event_type text not null,
  created_at timestamptz not null default now()
);
