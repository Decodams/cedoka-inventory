-- ============================================
-- 202609250001_sale_returns.sql
-- Controlled customer return / refund of a completed sale:
--   * restocks each sold item into the branch inventory (ledger transaction)
--   * releases unique serial numbers back to 'available'
--   * marks the sale 'returned' or 'refunded' with an audit trail
-- ============================================

CREATE OR REPLACE FUNCTION process_sale_return(
  p_sale_id uuid,
  p_status text DEFAULT 'returned',
  p_reason text DEFAULT NULL
) RETURNS daily_sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale daily_sales%rowtype;
  v_item record;
  v_returned_at timestamptz := now();
BEGIN
  IF p_status NOT IN ('returned', 'refunded') THEN
    RAISE EXCEPTION 'Status must be returned or refunded';
  END IF;

  SELECT * INTO v_sale FROM daily_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed sales can be returned (current: %)', v_sale.status;
  END IF;
  IF NOT can_access_branch(v_sale.branch_id) THEN
    RAISE EXCEPTION 'Sale branch is outside your scope';
  END IF;
  IF NOT has_permission('sales.create') AND NOT has_permission('sales.cancel') THEN
    RAISE EXCEPTION 'Not authorized to process returns';
  END IF;

  -- Restock each line and release its serials
  FOR v_item IN
    SELECT si.product_id, si.quantity, si.serial_number
    FROM sale_items si WHERE si.sale_id = p_sale_id
  LOOP
    IF v_item.quantity > 0 THEN
      PERFORM record_inventory_movement(
        v_item.product_id, v_sale.branch_id, 'return_in', v_item.quantity,
        COALESCE(NULLIF(btrim(p_reason), ''), 'Customer return of sale ' || p_sale_id::text),
        'sale_return', p_sale_id
      );
    END IF;

    -- Unique serials (comma-separated in sale_items.serial_number) go back to available
    IF v_item.serial_number IS NOT NULL AND btrim(v_item.serial_number) <> '' THEN
      UPDATE product_serial_numbers
         SET status = 'available', sale_id = NULL, sold_at = NULL, updated_at = now()
       WHERE product_id = v_item.product_id
         AND status = 'sold'
         AND serial_number = ANY(string_to_array(v_item.serial_number, ','));
      -- Shared-group serials: add the returned quantity back
      UPDATE product_serial_numbers
         SET quantity = quantity + v_item.quantity, updated_at = now()
       WHERE product_id = v_item.product_id
         AND mode = 'shared'
         AND serial_number = btrim(v_item.serial_number);
    END IF;

    -- Link rows also release their individual serials
    UPDATE product_serial_numbers psn
       SET status = 'available', sale_id = NULL, sold_at = NULL, updated_at = now()
      FROM sale_serial_numbers ssn
     WHERE ssn.sale_id = p_sale_id
       AND ssn.serial_number_id = psn.id
       AND psn.status = 'sold';
  END LOOP;

  UPDATE daily_sales
     SET status = p_status,
         notes = COALESCE(notes, '') || CASE
           WHEN NULLIF(btrim(p_reason), '') IS NULL THEN ''
           ELSE E'\nReturn reason: ' || btrim(p_reason)
         END
   WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'sale.returned', 'daily_sales', p_sale_id,
          jsonb_build_object('status', p_status, 'branch_id', v_sale.branch_id,
                             'amount', v_sale.unit_price * v_sale.quantity, 'reason', p_reason,
                             'processed_at', v_returned_at));

  RETURN v_sale;
END;
$$;

REVOKE ALL ON FUNCTION process_sale_return(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_sale_return(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
