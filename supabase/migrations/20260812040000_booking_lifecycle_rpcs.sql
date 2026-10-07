-- Adds the two booking-lifecycle transitions the admin panel needs but
-- that no RPC currently provides: confirmed -> active ("Mark Active") and
-- active -> completed ("Mark Completed"). Without these, a booking could
-- reach 'confirmed' but nothing in the app could ever move it past that —
-- the 'active'/'completed' filter tabs already exist in AdminPanel.jsx but
-- were previously unreachable.
--
-- Same additive pattern as the other migrations in this folder: brand new
-- function names, so nothing existing is touched.
--
-- Run this in the Supabase SQL editor, AFTER the earlier migrations here.

CREATE OR REPLACE FUNCTION activate_booking(p_booking_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can update booking status';
  END IF;

  UPDATE bookings
  SET status = 'active'
  WHERE id = p_booking_id
    AND status = 'confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking % is not in confirmed status', p_booking_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION complete_booking(p_booking_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can update booking status';
  END IF;

  UPDATE bookings
  SET status = 'completed'
  WHERE id = p_booking_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking % is not in active status', p_booking_id;
  END IF;
END;
$$;
