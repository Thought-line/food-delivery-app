
CREATE OR REPLACE FUNCTION get_remaining_units(p_camera_id uuid, p_start date, p_end date)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock integer;
  v_booked integer;
BEGIN
  SELECT stock_quantity INTO v_stock FROM cameras WHERE id = p_camera_id;

  -- Same formula as check_camera_stock_availability(): sum quantity across
  -- confirmed/active bookings whose dates overlap the requested range.
  SELECT COALESCE(SUM(quantity), 0) INTO v_booked
  FROM bookings
  WHERE camera_id = p_camera_id
    AND status IN ('confirmed', 'active')
    AND start_date < p_end
    AND end_date > p_start;

  RETURN GREATEST(COALESCE(v_stock, 0) - v_booked, 0);
END;
$$;

-- Bulk version for the camera grid — one call covering every camera for a
-- date range, instead of one get_remaining_units call per camera.
CREATE OR REPLACE FUNCTION get_booked_quantities_by_camera(p_start date, p_end date)
RETURNS TABLE(camera_id uuid, booked_quantity integer)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT camera_id, COALESCE(SUM(quantity), 0)::integer AS booked_quantity
  FROM bookings
  WHERE status IN ('confirmed', 'active')
    AND start_date < p_end
    AND end_date > p_start
  GROUP BY camera_id;
$$;
