-- ==========================================
-- 202609220002: Quotation -> sale amount fidelity
-- ==========================================
-- The receipt PDF (src/components/ReceiptPDF.tsx) derives every number
-- from the sale rows:
--     total     = SUM(qty * unit_price - sale_items.discount_value)
--     subtotal  = total + daily_sales.discount_value
--     discount  = daily_sales.discount_value
--     balance   = total - daily_sales.amount_paid
-- For those numbers to be correct the header discount_value MUST equal
-- the sum of the item discounts, and amount_paid MUST equal the total.
--
-- The first version of create_sale_from_quotation() copied only the
-- line discounts, so a quotation carrying a header discount converted
-- into a sale for the wrong (higher) amount.
--
-- This migration replaces the function so that:
--   * the quotation header discount is allocated across the line items
--     (proportionally to the line gross, remainder on the last line),
--   * daily_sales.discount_value == SUM(sale_items.discount_value),
--   * daily_sales.amount_paid == the quotation total (balance = 0),
--   * a quotation that carries VAT is refused, because the receipt
--     document has no VAT line and would otherwise mis-state the total.
-- ==========================================

CREATE OR REPLACE FUNCTION create_sale_from_quotation(p_quotation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote quotations%ROWTYPE;
  v_business_id uuid;
  v_sale_id uuid;
  v_item quotation_items%ROWTYPE;
  v_subtotal numeric(14,2) := 0;
  v_line_discount numeric(14,2) := 0;
  v_header_discount numeric(14,2) := 0;
  v_total_discount numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_mode text;
  v_count integer;
  v_sale_item_id uuid;
  v_serial text;
  v_serial_row record;
  v_line_gross numeric(14,2) := 0;
  v_cumulative numeric(14,2) := 0;
  v_cumulative_alloc numeric(14,2) := 0;
  v_allocated numeric(14,2) := 0;
  v_index integer := 0;
  v_item_count integer := 0;
BEGIN
  IF NOT has_permission('sales.create') THEN
    RAISE EXCEPTION 'Sales permission required';
  END IF;

  SELECT * INTO v_quote FROM quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;
  IF v_quote.status = 'converted' THEN
    RAISE EXCEPTION 'This quotation has already been converted to a sale';
  END IF;
  IF v_quote.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled quotation cannot be converted';
  END IF;
  IF NOT can_access_branch(v_quote.branch_id) THEN
    RAISE EXCEPTION 'Branch is outside your assigned scope';
  END IF;
  IF COALESCE(v_quote.tax_value, 0) > 0 THEN
    RAISE EXCEPTION 'This quotation includes VAT, which receipts cannot show. Record the sale manually so the receipt states the right amounts.';
  END IF;

  SELECT business_id INTO v_business_id FROM branches WHERE id = v_quote.branch_id AND is_active = true;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Active branch not found';
  END IF;

  SELECT count(*) INTO v_count FROM quotation_items WHERE quotation_id = p_quotation_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'This quotation has no items to convert';
  END IF;
  v_item_count := v_count;

  -- Validation pass: no writes yet.
  FOR v_item IN SELECT * FROM quotation_items WHERE quotation_id = p_quotation_id ORDER BY sort_order
  LOOP
    IF v_item.product_id IS NULL THEN
      RAISE EXCEPTION 'Quotation item "%" is not linked to a product. Link a product to it before converting, or record the sale manually.', v_item.item_name;
    END IF;
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Quotation item "%" has an invalid quantity', v_item.item_name;
    END IF;
    IF v_item.quantity <> trunc(v_item.quantity) THEN
      RAISE EXCEPTION 'Quotation item "%" must have a whole-number quantity to be sold', v_item.item_name;
    END IF;
    IF v_item.unit_price IS NULL OR v_item.unit_price < 0 OR v_item.discount_value < 0 THEN
      RAISE EXCEPTION 'Quotation item "%" has an invalid price', v_item.item_name;
    END IF;

    SELECT serial_tracking_mode INTO v_mode FROM products
    WHERE id = v_item.product_id AND branch_id = v_quote.branch_id AND is_active = true;
    IF v_mode IS NULL THEN
      RAISE EXCEPTION 'Product for quotation item "%" is not stocked at this branch', v_item.item_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM inventory_balances
      WHERE product_id = v_item.product_id AND branch_id = v_quote.branch_id AND current_stock >= v_item.quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for quotation item "%"', v_item.item_name;
    END IF;

    IF v_mode = 'unique' THEN
      SELECT count(*) INTO v_count FROM product_serial_numbers
      WHERE product_id = v_item.product_id AND status = 'available';
      IF v_count < v_item.quantity THEN
        RAISE EXCEPTION 'Not enough available serial numbers for quotation item "%"', v_item.item_name;
      END IF;
    ELSIF v_mode = 'shared' THEN
      IF NOT EXISTS (
        SELECT 1 FROM product_serial_numbers
        WHERE product_id = v_item.product_id AND mode = 'shared' AND status = 'available' AND quantity >= v_item.quantity
      ) THEN
        RAISE EXCEPTION 'No shared serial group with enough quantity for quotation item "%"', v_item.item_name;
      END IF;
    END IF;

    v_subtotal := v_subtotal + (v_item.quantity * v_item.unit_price);
    v_line_discount := v_line_discount + v_item.discount_value;
  END LOOP;

  -- The quotation header discount is spread across the lines so that the
  -- receipt shows the same total the customer accepted.
  v_header_discount := COALESCE(v_quote.discount_value, 0);
  IF v_header_discount > v_subtotal THEN
    RAISE EXCEPTION 'The quotation discount is larger than the subtotal. Adjust the quotation before converting it.';
  END IF;
  v_total_discount := v_line_discount + v_header_discount;
  v_total := v_subtotal - v_total_discount;

  -- Header row (mirrors create_sale_with_items conventions).
  INSERT INTO daily_sales (
    business_id, branch_id, salesperson_id, customer_name, sale_date,
    quantity, unit_price, discount_value, amount_paid, status, notes, quotation_id
  ) VALUES (
    v_business_id, v_quote.branch_id, auth.uid(),
    NULLIF(trim(COALESCE(v_quote.customer_name, v_quote.prepared_for, '')), ''),
    CURRENT_DATE, 1, v_subtotal, v_total_discount, v_total, 'completed',
    trim('Converted from quotation ' || COALESCE(v_quote.quote_number, v_quote.id::text)),
    v_quote.id
  ) RETURNING id INTO v_sale_id;

  -- Item rows, stock moves, serial transitions.
  v_index := 0;
  FOR v_item IN SELECT * FROM quotation_items WHERE quotation_id = p_quotation_id ORDER BY sort_order
  LOOP
    v_index := v_index + 1;
    SELECT serial_tracking_mode INTO v_mode FROM products WHERE id = v_item.product_id;
    v_serial := NULL;

    -- Share of the header discount for this line (remainder lands on the
    -- last line so the allocated total is exact).
    v_line_gross := v_item.quantity * v_item.unit_price;
    v_cumulative := v_cumulative + v_line_gross;
    IF v_index = v_item_count THEN
      v_allocated := v_header_discount - v_cumulative_alloc;
    ELSE
      v_allocated := round(v_header_discount * v_cumulative / NULLIF(v_subtotal, 0), 2) - v_cumulative_alloc;
    END IF;
    v_cumulative_alloc := v_cumulative_alloc + v_allocated;

    IF v_mode = 'unique' THEN
      SELECT psn.serial_number INTO v_serial
      FROM product_serial_numbers psn
      WHERE psn.product_id = v_item.product_id AND status = 'available'
      ORDER BY psn.serial_number
      LIMIT 1
      FOR UPDATE;

      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit, serial_number)
      VALUES (v_sale_id, v_item.product_id, v_item.quantity::integer, v_item.unit_price,
              v_item.discount_value + v_allocated,
              NULLIF(trim(COALESCE(v_item.unit, '')), ''), v_serial)
      RETURNING id INTO v_sale_item_id;

      FOR v_serial_row IN
        SELECT id, serial_number FROM product_serial_numbers
        WHERE product_id = v_item.product_id AND status = 'available'
        ORDER BY serial_number
        LIMIT v_item.quantity::integer
        FOR UPDATE
      LOOP
        UPDATE product_serial_numbers
        SET status = 'sold', sale_id = v_sale_id, sold_at = now(), updated_at = now()
        WHERE id = v_serial_row.id AND status = 'available';
        INSERT INTO sale_serial_numbers (sale_id, sale_item_id, product_id, serial_number_id, serial_number)
        VALUES (v_sale_id, v_sale_item_id, v_item.product_id, v_serial_row.id, v_serial_row.serial_number);
      END LOOP;

    ELSIF v_mode = 'shared' THEN
      SELECT psn.serial_number INTO v_serial
      FROM product_serial_numbers psn
      WHERE psn.product_id = v_item.product_id AND mode = 'shared' AND status = 'available' AND quantity >= v_item.quantity
      ORDER BY psn.serial_number
      LIMIT 1
      FOR UPDATE;

      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit, serial_number)
      VALUES (v_sale_id, v_item.product_id, v_item.quantity::integer, v_item.unit_price,
              v_item.discount_value + v_allocated,
              NULLIF(trim(COALESCE(v_item.unit, '')), ''), v_serial)
      RETURNING id INTO v_sale_item_id;

      UPDATE product_serial_numbers
      SET quantity = quantity - v_item.quantity, updated_at = now(),
          status = CASE WHEN quantity - v_item.quantity <= 0 THEN 'sold' ELSE status END,
          sale_id = CASE WHEN quantity - v_item.quantity <= 0 THEN v_sale_id ELSE sale_id END
      WHERE product_id = v_item.product_id AND serial_number = v_serial AND mode = 'shared'
        AND status = 'available' AND quantity >= v_item.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Shared serial % is no longer available for quotation item "%"', v_serial, v_item.item_name;
      END IF;
      INSERT INTO sale_serial_numbers (sale_id, sale_item_id, product_id, serial_number_id, serial_number)
      SELECT v_sale_id, v_sale_item_id, v_item.product_id, id, serial_number
      FROM product_serial_numbers
      WHERE product_id = v_item.product_id AND serial_number = v_serial AND mode = 'shared';

    ELSE
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit, serial_number)
      VALUES (v_sale_id, v_item.product_id, v_item.quantity::integer, v_item.unit_price,
              v_item.discount_value + v_allocated,
              NULLIF(trim(COALESCE(v_item.unit, '')), ''), NULL)
      RETURNING id INTO v_sale_item_id;
    END IF;

    UPDATE inventory_balances
    SET current_stock = current_stock - v_item.quantity, updated_at = now()
    WHERE product_id = v_item.product_id AND branch_id = v_quote.branch_id AND current_stock >= v_item.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient stock for quotation item "%"', v_item.item_name;
    END IF;

    INSERT INTO inventory_transactions (product_id, branch_id, movement_type, quantity, reason, reference_type, reference_id, actor_id)
    VALUES (v_item.product_id, v_quote.branch_id, 'sale', v_item.quantity,
            'Sale created from quotation ' || COALESCE(v_quote.quote_number, v_quote.id::text),
            'daily_sale', v_sale_id, auth.uid());
  END LOOP;

  UPDATE quotations
  SET status = 'converted', converted_to_sale_id = v_sale_id, converted_at = now(), updated_at = now()
  WHERE id = p_quotation_id;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata, branch_id)
  VALUES (auth.uid(), 'quotation.converted', 'quotations', p_quotation_id,
          jsonb_build_object('sale_id', v_sale_id, 'subtotal', v_subtotal, 'discount', v_total_discount, 'total', v_total, 'item_count', v_count),
          v_quote.branch_id);

  RETURN v_sale_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_sale_from_quotation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_sale_from_quotation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION create_sale_from_quotation(uuid) TO authenticated;
