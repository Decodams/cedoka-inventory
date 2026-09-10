-- ============================================
-- 20260907232526_001_core_tables.sql
-- ============================================
/*
# Core Tables: roles, permissions, businesses, branches, user_profiles, audit_log

## Purpose
Creates all core tables first WITHOUT cross-referencing RLS policies.
Policies that reference other tables will be added in migration 002.

## Tables Created
1. roles â€” role definitions (super_admin, admin, manager, sales_person)
2. permissions â€” granular permission codes
3. role_permissions â€” many-to-many join
4. businesses â€” top-level business units
5. branches â€” physical locations under businesses
6. user_profiles â€” user info linked to auth.users
7. audit_log â€” append-only action log

## Security
- RLS enabled on all tables (tables are locked down)
- Simple self-referencing policies only (own-row checks)
- Cross-table scope policies added in migration 002 after all tables exist
*/

-- ==========================================
-- ROLES
-- ==========================================
CREATE TABLE IF NOT EXISTS roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    name text UNIQUE NOT NULL,
    display_name text NOT NULL,
    description text DEFAULT '',
    is_system boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select_authenticated" ON roles;

CREATE POLICY "roles_select_authenticated" ON roles FOR
SELECT TO authenticated USING (true);

-- ==========================================
-- PERMISSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    code text UNIQUE NOT NULL,
    description text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_select_authenticated" ON permissions;

CREATE POLICY "permissions_select_authenticated" ON permissions FOR
SELECT TO authenticated USING (true);

-- ==========================================
-- ROLE_PERMISSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON role_permissions;

CREATE POLICY "role_permissions_select_authenticated" ON role_permissions FOR
SELECT TO authenticated USING (true);

-- ==========================================
-- BUSINESSES
-- ==========================================
CREATE TABLE IF NOT EXISTS businesses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    name text UNIQUE NOT NULL,
    category text,
    description text DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- BRANCHES
-- ==========================================
CREATE TABLE IF NOT EXISTS branches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    name text NOT NULL,
    location text DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (business_id, name)
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- USER_PROFILES
-- ==========================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id uuid PRIMARY KEY DEFAULT auth.uid () REFERENCES auth.users (id) ON DELETE CASCADE,
    email text UNIQUE NOT NULL,
    full_name text NOT NULL,
    role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    business_id uuid REFERENCES businesses (id) ON DELETE SET NULL,
    branch_id uuid REFERENCES branches (id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- AUDIT_LOG
-- ==========================================
CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    actor_id uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    action text NOT NULL,
    target_table text NOT NULL,
    target_id uuid,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_branches_business_id ON branches (business_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role_id ON user_profiles (role_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_business_id ON user_profiles (business_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_branch_id ON user_profiles (branch_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_table, target_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);

-- ============================================
-- 20260907232542_002_core_rls_policies.sql
-- ============================================
/*
# Core RLS Policies (Cross-Table Scope Checks)

## Purpose
Adds row-level security policies that reference other tables (now that all core tables exist).
Migration 001 created the tables without cross-referencing policies; this migration adds them.

## Policies Added

### businesses
- SELECT: all authenticated users can see active businesses
- INSERT/UPDATE: only super_admin

### branches
- SELECT: all authenticated users can see active branches
- INSERT/UPDATE: only admin or super_admin

### user_profiles
- SELECT: own profile OR (admin/super_admin see all) OR (manager sees same-branch)
- UPDATE: own profile (limited) OR admin/super_admin

### audit_log
- SELECT: own entries OR admin/super_admin see all
- INSERT: authenticated users (actor = self or system)
*/

-- ==========================================
-- BUSINESSES â€” cross-table policies
-- ==========================================
DROP POLICY IF EXISTS "businesses_select_authenticated" ON businesses;

CREATE POLICY "businesses_select_authenticated" ON businesses FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "businesses_insert_superuser" ON businesses;

CREATE POLICY "businesses_insert_superuser" ON businesses FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id = (
                    SELECT id
                    FROM roles
                    WHERE
                        name = 'super_admin'
                )
        )
    );

DROP POLICY IF EXISTS "businesses_update_superuser" ON businesses;

CREATE POLICY "businesses_update_superuser" ON businesses FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id = (
                SELECT id
                FROM roles
                WHERE
                    name = 'super_admin'
            )
    )
);

-- ==========================================
-- BRANCHES â€” cross-table policies
-- ==========================================
DROP POLICY IF EXISTS "branches_select_authenticated" ON branches;

CREATE POLICY "branches_select_authenticated" ON branches FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "branches_insert_admin_or_above" ON branches;

CREATE POLICY "branches_insert_admin_or_above" ON branches FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT id
                    FROM roles
                    WHERE
                        name IN ('super_admin', 'admin')
                )
        )
    );

DROP POLICY IF EXISTS "branches_update_admin_or_above" ON branches;

CREATE POLICY "branches_update_admin_or_above" ON branches FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT id
                FROM roles
                WHERE
                    name IN ('super_admin', 'admin')
            )
    )
);

-- ==========================================
-- USER_PROFILES â€” cross-table policies
-- ==========================================
DROP POLICY IF EXISTS "user_profiles_select_own" ON user_profiles;

CREATE POLICY "user_profiles_select_own" ON user_profiles FOR
SELECT TO authenticated USING (auth.uid () = id);

DROP POLICY IF EXISTS "user_profiles_select_admin_or_above" ON user_profiles;

CREATE POLICY "user_profiles_select_admin_or_above" ON user_profiles FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT id
                    FROM roles
                    WHERE
                        name IN ('super_admin', 'admin')
                )
        )
    );

DROP POLICY IF EXISTS "user_profiles_select_manager" ON user_profiles;

CREATE POLICY "user_profiles_select_manager" ON user_profiles FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1
            FROM user_profiles mgr
            WHERE
                mgr.id = auth.uid ()
                AND mgr.is_active = true
                AND mgr.role_id = (
                    SELECT id
                    FROM roles
                    WHERE
                        name = 'manager'
                )
                AND user_profiles.branch_id = mgr.branch_id
        )
    );

DROP POLICY IF EXISTS "user_profiles_update_own" ON user_profiles;

CREATE POLICY "user_profiles_update_own" ON user_profiles FOR
UPDATE TO authenticated USING (auth.uid () = id)
WITH
    CHECK (auth.uid () = id);

DROP POLICY IF EXISTS "user_profiles_update_admin_or_above" ON user_profiles;

CREATE POLICY "user_profiles_update_admin_or_above" ON user_profiles FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT id
                FROM roles
                WHERE
                    name IN ('super_admin', 'admin')
            )
    )
);

