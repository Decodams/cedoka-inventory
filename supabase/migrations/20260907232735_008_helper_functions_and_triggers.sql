/*
# Helper Functions: Week Date Calculations & Updated_at Triggers

## Purpose
- get_week_start(p_date date): returns the Sunday of the week containing p_date
- get_week_end(p_date date): returns the Saturday of the week containing p_date
- update_updated_at_column(): trigger function that auto-updates updated_at on row modification
- Apply the updated_at trigger to all tables with updated_at columns

## Functions Created
### get_week_start(p_date date) RETURNS date
### get_week_end(p_date date) RETURNS date
### update_updated_at_column() RETURNS trigger
*/

-- ==========================================
-- Week date helpers (Sunday-Saturday reporting cycle)
-- ==========================================
CREATE OR REPLACE FUNCTION get_week_start(p_date date DEFAULT CURRENT_DATE)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_date - ((EXTRACT(DOW FROM p_date)::int) % 7)::int;
$$;

CREATE OR REPLACE FUNCTION get_week_end(p_date date DEFAULT CURRENT_DATE)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_date - ((EXTRACT(DOW FROM p_date)::int) % 7)::int) + 6;
$$;

-- ==========================================
-- Updated_at trigger function
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Apply triggers to tables with updated_at
DROP TRIGGER IF EXISTS trg_weekly_reports_updated_at ON weekly_reports;
CREATE TRIGGER trg_weekly_reports_updated_at BEFORE UPDATE ON weekly_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_issues_updated_at ON issues;
CREATE TRIGGER trg_issues_updated_at BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_stock_transfers_updated_at ON stock_transfers;
CREATE TRIGGER trg_stock_transfers_updated_at BEFORE UPDATE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_purchase_requests_updated_at ON purchase_requests;
CREATE TRIGGER trg_purchase_requests_updated_at BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_inventory_balances_updated_at ON inventory_balances;
CREATE TRIGGER trg_inventory_balances_updated_at BEFORE UPDATE ON inventory_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
