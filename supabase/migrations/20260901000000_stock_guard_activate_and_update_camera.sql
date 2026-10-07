-- 1. Stock rule (idempotent re-assert, inclusive end date) -------------------
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
    RAISE EXCEPTION 'no_overlapping_confirmed_bookings: only % unit(s) available for camera % between % and % (requested %)',
      GREATEST(COALESCE(v_stock, 1) - v_overlapping_quantity, 0),
      NEW.camera_id, NEW.start_date, NEW.end_date, NEW.quantity;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_camera_stock_availability ON bookings;

CREATE TRIGGER trg_check_camera_stock_availability
BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION check_camera_stock_availability();

-- 2. Committed-units lookup for the admin panel ----------------------------
CREATE OR REPLACE FUNCTION get_committed_units(
  p_camera_id uuid,
  p_start date,
  p_end date,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT COALESCE(SUM(quantity), 0)::integer
  FROM bookings
  WHERE camera_id = p_camera_id
    AND status IN ('confirmed', 'active')
    AND (p_exclude_booking_id IS NULL OR id IS DISTINCT FROM p_exclude_booking_id)
    AND start_date <= p_end
    AND end_date >= p_start;
$$;

-- 3. confirmed -> active, with its own stock re-check --------------------
CREATE OR REPLACE FUNCTION activate_booking(p_booking_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_camera_id uuid;
  v_start     date;
  v_end       date;
  v_qty       integer;
  v_stock     integer;
  v_committed integer;
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can update booking status';
  END IF;

  SELECT camera_id, start_date, end_date, quantity
    INTO v_camera_id, v_start, v_end, v_qty
  FROM bookings
  WHERE id = p_booking_id
    AND status = 'confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking % is not in confirmed status', p_booking_id;
  END IF;

  -- FOR UPDATE: same reason as check_camera_stock_availability() — block a
  -- concurrent activate/confirm for the same camera instead of racing it.
  SELECT stock_quantity INTO v_stock FROM cameras WHERE id = v_camera_id FOR UPDATE;

  SELECT COALESCE(SUM(quantity), 0) INTO v_committed
  FROM bookings
  WHERE camera_id = v_camera_id
    AND status IN ('confirmed', 'active')
    AND id IS DISTINCT FROM p_booking_id
    AND start_date <= v_end
    AND end_date >= v_start;

  IF v_committed + v_qty > COALESCE(v_stock, 1) THEN
    RAISE EXCEPTION 'no_overlapping_confirmed_bookings: only % unit(s) available for camera % between % and % (booking needs %)',
      GREATEST(COALESCE(v_stock, 1) - v_committed, 0), v_camera_id, v_start, v_end, v_qty;
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

-- 4. update_camera(): can't cut stock below what's already committed -----
CREATE OR REPLACE FUNCTION update_camera(
  p_camera_id uuid,
  p_name text,
  p_model text,
  p_image_url text,
  p_stock_quantity integer,
  p_price numeric DEFAULT 0
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_peak integer;
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can update cameras';
  END IF;

  -- Highest number of units this camera owes on any single upcoming date
  -- across its confirmed/active bookings. Sweep-line over the future: for
  -- each not-yet-ended booking, the first date it still matters is
  -- GREATEST(start_date, today); total the concurrent load there and take
  -- the max. Load can only rise at one of those points, so the max is exact.
  SELECT COALESCE(MAX(day_load), 0) INTO v_peak
  FROM (
    SELECT pts.d, SUM(b2.quantity) AS day_load
    FROM (
      SELECT DISTINCT GREATEST(start_date, CURRENT_DATE) AS d
      FROM bookings
      WHERE camera_id = p_camera_id
        AND status IN ('confirmed', 'active')
        AND end_date >= CURRENT_DATE
    ) pts
    JOIN bookings b2
      ON b2.camera_id = p_camera_id
     AND b2.status IN ('confirmed', 'active')
     AND b2.end_date >= CURRENT_DATE
     AND pts.d BETWEEN b2.start_date AND b2.end_date
    GROUP BY pts.d
  ) loads;
  IF p_stock_quantity < v_peak THEN
    RAISE EXCEPTION 'Cannot set stock to % — % unit(s) are already committed to confirmed/active bookings on at least one upcoming date. Cancel or complete those bookings first.',
      p_stock_quantity, v_peak;
  END IF;
  UPDATE cameras
  SET name = p_name,
      model = p_model,
      image_url = p_image_url,
      stock_quantity = p_stock_quantity,
      price = COALESCE(p_price, price)
  WHERE id = p_camera_id;
END;
$$;
