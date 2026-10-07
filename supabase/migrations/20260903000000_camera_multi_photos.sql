-- Lets an admin attach multiple photos to a camera instead of just one.
--
-- `cameras.image_url` stays as the single "cover" photo (photos[1]) so every
-- existing read path — CameraList, SearchDrawer, CartDrawer, the camera
-- details page, CameraManager's table — keeps working unchanged; they all
-- go through getCameraPhotoUrl(), which now derives from `photos` with a
-- fallback to the old column for rows that predate this migration. The new
-- `photos` array is what AddCameraForm.jsx now reads/writes and what a
-- future gallery view (e.g. on the details page) would render.
--
-- Paste into the Supabase SQL editor and run. Idempotent / safe to replay.
--
-- What it does:
--   1. cameras.photos text[] — full photo list, cover photo first.
--   2. Backfills photos from the existing image_url for rows that don't
--      have it yet (rows added before this migration).
--   3. add_camera / update_camera: p_image_url -> p_photos text[]. Cover
--      photo (image_url) is derived server-side as photos[1] so callers
--      only ever need to think in terms of the array.

-- 1. New column ------------------------------------------------------------
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}';

-- 2. Backfill from the old single-photo column ------------------------------
UPDATE cameras
SET photos = ARRAY[image_url]
WHERE image_url IS NOT NULL
  AND (photos IS NULL OR photos = '{}');

-- 3. add_camera / update_camera: p_image_url -> p_photos -------------------
-- Drop the old single-photo signatures first — p_photos text[] sits in the
-- same position as the old p_image_url text, so Postgres would otherwise see
-- two candidate overloads and refuse to pick one.
DROP FUNCTION IF EXISTS add_camera(text, text, text, integer, numeric, text);
DROP FUNCTION IF EXISTS update_camera(uuid, text, text, text, integer, numeric, text);

CREATE OR REPLACE FUNCTION add_camera(
  p_name text,
  p_model text,
  p_photos text[],
  p_stock_quantity integer,
  p_price numeric DEFAULT 0,
  p_description text DEFAULT NULL
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

  INSERT INTO cameras (name, model, image_url, photos, stock_quantity, price, status, description)
  VALUES (p_name, p_model, v_photos[1], v_photos, p_stock_quantity, COALESCE(p_price, 0), 'active', p_description)
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
  p_description text DEFAULT NULL
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
      description = p_description
  WHERE id = p_camera_id;
END;
$$;