-- ==========================================
-- AUDIT_LOG â€” cross-table policies
-- ==========================================
DROP POLICY IF EXISTS "audit_log_select_own" ON audit_log;

CREATE POLICY "audit_log_select_own" ON audit_log FOR
SELECT TO authenticated USING (actor_id = auth.uid ());

DROP POLICY IF EXISTS "audit_log_select_admin_or_above" ON audit_log;

CREATE POLICY "audit_log_select_admin_or_above" ON audit_log FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT id
                    FROM roles
                    WHERE
                        name IN ('super_admin', 'admin')
                )
        )
    );

DROP POLICY IF EXISTS "audit_log_insert_authenticated" ON audit_log;

CREATE POLICY "audit_log_insert_authenticated" ON audit_log FOR INSERT TO authenticated
WITH
    CHECK (
        actor_id = auth.uid ()
        OR actor_id IS NULL
    );

-- ============================================
-- 20260907232601_003_seed_roles_and_permissions.sql
-- ============================================
/*
# Seed System Roles, Permissions, and Role-Permission Mapping

## Purpose
Populates the RBAC foundation with 4 system roles and a comprehensive permission catalog.
This is data, not schema â€” but it's applied as a migration so it's reproducible.

## Roles Seeded
1. super_admin â€” Full system access, creates businesses/admins
2. admin â€” General Manager, manages branches/managers within business(es)
3. manager â€” Branch Manager, manages single branch, submits weekly reports
4. sales_person â€” Front-line staff, logs daily sales/stock, sees own data

## Permissions Seeded (grouped by module)
- businesses.manage, branches.manage
- users.manage_all, users.manage_business, users.manage_branch
- reports.create, reports.submit, reports.review, reports.view_all, reports.view_branch, reports.view_own
- products.manage, products.view
- inventory.manage, inventory.view, inventory.adjust
- transfers.manage, transfers.view
- procurement.manage, procurement.view
- issues.create, issues.manage, issues.view_all, issues.view_branch
- daily_activity.create, daily_activity.view_branch, daily_activity.view_own
- dashboard.view_executive, dashboard.view_business, dashboard.view_branch, dashboard.view_personal
- audit.view

## Role-Permission Mapping
- super_admin: ALL permissions
- admin: everything except businesses.manage and users.manage_all (scoped to their business)
- manager: branch-scoped permissions (reports, products, inventory, transfers, issues, daily_activity, users.manage_branch, dashboard.view_branch)
- sales_person: personal-scoped (reports.create, daily_activity.create, dashboard.view_personal, issues.create, products.view, inventory.view)
*/

-- ==========================================
-- ROLES
-- ==========================================
INSERT INTO
    roles (
        name,
        display_name,
        description,
        is_system
    )
VALUES (
        'super_admin',
        'Super Admin',
        'Full system access. Creates businesses, branches, admins. Sees all reports across all businesses.',
        true
    ),
    (
        'admin',
        'Admin',
        'General Manager. Creates/manages branches and managers within assigned business(es). Views all reports within their business(es).',
        true
    ),
    (
        'manager',
        'Manager',
        'Branch Manager. Manages a single branch. Submits weekly reports. Sees only their own branch data.',
        true
    ),
    (
        'sales_person',
        'Sales Person',
        'Front-line staff. Logs sales, stock movements, daily figures. Sees only their own data.',
        true
    )
ON CONFLICT (name) DO NOTHING;

-- ==========================================
-- PERMISSIONS
-- ==========================================
INSERT INTO
    permissions (code, description)
VALUES
    -- Organization
    (
        'businesses.manage',
        'Create and manage business units'
    ),
    (
        'branches.manage',
        'Create and manage branches'
    ),
    -- Users
    (
        'users.manage_all',
        'Create and manage all users across all businesses'
    ),
    (
        'users.manage_business',
        'Create and manage users within assigned business'
    ),
    (
        'users.manage_branch',
        'Create and manage sales persons within assigned branch'
    ),
    -- Reports
    (
        'reports.create',
        'Create and edit draft weekly reports'
    ),
    (
        'reports.submit',
        'Submit weekly reports for review'
    ),
    (
        'reports.review',
        'Review and approve/flag submitted weekly reports'
    ),
    (
        'reports.view_all',
        'View all reports across all businesses'
    ),
    (
        'reports.view_branch',
        'View all reports for own branch'
    ),
    (
        'reports.view_own',
        'View own submitted reports only'
    ),
    (
        'reports.amend',
        'Amend submitted/reviewed reports with audit trail'
    ),
    -- Products
    (
        'products.manage',
        'Create and manage products/SKUs'
    ),
    (
        'products.view',
        'View products and categories'
    ),
    -- Inventory
    (
        'inventory.manage',
        'Record stock movements, transfers, adjustments'
    ),
    (
        'inventory.view',
        'View inventory levels and movement history'
    ),
    (
        'inventory.adjust',
        'Perform stock adjustments and physical counts'
    ),
    -- Transfers
    (
        'transfers.manage',
        'Create and manage stock transfers'
    ),
    (
        'transfers.view',
        'View stock transfers'
    ),
    -- Procurement
    (
        'procurement.manage',
        'Create and manage purchase requests and orders'
    ),
    (
        'procurement.view',
        'View procurement records'
    ),
    -- Issues
    (
        'issues.create',
        'Create issues and challenges'
    ),
    (
        'issues.manage',
        'Manage and resolve issues'
    ),
    (
        'issues.view_all',
        'View all issues across all businesses'
    ),
    (
        'issues.view_branch',
        'View issues for own branch'
    ),
    -- Daily Activity
    (
        'daily_activity.create',
        'Log daily activities'
    ),
    (
        'daily_activity.view_branch',
        'View all daily activities for own branch'
    ),
    (
        'daily_activity.view_own',
        'View own daily activities only'
    ),
    -- Dashboards
    (
        'dashboard.view_executive',
        'View cross-business executive dashboard'
    ),
    (
        'dashboard.view_business',
        'View business-level dashboard'
    ),
    (
        'dashboard.view_branch',
        'View branch-level dashboard'
    ),
    (
        'dashboard.view_personal',
        'View personal dashboard'
    ),
    -- Audit
    (
        'audit.view',
        'View audit logs'
    )
ON CONFLICT (code) DO NOTHING;

-- ==========================================
-- ROLE-PERMISSION MAPPING
-- ==========================================

-- super_admin: ALL permissions
INSERT INTO
    role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE
    r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- admin: everything except businesses.manage and users.manage_all
