-- Roles administration (Super Admin/Admin), multi-unit products, and
-- per-line sale units.

-- 1) Roles: Super Admin and Admin can create and edit roles. Deletes are
-- allowed except the locked super_admin and admin roles, enforced here so
-- no client can remove them.
DROP POLICY IF EXISTS "roles_insert_admin" ON roles;
CREATE POLICY "roles_insert_admin" ON roles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  );

DROP POLICY IF EXISTS "roles_update_admin" ON roles;
CREATE POLICY "roles_update_admin" ON roles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  );

DROP POLICY IF EXISTS "roles_delete_protected" ON roles;
CREATE POLICY "roles_delete_protected" ON roles FOR DELETE
  TO authenticated USING (
    roles.name NOT IN ('super_admin', 'admin')
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  );

-- 2) Extra measurement units per product (e.g. eggs sold per crate, dozen
-- or piece). The primary unit stays on products.unit.
CREATE TABLE IF NOT EXISTS product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_product_units_product_id ON product_units (product_id);

ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_units_select_authenticated" ON product_units;
CREATE POLICY "product_units_select_authenticated" ON product_units FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "product_units_write_manage" ON product_units;
CREATE POLICY "product_units_write_manage" ON product_units FOR ALL
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

-- 3) Record the unit used on each sale line.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit text;

-- Same sale logic as 202609150002, additionally persisting the line unit.
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
BEGIN
  IF NOT has_permission('sales.create') THEN RAISE EXCEPTION 'Sales permission required'; END IF;
  IF NOT can_access_branch(p_branch_id) THEN RAISE EXCEPTION 'Branch is outside your assigned scope'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'A sale must contain at least one item'; END IF;
  IF COALESCE(p_amount_paid, 0) < 0 THEN RAISE EXCEPTION 'Amount paid cannot be negative'; END IF;

  SELECT business_id INTO v_business_id FROM branches WHERE id = p_branch_id AND is_active;
  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Active branch not found'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_item_discount := COALESCE((v_item->>'discount_value')::numeric, 0);
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 OR v_item_discount < 0 THEN
      RAISE EXCEPTION 'Each sale item needs a product, positive quantity and valid price';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id AND business_id = v_business_id AND is_active) THEN
      RAISE EXCEPTION 'A selected product is unavailable for this branch business';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM inventory_balances WHERE product_id = v_product_id AND branch_id = p_branch_id AND current_stock >= v_quantity) THEN
      RAISE EXCEPTION 'Insufficient stock for selected product';
    END IF;
    v_subtotal := v_subtotal + (v_quantity * v_unit_price);
    v_discount := v_discount + v_item_discount;
  END LOOP;

  INSERT INTO daily_sales (business_id, branch_id, salesperson_id, customer_name, sale_date, quantity, unit_price, discount_value, amount_paid, status, notes)
  VALUES (v_business_id, p_branch_id, auth.uid(), NULLIF(trim(p_customer_name), ''), CURRENT_DATE, 1, v_subtotal, v_discount, p_amount_paid, 'completed', NULLIF(trim(p_notes), ''))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_item_discount := COALESCE((v_item->>'discount_value')::numeric, 0);
    v_unit := NULLIF(trim(COALESCE(v_item->>'unit', '')), '');
    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit)
    VALUES (v_sale_id, v_product_id, v_quantity, v_unit_price, v_item_discount, v_unit);
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
