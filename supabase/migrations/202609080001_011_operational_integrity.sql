/* Operational integrity: scoped access, atomic inventory, reconciliation, and workflow controls. */

-- Product-level period reconciliation. Aggregate weekly report fields remain for compatibility.
CREATE TABLE IF NOT EXISTS inventory_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (
        status IN (
            'open',
            'submitted',
            'approved',
            'amended'
        )
    ),
    approved_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (branch_id, period_end),
    CHECK (period_end = period_start + 6)
);

CREATE TABLE IF NOT EXISTS inventory_period_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    period_id uuid NOT NULL REFERENCES inventory_periods (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    opening_quantity integer NOT NULL DEFAULT 0,
    received_quantity integer NOT NULL DEFAULT 0,
    transfer_in_quantity integer NOT NULL DEFAULT 0,
    authorized_additions_quantity integer NOT NULL DEFAULT 0,
    sales_issues_quantity integer NOT NULL DEFAULT 0,
    transfer_out_quantity integer NOT NULL DEFAULT 0,
    damage_quantity integer NOT NULL DEFAULT 0,
    returns_deductions_quantity integer NOT NULL DEFAULT 0,
    adjustment_quantity integer NOT NULL DEFAULT 0,
    expected_closing_quantity integer GENERATED ALWAYS AS (
        opening_quantity + received_quantity + transfer_in_quantity + authorized_additions_quantity - sales_issues_quantity - transfer_out_quantity - damage_quantity - returns_deductions_quantity + adjustment_quantity
    ) STORED,
    physical_closing_quantity integer,
    counted_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    counted_at timestamptz,
    UNIQUE (period_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_variances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    period_line_id uuid NOT NULL REFERENCES inventory_period_lines (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    variance_quantity integer NOT NULL,
    possible_reason text,
    explanation text,
    supporting_evidence text,
    responsible_person uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    approval_status text NOT NULL DEFAULT 'pending' CHECK (
        approval_status IN (
            'pending',
            'approved',
            'rejected'
        )
    ),
    approved_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    approved_at timestamptz,
    requires_management_attention boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now ()
);

-- Future-ready operational sub-ledgers.
CREATE TABLE IF NOT EXISTS daily_sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    product_id uuid REFERENCES products (id) ON DELETE RESTRICT,
    salesperson_id uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    customer_name text,
    sale_date date NOT NULL DEFAULT CURRENT_DATE,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(14, 2) NOT NULL DEFAULT 0,
    discount_value numeric(14, 2) NOT NULL DEFAULT 0,
    amount_paid numeric(14, 2) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'completed' CHECK (
        status IN (
            'pending',
            'completed',
            'returned',
            'refunded'
        )
    ),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE TABLE IF NOT EXISTS operational_expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    expense_date date NOT NULL DEFAULT CURRENT_DATE,
    category text NOT NULL,
    description text NOT NULL,
    amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
    status text NOT NULL DEFAULT 'recorded' CHECK (
        status IN (
            'recorded',
            'approved',
            'rejected'
        )
    ),
    recorded_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    approved_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'simple' CHECK (
    product_type IN (
        'simple',
        'serialized',
        'batch'
    )
);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS warranty_months integer;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS expiry_tracking boolean NOT NULL DEFAULT false;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS opening_date date;

ALTER TABLE branches
ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES user_profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_periods_branch_end ON inventory_periods (branch_id, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_period_lines_product ON inventory_period_lines (product_id);

CREATE INDEX IF NOT EXISTS idx_stock_variances_attention ON stock_variances (requires_management_attention)
WHERE
    requires_management_attention;

CREATE INDEX IF NOT EXISTS idx_daily_sales_branch_date ON daily_sales (branch_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_operational_expenses_branch_date ON operational_expenses (branch_id, expense_date DESC);

-- SECURITY DEFINER scope checks avoid recursive RLS policies.
CREATE OR REPLACE FUNCTION current_profile()
RETURNS user_profiles LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT up FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active;
$$;

CREATE OR REPLACE FUNCTION can_access_business(p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (r.name = 'super_admin' OR up.business_id = p_business_id)
  );
$$;

CREATE OR REPLACE FUNCTION can_access_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
    JOIN branches b ON b.id = p_branch_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (r.name = 'super_admin' OR (r.name = 'admin' AND up.business_id = b.business_id)
           OR (r.name IN ('manager','sales_person') AND up.branch_id = p_branch_id))
  );
$$;

REVOKE ALL ON FUNCTION current_profile () FROM PUBLIC;

REVOKE ALL ON FUNCTION can_access_business (uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION can_access_branch (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION current_profile () TO authenticated;

GRANT EXECUTE ON FUNCTION can_access_business (uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION can_access_branch (uuid) TO authenticated;

-- Replace the broad operational read policies with backend-enforced scope policies.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['categories','suppliers','products','weekly_reports','daily_activities','issues','purchase_requests','goods_received_notes','stock_transfers','inventory_periods','inventory_period_lines','stock_variances','daily_sales','operational_expenses'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_select_authenticated', table_name);
  END LOOP;
  DROP POLICY IF EXISTS inventory_balances_select_authenticated ON inventory_balances;
  DROP POLICY IF EXISTS inventory_txns_select_authenticated ON inventory_transactions;
END $$;

CREATE POLICY categories_scoped_select ON categories FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

CREATE POLICY suppliers_scoped_select ON suppliers FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

CREATE POLICY products_scoped_select ON products FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

CREATE POLICY weekly_reports_scoped_select ON weekly_reports FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY daily_activities_scoped_select ON daily_activities FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY issues_scoped_select ON issues FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY purchase_requests_scoped_select ON purchase_requests FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY goods_received_notes_scoped_select ON goods_received_notes FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY stock_transfers_scoped_select ON stock_transfers FOR
SELECT TO authenticated USING (
        can_access_branch (from_branch_id)
        OR can_access_branch (to_branch_id)
    );

CREATE POLICY inventory_balances_scoped_select ON inventory_balances FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY inventory_txns_scoped_select ON inventory_transactions FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY inventory_periods_scoped_select ON inventory_periods FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY inventory_period_lines_scoped_select ON inventory_period_lines FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1
            FROM inventory_periods p
            WHERE
                p.id = period_id
                AND can_access_branch (p.branch_id)
        )
    );

CREATE POLICY stock_variances_scoped_select ON stock_variances FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY daily_sales_scoped_select ON daily_sales FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

CREATE POLICY operational_expenses_scoped_select ON operational_expenses FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

-- Atomic movement: lock the balance, write the ledger, and update the balance together.
CREATE OR REPLACE FUNCTION record_inventory_movement(
  p_product_id uuid, p_branch_id uuid, p_movement_type text, p_quantity integer,
  p_reason text DEFAULT NULL, p_reference_type text DEFAULT NULL, p_reference_id uuid DEFAULT NULL
) RETURNS inventory_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product products; v_balance inventory_balances; v_before integer; v_after integer; v_delta integer; v_tx inventory_transactions;
BEGIN
  IF NOT has_permission('inventory.manage') AND NOT has_permission('inventory.adjust') THEN RAISE EXCEPTION 'Inventory permission required'; END IF;
  IF NOT can_access_branch(p_branch_id) THEN RAISE EXCEPTION 'Branch is outside your scope'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_movement_type NOT IN ('opening_balance','purchase_receipt','sale','transfer_in','transfer_out','return_in','return_out','damage','loss','adjustment','stock_issue','physical_count','production') THEN RAISE EXCEPTION 'Invalid movement type'; END IF;
  SELECT * INTO v_product FROM products WHERE id = p_product_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found or inactive'; END IF;
  SELECT * INTO v_balance FROM inventory_balances WHERE product_id = p_product_id AND branch_id = p_branch_id FOR UPDATE;
  v_before := COALESCE(v_balance.current_stock, 0);
  v_delta := CASE WHEN p_movement_type IN ('purchase_receipt','transfer_in','return_in','production','opening_balance') THEN p_quantity
                  WHEN p_movement_type IN ('sale','transfer_out','return_out','damage','loss','stock_issue') THEN -p_quantity
                  WHEN p_movement_type = 'physical_count' THEN p_quantity - v_before
                  ELSE p_quantity END;
  v_after := v_before + v_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'Movement would make stock negative'; END IF;
  IF v_balance.id IS NULL THEN
    INSERT INTO inventory_balances(product_id, branch_id, opening_stock, current_stock, min_stock_level, reorder_level)
    VALUES (p_product_id, p_branch_id, CASE WHEN p_movement_type = 'opening_balance' THEN p_quantity ELSE 0 END, v_after, v_product.min_stock_level, v_product.reorder_level);
  ELSE
    UPDATE inventory_balances SET current_stock = v_after, last_count_date = CASE WHEN p_movement_type = 'physical_count' THEN CURRENT_DATE ELSE last_count_date END WHERE id = v_balance.id;
  END IF;
  INSERT INTO inventory_transactions(product_id, branch_id, movement_type, quantity, quantity_before, quantity_after, reason, reference_type, reference_id, actor_id)
  VALUES (p_product_id, p_branch_id, p_movement_type, p_quantity, v_before, v_after, NULLIF(trim(p_reason), ''), p_reference_type, p_reference_id, auth.uid()) RETURNING * INTO v_tx;
  RETURN v_tx;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_inventory_movement (
    uuid,
    uuid,
    text,
    integer,
    text,
    text,
    uuid
)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION record_inventory_movement (
    uuid,
    uuid,
    text,
    integer,
    text,
    text,
    uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION activate_user(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_permission('users.manage_all') AND NOT has_permission('users.manage_business') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_profiles target WHERE target.id = p_user_id AND (has_permission('users.manage_all') OR can_access_business(target.business_id))) THEN RAISE EXCEPTION 'User is outside your scope'; END IF;
  UPDATE user_profiles SET is_active = true WHERE id = p_user_id;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, metadata) VALUES (auth.uid(), 'user.activated', 'user_profiles', p_user_id, '{}');
END;
$$;

REVOKE EXECUTE ON FUNCTION activate_user (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION activate_user (uuid) TO authenticated;

-- Keep historical rows, but prevent silent edits to submitted reports at the database boundary.
CREATE OR REPLACE FUNCTION prevent_submitted_report_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('submitted','reviewed','amended') AND current_setting('app.allow_report_amendment', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Submitted reports are locked; use the amendment workflow';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_submitted_report ON weekly_reports;

CREATE TRIGGER trg_lock_submitted_report BEFORE UPDATE ON weekly_reports FOR EACH ROW EXECUTE FUNCTION prevent_submitted_report_edit();

-- Prevent anonymous/system clients from forging audit events.
DROP POLICY IF EXISTS audit_log_insert_authenticated ON audit_log;

CREATE POLICY audit_log_insert_authenticated ON audit_log FOR INSERT TO authenticated
WITH
    CHECK (actor_id = auth.uid ());

ALTER TABLE inventory_periods ENABLE ROW LEVEL SECURITY;

ALTER TABLE inventory_period_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE stock_variances ENABLE ROW LEVEL SECURITY;

ALTER TABLE daily_sales ENABLE ROW LEVEL SECURITY;

ALTER TABLE operational_expenses ENABLE ROW LEVEL SECURITY;