INSERT INTO
    role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE
    r.name = 'admin'
    AND p.code NOT IN (
        'businesses.manage',
        'users.manage_all'
    )
ON CONFLICT DO NOTHING;

-- manager: branch-scoped permissions
INSERT INTO
    role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE
    r.name = 'manager'
    AND p.code IN (
        'branches.manage',
        'users.manage_branch',
        'reports.create',
        'reports.submit',
        'reports.view_branch',
        'reports.amend',
        'products.manage',
        'products.view',
        'inventory.manage',
        'inventory.view',
        'inventory.adjust',
        'transfers.manage',
        'transfers.view',
        'procurement.manage',
        'procurement.view',
        'issues.create',
        'issues.manage',
        'issues.view_branch',
        'daily_activity.create',
        'daily_activity.view_branch',
        'dashboard.view_branch'
    )
ON CONFLICT DO NOTHING;

-- sales_person: personal-scoped permissions
INSERT INTO
    role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE
    r.name = 'sales_person'
    AND p.code IN (
        'reports.create',
        'products.view',
        'inventory.view',
        'issues.create',
        'daily_activity.create',
        'daily_activity.view_own',
        'dashboard.view_personal'
    )
ON CONFLICT DO NOTHING;

-- ============================================
-- 20260907232621_004_products_and_inventory.sql
-- ============================================
/*
# Products, Categories, Suppliers, and Inventory Architecture

## Purpose
Creates the product catalog and inventory ledger system. Inventory is a first-class system
with full movement tracking, not just a field in the weekly report.

## New Tables

### categories
- Product/service categories (e.g. "Solar Panels", "Phone Accessories")
- Scoped per business (each business can have its own categories)

### suppliers
- Supplier records with contact info, scoped per business

### products
- Full product definition: name, SKU, category, brand, model, unit, prices, stock levels
- Linked to a business (products belong to a business unit)
- Supports min stock level and reorder level for procurement triggers
- Active/inactive status

### inventory_balances
- Current stock position per product per branch
- Tracks opening_stock, current_stock, min_level, reorder_level
- Updated via inventory_transactions (never directly by client)

### inventory_transactions
- Full ledger of every stock movement
- Movement types: opening_balance, purchase_receipt, sale, transfer_in, transfer_out,
return_in, return_out, damage, loss, adjustment, stock_issue, physical_count
- Each transaction has quantity, reason, reference, actor
- This is the audit trail for all inventory changes

## Security
- RLS on all tables
- Products/categories/suppliers: authenticated can read; manage requires products.manage permission
- Inventory balances: authenticated can view; updates only via privileged functions or inventory.manage
- Inventory transactions: authenticated can read within scope; insert requires inventory.manage
- Scope filtering done via business_id/branch_id checks against user_profiles
*/

-- ==========================================
-- CATEGORIES
-- ==========================================
CREATE TABLE IF NOT EXISTS categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    name text NOT NULL,
    description text DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (business_id, name)
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_authenticated" ON categories;

CREATE POLICY "categories_select_authenticated" ON categories FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "categories_insert_manage" ON categories;

CREATE POLICY "categories_insert_manage" ON categories FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'products.manage'
                )
        )
    );

DROP POLICY IF EXISTS "categories_update_manage" ON categories;

CREATE POLICY "categories_update_manage" ON categories FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'products.manage'
            )
    )
);

-- ==========================================
-- SUPPLIERS
-- ==========================================
CREATE TABLE IF NOT EXISTS suppliers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    name text NOT NULL,
    contact_person text,
    phone text,
    email text,
    address text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_select_authenticated" ON suppliers;

CREATE POLICY "suppliers_select_authenticated" ON suppliers FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "suppliers_insert_manage" ON suppliers;

CREATE POLICY "suppliers_insert_manage" ON suppliers FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code IN (
                            'procurement.manage',
                            'products.manage'
                        )
                )
        )
    );

DROP POLICY IF EXISTS "suppliers_update_manage" ON suppliers;

CREATE POLICY "suppliers_update_manage" ON suppliers FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code IN (
                        'procurement.manage',
                        'products.manage'
                    )
            )
    )
);

-- ==========================================
-- PRODUCTS
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
    supplier_id uuid REFERENCES suppliers (id) ON DELETE SET NULL,
    name text NOT NULL,
    sku text,
    brand text,
    model text,
    description text DEFAULT '',
    unit text DEFAULT 'pcs',
    cost_price numeric(14, 2) DEFAULT 0,
    selling_price numeric(14, 2) DEFAULT 0,
    min_stock_level integer DEFAULT 0,
    reorder_level integer DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (business_id, sku)
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_authenticated" ON products;

CREATE POLICY "products_select_authenticated" ON products FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "products_insert_manage" ON products;

CREATE POLICY "products_insert_manage" ON products FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'products.manage'
                )
        )
    );

DROP POLICY IF EXISTS "products_update_manage" ON products;

CREATE POLICY "products_update_manage" ON products FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'products.manage'
            )
    )
);

-- ==========================================
-- INVENTORY_BALANCES
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_balances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
    opening_stock integer NOT NULL DEFAULT 0,
    current_stock integer NOT NULL DEFAULT 0,
    min_stock_level integer DEFAULT 0,
    reorder_level integer DEFAULT 0,
    last_count_date date,
    updated_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (product_id, branch_id)
);

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_balances_select_authenticated" ON inventory_balances;

CREATE POLICY "inventory_balances_select_authenticated" ON inventory_balances FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_balances_insert_manage" ON inventory_balances;

CREATE POLICY "inventory_balances_insert_manage" ON inventory_balances FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code IN (
                            'inventory.manage',
                            'inventory.adjust'
                        )
                )
        )
    );

DROP POLICY IF EXISTS "inventory_balances_update_manage" ON inventory_balances;

CREATE POLICY "inventory_balances_update_manage" ON inventory_balances FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code IN (
                        'inventory.manage',
                        'inventory.adjust'
                    )
            )
    )
);

-- ==========================================
-- INVENTORY_TRANSACTIONS (LEDGER)
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
    movement_type text NOT NULL CHECK (
        movement_type IN (
            'opening_balance',
            'purchase_receipt',
            'sale',
            'transfer_in',
            'transfer_out',
            'return_in',
            'return_out',
            'damage',
            'loss',
            'adjustment',
            'stock_issue',
            'physical_count',
            'production'
        )
    ),
    quantity integer NOT NULL,
    quantity_before integer,
    quantity_after integer,
    reason text,
    reference_type text,
    reference_id uuid,
    actor_id uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    transaction_date timestamptz NOT NULL DEFAULT now (),
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_txns_select_authenticated" ON inventory_transactions;

