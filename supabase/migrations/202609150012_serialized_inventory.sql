-- Serialized inventory: per-product tracking modes (none/unique/shared),
-- individual serial records with lifecycle status, and sale-to-serial links.
-- Existing products default to 'none' and keep working unchanged.

ALTER TABLE products ADD COLUMN IF NOT EXISTS serial_tracking_mode text NOT NULL DEFAULT 'none'
  CHECK (serial_tracking_mode IN ('none', 'unique', 'shared'));

-- Individual serial records. Unique-mode rows represent one physical unit
-- each; shared-mode rows represent a group with a remaining quantity.
CREATE TABLE IF NOT EXISTS product_serial_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  serial_number text NOT NULL,
  mode text NOT NULL DEFAULT 'unique' CHECK (mode IN ('unique', 'shared')),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'sold', 'cancelled', 'returned', 'damaged', 'lost')),
  quantity numeric(14,2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  sale_id uuid REFERENCES daily_sales(id) ON DELETE SET NULL,
  sold_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_psn_product_status ON product_serial_numbers (product_id, status);

ALTER TABLE product_serial_numbers ENABLE ROW LEVEL SECURITY;

-- Serial numbers are selectable by anyone making a sale; only
-- product managers may change them.
DROP POLICY IF EXISTS "psn_select_authenticated" ON product_serial_numbers;
CREATE POLICY "psn_select_authenticated" ON product_serial_numbers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "psn_write_manage" ON product_serial_numbers;
CREATE POLICY "psn_write_manage" ON product_serial_numbers FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin', 'manager'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin', 'manager'))
    )
  );

-- Permanent link between a sale line and the exact physical units sold.
CREATE TABLE IF NOT EXISTS sale_serial_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES daily_sales(id) ON DELETE CASCADE,
  sale_item_id uuid REFERENCES sale_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  serial_number_id uuid REFERENCES product_serial_numbers(id) ON DELETE SET NULL,
  serial_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ssn_sale_id ON sale_serial_numbers (sale_id);
CREATE INDEX IF NOT EXISTS idx_ssn_serial_id ON sale_serial_numbers (serial_number_id);

ALTER TABLE sale_serial_numbers ENABLE ROW LEVEL SECURITY;

-- Readable wherever the parent sale is visible. No direct-write policy:
-- rows are created only by the sale transaction itself.
DROP POLICY IF EXISTS sale_serials_scoped_select ON sale_serial_numbers;
CREATE POLICY sale_serials_scoped_select ON sale_serial_numbers FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM daily_sales s WHERE s.id = sale_id AND can_view_user_records(s.salesperson_id)));

-- Same sale logic as 202609150011, plus serialized-inventory handling.
-- Unique mode: each requested unit needs an available serial, locked with
-- FOR UPDATE so concurrent sales cannot take the same unit; sold serials
-- are marked sold and linked. Shared mode: the named group must cover the
-- requested quantity, which is then decremented. Everything stays in one
-- transaction: any failure rolls back sale, stock and serials together.
CREATE OR REPLACE FUNCTION create_sale_with_items(
  p_branch_id uuid,
  p_customer_name text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_amount_paid numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_business_id uuid;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,2);
  v_unit_price numeric(14,2);
  v_item_discount numeric(14,2);
  v_unit text;
  v_serial text;
  v_mode text;
  v_serials jsonb;
  v_serial_value text;
  v_serial_row record;
  v_sale_item_id uuid;
