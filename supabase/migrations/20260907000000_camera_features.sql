-- Adds a "Product Features" bullet list to the camera details page —
-- admin-entered, real per-camera data (one line per feature), not a
-- generic fabricated list. Shown under the existing description block.
--
-- Run this in the Supabase SQL editor. Idempotent / safe to replay.

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS features text;

-- add_camera / update_camera gain a trailing p_features param, same
-- pattern as p_description in 20260902000000_public_browse_and_booking_auth.sql.
DROP FUNCTION IF EXISTS add_camera(text, text, text[], integer, numeric, text);
DROP FUNCTION IF EXISTS update_camera(uuid, text, text, text[], integer, numeric, text);

CREATE OR REPLACE FUNCTION add_camera(
  p_name text,
  p_model text,
  p_photos text[],
  p_stock_quantity integer,
  p_price numeric DEFAULT 0,
  p_description text DEFAULT NULL,
  p_features text DEFAULT NULL
)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_camera_id uuid;
  v_photos text[] := COALESCE(p_photos, '{}');
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can add cameras';
  END IF;

  INSERT INTO cameras (name, model, image_url, photos, stock_quantity, price, status, description, features)
  VALUES (p_name, p_model, v_photos[1], v_photos, p_stock_quantity, COALESCE(p_price, 0), 'active', p_description, p_features)
  RETURNING id INTO v_camera_id;

  RETURN v_camera_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_camera(
  p_camera_id uuid,
  p_name text,
  p_model text,
  p_photos text[],
  p_stock_quantity integer,
  p_price numeric DEFAULT 0,
  p_description text DEFAULT NULL,
  p_features text DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_peak integer;
  v_photos text[] := COALESCE(p_photos, '{}');
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can update cameras';
  END IF;

  -- Refuse to cut stock below the peak units already committed to
  -- confirmed/active bookings on any upcoming date (see 20260901000000).
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
      image_url = v_photos[1],
      photos = v_photos,
      stock_quantity = p_stock_quantity,
      price = COALESCE(p_price, price),
      description = p_description,
      features = p_features
  WHERE id = p_camera_id;
END;
$$;
