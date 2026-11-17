-- ============================================
-- 202609230001_live_stock_and_serial_registration.sql
-- 1) Allow an attendant (sales.create) to register a new product serial while
--    recording a sale, even if they only have the sales_person role.
-- 2) Push a submitted weekly report's closing stock back into the live
--    inventory balances (audited adjustment transactions) so the stock
--    balance is correct and consistent across the whole system.
-- ============================================

-- 1. Register / add a product serial number from the sales screen.
CREATE OR REPLACE FUNCTION register_product_serial(
  p_product_id uuid,
  p_serial_number text,
  p_mode text DEFAULT 'unique',
  p_quantity numeric DEFAULT 1
) RETURNS product_serial_numbers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product products;
  v_row product_serial_numbers;
  v_serial text := btrim(p_serial_number);
BEGIN
  IF v_serial IS NULL OR length(v_serial) < 1 THEN
    RAISE EXCEPTION 'Serial number is required';
  END IF;
  IF p_mode NOT IN ('unique', 'shared') THEN
    RAISE EXCEPTION 'Mode must be unique or shared';
  END IF;
  SELECT * INTO v_product FROM products WHERE id = p_product_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;
  IF NOT can_access_branch(v_product.branch_id) THEN
    RAISE EXCEPTION 'Product is outside your branch scope';
  END IF;
  IF NOT has_permission('sales.create')
     AND NOT has_permission('inventory.manage')
     AND NOT has_permission('inventory.adjust') THEN
    RAISE EXCEPTION 'Not authorized to register serial numbers';
  END IF;
  IF p_mode = 'shared' AND p_quantity <= 0 THEN
    RAISE EXCEPTION 'Shared serial quantity must be greater than zero';
  END IF;

  SELECT * INTO v_row
  FROM product_serial_numbers
  WHERE product_id = p_product_id AND serial_number = v_serial;

  IF FOUND THEN
    IF v_row.status <> 'available' THEN
      RAISE EXCEPTION 'Serial "%" already exists and is %', v_serial, v_row.status;
    END IF;
    IF p_mode = 'shared' THEN
      UPDATE product_serial_numbers
      SET quantity = quantity + p_quantity, updated_at = now()
      WHERE id = v_row.id
      RETURNING * INTO v_row;
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO product_serial_numbers (product_id, serial_number, mode, status, quantity)
  VALUES (p_product_id, v_serial, p_mode, 'available', CASE WHEN p_mode = 'shared' THEN p_quantity ELSE 1 END)
  RETURNING * INTO v_row;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'serial.registered', 'product_serial_numbers', v_row.id,
          jsonb_build_object('product_id', p_product_id, 'serial_number', v_serial, 'mode', p_mode, 'quantity', v_row.quantity));

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION register_product_serial(uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_product_serial(uuid, text, text, numeric) TO authenticated;

-- 2. Sync a submitted weekly report's closing stock into the live balances.
--    The report is aggregate; balances are per-product, so the difference is
--    distributed proportionally across the branch's products and written as
--    fully audited inventory_transactions (physical_count). No silent edits.
CREATE OR REPLACE FUNCTION sync_weekly_report_stock(
  p_report_id uuid,
  p_closing_stock numeric,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_report weekly_reports%rowtype;
  v_total numeric;
  v_diff numeric;
  v_movable numeric;
  v_rec record;
  v_delta numeric;
  v_new numeric;
  v_moved numeric := 0;
  v_lines int := 0;
BEGIN
  SELECT * INTO v_report FROM weekly_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;
  IF NOT can_access_branch(v_report.branch_id) THEN
    RAISE EXCEPTION 'Report branch is outside your scope';
  END IF;
  IF NOT has_permission('inventory.adjust') AND NOT has_permission('inventory.manage') THEN
    -- Attendants can submit reports but must not silently rewrite stock.
    RETURN jsonb_build_object('applied', false, 'reason', 'no inventory adjustment permission');
  END IF;

  SELECT COALESCE(sum(current_stock), 0) INTO v_total
  FROM inventory_balances WHERE branch_id = v_report.branch_id;

  v_diff := p_closing_stock - v_total;
  IF abs(v_diff) < 0.005 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'already aligned', 'system_total', v_total);
  END IF;

  SELECT COALESCE(sum(current_stock), 0) INTO v_movable
  FROM inventory_balances WHERE branch_id = v_report.branch_id AND current_stock > 0;

  IF COALESCE(v_movable, 0) <= 0 THEN
    -- Nothing to distribute over: record the discrepancy as a report note only.
    RETURN jsonb_build_object('applied', false, 'reason', 'no stock balances to adjust', 'system_total', v_total);
  END IF;

  FOR v_rec IN
    SELECT id, product_id, current_stock
    FROM inventory_balances
    WHERE branch_id = v_report.branch_id AND current_stock > 0
    ORDER BY current_stock DESC, id
  LOOP
    v_lines := v_lines + 1;
    IF v_lines = (SELECT count(*) FROM inventory_balances WHERE branch_id = v_report.branch_id AND current_stock > 0) THEN
      v_delta := v_diff - v_moved; -- last line absorbs rounding remainder
    ELSE
      v_delta := round(v_diff * (v_rec.current_stock / v_movable), 2);
      v_moved := v_moved + v_delta;
    END IF;
    v_new := v_rec.current_stock + v_delta;
    IF v_new < 0 THEN
      v_delta := -v_rec.current_stock;
      v_new := 0;
    END IF;
    UPDATE inventory_balances
    SET current_stock = v_new, updated_at = now()
    WHERE id = v_rec.id;
    INSERT INTO inventory_transactions
      (product_id, branch_id, movement_type, quantity, quantity_before, quantity_after,
       reason, reference_type, reference_id, actor_id, transaction_date)
    VALUES
      (v_rec.product_id, v_report.branch_id, 'physical_count', abs(v_delta),
       v_rec.current_stock, v_new,
       COALESCE(NULLIF(btrim(p_reason), ''), 'Weekly report closing stock reconciliation'),
       'weekly_report', p_report_id, auth.uid(), now());
  END LOOP;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'report.stock_synced', 'weekly_reports', p_report_id,
          jsonb_build_object('branch_id', v_report.branch_id, 'week_end', v_report.week_end_date,
                             'previous_system_total', v_total, 'reported_closing', p_closing_stock,
                             'difference', v_diff, 'lines_adjusted', v_lines));

  RETURN jsonb_build_object('applied', true, 'system_total', v_total,
                            'reported_closing', p_closing_stock, 'difference', v_diff,
                            'lines_adjusted', v_lines);
END;
$$;

REVOKE ALL ON FUNCTION sync_weekly_report_stock(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_weekly_report_stock(uuid, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
