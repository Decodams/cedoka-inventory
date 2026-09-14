-- ==========================================
-- Prevent backdated sales
-- 1. New sales must be dated today (no backdating, no future dates)
-- 2. The sale_date of an existing sale can never be changed (audit integrity)
-- ==========================================

CREATE OR REPLACE FUNCTION prevent_backdated_sales()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sale_date::date <> CURRENT_DATE THEN
      RAISE EXCEPTION 'Sales cannot be backdated or dated in the future. Use today''s date.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.sale_date IS DISTINCT FROM OLD.sale_date THEN
      RAISE EXCEPTION 'The sale date of an existing sale cannot be changed.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_backdated_sales ON daily_sales;

CREATE TRIGGER trg_prevent_backdated_sales
BEFORE INSERT OR UPDATE ON daily_sales
FOR EACH ROW EXECUTE FUNCTION prevent_backdated_sales();