BEGIN
  IF NOT has_permission('sales.create') THEN RAISE EXCEPTION 'Sales permission required'; END IF;
  IF NOT can_access_branch(p_branch_id) THEN RAISE EXCEPTION 'Branch is outside your assigned scope'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'A sale must contain at least one item'; END IF;
  IF COALESCE(p_amount_paid, 0) < 0 THEN RAISE EXCEPTION 'Amount paid cannot be negative'; END IF;

  SELECT business_id INTO v_business_id FROM branches WHERE id = p_branch_id AND is_active;
  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Active branch not found'; END IF;

  -- Validation pass: products, stock, and serials (nothing written yet).
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_item_discount := COALESCE((v_item->>'discount_value')::numeric, 0);
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 OR v_item_discount < 0 THEN
      RAISE EXCEPTION 'Each sale item needs a product, positive quantity and valid price';
    END IF;
    SELECT serial_tracking_mode INTO v_mode FROM products WHERE id = v_product_id AND business_id = v_business_id AND is_active;
    IF v_mode IS NULL THEN
      RAISE EXCEPTION 'A selected product is unavailable for this branch business';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM inventory_balances WHERE product_id = v_product_id AND branch_id = p_branch_id AND current_stock >= v_quantity) THEN
      RAISE EXCEPTION 'Insufficient stock for selected product';
    END IF;
    IF v_mode = 'unique' THEN
      v_serials := COALESCE(v_item->'serial_numbers', '[]'::jsonb);
      IF jsonb_typeof(v_serials) <> 'array' THEN
        RAISE EXCEPTION 'Select serial numbers for this product';
      END IF;
      IF v_quantity <> trunc(v_quantity) THEN
        RAISE EXCEPTION 'Unique-serialised items need a whole quantity';
      END IF;
      IF jsonb_array_length(v_serials) <> v_quantity::int THEN
        RAISE EXCEPTION 'Select exactly % serial number(s) for this product', v_quantity::int;
      END IF;
      IF (SELECT count(*) FROM (SELECT DISTINCT value FROM jsonb_array_elements(v_serials)) d) <> jsonb_array_length(v_serials) THEN
        RAISE EXCEPTION 'Duplicate serial numbers selected';
      END IF;
      FOR v_serial_value IN SELECT value #>> '{}' FROM jsonb_array_elements(v_serials)
      LOOP
        SELECT id INTO v_serial_row FROM product_serial_numbers
        WHERE product_id = v_product_id AND serial_number = v_serial_value AND status = 'available'
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Serial number % is no longer available. It may have been sold by another user.', v_serial_value;
        END IF;
      END LOOP;
    ELSIF v_mode = 'shared' THEN
      v_serial := NULLIF(trim(COALESCE(v_item->>'serial_number', '')), '');
      IF v_serial IS NULL AND EXISTS (SELECT 1 FROM product_serial_numbers WHERE product_id = v_product_id AND mode = 'shared' AND status = 'available') THEN
        RAISE EXCEPTION 'Select a serial group for this product';
      END IF;
      IF v_serial IS NOT NULL THEN
        SELECT id INTO v_serial_row FROM product_serial_numbers
        WHERE product_id = v_product_id AND serial_number = v_serial AND mode = 'shared'
          AND status = 'available' AND quantity >= v_quantity
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Shared serial % does not cover the requested quantity', v_serial;
        END IF;
      END IF;
    END IF;
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_discount := v_discount + v_item_discount;
  END LOOP;

  INSERT INTO daily_sales (business_id, branch_id, salesperson_id, customer_name, sale_date, quantity, unit_price, discount_value, amount_paid, status, notes)
  VALUES (v_business_id, p_branch_id, auth.uid(), NULLIF(trim(p_customer_name), ''), CURRENT_DATE, 1, v_subtotal, v_discount, p_amount_paid, 'completed', NULLIF(trim(p_notes), ''))
  RETURNING id INTO v_sale_id;

  -- Write pass: header lines, stock moves, serial transitions + links.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_item_discount := COALESCE((v_item->>'discount_value')::numeric, 0);
    v_unit := NULLIF(trim(COALESCE(v_item->>'unit', '')), '');
    v_serial := NULLIF(trim(COALESCE(v_item->>'serial_number', '')), '');
    SELECT serial_tracking_mode INTO v_mode FROM products WHERE id = v_product_id;
    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit, serial_number)
    VALUES (v_sale_id, v_product_id, v_quantity, v_unit_price, v_item_discount, v_unit, v_serial)
    RETURNING id INTO v_sale_item_id;

    IF v_mode = 'unique' THEN
      v_serials := COALESCE(v_item->'serial_numbers', '[]'::jsonb);
      FOR v_serial_value IN SELECT value #>> '{}' FROM jsonb_array_elements(v_serials)
      LOOP
        UPDATE product_serial_numbers
        SET status = 'sold', sale_id = v_sale_id, sold_at = now(), updated_at = now()
        WHERE product_id = v_product_id AND serial_number = v_serial_value AND status = 'available';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Serial number % is no longer available. It may have been sold by another user.', v_serial_value;
        END IF;
        INSERT INTO sale_serial_numbers (sale_id, sale_item_id, product_id, serial_number_id, serial_number)
        SELECT v_sale_id, v_sale_item_id, v_product_id, id, serial_number FROM product_serial_numbers
        WHERE product_id = v_product_id AND serial_number = v_serial_value;
      END LOOP;
    ELSIF v_mode = 'shared' AND v_serial IS NOT NULL THEN
      UPDATE product_serial_numbers
      SET quantity = quantity - v_quantity, updated_at = now(),
          status = CASE WHEN quantity - v_quantity <= 0 THEN 'sold' ELSE status END,
          sale_id = CASE WHEN quantity - v_quantity <= 0 THEN v_sale_id ELSE sale_id END
      WHERE product_id = v_product_id AND serial_number = v_serial AND mode = 'shared'
        AND status = 'available' AND quantity >= v_quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Shared serial % does not cover the requested quantity', v_serial;
      END IF;
      INSERT INTO sale_serial_numbers (sale_id, sale_item_id, product_id, serial_number_id, serial_number)
      SELECT v_sale_id, v_sale_item_id, v_product_id, id, serial_number FROM product_serial_numbers
      WHERE product_id = v_product_id AND serial_number = v_serial;
    END IF;

    UPDATE inventory_balances SET current_stock = current_stock - v_quantity, updated_at = now()
    WHERE product_id = v_product_id AND branch_id = p_branch_id AND current_stock >= v_quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for selected product'; END IF;
    INSERT INTO inventory_transactions (product_id, branch_id, movement_type, quantity, reason, reference_type, reference_id, actor_id)
    VALUES (v_product_id, p_branch_id, 'sale', v_quantity, 'Completed sale', 'daily_sale', v_sale_id, auth.uid());
  END LOOP;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'sale.created', 'daily_sales', v_sale_id, jsonb_build_object('item_count', jsonb_array_length(p_items), 'payment_method', p_payment_method));
  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION create_sale_with_items(uuid, text, text, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_sale_with_items(uuid, text, text, numeric, text, jsonb) TO authenticated;