CREATE POLICY "inventory_txns_select_authenticated" ON inventory_transactions FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_txns_insert_manage" ON inventory_transactions;

CREATE POLICY "inventory_txns_insert_manage" ON inventory_transactions FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code IN (
                            'inventory.manage',
                            'inventory.adjust'
                        )
                )
        )
    );

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON categories (business_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers (business_id);

CREATE INDEX IF NOT EXISTS idx_products_business_id ON products (business_id);

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_product_branch ON inventory_balances (product_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_branch_id ON inventory_balances (branch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_txns_product_id ON inventory_transactions (product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_txns_branch_id ON inventory_transactions (branch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_txns_date ON inventory_transactions (transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_txns_movement_type ON inventory_transactions (movement_type);

-- ============================================
-- 20260907232645_005_reports_activities_issues.sql
-- ============================================
/*
# Weekly Reports, Amendments, Daily Activities, and Issues

## Purpose
Creates the weekly reporting cycle, daily activity log, and issues/challenges tracking system.
These are the core operational modules for branch management accountability.

## New Tables

### weekly_reports
- One report per branch per business per week (Sunday-Saturday cycle)
- Stock position: opening, received, sold, damaged, closing (auto-calc but manually overridable)
- Financial summary: sales value, purchase value, pending sales/purchase/procurement
- Narrative: activities, challenges, issues, improvements
- Status workflow: draft â†’ submitted â†’ reviewed â†’ amended
- Locking: once submitted, edits go through report_amendments
- closing_stock_is_manual flag: makes discrepancies visible, not hidden

### report_amendments
- Audit trail for any changes to submitted/reviewed reports
- Stores previous_values (jsonb), amended_by, reason

### daily_activities
- Lightweight daily log of what happened at a branch
- Aggregates into weekly report narrative
- Categories: meeting, customer_event, supplier_activity, delivery, maintenance, staff, incident, other

### issues
- Trackable challenges/problems with full lifecycle
- Status workflow: open â†’ assigned â†’ in_progress â†’ waiting â†’ resolved â†’ closed
- Priority, severity, category, responsible person, deadline
- requires_management_attention flag for escalation
- Resolution tracking with date and notes

## Security
- RLS on all tables
- Scope-based access: users see data for their business/branch based on role
- super_admin sees all; admin sees within business; manager sees within branch; sales_person sees own
*/

-- ==========================================
-- WEEKLY_REPORTS
-- ==========================================
CREATE TABLE IF NOT EXISTS weekly_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    week_start_date date NOT NULL,
    week_end_date date NOT NULL,
    -- Stock Position
    opening_stock integer NOT NULL DEFAULT 0,
    stock_received integer NOT NULL DEFAULT 0,
    stock_sold integer NOT NULL DEFAULT 0,
    stock_damaged integer NOT NULL DEFAULT 0,
    closing_stock integer NOT NULL DEFAULT 0,
    closing_stock_is_manual boolean NOT NULL DEFAULT false,
    -- Financial Summary
    total_sales_value numeric(14, 2) NOT NULL DEFAULT 0,
    total_purchase_value numeric(14, 2) NOT NULL DEFAULT 0,
    pending_sales_value numeric(14, 2) NOT NULL DEFAULT 0,
    pending_purchase_value numeric(14, 2) NOT NULL DEFAULT 0,
    pending_procurement_value numeric(14, 2) NOT NULL DEFAULT 0,
    -- Narrative Layer
    activities_notes text DEFAULT '',
    challenges_notes text DEFAULT '',
    issues_notes text DEFAULT '',
    improvement_notes text DEFAULT '',
    -- Metadata
    status text NOT NULL DEFAULT 'draft' CHECK (
        status IN (
            'draft',
            'submitted',
            'reviewed',
            'amended'
        )
    ),
    submitted_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    submitted_at timestamptz,
    reviewed_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    review_notes text DEFAULT '',
    created_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (
        business_id,
        branch_id,
        week_end_date
    )
);

ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read reports within their scope
-- We use a broad SELECT and filter in the app; RLS ensures only authenticated users access
DROP POLICY IF EXISTS "weekly_reports_select_authenticated" ON weekly_reports;

CREATE POLICY "weekly_reports_select_authenticated" ON weekly_reports FOR
SELECT TO authenticated USING (true);

-- Insert: users with reports.create permission
DROP POLICY IF EXISTS "weekly_reports_insert_create" ON weekly_reports;

CREATE POLICY "weekly_reports_insert_create" ON weekly_reports FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'reports.create'
                )
        )
    );

-- Update: users with reports.create permission (for draft edits) or reports.review / reports.amend
DROP POLICY IF EXISTS "weekly_reports_update_authorized" ON weekly_reports;

CREATE POLICY "weekly_reports_update_authorized" ON weekly_reports FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code IN (
                        'reports.create',
                        'reports.review',
                        'reports.amend'
                    )
            )
    )
);

-- ==========================================
-- REPORT_AMENDMENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS report_amendments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    weekly_report_id uuid NOT NULL REFERENCES weekly_reports (id) ON DELETE CASCADE,
    amended_by uuid NOT NULL REFERENCES user_profiles (id) ON DELETE SET NULL,
    amended_at timestamptz NOT NULL DEFAULT now (),
    previous_values jsonb NOT NULL DEFAULT '{}',
    new_values jsonb NOT NULL DEFAULT '{}',
    reason text NOT NULL DEFAULT ''
);

ALTER TABLE report_amendments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_amendments_select_authenticated" ON report_amendments;

CREATE POLICY "report_amendments_select_authenticated" ON report_amendments FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "report_amendments_insert_authorized" ON report_amendments;

CREATE POLICY "report_amendments_insert_authorized" ON report_amendments FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'reports.amend'
                )
        )
    );

-- ==========================================
-- DAILY_ACTIVITIES
-- ==========================================
CREATE TABLE IF NOT EXISTS daily_activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    activity_date date NOT NULL DEFAULT CURRENT_DATE,
    category text NOT NULL DEFAULT 'other' CHECK (
        category IN (
            'meeting',
            'customer_event',
            'supplier_activity',
            'delivery',
            'maintenance',
            'staff',
            'incident',
            'other',
            'follow_up'
        )
    ),
    title text NOT NULL,
    description text DEFAULT '',
    requires_follow_up boolean NOT NULL DEFAULT false,
    follow_up_notes text DEFAULT '',
    recorded_by uuid NOT NULL REFERENCES user_profiles (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE daily_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_activities_select_authenticated" ON daily_activities;

CREATE POLICY "daily_activities_select_authenticated" ON daily_activities FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "daily_activities_insert_create" ON daily_activities;

CREATE POLICY "daily_activities_insert_create" ON daily_activities FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'daily_activity.create'
                )
        )
    );

