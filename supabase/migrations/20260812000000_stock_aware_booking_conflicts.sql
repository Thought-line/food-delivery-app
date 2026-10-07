-- Replaces the old pairwise "no overlapping confirmed bookings" exclusion
-- constraint (which blocked ANY second confirmed/active booking for a
-- camera regardless of stock_quantity) with a stock-aware trigger:
-- a booking is only blocked if every unit of stock is already
-- confirmed/active for the overlapping date range.
--
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).

-- 1. Drop the old single-slot exclusion constraint, if present.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_overlapping_confirmed_bookings;

-- 2. Stock-aware availability check, applied to any row that represents an
--    actual hold on a unit (requested, confirmed, or active).
CREATE OR REPLACE FUNCTION check_camera_stock_availability()
RETURNS TRIGGER AS $$
DECLARE
  v_stock integer;
  v_overlapping integer;
BEGIN
  IF NEW.status NOT IN ('requested', 'confirmed', 'active') THEN
    RETURN NEW;
  END IF;

  SELECT stock_quantity INTO v_stock FROM cameras WHERE id = NEW.camera_id;

  -- Only bookings that are actually confirmed/active count against stock —
  -- other pending requests for the same dates don't block each other.
  SELECT count(*) INTO v_overlapping
  FROM bookings
  WHERE camera_id = NEW.camera_id
    AND status IN ('confirmed', 'active')
    AND id IS DISTINCT FROM NEW.id
    -- Inclusive end date (see 20260831000000_inclusive_end_date_overlap.sql),
    -- kept in sync here even though 20260812020000 immediately replaces this
    -- body, so a full top-to-bottom replay never installs the old rule.
    AND start_date <= NEW.end_date
    AND end_date >= NEW.start_date;

  IF v_overlapping >= COALESCE(v_stock, 1) THEN
    -- Keep the 'no_overlapping_confirmed_bookings' substring so the
    -- existing frontend error-matching (AdminPanel.jsx, BookingForm.jsx)
    -- keeps working without further changes.
    RAISE EXCEPTION 'no_overlapping_confirmed_bookings: no units available for camera % between % and %',
      NEW.camera_id, NEW.start_date, NEW.end_date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_camera_stock_availability ON bookings;

CREATE TRIGGER trg_check_camera_stock_availability
BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION check_camera_stock_availability();
