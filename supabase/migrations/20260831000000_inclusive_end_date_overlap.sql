
CREATE OR REPLACE FUNCTION check_camera_stock_availability()
RETURNS TRIGGER AS $$
DECLARE
  v_stock integer;
  v_overlapping_quantity integer;
BEGIN
  IF NEW.status NOT IN ('requested', 'confirmed', 'active') THEN
    RETURN NEW;
  END IF;
  SELECT stock_quantity INTO v_stock FROM cameras WHERE id = NEW.camera_id FOR UPDATE;
  SELECT COALESCE(SUM(quantity), 0) INTO v_overlapping_quantity
  FROM bookings
  WHERE camera_id = NEW.camera_id
    AND status IN ('confirmed', 'active')
    AND id IS DISTINCT FROM NEW.id
    AND start_date <= NEW.end_date
    AND end_date >= NEW.start_date;
  IF v_overlapping_quantity + NEW.quantity > COALESCE(v_stock, 1) THEN
    -- Keep the 'no_overlapping_confirmed_bookings' substring so the
    -- existing frontend error-matching (AdminPanel.jsx) keeps working
    -- without further changes.
    RAISE EXCEPTION 'no_overlapping_confirmed_bookings: only % unit(s) available for camera % between % and % (requested %)',
      GREATEST(COALESCE(v_stock, 1) - v_overlapping_quantity, 0),
      NEW.camera_id, NEW.start_date, NEW.end_date, NEW.quantity;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Displayed availability for one camera over a date range.
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
  -- confirmed/active bookings whose dates overlap the requested range,
  -- with the end date treated as inclusive.
  SELECT COALESCE(SUM(quantity), 0) INTO v_booked
  FROM bookings
  WHERE camera_id = p_camera_id
    AND status IN ('confirmed', 'active')
    AND start_date <= p_end
    AND end_date >= p_start;

  RETURN GREATEST(COALESCE(v_stock, 0) - v_booked, 0);
END;
$$;

-- 3. Bulk version for the camera grid — one call covering every camera.
CREATE OR REPLACE FUNCTION get_booked_quantities_by_camera(p_start date, p_end date)
RETURNS TABLE(camera_id uuid, booked_quantity integer)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT camera_id, COALESCE(SUM(quantity), 0)::integer AS booked_quantity
  FROM bookings
  WHERE status IN ('confirmed', 'active')
    AND start_date <= p_end
    AND end_date >= p_start
  GROUP BY camera_id;
$$;