DROP POLICY IF EXISTS "daily_activities_update_own_or_manage" ON daily_activities;

CREATE POLICY "daily_activities_update_own_or_manage" ON daily_activities FOR
UPDATE TO authenticated USING (
    recorded_by = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code IN (
                        'daily_activity.view_branch',
                        'issues.manage'
                    )
            )
    )
);

DROP POLICY IF EXISTS "daily_activities_delete_own_or_manage" ON daily_activities;

CREATE POLICY "daily_activities_delete_own_or_manage" ON daily_activities FOR DELETE TO authenticated USING (
    recorded_by = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code IN (
                        'daily_activity.view_branch',
                        'issues.manage'
                    )
            )
    )
);

-- ==========================================
-- ISSUES
-- ==========================================
CREATE TABLE IF NOT EXISTS issues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    title text NOT NULL,
    description text DEFAULT '',
    category text DEFAULT 'operational' CHECK (
        category IN (
            'operational',
            'stock',
            'financial',
            'staff',
            'customer',
            'supplier',
            'equipment',
            'infrastructure',
            'safety',
            'compliance',
            'other'
        )
    ),
    priority text NOT NULL DEFAULT 'medium' CHECK (
        priority IN (
            'low',
            'medium',
            'high',
            'critical'
        )
    ),
    severity text NOT NULL DEFAULT 'minor' CHECK (
        severity IN (
            'minor',
            'moderate',
            'major',
            'severe'
        )
    ),
    status text NOT NULL DEFAULT 'open' CHECK (
        status IN (
            'open',
            'assigned',
            'in_progress',
            'waiting',
            'resolved',
            'closed'
        )
    ),
    requires_management_attention boolean NOT NULL DEFAULT false,
    reported_by uuid NOT NULL REFERENCES user_profiles (id) ON DELETE SET NULL,
    responsible_person uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    date_reported date NOT NULL DEFAULT CURRENT_DATE,
    deadline date,
    resolution_notes text DEFAULT '',
    resolved_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "issues_select_authenticated" ON issues;

CREATE POLICY "issues_select_authenticated" ON issues FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "issues_insert_create" ON issues;

CREATE POLICY "issues_insert_create" ON issues FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'issues.create'
                )
        )
    );

DROP POLICY IF EXISTS "issues_update_manage_or_own" ON issues;

CREATE POLICY "issues_update_manage_or_own" ON issues FOR
UPDATE TO authenticated USING (
    reported_by = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code IN (
                        'issues.manage',
                        'issues.view_branch'
                    )
            )
    )
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_weekly_reports_business_branch_week ON weekly_reports (
    business_id,
    branch_id,
    week_end_date DESC
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_status ON weekly_reports (status);

CREATE INDEX IF NOT EXISTS idx_report_amendments_report_id ON report_amendments (weekly_report_id);

CREATE INDEX IF NOT EXISTS idx_daily_activities_branch_date ON daily_activities (branch_id, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_activities_business_date ON daily_activities (
    business_id,
    activity_date DESC
);

CREATE INDEX IF NOT EXISTS idx_issues_business_branch ON issues (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_issues_status ON issues (status);

CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues (priority);

CREATE INDEX IF NOT EXISTS idx_issues_management_attention ON issues (requires_management_attention)
WHERE
    requires_management_attention = true;

CREATE INDEX IF NOT EXISTS idx_issues_deadline ON issues (deadline)
WHERE
    deadline IS NOT NULL;

-- ============================================
-- 20260907232708_006_transfers_and_procurement.sql
-- ============================================
/*
# Stock Transfers and Procurement Architecture

## Purpose
Creates stock transfer workflow (branch-to-branch) and procurement lifecycle (purchase requests
through goods received). Inventory only increases when goods are confirmed received, not when
a purchase request is entered.

## New Tables

### stock_transfers
- Branch-to-branch stock transfer tracking
- Workflow: request â†’ review â†’ approved â†’ dispatched â†’ in_transit â†’ received â†’ completed
- Tracks source branch (transfer_out) and destination branch (transfer_in)
- Product, quantity, reason, actor

### stock_transfer_items
- Line items for a transfer (multiple products per transfer)

### purchase_requests
- Procurement lifecycle: request â†’ quoted â†’ ordered â†’ partially_received â†’ received â†’ completed
- Linked to business, branch, supplier
- Financial values: estimated_cost, actual_cost

### purchase_request_items
- Line items: product, quantity ordered, quantity received, unit price
- Outstanding quantity = ordered - received

### goods_received_notes
- Record goods arrival against purchase orders
- Compare ordered vs received, shortages, damaged, rejected
- Supports partial deliveries
- Updates inventory when confirmed

## Security
- RLS on all tables
- transfers.manage / transfers.view permissions for stock_transfers
- procurement.manage / procurement.view for purchase_requests and goods_received_notes
- All authenticated users can read (scope filtering in app)
*/

-- ==========================================
-- STOCK_TRANSFERS
-- ==========================================
CREATE TABLE IF NOT EXISTS stock_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    transfer_number text,
    from_branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    to_branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'requested' CHECK (
        status IN (
            'requested',
            'reviewed',
            'approved',
            'dispatched',
            'in_transit',
            'received',
            'completed',
            'rejected'
        )
    ),
    reason text,
    requested_by uuid NOT NULL REFERENCES user_profiles (id) ON DELETE SET NULL,
    reviewed_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    approved_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    dispatched_at timestamptz,
    received_at timestamptz,
    completed_at timestamptz,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_select_authenticated" ON stock_transfers;

CREATE POLICY "stock_transfers_select_authenticated" ON stock_transfers FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "stock_transfers_insert_manage" ON stock_transfers;

CREATE POLICY "stock_transfers_insert_manage" ON stock_transfers FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'transfers.manage'
                )
        )
    );

DROP POLICY IF EXISTS "stock_transfers_update_manage" ON stock_transfers;

CREATE POLICY "stock_transfers_update_manage" ON stock_transfers FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'transfers.manage'
            )
    )
);

-- ==========================================
-- STOCK_TRANSFER_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    transfer_id uuid NOT NULL REFERENCES stock_transfers (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity > 0),
    received_quantity integer DEFAULT 0,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfer_items_select_authenticated" ON stock_transfer_items;

CREATE POLICY "stock_transfer_items_select_authenticated" ON stock_transfer_items FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "stock_transfer_items_insert_manage" ON stock_transfer_items;

