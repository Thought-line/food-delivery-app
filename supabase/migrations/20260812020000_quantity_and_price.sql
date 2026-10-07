-- Adds real multi-unit quantity support and a price field.
--
-- 1. cameras.price       — additive, safe. Shown in the admin form and on
--                           camera cards; no existing code reads or writes it.
-- 2. bookings.quantity   — additive, safe. Defaults to 1 so every existing
--                           row (which always represented exactly 1 unit)
--                           keeps meaning exactly what it already meant.
-- 3. check_camera_stock_availability() — rewritten from a COUNT(*) of
--    overlapping rows to a SUM(quantity) of overlapping rows, and now takes
--    a row lock on the camera (FOR UPDATE) before computing that sum. This
--    function was introduced in the previous migration and is fully owned
--    by this project (not a pre-existing Supabase-authored function), so
--    rewriting it here is safe — no unknown prior behavior can be lost.
--
--    Why the lock matters: under Postgres's default READ COMMITTED
--    isolation, a SELECT+compare with no lock is NOT race-safe just by
--    being inside a trigger — two concurrent transactions confirming
--    overlapping bookings for the same camera could both run the SELECT
--    before either commits, both see "room for 1 more", and both pass.
--    Locking the camera row forces the second transaction to block until
--    the first commits (or rolls back), then re-read the now-current sum —
--    that's what actually makes "only one booking wins a race for the
--    last unit" true.
--
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query),
-- AFTER 20260812000000_stock_aware_booking_conflicts.sql.

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS price numeric(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_quantity_positive CHECK (quantity > 0);

CREATE OR REPLACE FUNCTION check_camera_stock_availability()
RETURNS TRIGGER AS $$
DECLARE
  v_stock integer;
  v_overlapping_quantity integer;
BEGIN
  IF NEW.status NOT IN ('requested', 'confirmed', 'active') THEN
    RETURN NEW;
  END IF;

  -- FOR UPDATE: locks this camera row for the rest of the transaction, so
  -- a concurrent INSERT/UPDATE against the same camera has to wait here
  -- instead of reading the same stale snapshot (see note above).
  SELECT stock_quantity INTO v_stock FROM cameras WHERE id = NEW.camera_id FOR UPDATE;

  -- Only bookings that are actually confirmed/active count against stock —
  -- other pending requests for the same dates don't block each other.
  -- Sum their quantity (not just count rows) since a single row can now
  -- represent more than one unit.
  SELECT COALESCE(SUM(quantity), 0) INTO v_overlapping_quantity
  FROM bookings
  WHERE camera_id = NEW.camera_id
    AND status IN ('confirmed', 'active')
    AND id IS DISTINCT FROM NEW.id
    AND start_date < NEW.end_date
    AND end_date > NEW.start_date;

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
