-- Public browsing + login-gated booking.
--
-- Lets a signed-out visitor read the active camera catalogue (Home page and
-- the new /camera/:id details page) while keeping booking creation locked to
-- authenticated users. The React UI already pops a "login required to book"
-- prompt; this migration is the server-side half of that guard so the rule
-- holds even if the UI is bypassed.
--
-- As with the other files in this folder: paste into the Supabase SQL editor
-- (Project > SQL Editor > New query) and run. Every statement is additive /
-- idempotent and safe to replay. The live RLS policies were created by hand
-- in the dashboard and are not tracked here — review the notes below against
-- what already exists on the project before running.
--
-- What it does:
--   1. cameras.description — free-text spec block shown on the details page.
--   2. cameras: RLS + a single SELECT policy letting anon/authenticated read
--      active cameras (admins still read every status, for CameraManager).
--      Direct writes stay RPC-only (add_camera / update_camera /
--      set_camera_status are SECURITY DEFINER + admin-gated).
--   3. bookings: RLS + owner-scoped SELECT, and INSERT/UPDATE/DELETE revoked
--      from anon/authenticated so rows can only be created via request_booking
--      (SECURITY DEFINER, owned by postgres, so unaffected by the revoke).
--   4. request_booking: EXECUTE revoked from anon/PUBLIC, granted to
--      authenticated. Its existing `auth.uid() IS NULL` guard is still the
--      real check; this just stops anon calling it at all.
--   5. Availability RPCs: EXECUTE granted to anon so the public catalogue can
--      show live "N available" numbers without a session.
--   6. add_camera / update_camera: extra trailing p_description param.

-- 1. Spec column -----------------------------------------------------------
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS description text;

-- 2. cameras: public read of active rows ---------------------------------
ALTER TABLE cameras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cameras_public_read ON cameras;
CREATE POLICY cameras_public_read ON cameras
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'active'
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- Catalogue writes only ever happen through the admin-gated SECURITY DEFINER
-- RPCs — no client should be writing this table directly.
REVOKE INSERT, UPDATE, DELETE ON cameras FROM anon, authenticated;

-- 3. bookings: created only via request_booking, read only by the owner ---
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- No client INSERT/UPDATE/DELETE. request_booking (and the admin lifecycle
-- RPCs) are SECURITY DEFINER and run as their owner, so they keep working.
REVOKE INSERT, UPDATE, DELETE ON bookings FROM anon, authenticated;

-- A customer reads their own bookings (MyBookingsPage); an admin reads all of
-- them (AdminPanel). Both policies are (re)created here so enabling RLS above
-- can't accidentally hide rows from either — if equivalents already exist on
-- the project these simply replace them with the same rule.
DROP POLICY IF EXISTS bookings_select_own ON bookings;
CREATE POLICY bookings_select_own ON bookings
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

DROP POLICY IF EXISTS bookings_select_admin ON bookings;
CREATE POLICY bookings_select_admin ON bookings
  FOR SELECT
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- 4. request_booking: authenticated only --------------------------------
REVOKE EXECUTE ON FUNCTION request_booking(uuid, date, date, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_booking(uuid, date, date, text, text, text, integer)
  TO authenticated;

-- 5. Availability lookups: callable without a session ------------------
GRANT EXECUTE ON FUNCTION get_remaining_units(uuid, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_booked_quantities_by_camera(date, date) TO anon, authenticated;

-- 6. add_camera / update_camera gain p_description --------------------
-- Drop the old 5-arg signatures first so the new optional param can't make a
-- 5-arg call ambiguous. Bodies are the current ones (see 20260812030000 and
-- 20260901000000) with `description` threaded through.
DROP FUNCTION IF EXISTS add_camera(text, text, text, integer, numeric);
DROP FUNCTION IF EXISTS update_camera(uuid, text, text, text, integer, numeric);

CREATE OR REPLACE FUNCTION add_camera(
  p_name text,
  p_model text,
  p_image_url text,
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
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can add cameras';
  END IF;

  INSERT INTO cameras (name, model, image_url, stock_quantity, price, status, description)
  VALUES (p_name, p_model, p_image_url, p_stock_quantity, COALESCE(p_price, 0), 'active', p_description)
  RETURNING id INTO v_camera_id;

  RETURN v_camera_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_camera(
  p_camera_id uuid,
  p_name text,
  p_model text,
  p_image_url text,
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
      image_url = p_image_url,
      stock_quantity = p_stock_quantity,
      price = COALESCE(p_price, price),
      description = p_description
  WHERE id = p_camera_id;
END;
$$;