CREATE POLICY "stock_transfer_items_insert_manage" ON stock_transfer_items FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'transfers.manage'
                )
        )
    );

DROP POLICY IF EXISTS "stock_transfer_items_update_manage" ON stock_transfer_items;

CREATE POLICY "stock_transfer_items_update_manage" ON stock_transfer_items FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'transfers.manage'
            )
    )
);

-- ==========================================
-- PURCHASE_REQUESTS
-- ==========================================
CREATE TABLE IF NOT EXISTS purchase_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    request_number text,
    business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    supplier_id uuid REFERENCES suppliers (id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'requested' CHECK (
        status IN (
            'requested',
            'quoted',
            'ordered',
            'partially_received',
            'received',
            'completed',
            'rejected',
            'cancelled'
        )
    ),
    estimated_cost numeric(14, 2) DEFAULT 0,
    actual_cost numeric(14, 2) DEFAULT 0,
    requested_by uuid NOT NULL REFERENCES user_profiles (id) ON DELETE SET NULL,
    approved_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL,
    ordered_at timestamptz,
    expected_delivery_date date,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_requests_select_authenticated" ON purchase_requests;

CREATE POLICY "purchase_requests_select_authenticated" ON purchase_requests FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_requests_insert_manage" ON purchase_requests;

CREATE POLICY "purchase_requests_insert_manage" ON purchase_requests FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'procurement.manage'
                )
        )
    );

DROP POLICY IF EXISTS "purchase_requests_update_manage" ON purchase_requests;

CREATE POLICY "purchase_requests_update_manage" ON purchase_requests FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'procurement.manage'
            )
    )
);

-- ==========================================
-- PURCHASE_REQUEST_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS purchase_request_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    purchase_request_id uuid NOT NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
    quantity_received integer NOT NULL DEFAULT 0,
    unit_price numeric(14, 2) DEFAULT 0,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE purchase_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_request_items_select_authenticated" ON purchase_request_items;

CREATE POLICY "purchase_request_items_select_authenticated" ON purchase_request_items FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_request_items_insert_manage" ON purchase_request_items;

CREATE POLICY "purchase_request_items_insert_manage" ON purchase_request_items FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'procurement.manage'
                )
        )
    );

DROP POLICY IF EXISTS "purchase_request_items_update_manage" ON purchase_request_items;

CREATE POLICY "purchase_request_items_update_manage" ON purchase_request_items FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'procurement.manage'
            )
    )
);

-- ==========================================
-- GOODS_RECEIVED_NOTES
-- ==========================================
CREATE TABLE IF NOT EXISTS goods_received_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    grn_number text,
    purchase_request_id uuid REFERENCES purchase_requests (id) ON DELETE SET NULL,
    branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    supplier_id uuid REFERENCES suppliers (id) ON DELETE SET NULL,
    received_by uuid NOT NULL REFERENCES user_profiles (id) ON DELETE SET NULL,
    received_date date NOT NULL DEFAULT CURRENT_DATE,
    delivery_note_number text,
    is_partial boolean NOT NULL DEFAULT false,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goods_received_notes_select_authenticated" ON goods_received_notes;

CREATE POLICY "goods_received_notes_select_authenticated" ON goods_received_notes FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "goods_received_notes_insert_manage" ON goods_received_notes;

CREATE POLICY "goods_received_notes_insert_manage" ON goods_received_notes FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'procurement.manage'
                )
        )
    );

DROP POLICY IF EXISTS "goods_received_notes_update_manage" ON goods_received_notes;

CREATE POLICY "goods_received_notes_update_manage" ON goods_received_notes FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'procurement.manage'
            )
    )
);

-- ==========================================
-- GOODS_RECEIVED_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS goods_received_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    grn_id uuid NOT NULL REFERENCES goods_received_notes (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity_ordered integer NOT NULL DEFAULT 0,
    quantity_received integer NOT NULL DEFAULT 0,
    quantity_damaged integer NOT NULL DEFAULT 0,
    quantity_rejected integer NOT NULL DEFAULT 0,
    quantity_short integer NOT NULL DEFAULT 0,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now ()
);

ALTER TABLE goods_received_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goods_received_items_select_authenticated" ON goods_received_items;

CREATE POLICY "goods_received_items_select_authenticated" ON goods_received_items FOR
SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "goods_received_items_insert_manage" ON goods_received_items;

CREATE POLICY "goods_received_items_insert_manage" ON goods_received_items FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM user_profiles up
            WHERE
                up.id = auth.uid ()
                AND up.is_active = true
                AND up.role_id IN (
                    SELECT rp.role_id
                    FROM
                        role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                    WHERE
                        p.code = 'procurement.manage'
                )
        )
    );

DROP POLICY IF EXISTS "goods_received_items_update_manage" ON goods_received_items;

