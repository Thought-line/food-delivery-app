-- Adds an admin-only "cancel an active booking" transition. The existing
-- cancel_booking RPC (body unknown — predates this session's migrations) is
-- already relied on for requested/confirmed -> cancelled and is left
-- untouched. Since it's unclear whether its WHERE clause even permits an
-- 'active' source row, this uses a brand new function name for the
-- active -> cancelled transition rather than assuming that behavior.
--
-- No manual "release stock" step is needed: camera availability is computed
-- on the fly by check_camera_stock_availability() as SUM(quantity) over
-- bookings with status IN ('confirmed', 'active') for overlapping dates.
-- Once a booking's status flips away from those, it's automatically
-- excluded from that sum on the very next read.

CREATE OR REPLACE FUNCTION cancel_active_booking(p_booking_id uuid)
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
  SET status = 'cancelled'
  WHERE id = p_booking_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking % is not in active status', p_booking_id;
  END IF;
END;
$$;
