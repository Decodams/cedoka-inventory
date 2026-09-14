-- Multi-item sales.  daily_sales remains the transaction header so existing
-- dashboards and weekly-report aggregates continue to work unchanged.

INSERT INTO permissions (code, description) VALUES
  ('sales.create', 'Create a sale within the assigned branch'),
  ('sales.view', 'View sales within the assigned scope')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code IN ('sales.create', 'sales.view')
  AND r.name IN ('super_admin', 'admin', 'manager', 'supervisor', 'sales_person')
ON CONFLICT DO NOTHING;

-- Scope is assignment-based, not a hard-coded role list.  This lets an Admin
-- oversee multiple businesses and lets any future sales-enabled role sell only
-- from its assigned branch.
CREATE OR REPLACE FUNCTION can_access_business(p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (r.name = 'super_admin' OR up.business_id = p_business_id
           OR EXISTS (SELECT 1 FROM user_business_assignments uba WHERE uba.user_id = up.id AND uba.business_id = p_business_id))
  );
$$;

CREATE OR REPLACE FUNCTION can_access_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id JOIN branches b ON b.id = p_branch_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (r.name = 'super_admin' OR up.branch_id = p_branch_id
           OR EXISTS (SELECT 1 FROM user_branch_assignments uba WHERE uba.user_id = up.id AND uba.branch_id = p_branch_id)
           OR (r.name = 'admin' AND (up.business_id = b.business_id OR EXISTS (SELECT 1 FROM user_business_assignments uba WHERE uba.user_id = up.id AND uba.business_id = b.business_id))))
  );
$$;

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES daily_sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_items_scoped_select ON sale_items;
CREATE POLICY sale_items_scoped_select ON sale_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM daily_sales s WHERE s.id = sale_id AND can_view_user_records(s.salesperson_id)));

-- This is deliberately the only write path for new sales.  It derives staff
-- attribution from auth.uid(), validates the branch/business relation, and
-- creates the header, lines and stock movements in one database transaction.
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
  v_quantity integer;
  v_unit_price numeric(14,2);
  v_item_discount numeric(14,2);
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
    v_quantity := (v_item->>'quantity')::integer;
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
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_item_discount := COALESCE((v_item->>'discount_value')::numeric, 0);
    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value)
    VALUES (v_sale_id, v_product_id, v_quantity, v_unit_price, v_item_discount);
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