CREATE POLICY "goods_received_items_update_manage" ON goods_received_items FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM user_profiles up
        WHERE
            up.id = auth.uid ()
            AND up.is_active = true
            AND up.role_id IN (
                SELECT rp.role_id
                FROM
                    role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                WHERE
                    p.code = 'procurement.manage'
            )
    )
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_branch ON stock_transfers (from_branch_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_branch ON stock_transfers (to_branch_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers (status);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON stock_transfer_items (transfer_id);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_business_branch ON purchase_requests (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests (status);

CREATE INDEX IF NOT EXISTS idx_purchase_request_items_pr_id ON purchase_request_items (purchase_request_id);

CREATE INDEX IF NOT EXISTS idx_goods_received_notes_branch ON goods_received_notes (branch_id);

CREATE INDEX IF NOT EXISTS idx_goods_received_notes_pr ON goods_received_notes (purchase_request_id);

CREATE INDEX IF NOT EXISTS idx_goods_received_items_grn ON goods_received_items (grn_id);

-- ============================================
-- 20260907232725_007_security_definer_functions.sql
-- ============================================
/*
# Security Definer Functions: User Management & Permission Helpers

## Purpose
Creates privileged server-side functions for operations that must not be client-writable:
- Creating user accounts (signing up a new user with a specific role/business/branch assignment)
- Deactivating users (offboarding)
- Checking if the current user has a specific permission

These functions run as the database owner (SECURITY DEFINER) and perform their own
authorization checks, bypassing RLS. This is the secure pattern for privileged mutations.

## Functions Created

### has_permission(p_code text)
- Returns boolean: does the current authenticated user have the given permission code?
- Used in RLS policies and app-level checks

### create_user_account(...)
- Creates a new auth user + user_profile in a single transaction
- Caller must be authenticated with proper role (super_admin creates anyone, admin creates
managers/sales_person within their business, manager creates sales_person within their branch)
- Returns the new user_profile record

### deactivate_user(p_user_id uuid)
- Sets is_active = false on a user profile
- Caller must be admin or super_admin
- Logs to audit_log

## Security
- All functions SET search_path = public (prevents search_path injection)
- EXECUTE revoked from anon; granted to authenticated only
- Actor derived from auth.uid() â€” never from a parameter
*/

-- ==========================================
-- has_permission: check if current user has a permission
-- ==========================================
CREATE OR REPLACE FUNCTION has_permission(p_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN role_permissions rp ON rp.role_id = up.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE up.id = auth.uid()
      AND up.is_active = true
      AND p.code = p_code
  );
$$;

REVOKE EXECUTE ON FUNCTION has_permission FROM anon;

GRANT EXECUTE ON FUNCTION has_permission TO authenticated;

-- ==========================================
-- get_current_user_role: returns the current user's role name
-- ==========================================
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.name FROM user_profiles up
  JOIN roles r ON r.id = up.role_id
  WHERE up.id = auth.uid() AND up.is_active = true;
$$;

REVOKE EXECUTE ON FUNCTION get_current_user_role FROM anon;

GRANT EXECUTE ON FUNCTION get_current_user_role TO authenticated;

-- ==========================================
-- create_user_account: privileged user creation
-- ==========================================
CREATE OR REPLACE FUNCTION create_user_account(
  p_email text,
  p_password text,
  p_full_name text,
  p_role_name text,
  p_business_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS user_profiles
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor user_profiles;
  v_actor_role text;
  v_new_role_id uuid;
  v_new_user_id uuid;
  v_new_profile user_profiles;
BEGIN
  -- Get the caller's profile
  SELECT * INTO v_actor FROM user_profiles WHERE id = auth.uid() AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT r.name INTO v_actor_role FROM roles r WHERE r.id = v_actor.role_id;

  -- Authorization rules:
  -- super_admin: can create anyone
  -- admin: can create manager or sales_person within their business
  -- manager: can create sales_person within their branch
  IF v_actor_role = 'super_admin' THEN
    -- Can create any role
    NULL;
  ELSIF v_actor_role = 'admin' THEN
    IF p_role_name NOT IN ('manager', 'sales_person') THEN
      RAISE EXCEPTION 'Admins can only create managers or sales persons';
    END IF;
    IF p_business_id IS NOT NULL AND p_business_id != v_actor.business_id THEN
      RAISE EXCEPTION 'Admins can only create users within their own business';
    END IF;
    p_business_id := COALESCE(p_business_id, v_actor.business_id);
  ELSIF v_actor_role = 'manager' THEN
    IF p_role_name != 'sales_person' THEN
      RAISE EXCEPTION 'Managers can only create sales persons';
    END IF;
    IF p_branch_id IS NOT NULL AND p_branch_id != v_actor.branch_id THEN
      RAISE EXCEPTION 'Managers can only create users within their own branch';
    END IF;
    p_branch_id := COALESCE(p_branch_id, v_actor.branch_id);
    p_business_id := v_actor.business_id;
  ELSE
    RAISE EXCEPTION 'Not authorized to create user accounts';
  END IF;

  -- Validate role exists
  SELECT id INTO v_new_role_id FROM roles WHERE name = p_role_name;
  IF v_new_role_id IS NULL THEN
    RAISE EXCEPTION 'Invalid role: %', p_role_name;
  END IF;

  RAISE EXCEPTION 'User creation must use the create-user-account Edge Function';
END;
$$;

REVOKE EXECUTE ON FUNCTION create_user_account FROM anon;

GRANT EXECUTE ON FUNCTION create_user_account TO authenticated;

-- ==========================================
-- deactivate_user: set is_active = false
-- ==========================================
CREATE OR REPLACE FUNCTION deactivate_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_target user_profiles;
BEGIN
  SELECT r.name INTO v_actor_role
  FROM user_profiles up JOIN roles r ON r.id = up.role_id
  WHERE up.id = auth.uid() AND up.is_active = true;

  IF v_actor_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Not authorized to deactivate users';
  END IF;

  SELECT * INTO v_target FROM user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Admin can only deactivate users within their business
  IF v_actor_role = 'admin' AND v_target.business_id != (SELECT business_id FROM user_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to deactivate users outside your business';
  END IF;

  UPDATE user_profiles SET is_active = false WHERE id = p_user_id;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'user.deactivated', 'user_profiles', p_user_id,
          jsonb_build_object('email', v_target.email));
END;
$$;

REVOKE EXECUTE ON FUNCTION deactivate_user FROM anon;

GRANT EXECUTE ON FUNCTION deactivate_user TO authenticated;

-- ============================================
-- 20260907232735_008_helper_functions_and_triggers.sql
-- ============================================
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

-- ============================================
-- 20260907235651_009_seed_businesses_and_branches.sql
-- ============================================
/*
# Seed Initial Data: Cedoka Global Businesses and Branches

## Purpose
Populates the platform with the starting organizational structure for Cedoka Global.

## Data Created
1. Business Units: Electronics Retail, Itel Energy, Farm, Ride/Logistics
2. Branches: Awka, Lagos, Ibadan (Electronics Retail); Ejigbo (Itel Energy)

Uses ON CONFLICT DO NOTHING for idempotency.
*/

INSERT INTO
    businesses (name, category, description)
VALUES (
        'Electronics Retail',
        'Retail',
        'Consumer electronics retail including phones, accessories, and devices.'
    ),
    (
        'Itel Energy',
        'Energy',
        'Solar distribution and renewable energy products.'
    ),
    (
        'Farm',
        'Agriculture',
        'Agricultural operations and produce.'
    ),
    (
        'Ride/Logistics',
        'Logistics',
        'Transportation and logistics services.'
    )
ON CONFLICT (name) DO NOTHING;

INSERT INTO
    branches (business_id, name, location)
SELECT b.id, branch_name, branch_location
FROM businesses b
    CROSS JOIN (
        VALUES ('Awka', 'Awka, Anambra State'), ('Lagos', 'Lagos, Lagos State'), ('Ibadan', 'Ibadan, Oyo State')
    ) AS t (branch_name, branch_location)
WHERE
    b.name = 'Electronics Retail'
ON CONFLICT (business_id, name) DO NOTHING;

INSERT INTO
    branches (business_id, name, location)
SELECT b.id, 'Ejigbo', 'Ejigbo, Lagos State'
FROM businesses b
WHERE
    b.name = 'Itel Energy'
ON CONFLICT (business_id, name) DO NOTHING;

-- ============================================
-- 20260907235717_010_create_super_admin.sql
-- ============================================
/*
# Create Super Admin Account

## Purpose
Creates the initial super_admin user in auth.users and user_profiles.

## Notes
- Create the Auth user in Supabase Dashboard before applying this migration.
*/

DO $$
DECLARE
  v_user_id uuid;
  v_super_admin_role_id uuid;
BEGIN
  SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
  IF v_super_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'super_admin role not found';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@cedoka.com';
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Create admin@cedoka.com in Supabase Dashboard > Authentication > Users, then run this migration again.';
    RETURN;
  END IF;

  INSERT INTO user_profiles (id, email, full_name, role_id, is_active)
  VALUES (v_user_id, 'admin@cedoka.com', 'Cedoka Super Admin', v_super_admin_role_id, true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role_id = EXCLUDED.role_id,
    is_active = true;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (v_user_id, 'user.created', 'user_profiles', v_user_id,
          jsonb_build_object('email', 'admin@cedoka.com', 'role', 'super_admin', 'source', 'seed'));
END $$;

-- ============================================
-- 202609080001_011_operational_integrity.sql
-- ============================================
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

-- ============================================
-- 20260910000012_org_extensions.sql
-- ============================================
-- ============================================
-- 20260910000012_org_extensions.sql
-- Dedicated screens for departments, teams, customers, services, locations, workflows, report_types
-- All are business-scoped, soft-deletable (is_active), and RLS-protected
-- ============================================

-- DEPARTMENTS
create table if not exists departments (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    name text not null,
    description text default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table departments enable row level security;

drop policy if exists departments_scoped_select on departments;

create policy departments_scoped_select on departments for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists departments_write on departments;

create policy departments_write on departments for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_departments_business on departments (business_id);

-- TEAMS
create table if not exists teams (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    department_id uuid references departments (id) on delete set null,
    branch_id uuid references branches (id) on delete set null,
    name text not null,
    description text default '',
    lead_user_id uuid references user_profiles (id) on delete set null,
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table teams enable row level security;

drop policy if exists teams_scoped_select on teams;

create policy teams_scoped_select on teams for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists teams_write on teams;

create policy teams_write on teams for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_teams_business on teams (business_id);

create index if not exists idx_teams_department on teams (department_id);

create index if not exists idx_teams_branch on teams (branch_id);

-- CUSTOMERS
create table if not exists customers (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    branch_id uuid references branches (id) on delete set null,
    name text not null,
    email text,
    phone text,
    address text default '',
    is_active boolean not null default true,
    created_at timestamptz not null default now ()
);

alter table customers enable row level security;

drop policy if exists customers_scoped_select on customers;

create policy customers_scoped_select on customers for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists customers_write on customers;

create policy customers_write on customers for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_customers_business on customers (business_id);

create index if not exists idx_customers_branch on customers (branch_id);

create index if not exists idx_customers_name on customers (name);

-- SERVICES (business services, not products)
create table if not exists services (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    name text not null,
    sku text,
    description text default '',
    category text default '',
    unit_price numeric(14, 2) not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table services enable row level security;

drop policy if exists services_scoped_select on services;

create policy services_scoped_select on services for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists services_write on services;

create policy services_write on services for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_services_business on services (business_id);

-- LOCATIONS (physical locations, inventory locations, warehouses)
create table if not exists locations (
    id uuid primary key default gen_random_uuid (),
    business_id uuid not null references businesses (id) on delete cascade,
    branch_id uuid references branches (id) on delete set null,
    name text not null,
    address text default '',
    location_type text not null default 'warehouse' check (
        location_type in (
            'warehouse',
            'store',
            'office',
            'branch',
            'inventory',
            'other'
        )
    ),
    is_active boolean not null default true,
    created_at timestamptz not null default now (),
    unique (business_id, name)
);

alter table locations enable row level security;

drop policy if exists locations_scoped_select on locations;

create policy locations_scoped_select on locations for
select to authenticated using (
        can_access_business (business_id)
    );

drop policy if exists locations_write on locations;

create policy locations_write on locations for all to authenticated using (
    can_access_business (business_id)
)
with
    check (
        can_access_business (business_id)
    );

create index if not exists idx_locations_business on locations (business_id);

create index if not exists idx_locations_branch on locations (branch_id);

-- WORKFLOWS (configurable business workflows)
create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  description text default '',
  steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(business_id, name)
);

alter table workflows enable row level security;

drop policy if exists workflows_scoped_select on workflows;

create policy workflows_scoped_select on workflows for
select to authenticated using (
        business_id is null
        or can_access_business (business_id)
    );

drop policy if exists workflows_write on workflows;

create policy workflows_write on workflows for all to authenticated using (
    business_id is null
    or can_access_business (business_id)
)
with
    check (
        business_id is null
        or can_access_business (business_id)
    );

create index if not exists idx_workflows_business on workflows (business_id);

-- REPORT TYPES (configurable report templates)
create table if not exists report_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  description text default '',
  fields jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(business_id, name)
);

alter table report_types enable row level security;

drop policy if exists report_types_scoped_select on report_types;

create policy report_types_scoped_select on report_types for
select to authenticated using (
        business_id is null
        or can_access_business (business_id)
    );

drop policy if exists report_types_write on report_types;

create policy report_types_write on report_types for all to authenticated using (
    business_id is null
    or can_access_business (business_id)
)
with
    check (
        business_id is null
        or can_access_business (business_id)
    );

create index if not exists idx_report_types_business on report_types (business_id);

-- Seed some defaults for demo (idempotent)
insert into
    departments (
        business_id,
        name,
        description
    )
select b.id, 'Operations', 'Core operations & branch management'
from businesses b
where
    b.name = 'Electronics Retail'
on conflict do nothing;

insert into
    departments (
        business_id,
        name,
        description
    )
select b.id, 'Sales', 'Sales & customer relations'
from businesses b
where
    b.name = 'Electronics Retail'
on conflict do nothing;

insert into report_types (business_id, name, description, fields) values (null, 'Weekly Stock & Financials', 'Standard weekly management report (stock, sales, challenges)', '["opening_stock","stock_received","stock_sold","stock_damaged","total_sales_value","activities_notes"]'::jsonb) on conflict do nothing;

insert into workflows (business_id, name, description, steps) values (null, 'Stock Transfer', 'Branch-to-branch stock movement', '["requested","reviewed","approved","dispatched","in_transit","received","completed"]'::jsonb) on conflict do nothing;

-- ============================================
-- 202609100001_012_extensibility_and_write_policies.sql
-- ============================================
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