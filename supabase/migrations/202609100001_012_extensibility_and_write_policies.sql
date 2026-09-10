/* Extensibility, controlled operational records, and write policies. */

CREATE TABLE IF NOT EXISTS departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    department_id uuid REFERENCES departments (id) ON DELETE SET NULL,
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    branch_id uuid REFERENCES branches (id) ON DELETE SET NULL,
    name text NOT NULL,
    description text DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now (),
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_business_assignments (
    user_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now (),
    PRIMARY KEY (user_id, business_id)
);

CREATE TABLE IF NOT EXISTS user_branch_assignments (
    user_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now (),
    PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
    name text NOT NULL,
    code text,
    description text DEFAULT '',
    unit text NOT NULL DEFAULT 'service',
    price numeric(14, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    name text NOT NULL,
    email text,
    phone text,
    address text,
    notes text DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE TABLE IF NOT EXISTS inventory_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    branch_id uuid REFERENCES branches (id) ON DELETE SET NULL,
    name text NOT NULL,
    location_type text NOT NULL DEFAULT 'stockroom' CHECK (
        location_type IN (
            'branch',
            'warehouse',
            'stockroom',
            'shelf',
            'bin',
            'transit',
            'other'
        )
    ),
    parent_location_id uuid REFERENCES inventory_locations (id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS report_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  schema_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  module text NOT NULL,
  name text NOT NULL,
  transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_roles text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, module, name)
);

CREATE TABLE IF NOT EXISTS inventory_exception_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    product_id uuid REFERENCES products (id) ON DELETE RESTRICT,
    exception_type text NOT NULL CHECK (
        exception_type IN (
            'damage',
            'loss',
            'customer_return',
            'supplier_return',
            'write_off'
        )
    ),
    quantity integer NOT NULL CHECK (quantity > 0),
    value numeric(14, 2) CHECK (
        value IS NULL
        OR value >= 0
    ),
    reason text NOT NULL,
    evidence text,
    reported_by uuid NOT NULL REFERENCES user_profiles (id) ON DELETE RESTRICT,
    responsible_person uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    approval_status text NOT NULL DEFAULT 'pending' CHECK (
        approval_status IN (
            'pending',
            'approved',
            'rejected',
            'resolved'
        )
    ),
    approved_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    approved_at timestamptz,
    resolution text,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_departments_business ON departments (business_id);

CREATE INDEX IF NOT EXISTS idx_teams_business_branch ON teams (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_customers_business ON customers (business_id);

CREATE INDEX IF NOT EXISTS idx_locations_branch ON inventory_locations (branch_id);

CREATE INDEX IF NOT EXISTS idx_exceptions_branch_status ON inventory_exception_records (branch_id, approval_status);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_business_assignments ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_branch_assignments ENABLE ROW LEVEL SECURITY;

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;

ALTER TABLE report_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;

ALTER TABLE inventory_exception_records ENABLE ROW LEVEL SECURITY;

-- Remove policies from earlier extension versions before recreating them.
DO $$
DECLARE
    policy_row record;
BEGIN
    FOR policy_row IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE policyname IN (
            'departments_scope', 'teams_scope', 'services_scope', 'customers_scope',
            'locations_scope', 'report_types_scope', 'workflows_scope', 'exceptions_scope',
            'team_members_scope', 'user_business_assignments_scope', 'user_branch_assignments_scope'
        )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    END LOOP;
END $$;

CREATE POLICY departments_scope ON departments FOR ALL TO authenticated USING (
    can_access_business (business_id)
)
WITH
    CHECK (
        can_access_business (business_id)
    );

CREATE POLICY teams_scope ON teams FOR ALL TO authenticated USING (
    can_access_business (business_id)
)
WITH
    CHECK (
        can_access_business (business_id)
    );

CREATE POLICY services_scope ON services FOR ALL TO authenticated USING (
    can_access_business (business_id)
)
WITH
    CHECK (
        can_access_business (business_id)
    );

CREATE POLICY customers_scope ON customers FOR ALL TO authenticated USING (
    can_access_business (business_id)
)
WITH
    CHECK (
        can_access_business (business_id)
    );

CREATE POLICY locations_scope ON inventory_locations FOR ALL TO authenticated USING (
    can_access_business (business_id)
)
WITH
    CHECK (
        can_access_business (business_id)
    );

CREATE POLICY report_types_scope ON report_types FOR ALL TO authenticated USING (
    business_id IS NULL
    OR can_access_business (business_id)
)
WITH
    CHECK (
        business_id IS NULL
        OR can_access_business (business_id)
    );

CREATE POLICY workflows_scope ON workflow_definitions FOR ALL TO authenticated USING (
    business_id IS NULL
    OR can_access_business (business_id)
)
WITH
    CHECK (
        business_id IS NULL
        OR can_access_business (business_id)
    );

CREATE POLICY exceptions_scope ON inventory_exception_records FOR ALL TO authenticated USING (can_access_branch (branch_id))
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY team_members_scope ON team_members FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM teams t
        WHERE
            t.id = team_id
            AND can_access_business (t.business_id)
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM teams t
            WHERE
                t.id = team_id
                AND can_access_business (t.business_id)
        )
    );

