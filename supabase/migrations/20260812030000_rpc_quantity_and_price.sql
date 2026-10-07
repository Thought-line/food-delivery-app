CREATE OR REPLACE FUNCTION request_booking(
  p_camera_id uuid,
  p_start date,
  p_end date,
  p_name text,
  p_location text,
  p_phone text,
  p_quantity integer DEFAULT 1
)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'you must be signed in to request a booking';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be at least 1';
  END IF;

  IF p_end <= p_start THEN
    RAISE EXCEPTION 'end date must be after the start date';
  END IF;

  -- Stock/date-overlap validation happens atomically in
  -- check_camera_stock_availability() (BEFORE INSERT trigger on bookings),
  -- so it doesn't need to be duplicated here.
  INSERT INTO bookings (
    camera_id, start_date, end_date,
    customer_name, customer_location, customer_phone,
    customer_id, status, quantity
  ) VALUES (
    p_camera_id, p_start, p_end,
    p_name, p_location, p_phone,
    auth.uid(), 'requested', p_quantity
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION add_camera(
  p_name text,
  p_model text,
  p_image_url text,
  p_stock_quantity integer,
  p_price numeric DEFAULT 0
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

  INSERT INTO cameras (name, model, image_url, stock_quantity, price, status)
  VALUES (p_name, p_model, p_image_url, p_stock_quantity, COALESCE(p_price, 0), 'active')
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
  p_price numeric DEFAULT 0
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admins can update cameras';
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