CREATE POLICY user_business_assignments_scope ON user_business_assignments FOR ALL TO authenticated USING (
    can_access_business (business_id)
)
WITH
    CHECK (
        can_access_business (business_id)
    );

CREATE POLICY user_branch_assignments_scope ON user_branch_assignments FOR ALL TO authenticated USING (can_access_branch (branch_id))
WITH
    CHECK (can_access_branch (branch_id));

-- This migration may follow an earlier organization-extension migration.
-- Remove only policies owned here so applying the migration remains idempotent.
DO $$
DECLARE
    policy_row record;
BEGIN
    FOR policy_row IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE policyname IN (
            'categories_scoped_select', 'suppliers_scoped_select', 'products_scoped_select',
            'weekly_reports_scoped_select', 'daily_activities_scoped_select', 'issues_scoped_select',
            'purchase_requests_scoped_select', 'goods_received_notes_scoped_select',
            'stock_transfers_scoped_select', 'inventory_balances_scoped_select',
            'inventory_txns_scoped_select', 'inventory_periods_scoped_select',
            'inventory_period_lines_scoped_select', 'stock_variances_scoped_select',
            'daily_sales_scoped_select', 'operational_expenses_scoped_select',
            'departments_scope', 'teams_scope', 'services_scope', 'customers_scope',
            'locations_scope', 'report_types_scope', 'workflows_scope', 'exceptions_scope',
            'team_members_scope', 'user_business_assignments_scope', 'user_branch_assignments_scope',
            'inventory_periods_write', 'inventory_periods_update', 'inventory_lines_write',
            'inventory_lines_update', 'variance_write', 'variance_update', 'sales_write',
            'sales_update', 'expenses_write', 'expenses_update'
        )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    END LOOP;
END $$;

CREATE POLICY inventory_periods_write ON inventory_periods FOR INSERT TO authenticated
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY inventory_periods_update ON inventory_periods FOR
UPDATE TO authenticated USING (can_access_branch (branch_id))
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY inventory_lines_write ON inventory_period_lines FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM inventory_periods p
            WHERE
                p.id = period_id
                AND can_access_branch (p.branch_id)
        )
    );

CREATE POLICY inventory_lines_update ON inventory_period_lines FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM inventory_periods p
        WHERE
            p.id = period_id
            AND can_access_branch (p.branch_id)
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM inventory_periods p
            WHERE
                p.id = period_id
                AND can_access_branch (p.branch_id)
        )
    );

CREATE POLICY variance_write ON stock_variances FOR INSERT TO authenticated
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY variance_update ON stock_variances FOR
UPDATE TO authenticated USING (can_access_branch (branch_id))
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY sales_write ON daily_sales FOR INSERT TO authenticated
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY sales_update ON daily_sales FOR
UPDATE TO authenticated USING (can_access_branch (branch_id))
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY expenses_write ON operational_expenses FOR INSERT TO authenticated
WITH
    CHECK (can_access_branch (branch_id));

CREATE POLICY expenses_update ON operational_expenses FOR
UPDATE TO authenticated USING (can_access_branch (branch_id))
WITH
    CHECK (can_access_branch (branch_id));

CREATE OR REPLACE FUNCTION prevent_inventory_period_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('submitted', 'approved') AND NEW.status <> 'amended' THEN
    RAISE EXCEPTION 'Submitted or approved inventory periods require amendment workflow';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_inventory_period ON inventory_periods;

CREATE TRIGGER trg_lock_inventory_period BEFORE UPDATE ON inventory_periods FOR EACH ROW EXECUTE FUNCTION prevent_inventory_period_edit();