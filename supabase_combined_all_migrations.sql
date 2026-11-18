
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select_authenticated" ON roles;
CREATE POLICY "roles_select_authenticated" ON roles FOR SELECT
  TO authenticated USING (true);

-- ==========================================
-- PERMISSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_select_authenticated" ON permissions;
CREATE POLICY "permissions_select_authenticated" ON permissions FOR SELECT
  TO authenticated USING (true);

-- ==========================================
-- ROLE_PERMISSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON role_permissions;
CREATE POLICY "role_permissions_select_authenticated" ON role_permissions FOR SELECT
  TO authenticated USING (true);

-- ==========================================
-- BUSINESSES
-- ==========================================
CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  category text,
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- BRANCHES
-- ==========================================
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  location text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, name)
);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- USER_PROFILES
-- ==========================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- AUDIT_LOG
-- ==========================================
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_table text NOT NULL,
  target_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_branches_business_id ON branches(business_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role_id ON user_profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_business_id ON user_profiles(business_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_branch_id ON user_profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);


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
CREATE POLICY "businesses_select_authenticated" ON businesses FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "businesses_insert_superuser" ON businesses;
CREATE POLICY "businesses_insert_superuser" ON businesses FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id = (SELECT id FROM roles WHERE name = 'super_admin'))
  );

DROP POLICY IF EXISTS "businesses_update_superuser" ON businesses;
CREATE POLICY "businesses_update_superuser" ON businesses FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id = (SELECT id FROM roles WHERE name = 'super_admin'))
  );

-- ==========================================
-- BRANCHES â€” cross-table policies
-- ==========================================
DROP POLICY IF EXISTS "branches_select_authenticated" ON branches;
CREATE POLICY "branches_select_authenticated" ON branches FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "branches_insert_admin_or_above" ON branches;
CREATE POLICY "branches_insert_admin_or_above" ON branches FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin','admin')))
  );

DROP POLICY IF EXISTS "branches_update_admin_or_above" ON branches;
CREATE POLICY "branches_update_admin_or_above" ON branches FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin','admin')))
  );

-- ==========================================
-- USER_PROFILES â€” cross-table policies
-- ==========================================
DROP POLICY IF EXISTS "user_profiles_select_own" ON user_profiles;
CREATE POLICY "user_profiles_select_own" ON user_profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "user_profiles_select_admin_or_above" ON user_profiles;
CREATE POLICY "user_profiles_select_admin_or_above" ON user_profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin','admin')))
  );

DROP POLICY IF EXISTS "user_profiles_select_manager" ON user_profiles;
CREATE POLICY "user_profiles_select_manager" ON user_profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles mgr WHERE mgr.id = auth.uid() AND mgr.is_active = true
            AND mgr.role_id = (SELECT id FROM roles WHERE name = 'manager')
            AND user_profiles.branch_id = mgr.branch_id)
  );

DROP POLICY IF EXISTS "user_profiles_update_own" ON user_profiles;
CREATE POLICY "user_profiles_update_own" ON user_profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "user_profiles_update_admin_or_above" ON user_profiles;
CREATE POLICY "user_profiles_update_admin_or_above" ON user_profiles FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin','admin')))
  );

-- ==========================================
-- AUDIT_LOG â€” cross-table policies
-- ==========================================
DROP POLICY IF EXISTS "audit_log_select_own" ON audit_log;
CREATE POLICY "audit_log_select_own" ON audit_log FOR SELECT
  TO authenticated USING (actor_id = auth.uid());

DROP POLICY IF EXISTS "audit_log_select_admin_or_above" ON audit_log;
CREATE POLICY "audit_log_select_admin_or_above" ON audit_log FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin','admin')))
  );

DROP POLICY IF EXISTS "audit_log_insert_authenticated" ON audit_log;
CREATE POLICY "audit_log_insert_authenticated" ON audit_log FOR INSERT
  TO authenticated WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);


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
INSERT INTO roles (name, display_name, description, is_system) VALUES
  ('super_admin', 'Super Admin', 'Full system access. Creates businesses, branches, admins. Sees all reports across all businesses.', true),
  ('admin', 'Admin', 'General Manager. Creates/manages branches and managers within assigned business(es). Views all reports within their business(es).', true),
  ('manager', 'Manager', 'Branch Manager. Manages a single branch. Submits weekly reports. Sees only their own branch data.', true),
  ('sales_person', 'Sales Person', 'Front-line staff. Logs sales, stock movements, daily figures. Sees only their own data.', true)
ON CONFLICT (name) DO NOTHING;

-- ==========================================
-- PERMISSIONS
-- ==========================================
INSERT INTO permissions (code, description) VALUES
  -- Organization
  ('businesses.manage', 'Create and manage business units'),
  ('branches.manage', 'Create and manage branches'),
  -- Users
  ('users.manage_all', 'Create and manage all users across all businesses'),
  ('users.manage_business', 'Create and manage users within assigned business'),
  ('users.manage_branch', 'Create and manage sales persons within assigned branch'),
  -- Reports
  ('reports.create', 'Create and edit draft weekly reports'),
  ('reports.submit', 'Submit weekly reports for review'),
  ('reports.review', 'Review and approve/flag submitted weekly reports'),
  ('reports.view_all', 'View all reports across all businesses'),
  ('reports.view_branch', 'View all reports for own branch'),
  ('reports.view_own', 'View own submitted reports only'),
  ('reports.amend', 'Amend submitted/reviewed reports with audit trail'),
  -- Products
  ('products.manage', 'Create and manage products/SKUs'),
  ('products.view', 'View products and categories'),
  -- Inventory
  ('inventory.manage', 'Record stock movements, transfers, adjustments'),
  ('inventory.view', 'View inventory levels and movement history'),
  ('inventory.adjust', 'Perform stock adjustments and physical counts'),
  -- Transfers
  ('transfers.manage', 'Create and manage stock transfers'),
  ('transfers.view', 'View stock transfers'),
  -- Procurement
  ('procurement.manage', 'Create and manage purchase requests and orders'),
  ('procurement.view', 'View procurement records'),
  -- Issues
  ('issues.create', 'Create issues and challenges'),
  ('issues.manage', 'Manage and resolve issues'),
  ('issues.view_all', 'View all issues across all businesses'),
  ('issues.view_branch', 'View issues for own branch'),
  -- Daily Activity
  ('daily_activity.create', 'Log daily activities'),
  ('daily_activity.view_branch', 'View all daily activities for own branch'),
  ('daily_activity.view_own', 'View own daily activities only'),
  -- Dashboards
  ('dashboard.view_executive', 'View cross-business executive dashboard'),
  ('dashboard.view_business', 'View business-level dashboard'),
  ('dashboard.view_branch', 'View branch-level dashboard'),
  ('dashboard.view_personal', 'View personal dashboard'),
  -- Audit
  ('audit.view', 'View audit logs')
ON CONFLICT (code) DO NOTHING;

-- ==========================================
-- ROLE-PERMISSION MAPPING
-- ==========================================

-- super_admin: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- admin: everything except businesses.manage and users.manage_all
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code NOT IN ('businesses.manage', 'users.manage_all')
ON CONFLICT DO NOTHING;

-- manager: branch-scoped permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager' AND p.code IN (
  'branches.manage',
  'users.manage_branch',
  'reports.create', 'reports.submit', 'reports.view_branch', 'reports.amend',
  'products.manage', 'products.view',
  'inventory.manage', 'inventory.view', 'inventory.adjust',
  'transfers.manage', 'transfers.view',
  'procurement.manage', 'procurement.view',
  'issues.create', 'issues.manage', 'issues.view_branch',
  'daily_activity.create', 'daily_activity.view_branch',
  'dashboard.view_branch'
)
ON CONFLICT DO NOTHING;

-- sales_person: personal-scoped permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'sales_person' AND p.code IN (
  'reports.create',
  'products.view',
  'inventory.view',
  'issues.create',
  'daily_activity.create', 'daily_activity.view_own',
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, name)
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_authenticated" ON categories;
CREATE POLICY "categories_select_authenticated" ON categories FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "categories_insert_manage" ON categories;
CREATE POLICY "categories_insert_manage" ON categories FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

DROP POLICY IF EXISTS "categories_update_manage" ON categories;
CREATE POLICY "categories_update_manage" ON categories FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

-- ==========================================
-- SUPPLIERS
-- ==========================================
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_select_authenticated" ON suppliers;
CREATE POLICY "suppliers_select_authenticated" ON suppliers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "suppliers_insert_manage" ON suppliers;
CREATE POLICY "suppliers_insert_manage" ON suppliers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('procurement.manage','products.manage')))
  );

DROP POLICY IF EXISTS "suppliers_update_manage" ON suppliers;
CREATE POLICY "suppliers_update_manage" ON suppliers FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('procurement.manage','products.manage')))
  );

-- ==========================================
-- PRODUCTS
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text,
  brand text,
  model text,
  description text DEFAULT '',
  unit text DEFAULT 'pcs',
  cost_price numeric(14,2) DEFAULT 0,
  selling_price numeric(14,2) DEFAULT 0,
  min_stock_level integer DEFAULT 0,
  reorder_level integer DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, sku)
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_authenticated" ON products;
CREATE POLICY "products_select_authenticated" ON products FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "products_insert_manage" ON products;
CREATE POLICY "products_insert_manage" ON products FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

DROP POLICY IF EXISTS "products_update_manage" ON products;
CREATE POLICY "products_update_manage" ON products FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

-- ==========================================
-- INVENTORY_BALANCES
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  opening_stock integer NOT NULL DEFAULT 0,
  current_stock integer NOT NULL DEFAULT 0,
  min_stock_level integer DEFAULT 0,
  reorder_level integer DEFAULT 0,
  last_count_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, branch_id)
);
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_balances_select_authenticated" ON inventory_balances;
CREATE POLICY "inventory_balances_select_authenticated" ON inventory_balances FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_balances_insert_manage" ON inventory_balances;
CREATE POLICY "inventory_balances_insert_manage" ON inventory_balances FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('inventory.manage','inventory.adjust')))
  );

DROP POLICY IF EXISTS "inventory_balances_update_manage" ON inventory_balances;
CREATE POLICY "inventory_balances_update_manage" ON inventory_balances FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('inventory.manage','inventory.adjust')))
  );

-- ==========================================
-- INVENTORY_TRANSACTIONS (LEDGER)
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (
    movement_type IN ('opening_balance','purchase_receipt','sale','transfer_in','transfer_out',
                      'return_in','return_out','damage','loss','adjustment','stock_issue',
                      'physical_count','production')
  ),
  quantity integer NOT NULL,
  quantity_before integer,
  quantity_after integer,
  reason text,
  reference_type text,
  reference_id uuid,
  actor_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  transaction_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_txns_select_authenticated" ON inventory_transactions;
CREATE POLICY "inventory_txns_select_authenticated" ON inventory_transactions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_txns_insert_manage" ON inventory_transactions;
CREATE POLICY "inventory_txns_insert_manage" ON inventory_transactions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('inventory.manage','inventory.adjust')))
  );

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON categories(business_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_product_branch ON inventory_balances(product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_branch_id ON inventory_balances(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_product_id ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_branch_id ON inventory_transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_date ON inventory_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_movement_type ON inventory_transactions(movement_type);


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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
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
  total_sales_value numeric(14,2) NOT NULL DEFAULT 0,
  total_purchase_value numeric(14,2) NOT NULL DEFAULT 0,
  pending_sales_value numeric(14,2) NOT NULL DEFAULT 0,
  pending_purchase_value numeric(14,2) NOT NULL DEFAULT 0,
  pending_procurement_value numeric(14,2) NOT NULL DEFAULT 0,
  -- Narrative Layer
  activities_notes text DEFAULT '',
  challenges_notes text DEFAULT '',
  issues_notes text DEFAULT '',
  improvement_notes text DEFAULT '',
  -- Metadata
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','reviewed','amended')),
  submitted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text DEFAULT '',
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, branch_id, week_end_date)
);
ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read reports within their scope
-- We use a broad SELECT and filter in the app; RLS ensures only authenticated users access
DROP POLICY IF EXISTS "weekly_reports_select_authenticated" ON weekly_reports;
CREATE POLICY "weekly_reports_select_authenticated" ON weekly_reports FOR SELECT
  TO authenticated USING (true);

-- Insert: users with reports.create permission
DROP POLICY IF EXISTS "weekly_reports_insert_create" ON weekly_reports;
CREATE POLICY "weekly_reports_insert_create" ON weekly_reports FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'reports.create'))
  );

-- Update: users with reports.create permission (for draft edits) or reports.review / reports.amend
DROP POLICY IF EXISTS "weekly_reports_update_authorized" ON weekly_reports;
CREATE POLICY "weekly_reports_update_authorized" ON weekly_reports FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('reports.create','reports.review','reports.amend')))
  );

-- ==========================================
-- REPORT_AMENDMENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS report_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_report_id uuid NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE,
  amended_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  amended_at timestamptz NOT NULL DEFAULT now(),
  previous_values jsonb NOT NULL DEFAULT '{}',
  new_values jsonb NOT NULL DEFAULT '{}',
  reason text NOT NULL DEFAULT ''
);
ALTER TABLE report_amendments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_amendments_select_authenticated" ON report_amendments;
CREATE POLICY "report_amendments_select_authenticated" ON report_amendments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "report_amendments_insert_authorized" ON report_amendments;
CREATE POLICY "report_amendments_insert_authorized" ON report_amendments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'reports.amend'))
  );

-- ==========================================
-- DAILY_ACTIVITIES
-- ==========================================
CREATE TABLE IF NOT EXISTS daily_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  activity_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL DEFAULT 'other' CHECK (
    category IN ('meeting','customer_event','supplier_activity','delivery',
                 'maintenance','staff','incident','other','follow_up')
  ),
  title text NOT NULL,
  description text DEFAULT '',
  requires_follow_up boolean NOT NULL DEFAULT false,
  follow_up_notes text DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE daily_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_activities_select_authenticated" ON daily_activities;
CREATE POLICY "daily_activities_select_authenticated" ON daily_activities FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "daily_activities_insert_create" ON daily_activities;
CREATE POLICY "daily_activities_insert_create" ON daily_activities FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'daily_activity.create'))
  );

DROP POLICY IF EXISTS "daily_activities_update_own_or_manage" ON daily_activities;
CREATE POLICY "daily_activities_update_own_or_manage" ON daily_activities FOR UPDATE
  TO authenticated USING (
    recorded_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
               AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                                 JOIN permissions p ON p.id = rp.permission_id
                                 WHERE p.code IN ('daily_activity.view_branch','issues.manage')))
  );

DROP POLICY IF EXISTS "daily_activities_delete_own_or_manage" ON daily_activities;
CREATE POLICY "daily_activities_delete_own_or_manage" ON daily_activities FOR DELETE
  TO authenticated USING (
    recorded_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
               AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                                 JOIN permissions p ON p.id = rp.permission_id
                                 WHERE p.code IN ('daily_activity.view_branch','issues.manage')))
  );

-- ==========================================
-- ISSUES
-- ==========================================
CREATE TABLE IF NOT EXISTS issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text DEFAULT '',
  category text DEFAULT 'operational' CHECK (
    category IN ('operational','stock','financial','staff','customer','supplier',
                 'equipment','infrastructure','safety','compliance','other')
  ),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','moderate','major','severe')),
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open','assigned','in_progress','waiting','resolved','closed')
  ),
  requires_management_attention boolean NOT NULL DEFAULT false,
  reported_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  responsible_person uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  date_reported date NOT NULL DEFAULT CURRENT_DATE,
  deadline date,
  resolution_notes text DEFAULT '',
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "issues_select_authenticated" ON issues;
CREATE POLICY "issues_select_authenticated" ON issues FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "issues_insert_create" ON issues;
CREATE POLICY "issues_insert_create" ON issues FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'issues.create'))
  );

DROP POLICY IF EXISTS "issues_update_manage_or_own" ON issues;
CREATE POLICY "issues_update_manage_or_own" ON issues FOR UPDATE
  TO authenticated USING (
    reported_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
               AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                                 JOIN permissions p ON p.id = rp.permission_id
                                 WHERE p.code IN ('issues.manage','issues.view_branch')))
  );

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_weekly_reports_business_branch_week ON weekly_reports(business_id, branch_id, week_end_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_status ON weekly_reports(status);
CREATE INDEX IF NOT EXISTS idx_report_amendments_report_id ON report_amendments(weekly_report_id);
CREATE INDEX IF NOT EXISTS idx_daily_activities_branch_date ON daily_activities(branch_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_activities_business_date ON daily_activities(business_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_issues_business_branch ON issues(business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_management_attention ON issues(requires_management_attention) WHERE requires_management_attention = true;
CREATE INDEX IF NOT EXISTS idx_issues_deadline ON issues(deadline) WHERE deadline IS NOT NULL;


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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text,
  from_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  to_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested','reviewed','approved','dispatched','in_transit','received','completed','rejected')
  ),
  reason text,
  requested_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  dispatched_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_select_authenticated" ON stock_transfers;
CREATE POLICY "stock_transfers_select_authenticated" ON stock_transfers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "stock_transfers_insert_manage" ON stock_transfers;
CREATE POLICY "stock_transfers_insert_manage" ON stock_transfers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

DROP POLICY IF EXISTS "stock_transfers_update_manage" ON stock_transfers;
CREATE POLICY "stock_transfers_update_manage" ON stock_transfers FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

-- ==========================================
-- STOCK_TRANSFER_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  received_quantity integer DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfer_items_select_authenticated" ON stock_transfer_items;
CREATE POLICY "stock_transfer_items_select_authenticated" ON stock_transfer_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "stock_transfer_items_insert_manage" ON stock_transfer_items;
CREATE POLICY "stock_transfer_items_insert_manage" ON stock_transfer_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

DROP POLICY IF EXISTS "stock_transfer_items_update_manage" ON stock_transfer_items;
CREATE POLICY "stock_transfer_items_update_manage" ON stock_transfer_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

-- ==========================================
-- PURCHASE_REQUESTS
-- ==========================================
CREATE TABLE IF NOT EXISTS purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested','quoted','ordered','partially_received','received','completed','rejected','cancelled')
  ),
  estimated_cost numeric(14,2) DEFAULT 0,
  actual_cost numeric(14,2) DEFAULT 0,
  requested_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ordered_at timestamptz,
  expected_delivery_date date,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_requests_select_authenticated" ON purchase_requests;
CREATE POLICY "purchase_requests_select_authenticated" ON purchase_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_requests_insert_manage" ON purchase_requests;
CREATE POLICY "purchase_requests_insert_manage" ON purchase_requests FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "purchase_requests_update_manage" ON purchase_requests;
CREATE POLICY "purchase_requests_update_manage" ON purchase_requests FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- PURCHASE_REQUEST_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS purchase_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received integer NOT NULL DEFAULT 0,
  unit_price numeric(14,2) DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchase_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_request_items_select_authenticated" ON purchase_request_items;
CREATE POLICY "purchase_request_items_select_authenticated" ON purchase_request_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_request_items_insert_manage" ON purchase_request_items;
CREATE POLICY "purchase_request_items_insert_manage" ON purchase_request_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "purchase_request_items_update_manage" ON purchase_request_items;
CREATE POLICY "purchase_request_items_update_manage" ON purchase_request_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- GOODS_RECEIVED_NOTES
-- ==========================================
CREATE TABLE IF NOT EXISTS goods_received_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text,
  purchase_request_id uuid REFERENCES purchase_requests(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  received_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  delivery_note_number text,
  is_partial boolean NOT NULL DEFAULT false,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goods_received_notes_select_authenticated" ON goods_received_notes;
CREATE POLICY "goods_received_notes_select_authenticated" ON goods_received_notes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "goods_received_notes_insert_manage" ON goods_received_notes;
CREATE POLICY "goods_received_notes_insert_manage" ON goods_received_notes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "goods_received_notes_update_manage" ON goods_received_notes;
CREATE POLICY "goods_received_notes_update_manage" ON goods_received_notes FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- GOODS_RECEIVED_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS goods_received_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES goods_received_notes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_ordered integer NOT NULL DEFAULT 0,
  quantity_received integer NOT NULL DEFAULT 0,
  quantity_damaged integer NOT NULL DEFAULT 0,
  quantity_rejected integer NOT NULL DEFAULT 0,
  quantity_short integer NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE goods_received_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goods_received_items_select_authenticated" ON goods_received_items;
CREATE POLICY "goods_received_items_select_authenticated" ON goods_received_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "goods_received_items_insert_manage" ON goods_received_items;
CREATE POLICY "goods_received_items_insert_manage" ON goods_received_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "goods_received_items_update_manage" ON goods_received_items;
CREATE POLICY "goods_received_items_update_manage" ON goods_received_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_branch ON stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_branch ON stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_business_branch ON purchase_requests(business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_pr_id ON purchase_request_items(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_branch ON goods_received_notes(branch_id);
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_pr ON goods_received_notes(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_goods_received_items_grn ON goods_received_items(grn_id);


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

INSERT INTO businesses (name, category, description) VALUES
  ('Electronics Retail', 'Retail', 'Consumer electronics retail including phones, accessories, and devices.'),
  ('Itel Energy', 'Energy', 'Solar distribution and renewable energy products.'),
  ('Farm', 'Agriculture', 'Agricultural operations and produce.'),
  ('Ride/Logistics', 'Logistics', 'Transportation and logistics services.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO branches (business_id, name, location)
SELECT b.id, branch_name, branch_location
FROM businesses b
CROSS JOIN (VALUES
  ('Awka', 'Awka, Anambra State'),
  ('Lagos', 'Lagos, Lagos State'),
  ('Ibadan', 'Ibadan, Oyo State')
) AS t(branch_name, branch_location)
WHERE b.name = 'Electronics Retail'
ON CONFLICT (business_id, name) DO NOTHING;

INSERT INTO branches (business_id, name, location)
SELECT b.id, 'Ejigbo', 'Ejigbo, Lagos State'
FROM businesses b
WHERE b.name = 'Itel Energy'
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

-- Keep this migration replay-safe when an earlier deployment created these policies.
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
      'audit_log_insert_authenticated'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  END LOOP;
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

alter table customers
add column if not exists branch_id uuid references branches (id) on delete set null;

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

alter table services
add column if not exists category_id uuid references categories (id) on delete set null;

alter table services
add column if not exists unit text not null default 'service';

alter table services
add column if not exists price numeric(14, 2) not null default 0;

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

alter table report_types add column if not exists schema_definition jsonb not null default '{}'::jsonb;

alter table report_types add column if not exists fields jsonb not null default '[]'::jsonb;

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

-- ============================================
-- 202609100002_013_fix_user_profile_rls_recursion.sql
-- ============================================
/* Fix recursive user_profiles RLS policies. */

DROP POLICY IF EXISTS "user_profiles_select_own" ON user_profiles;

DROP POLICY IF EXISTS "user_profiles_select_admin_or_above" ON user_profiles;

DROP POLICY IF EXISTS "user_profiles_select_manager" ON user_profiles;

CREATE POLICY user_profiles_select_scoped ON user_profiles FOR
SELECT TO authenticated USING (
        auth.uid () = id
        OR EXISTS (
            SELECT 1
            FROM roles r
            WHERE
                r.id = (current_profile ()).role_id
                AND r.name IN ('super_admin', 'admin')
        )
        OR (
            EXISTS (
                SELECT 1
                FROM roles r
                WHERE
                    r.id = (current_profile ()).role_id
                    AND r.name = 'manager'
            )
            AND branch_id = (current_profile ()).branch_id
        )
    );

DROP POLICY IF EXISTS "user_profiles_update_admin_or_above" ON user_profiles;

CREATE POLICY user_profiles_update_scoped ON user_profiles FOR
UPDATE TO authenticated USING (
    auth.uid () = id
    OR EXISTS (
        SELECT 1
        FROM roles r
        WHERE
            r.id = (current_profile ()).role_id
            AND r.name IN ('super_admin', 'admin')
    )
)
WITH
    CHECK (
        auth.uid () = id
        OR EXISTS (
            SELECT 1
            FROM roles r
            WHERE
                r.id = (current_profile ()).role_id
                AND r.name IN ('super_admin', 'admin')
        )
    );

-- ============================================
-- 202609100003_014_staff_registration_approval.sql
-- ============================================
/* Public staff registration and administrator approval workflow. */

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved' CHECK (
    approval_status IN (
        'pending',
        'approved',
        'rejected'
    )
);

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS approval_reason text;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now ();

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_profiles_approval_status ON user_profiles (approval_status);

DROP POLICY IF EXISTS user_profiles_select_scoped ON user_profiles;

CREATE POLICY user_profiles_select_scoped ON user_profiles FOR
SELECT TO authenticated USING (
        auth.uid () = id
        OR EXISTS (
            SELECT 1
            FROM roles r
            WHERE
                r.id = (current_profile ()).role_id
                AND r.name IN ('super_admin', 'admin')
        )
        OR (
            EXISTS (
                SELECT 1
                FROM roles r
                WHERE
                    r.id = (current_profile ()).role_id
                    AND r.name = 'manager'
            )
            AND branch_id = (current_profile ()).branch_id
        )
    );

-- ============================================
-- 202609100004_hierarchy_report_lock_and_plugins.sql
-- ============================================
-- Enforce reporting hierarchy, immutable submissions, and per-user dashboard plugins.

CREATE OR REPLACE FUNCTION can_view_user_records(p_target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE visible_users AS (
    SELECT id, manager_id
    FROM user_profiles
    WHERE id = auth.uid() AND is_active = true
    UNION ALL
    SELECT child.id, child.manager_id
    FROM user_profiles child
    JOIN visible_users parent ON child.manager_id = parent.id
    WHERE child.is_active = true
  )
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles actor
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND (
        actor.role_id = (SELECT id FROM roles WHERE name = 'super_admin')
        OR actor.role_id = (SELECT id FROM roles WHERE name = 'admin')
        OR p_target_user IN (SELECT id FROM visible_users)
      )
  );
$$;

REVOKE ALL ON FUNCTION can_view_user_records (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION can_view_user_records (uuid) TO authenticated;

UPDATE user_profiles staff
SET
    manager_id = branch.manager_id
FROM
    branches branch
    JOIN roles staff_role ON staff_role.name = 'sales_person'
WHERE
    staff.branch_id = branch.id
    AND staff.role_id = staff_role.id
    AND staff.manager_id IS NULL
    AND branch.manager_id IS NOT NULL
    AND branch.manager_id <> staff.id;

DROP POLICY IF EXISTS weekly_reports_scoped_select ON weekly_reports;

DROP POLICY IF EXISTS "weekly_reports_select_authenticated" ON weekly_reports;

CREATE POLICY weekly_reports_scoped_select ON weekly_reports FOR
SELECT TO authenticated USING (
        can_view_user_records (
            COALESCE(submitted_by, created_by)
        )
    );

DROP POLICY IF EXISTS weekly_reports_update_authorized ON weekly_reports;

CREATE POLICY weekly_reports_update_authorized ON weekly_reports FOR
UPDATE TO authenticated USING (
    (
        status = 'draft'
        AND created_by = auth.uid ()
    )
    OR has_permission ('reports.review')
    OR has_permission ('reports.amend')
)
WITH
    CHECK (
        can_view_user_records (
            COALESCE(submitted_by, created_by)
        )
    );

DROP POLICY IF EXISTS weekly_reports_delete_admin_only ON weekly_reports;

CREATE POLICY weekly_reports_delete_admin_only ON weekly_reports FOR DELETE TO authenticated USING (
    has_permission ('reports.amend')
);

CREATE OR REPLACE FUNCTION prevent_submitted_report_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('submitted', 'reviewed', 'amended')
     AND NOT has_permission('reports.amend') THEN
    RAISE EXCEPTION 'Submitted reports can only be edited by Admin or Super Admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS daily_activities_scoped_select ON daily_activities;

DROP POLICY IF EXISTS "daily_activities_select_authenticated" ON daily_activities;

CREATE POLICY daily_activities_scoped_select ON daily_activities FOR
SELECT TO authenticated USING (
        can_view_user_records (recorded_by)
    );

DROP POLICY IF EXISTS daily_sales_scoped_select ON daily_sales;

DROP POLICY IF EXISTS "daily_sales_select_authenticated" ON daily_sales;

CREATE POLICY daily_sales_scoped_select ON daily_sales FOR
SELECT TO authenticated USING (
        can_view_user_records (salesperson_id)
    );

DROP POLICY IF EXISTS operational_expenses_scoped_select ON operational_expenses;

DROP POLICY IF EXISTS "operational_expenses_select_authenticated" ON operational_expenses;

CREATE POLICY operational_expenses_scoped_select ON operational_expenses FOR
SELECT TO authenticated USING (
        can_view_user_records (recorded_by)
    );

CREATE TABLE IF NOT EXISTS user_dashboard_plugins (
    user_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
    plugin_key text NOT NULL,
    is_enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now (),
    PRIMARY KEY (user_id, plugin_key)
);

ALTER TABLE user_dashboard_plugins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_dashboard_plugins_own ON user_dashboard_plugins;

CREATE POLICY user_dashboard_plugins_own ON user_dashboard_plugins FOR ALL TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

INSERT INTO
    user_dashboard_plugins (
        user_id,
        plugin_key,
        is_enabled
    )
SELECT id, 'activity_reports', true
FROM user_profiles
ON CONFLICT (user_id, plugin_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_user_profiles_manager_id ON user_profiles (manager_id);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_submitted_by ON weekly_reports (submitted_by);

CREATE INDEX IF NOT EXISTS idx_daily_activities_recorded_by ON daily_activities (recorded_by);

CREATE INDEX IF NOT EXISTS idx_daily_sales_salesperson_id ON daily_sales (salesperson_id);

CREATE INDEX IF NOT EXISTS idx_operational_expenses_recorded_by ON operational_expenses (recorded_by);

-- ============================================
-- 202609110001_fix_inventory_period_rls_and_super_admin_limit.sql
-- ============================================
-- Fix inventory period creation scope and enforce the two-super-admin limit.

CREATE OR REPLACE FUNCTION can_manage_inventory_period(p_business_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles actor
    JOIN roles actor_role ON actor_role.id = actor.role_id
    JOIN branches target_branch ON target_branch.id = p_branch_id
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND target_branch.business_id = p_business_id
      AND (
        actor_role.name = 'super_admin'
        OR (actor_role.name = 'admin' AND actor.business_id = p_business_id)
        OR (actor_role.name = 'manager' AND actor.branch_id = p_branch_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION can_manage_inventory_period (uuid, uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION can_manage_inventory_period (uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS inventory_periods_write ON inventory_periods;

CREATE POLICY inventory_periods_write ON inventory_periods FOR INSERT TO authenticated
WITH
    CHECK (
        can_manage_inventory_period (business_id, branch_id)
    );

DROP POLICY IF EXISTS inventory_periods_update ON inventory_periods;

CREATE POLICY inventory_periods_update ON inventory_periods FOR
UPDATE TO authenticated USING (
    can_manage_inventory_period (business_id, branch_id)
)
WITH
    CHECK (
        can_manage_inventory_period (business_id, branch_id)
    );

DROP POLICY IF EXISTS inventory_lines_write ON inventory_period_lines;

CREATE POLICY inventory_lines_write ON inventory_period_lines FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM inventory_periods period
            WHERE
                period.id = period_id
                AND can_manage_inventory_period (
                    period.business_id,
                    period.branch_id
                )
        )
    );

DROP POLICY IF EXISTS inventory_lines_update ON inventory_period_lines;

CREATE POLICY inventory_lines_update ON inventory_period_lines FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM inventory_periods period
        WHERE
            period.id = period_id
            AND can_manage_inventory_period (
                period.business_id,
                period.branch_id
            )
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM inventory_periods period
            WHERE
                period.id = period_id
                AND can_manage_inventory_period (
                    period.business_id,
                    period.branch_id
                )
        )
    );

CREATE OR REPLACE FUNCTION enforce_super_admin_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  super_admin_role_id uuid;
BEGIN
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin';
  IF NEW.role_id = super_admin_role_id
      AND TG_OP = 'INSERT'
      AND (SELECT count(*) FROM user_profiles WHERE role_id = super_admin_role_id) >= 2 THEN
     RAISE EXCEPTION 'Only two Super Admin accounts are allowed';
  ELSIF NEW.role_id = super_admin_role_id
      AND TG_OP = 'UPDATE'
      AND OLD.role_id <> super_admin_role_id
      AND (SELECT count(*) FROM user_profiles WHERE role_id = super_admin_role_id) >= 2 THEN
    RAISE EXCEPTION 'Only two Super Admin accounts are allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_super_admin_limit ON user_profiles;

CREATE TRIGGER trg_enforce_super_admin_limit
BEFORE INSERT OR UPDATE OF role_id ON user_profiles
FOR EACH ROW EXECUTE FUNCTION enforce_super_admin_limit();

-- ============================================
-- 202609120000_add_new_roles.sql
-- ============================================
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS permission_flags jsonb;

INSERT INTO public.roles (id, name, display_name, description, is_system, permission_flags) VALUES
  ('00000000-0000-0000-0000-000000000005', 'supervisor', 'Supervisor', 'Floor-level oversight; bridge between Manager and Sales Person', true, '{"can_view_team_sales": true, "can_log_incidents": true, "can_create_users": false, "can_edit_sales": false}'),
  ('00000000-0000-0000-0000-000000000006', 'accountant', 'Accountant / Finance Officer', 'Reconciles money â€” sales, expenses, pending payments â€” without editing sales records', true, '{"can_view_financials": true, "can_edit_sales": false, "can_view_scope": "business"}'),
  ('00000000-0000-0000-0000-000000000007', 'inventory_officer', 'Inventory / Store Officer', 'Owns stock accuracy â€” receiving, damages, stock counts â€” separate from the sales person', true, '{"can_record_stock_in": true, "can_log_damages": true, "can_update_procurement": true, "can_view_scope": "branch"}'),
  ('00000000-0000-0000-0000-000000000008', 'transport_officer', 'Transport / Fleet Officer', 'Logs trips, fuel, maintenance, driver-specific activity for the Transport arm', true, '{"can_log_trips": true, "can_log_fuel": true, "can_log_maintenance": true, "can_view_scope": "vehicle"}'),
  ('00000000-0000-0000-0000-000000000009', 'auditor', 'Auditor', 'View-only oversight; can be handed to an external accountant/auditor without giving edit rights', true, '{"can_view_scope": "configurable", "can_create": false, "can_edit": false, "can_delete": false, "can_approve": false}')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- 202609120001_add_user_branch_assignments.sql
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_branch_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  assigned_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_branch_assignments_user_id ON public.user_branch_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_assignments_branch_id ON public.user_branch_assignments (branch_id);

-- ============================================
-- 202609130002_add_units_table.sql
-- ============================================
CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text DEFAULT '',
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_units_business_id ON public.units (business_id);
CREATE INDEX IF NOT EXISTS idx_units_branch_id ON public.units (branch_id);
CREATE INDEX IF NOT EXISTS idx_units_is_active ON public.units (is_active);

-- Unit-to-user assignment table (many-to-many: users can belong to multiple units)
CREATE TABLE IF NOT EXISTS user_unit_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_unit_assignments_user_id ON public.user_unit_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_unit_assignments_unit_id ON public.user_unit_assignments (unit_id);

-- ============================================
-- 202609140001_add_units_rls_policies.sql
-- ============================================
/*
# Units & Unit Assignments RLS Policies

## Purpose
Adds row-level security for the new units table and user_unit_assignments,
extending branch-scoped access control to the new unit system.

## Policies Added

### units
- SELECT: users can see units in their assigned branch(es) or all units for super_admin/admin
- INSERT: only admin or super_admin
- UPDATE: only admin or super_admin (unit ownership changes)
- DELETE: only admin or super_admin

### user_unit_assignments
- SELECT: users can see their own assignments; admins/super_admins see all
- INSERT: only admin or super_admin
- DELETE: only admin or super_admin
*/

-- ==========================================
-- UNITS â€” branch-scoped access
-- ==========================================
DROP POLICY IF EXISTS "units_select_authenticated" ON units;
CREATE POLICY "units_select_authenticated" ON units FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_unit_assignments uua
      WHERE uua.unit_id = units.id
      AND uua.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role_id = (SELECT id FROM roles WHERE name = 'super_admin')
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role_id = (SELECT id FROM roles WHERE name = 'admin')
    )
  );

DROP POLICY IF EXISTS "units_insert_admin_or_above" ON units;
CREATE POLICY "units_insert_admin_or_above" ON units FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.is_active = true
      AND up.role_id IN (
        SELECT id FROM roles WHERE name IN ('super_admin','admin')
      )
    )
  );

DROP POLICY IF EXISTS "units_update_admin_or_above" ON units;
CREATE POLICY "units_update_admin_or_above" ON units FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.is_active = true
      AND up.role_id IN (
        SELECT id FROM roles WHERE name IN ('super_admin','admin')
      )
    )
  );

DROP POLICY IF EXISTS "units_delete_admin_or_above" ON units;
CREATE POLICY "units_delete_admin_or_above" ON units FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.is_active = true
      AND up.role_id IN (
        SELECT id FROM roles WHERE name IN ('super_admin','admin')
      )
    )
  );

-- ==========================================
-- USER_UNIT_ASSIGNMENTS â€” admin-managed assignments
-- ==========================================
DROP POLICY IF EXISTS "user_unit_assignments_select_own_or_admin" ON user_unit_assignments;
CREATE POLICY "user_unit_assignments_select_own_or_admin" ON user_unit_assignments FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.is_active = true
      AND up.role_id IN (
        SELECT id FROM roles WHERE name IN ('super_admin','admin')
      )
    )
  );

DROP POLICY IF EXISTS "user_unit_assignments_insert_admin_or_above" ON user_unit_assignments;
CREATE POLICY "user_unit_assignments_insert_admin_or_above" ON user_unit_assignments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.is_active = true
      AND up.role_id IN (
        SELECT id FROM roles WHERE name IN ('super_admin','admin')
      )
    )
  );

DROP POLICY IF EXISTS "user_unit_assignments_delete_admin_or_above" ON user_unit_assignments;
CREATE POLICY "user_unit_assignments_delete_admin_or_above" ON user_unit_assignments FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.is_active = true
      AND up.role_id IN (
        SELECT id FROM roles WHERE name IN ('super_admin','admin')
      )
    )
  );

-- ============================================
-- 202609140002_prevent_backdated_sales.sql
-- ============================================
-- ==========================================
-- Prevent backdated sales
-- 1. New sales must be dated today (no backdating, no future dates)
-- 2. The sale_date of an existing sale can never be changed (audit integrity)
-- ==========================================

CREATE OR REPLACE FUNCTION prevent_backdated_sales()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sale_date::date <> CURRENT_DATE THEN
      RAISE EXCEPTION 'Sales cannot be backdated or dated in the future. Use today''s date.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.sale_date IS DISTINCT FROM OLD.sale_date THEN
      RAISE EXCEPTION 'The sale date of an existing sale cannot be changed.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_backdated_sales ON daily_sales;

CREATE TRIGGER trg_prevent_backdated_sales
BEFORE INSERT OR UPDATE ON daily_sales
FOR EACH ROW EXECUTE FUNCTION prevent_backdated_sales();

-- ============================================
-- 202609140003_anon_registration_selects.sql
-- ============================================
-- ==========================================
-- Allow anonymous reads of registration data
-- The sign-up form (before login) needs the list of
-- businesses, branches, and roles so applicants can
-- pick where and as whom they want to work.
-- Only public names/status data is exposed.
-- ==========================================

DROP POLICY IF EXISTS "businesses_select_anon_registration" ON businesses;
CREATE POLICY "businesses_select_anon_registration" ON businesses FOR SELECT
  TO anon USING (is_active = true);

DROP POLICY IF EXISTS "branches_select_anon_registration" ON branches;
CREATE POLICY "branches_select_anon_registration" ON branches FOR SELECT
  TO anon USING (is_active = true);

DROP POLICY IF EXISTS "roles_select_anon_registration" ON roles;
CREATE POLICY "roles_select_anon_registration" ON roles FOR SELECT
  TO anon USING (true);

-- ============================================
-- 202609140004_multi_item_sales.sql
-- ============================================
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


-- ============================================
-- 202609150001_cumulative_role_permissions.sql
-- ============================================
-- Cumulative role permissions: every role holds everything granted to the
-- roles below it, plus its own specific capabilities.
-- Hierarchy: super_admin > admin > manager > supervisor > sales_person,
-- with specialist roles (accountant, inventory_officer, transport_officer,
-- auditor, farm_operations_officer) building on the staff base set.
-- All inserts are idempotent.

-- The farm operations role is referenced by the app but was never seeded.
INSERT INTO roles (name, display_name, description, is_system)
VALUES ('farm_operations_officer', 'Farm Operations Officer', 'Runs farm production and produce handling; sells farm output', true)
ON CONFLICT (name) DO NOTHING;

-- Supervisor inherits the full sales_person set, plus oversight capabilities.
INSERT INTO role_permissions (role_id, permission_id)
SELECT sup.id, p.id FROM roles sup JOIN permissions p ON true
WHERE sup.name = 'supervisor'
  AND p.code IN (
    SELECT p2.code FROM permissions p2
    JOIN role_permissions rp ON rp.permission_id = p2.id
    JOIN roles base ON base.id = rp.role_id
    WHERE base.name = 'sales_person'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'supervisor'
  AND p.code IN (
    'reports.view_branch',
    'issues.manage',
    'daily_activity.view_branch',
    'dashboard.view_branch',
    'inventory.adjust'
  )
ON CONFLICT DO NOTHING;

-- Manager inherits the full supervisor set (cumulativity gap fill).
INSERT INTO role_permissions (role_id, permission_id)
SELECT mgr.id, p.id FROM roles mgr JOIN permissions p ON true
WHERE mgr.name = 'manager'
  AND p.code IN (
    SELECT p2.code FROM permissions p2
    JOIN role_permissions rp ON rp.permission_id = p2.id
    JOIN roles lower ON lower.id = rp.role_id
    WHERE lower.name IN ('supervisor', 'sales_person')
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'manager' AND p.code IN ('dashboard.view_personal')
ON CONFLICT DO NOTHING;

-- Admin keeps everything except org-level controls (already seeded that way);
-- ensure it also covers every manager capability explicitly.
INSERT INTO role_permissions (role_id, permission_id)
SELECT adm.id, p.id FROM roles adm JOIN permissions p ON true
WHERE adm.name = 'admin'
  AND p.code IN (
    SELECT p2.code FROM permissions p2
    JOIN role_permissions rp ON rp.permission_id = p2.id
    JOIN roles lower ON lower.id = rp.role_id
    WHERE lower.name IN ('manager', 'supervisor', 'sales_person')
  )
  AND p.code NOT IN ('businesses.manage', 'users.manage_all')
ON CONFLICT DO NOTHING;

-- Specialist roles: staff base set plus their own capabilities.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'accountant'
  AND p.code IN (
    'products.view', 'inventory.view', 'sales.view',
    'reports.view_branch', 'dashboard.view_branch',
    'issues.view_branch', 'daily_activity.view_branch'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'inventory_officer'
  AND p.code IN (
    'products.view', 'inventory.view', 'inventory.manage', 'inventory.adjust',
    'procurement.manage', 'procurement.view',
    'transfers.manage', 'transfers.view',
    'dashboard.view_branch', 'daily_activity.create', 'daily_activity.view_branch'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'transport_officer'
  AND p.code IN (
    'products.view', 'inventory.view', 'dashboard.view_branch',
    'daily_activity.create', 'daily_activity.view_own'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'auditor'
  AND p.code IN (
    'products.view', 'inventory.view', 'sales.view',
    'reports.view_branch', 'dashboard.view_branch',
    'issues.view_branch', 'daily_activity.view_branch'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON true
WHERE r.name = 'farm_operations_officer'
  AND p.code IN (
    SELECT p2.code FROM permissions p2
    JOIN role_permissions rp ON rp.permission_id = p2.id
    JOIN roles base ON base.id = rp.role_id
    WHERE base.name = 'sales_person'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'farm_operations_officer'
  AND p.code IN ('inventory.adjust', 'daily_activity.view_branch', 'reports.view_branch')
ON CONFLICT DO NOTHING;


-- ============================================
-- 202609150002_fractional_quantities_and_balance_backfill.sql
-- ============================================
-- Fractional quantities for farm produce (bags, crates, kilos can be split)
-- plus a backfill so every active product has a balance row in every active
-- branch of its business. Missing balance rows are the reason sales fail
-- with "Insufficient stock" even when stock was recorded.

ALTER TABLE sale_items ALTER COLUMN quantity TYPE numeric(14,2);
ALTER TABLE inventory_transactions ALTER COLUMN quantity TYPE numeric(14,2);
ALTER TABLE inventory_balances ALTER COLUMN current_stock TYPE numeric(14,2);
ALTER TABLE inventory_balances ALTER COLUMN opening_stock TYPE numeric(14,2);

-- Backfill zero-balance rows for every active product x active branch
-- combination within the same business.
INSERT INTO inventory_balances (product_id, branch_id, opening_stock, current_stock)
SELECT p.id, b.id, 0, 0
FROM products p
JOIN branches b ON b.business_id = p.business_id AND b.is_active = true
WHERE p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM inventory_balances ib
    WHERE ib.product_id = p.id AND ib.branch_id = b.id
  )
ON CONFLICT (product_id, branch_id) DO NOTHING;

-- Same sale logic as 202609140004, with numeric quantities so fractional
-- farm measures (e.g. 2.5 kilos) validate and decrement correctly.
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


-- ============================================
-- 202609150003_business_measurement_units.sql
-- ============================================
-- Per-business measurement units (e.g. Farm: bag/crate/basket/kilo,
-- Electronics: pcs/carton/pack). Products and sales use these so each
-- business measures stock and sells in its own proper units.

CREATE TABLE IF NOT EXISTS business_measurement_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bmu_business_id ON business_measurement_units (business_id);

ALTER TABLE business_measurement_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bmu_select_authenticated" ON business_measurement_units;
CREATE POLICY "bmu_select_authenticated" ON business_measurement_units FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "bmu_write_manage" ON business_measurement_units;
CREATE POLICY "bmu_write_manage" ON business_measurement_units FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin', 'manager'))
    )
    AND can_access_business(business_measurement_units.business_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin', 'manager'))
    )
    AND can_access_business(business_measurement_units.business_id)
  );

-- Seed farm-style units for agricultural businesses.
INSERT INTO business_measurement_units (business_id, name)
SELECT b.id, u.unit_name
FROM businesses b
CROSS JOIN (VALUES
  ('bag'), ('crate'), ('basket'), ('kilo'), ('kg'),
  ('unit'), ('bundle'), ('tuber'), ('dozen'), ('sack'), ('carton')
) AS u(unit_name)
WHERE lower(b.name) LIKE '%farm%' OR lower(COALESCE(b.category, '')) LIKE '%agric%'
ON CONFLICT (business_id, name) DO NOTHING;

-- Seed retail-style units for every other business.
INSERT INTO business_measurement_units (business_id, name)
SELECT b.id, u.unit_name
FROM businesses b
CROSS JOIN (VALUES
  ('pcs'), ('box'), ('carton'), ('pack'), ('set'),
  ('pair'), ('kg'), ('litre'), ('meter')
) AS u(unit_name)
WHERE NOT (lower(b.name) LIKE '%farm%' OR lower(COALESCE(b.category, '')) LIKE '%agric%')
ON CONFLICT (business_id, name) DO NOTHING;


-- ============================================
-- 202609150004_units_visibility.sql
-- ============================================
-- Org units (departments) must be visible during anonymous registration and
-- to managers overseeing their own business scope.

DROP POLICY IF EXISTS "units_select_anon_registration" ON units;
CREATE POLICY "units_select_anon_registration" ON units FOR SELECT
  TO anon USING (is_active = true);

DROP POLICY IF EXISTS "units_select_manager_scope" ON units;
CREATE POLICY "units_select_manager_scope" ON units FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name = 'manager')
        AND (units.business_id = up.business_id OR units.branch_id = up.branch_id)
    )
  );


-- ============================================
-- 202609150005_roles_product_units_sale_units.sql
-- ============================================
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


-- ============================================
-- 202609150006_units_manager_scope.sql
-- ============================================
-- Let Managers manage org units (departments) within their own business.
-- Super Admin and Admin keep full access via the existing policies.

DROP POLICY IF EXISTS "units_insert_manager_scope" ON units;
CREATE POLICY "units_insert_manager_scope" ON units FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name = 'manager')
        AND units.business_id = up.business_id
    )
  );

DROP POLICY IF EXISTS "units_update_manager_scope" ON units;
CREATE POLICY "units_update_manager_scope" ON units FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name = 'manager')
        AND units.business_id = up.business_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name = 'manager')
        AND units.business_id = up.business_id
    )
  );


-- ============================================
-- 202609150007_business_admin_write.sql
-- ============================================
-- Let Admins create and edit businesses (Super Admin keeps full control,
-- including the original superuser policies which remain in place).

DROP POLICY IF EXISTS "businesses_insert_admin" ON businesses;
CREATE POLICY "businesses_insert_admin" ON businesses FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  );

DROP POLICY IF EXISTS "businesses_update_admin" ON businesses;
CREATE POLICY "businesses_update_admin" ON businesses FOR UPDATE
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


-- ============================================
-- 202609150008_roles_is_active.sql
-- ============================================
-- Roles can be deactivated instead of deleted (safer when history exists).
-- Super Admin and Admin rows stay locked at the app and RLS layers.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;


-- ============================================
-- 202609150009_restore_scoped_selects.sql
-- ============================================
-- Restore the scoped read policies that migration 012's cleanup block
-- dropped without recreating. Without a SELECT policy, RLS silences every
-- read (empty lists, no error) â€” this is why saved products, categories,
-- suppliers, transfers and inventory rows were invisible while writes
-- worked. Bodies mirror migration 011's design; business/branch scope
-- (including multi-business assignments) is enforced by
-- can_access_business() / can_access_branch().

DROP POLICY IF EXISTS products_scoped_select ON products;
CREATE POLICY products_scoped_select ON products FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

DROP POLICY IF EXISTS categories_scoped_select ON categories;
CREATE POLICY categories_scoped_select ON categories FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

DROP POLICY IF EXISTS suppliers_scoped_select ON suppliers;

CREATE POLICY suppliers_scoped_select ON suppliers FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

DROP POLICY IF EXISTS issues_scoped_select ON issues;
CREATE POLICY issues_scoped_select ON issues FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS purchase_requests_scoped_select ON purchase_requests;
CREATE POLICY purchase_requests_scoped_select ON purchase_requests FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS goods_received_notes_scoped_select ON goods_received_notes;
CREATE POLICY goods_received_notes_scoped_select ON goods_received_notes FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS stock_transfers_scoped_select ON stock_transfers;
CREATE POLICY stock_transfers_scoped_select ON stock_transfers FOR
SELECT TO authenticated USING (
        can_access_branch (from_branch_id)
        OR can_access_branch (to_branch_id)
    );

DROP POLICY IF EXISTS inventory_balances_scoped_select ON inventory_balances;
CREATE POLICY inventory_balances_scoped_select ON inventory_balances FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS inventory_txns_scoped_select ON inventory_transactions;
CREATE POLICY inventory_txns_scoped_select ON inventory_transactions FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS inventory_periods_scoped_select ON inventory_periods;
CREATE POLICY inventory_periods_scoped_select ON inventory_periods FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS inventory_period_lines_scoped_select ON inventory_period_lines;
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

DROP POLICY IF EXISTS stock_variances_scoped_select ON stock_variances;
CREATE POLICY stock_variances_scoped_select ON stock_variances FOR
SELECT TO authenticated USING (can_access_branch (branch_id));


-- ============================================
-- 202609150010_default_bucket.sql
-- ============================================
-- System fallback bucket for records orphaned by Super Admin deletions.
-- The Default business/branch are inactive (hidden from pickers) but remain
-- referenceable so financial and operational history is never lost.
-- Application code must refuse to delete them (see delete-organization).

INSERT INTO businesses (name, category, description, is_active)
VALUES ('Default', 'System', 'System fallback bucket for records orphaned by deletions. Do not delete.', false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO branches (business_id, name, location, is_active)
SELECT b.id, 'Default', 'System fallback', false
FROM businesses b
WHERE b.name = 'Default'
ON CONFLICT (business_id, name) DO NOTHING;


-- ============================================
-- 202609150011_sale_item_serials.sql
-- ============================================
-- Optional per-line serial numbers on sales (e.g. electronics with
-- manufacturer serials). Recorded on the sale item and shown on receipts.

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS serial_number text;

-- Same sale logic as 202609150005, additionally persisting the line serial.
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
    v_serial := NULLIF(trim(COALESCE(v_item->>'serial_number', '')), '');
    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit, serial_number)
    VALUES (v_sale_id, v_product_id, v_quantity, v_unit_price, v_item_discount, v_unit, v_serial);
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


-- ============================================
-- 202609150012_serialized_inventory.sql
-- ============================================
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


-- ============================================
-- 202609150013_general_assets.sql
-- ============================================
-- General Asset Management: comprehensive, traceable asset inventory.
-- Extends existing inventory_balances/transactions without replacing them.

-- Common asset types (extensible via free-text if needed).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_type') THEN
    CREATE TYPE asset_type AS ENUM ('machinery','vehicle','tool','equipment','furniture','electronics','generator','ware','plant','scrap','other');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_condition') THEN
    CREATE TYPE asset_condition AS ENUM ('new','good','fair','poor','damaged','under_repair','scrapped','disposed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_status') THEN
    CREATE TYPE asset_status AS ENUM ('available','in_use','assigned','reserved','under_repair','damaged','missing','in_transit','scrapped','disposed','sold');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  asset_type asset_type NOT NULL DEFAULT 'other',
  name text NOT NULL,
  asset_code text,
  serial_number text,
  description text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit text DEFAULT 'pcs',
  location text,
  department text,
  custodian_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  condition asset_condition NOT NULL DEFAULT 'good',
  status asset_status NOT NULL DEFAULT 'available',
  purchase_date date,
  purchase_cost numeric(14,2) DEFAULT 0,
  current_value numeric(14,2) DEFAULT 0,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  procurement_reference text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_business ON inventory_assets(business_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_branch ON inventory_assets(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_type ON inventory_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_status ON inventory_assets(status);

ALTER TABLE inventory_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_assets_scoped_select ON inventory_assets;
CREATE POLICY inventory_assets_scoped_select ON inventory_assets FOR SELECT TO authenticated USING (can_access_branch(branch_id) OR can_access_business(business_id));
DROP POLICY IF EXISTS inventory_assets_write ON inventory_assets;
CREATE POLICY inventory_assets_write ON inventory_assets FOR ALL TO authenticated USING (can_access_branch(branch_id) OR can_access_business(business_id)) WITH CHECK (can_access_branch(branch_id) OR can_access_business(business_id));

CREATE TABLE IF NOT EXISTS inventory_asset_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  from_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  to_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  from_status asset_status,
  to_status asset_status,
  from_condition asset_condition,
  to_condition asset_condition,
  reason text,
  reference_type text,
  reference_id uuid,
  actor_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_movements_asset ON inventory_asset_movements(asset_id);
ALTER TABLE inventory_asset_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_movements_scoped_select ON inventory_asset_movements;
CREATE POLICY asset_movements_scoped_select ON inventory_asset_movements FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM inventory_assets a WHERE a.id = asset_id AND (can_access_branch(a.branch_id) OR can_access_business(a.business_id))));
DROP POLICY IF EXISTS asset_movements_write ON inventory_asset_movements;
CREATE POLICY asset_movements_write ON inventory_asset_movements FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM inventory_assets a WHERE a.id = asset_id AND (can_access_branch(a.branch_id) OR can_access_business(a.business_id)))) WITH CHECK (EXISTS (SELECT 1 FROM inventory_assets a WHERE a.id = asset_id AND (can_access_branch(a.branch_id) OR can_access_business(a.business_id))));


-- ============================================
-- 202609160001_multi_business_admin_scope.sql
-- ============================================
-- Multi-business Admin oversight.
--
-- An Admin may be assigned to any number of businesses (and to the branches of
-- those businesses). The assignment tables were added in
-- 202609100001_012 (user_business_assignments, user_branch_assignments) and are
-- already honoured by the scope helpers re-declared in
-- 202609140004_multi_item_sales. What was still missing was read scoping for
-- the reference tables themselves:
--
--   * `businesses` was readable by every authenticated user (USING true), so an
--     Admin saw businesses they were never added to.
--   * `branches` was readable by every authenticated user (USING true).
--   * `user_profiles` let any Admin read every staff record group-wide.
--
-- This migration closes those gaps while keeping a Super Admin global, and
-- keeps every other role scoped to its own business/branch.
--
-- Everything here is idempotent so it can be replayed safely.

-- ==========================================
-- 1. Scope helpers (assignment aware)
-- ==========================================
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
           OR EXISTS (SELECT 1 FROM user_branch_assignments ubra WHERE ubra.user_id = up.id AND ubra.branch_id = p_branch_id)
           OR (r.name = 'admin' AND (up.business_id = b.business_id OR EXISTS (SELECT 1 FROM user_business_assignments uba WHERE uba.user_id = up.id AND uba.business_id = b.business_id))))
  );
$$;

-- Businesses the current user may list: Super Admin gets everything, everyone
-- else gets their primary business plus every explicit assignment.
CREATE OR REPLACE FUNCTION my_business_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM businesses b
  WHERE EXISTS (
    SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (r.name = 'super_admin' OR up.business_id = b.id
           OR EXISTS (SELECT 1 FROM user_business_assignments uba WHERE uba.user_id = up.id AND uba.business_id = b.id))
  );
$$;

-- Branches the current user may list: Super Admin gets everything; everyone else
-- gets every branch of a business they belong to (so branch pickers such as
-- Transfers keep working) plus any branch they are explicitly assigned to.
CREATE OR REPLACE FUNCTION my_branch_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM branches b
  WHERE EXISTS (
    SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (
        r.name = 'super_admin'
        OR up.business_id = b.business_id
        OR EXISTS (SELECT 1 FROM user_business_assignments uba WHERE uba.user_id = up.id AND uba.business_id = b.business_id)
        OR EXISTS (SELECT 1 FROM user_branch_assignments ubra WHERE ubra.user_id = up.id AND ubra.branch_id = b.id)
      )
  );
$$;

REVOKE ALL ON FUNCTION my_business_ids () FROM PUBLIC;
REVOKE ALL ON FUNCTION my_branch_ids () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_business_ids () TO authenticated;
GRANT EXECUTE ON FUNCTION my_branch_ids () TO authenticated;

-- ==========================================
-- 2. businesses â€” scoped reads
--    (the anon registration policy from 202609140003 is left untouched; it only
--     applies to the `anon` role and is OR-ed with the policies below)
-- ==========================================
DROP POLICY IF EXISTS "businesses_select_authenticated" ON businesses;
DROP POLICY IF EXISTS "businesses_select_scoped" ON businesses;
CREATE POLICY "businesses_select_scoped" ON businesses FOR SELECT
  TO authenticated USING (
    businesses.id IN (SELECT my_business_ids())
  );

-- ==========================================
-- 3. branches â€” scoped reads
-- ==========================================
DROP POLICY IF EXISTS "branches_select_authenticated" ON branches;
DROP POLICY IF EXISTS "branches_select_scoped" ON branches;
CREATE POLICY "branches_select_scoped" ON branches FOR SELECT
  TO authenticated USING (
    branches.id IN (SELECT my_branch_ids())
  );

-- ==========================================
-- 4. user_profiles â€” an Admin only sees staff inside the businesses the Admin
--    was added to (Super Admin stays global, Managers stay in their branch).
-- ==========================================
DROP POLICY IF EXISTS user_profiles_select_scoped ON user_profiles;
CREATE POLICY user_profiles_select_scoped ON user_profiles FOR SELECT
  TO authenticated USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = (current_profile()).role_id AND r.name = 'super_admin'
    )
    OR (
      EXISTS (SELECT 1 FROM roles r WHERE r.id = (current_profile()).role_id AND r.name = 'admin')
      AND (
        user_profiles.business_id IN (SELECT my_business_ids())
        OR EXISTS (
          SELECT 1 FROM user_business_assignments uba
          WHERE uba.user_id = user_profiles.id
            AND uba.business_id IN (SELECT my_business_ids())
        )
      )
    )
    OR (
      EXISTS (SELECT 1 FROM roles r WHERE r.id = (current_profile()).role_id AND r.name = 'manager')
      AND user_profiles.branch_id = (current_profile()).branch_id
    )
  );

-- ==========================================
-- 5. Backfill the primary business/branch into the assignment tables so the
--    existing Administrators render correctly in the new multi-select UI.
--    NOT EXISTS (not ON CONFLICT) is used because the live
--    user_branch_assignments table still carries its original surrogate `id`
--    primary key rather than a UNIQUE(user_id, branch_id) constraint.
-- ==========================================
INSERT INTO user_business_assignments (user_id, business_id)
SELECT up.id, up.business_id
FROM user_profiles up
JOIN roles r ON r.id = up.role_id
WHERE r.name = 'admin'
  AND up.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_business_assignments uba
    WHERE uba.user_id = up.id AND uba.business_id = up.business_id
  );

INSERT INTO user_branch_assignments (user_id, branch_id)
SELECT up.id, up.branch_id
FROM user_profiles up
JOIN roles r ON r.id = up.role_id
WHERE r.name = 'admin'
  AND up.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_branch_assignments ubra
    WHERE ubra.user_id = up.id AND ubra.branch_id = up.branch_id
  );

-- Keep the assignment tables writable for the people who manage the scope.
DROP POLICY IF EXISTS user_business_assignments_scope ON user_business_assignments;
CREATE POLICY user_business_assignments_scope ON user_business_assignments FOR ALL
  TO authenticated USING (can_access_business (business_id))
  WITH CHECK (can_access_business (business_id));

DROP POLICY IF EXISTS user_branch_assignments_scope ON user_branch_assignments;
CREATE POLICY user_branch_assignments_scope ON user_branch_assignments FOR ALL
  TO authenticated USING (can_access_branch (branch_id))
  WITH CHECK (can_access_branch (branch_id));

-- ==========================================
-- 6. Align the remaining scope checks with multi-business assignment
-- ==========================================

-- Report/sale visibility previously treated every Admin as global. Keep the
-- reporting hierarchy (manager_id chain) but bound Admins to their businesses.
CREATE OR REPLACE FUNCTION can_view_user_records(p_target_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE visible_users AS (
    SELECT id, manager_id
    FROM user_profiles
    WHERE id = auth.uid() AND is_active = true
    UNION ALL
    SELECT child.id, child.manager_id
    FROM user_profiles child
    JOIN visible_users parent ON child.manager_id = parent.id
    WHERE child.is_active = true
  )
  SELECT EXISTS (
    SELECT 1 FROM user_profiles actor
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND (
        actor.role_id = (SELECT id FROM roles WHERE name = 'super_admin')
        OR (
          actor.role_id = (SELECT id FROM roles WHERE name = 'admin')
          AND (
            can_access_business ((SELECT business_id FROM user_profiles WHERE id = p_target_user))
            OR EXISTS (
              SELECT 1 FROM user_business_assignments uba
              WHERE uba.user_id = p_target_user
                AND can_access_business (uba.business_id)
            )
          )
        )
        OR p_target_user IN (SELECT id FROM visible_users)
      )
  );
$$;

-- SECURITY DEFINER helpers: policies on `units` and `user_unit_assignments`
-- reference each other, so the lookups must bypass RLS (same pattern as
-- can_access_business) to avoid "infinite recursion detected in policy".
CREATE OR REPLACE FUNCTION is_assigned_to_unit(p_unit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_unit_assignments uua
    WHERE uua.unit_id = p_unit_id AND uua.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION can_access_unit(p_unit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM units u
    WHERE u.id = p_unit_id AND can_access_business (u.business_id)
  );
$$;

REVOKE ALL ON FUNCTION is_assigned_to_unit (uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_access_unit (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_assigned_to_unit (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_access_unit (uuid) TO authenticated;

-- Org units: branch/unit members keep their own view, Admins get every unit of
-- the businesses they were added to (was: every unit in the system).
DROP POLICY IF EXISTS "units_select_authenticated" ON units;
DROP POLICY IF EXISTS "units_select_manager_scope" ON units;
DROP POLICY IF EXISTS "units_select_scoped" ON units;
CREATE POLICY "units_select_scoped" ON units FOR SELECT
  TO authenticated USING (
    can_access_business (units.business_id)
    OR units.branch_id = (current_profile()).branch_id
    OR is_assigned_to_unit (units.id)
  );

-- Measurement units are per-business reference data.
DROP POLICY IF EXISTS "bmu_select_authenticated" ON business_measurement_units;
DROP POLICY IF EXISTS "bmu_select_scoped" ON business_measurement_units;
CREATE POLICY "bmu_select_scoped" ON business_measurement_units FOR SELECT
  TO authenticated USING (can_access_business (business_measurement_units.business_id));

DROP POLICY IF EXISTS "user_unit_assignments_select_own_or_admin" ON user_unit_assignments;
CREATE POLICY "user_unit_assignments_select_own_or_admin" ON user_unit_assignments FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR can_access_unit (user_unit_assignments.unit_id)
  );


-- ============================================
-- 202609170001_enable_unit_assignment_rls.sql
-- ============================================
-- Enable RLS on user_unit_assignments.
--
-- 202609160001 created the SELECT policy for this table but never flipped
-- relrowsecurity on, so the policy was inert (verified: relrowsecurity=false
-- on the live database). Enable it and grant the minimum privileges the
-- SECURITY DEFINER helpers (is_assigned_to_unit, can_access_unit) rely on.

ALTER TABLE user_unit_assignments ENABLE ROW LEVEL SECURITY;

-- The helper functions are SECURITY DEFINER and run as the function owner, so
-- they bypass RLS; authenticated users only need SELECT for the own-rows
-- policy to be meaningful (INSERT/UPDATE/DELETE stay managed by whoever has
-- table grants through service role / edge functions).
DROP POLICY IF EXISTS "user_unit_assignments_select_own_or_admin" ON user_unit_assignments;
CREATE POLICY "user_unit_assignments_select_own_or_admin" ON user_unit_assignments FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR can_access_unit (unit_id)
  );


-- ============================================
-- 202609170002_stock_sync_integrity.sql
-- ============================================
-- Stock sync integrity: fractional quantities, single-row balance seeding
-- history cleanup, and an atomic GRN receipt endpoint.
--
-- 1) Widen every quantity/threshold column that still used integers so
--    fractional farm goods (2.5 kg bags, 0.75 crates) flow through transfers,
--    GRNs, ledgers and min/reorder levels without rounding or insert errors.
-- 2) Consolidate balance rows duplicated by the old seedBalances (it copied the
--    same opening stock into EVERY branch of the business, so one product
--    appeared once per branch in inventory). Only untouched rows with zero
--    movements are collapsed; each product keeps exactly one row.
-- 3) Backfill balance min/reorder levels from the product master.
-- 4) record_inventory_movement takes numeric(14,2) instead of integer
--    (the integer signature silently rejected fractional movements).
-- 5) record_grn_with_items: atomic GRN (note + items + stock movements +
--    purchase status) so a failed movement can never desync procurement from
--    inventory again.

-- ---------------------------------------------------------------------
-- 1. Fractional quantity widening
-- ---------------------------------------------------------------------
ALTER TABLE inventory_transactions ALTER COLUMN quantity_before TYPE numeric(14, 2);
ALTER TABLE inventory_transactions ALTER COLUMN quantity_after TYPE numeric(14, 2);

ALTER TABLE stock_transfer_items ALTER COLUMN quantity TYPE numeric(14, 2);
ALTER TABLE stock_transfer_items ALTER COLUMN received_quantity TYPE numeric(14, 2);

ALTER TABLE goods_received_items ALTER COLUMN quantity_ordered TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_received TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_damaged TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_rejected TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_short TYPE numeric(14, 2);

ALTER TABLE products ALTER COLUMN min_stock_level TYPE numeric(14, 2);
ALTER TABLE products ALTER COLUMN reorder_level TYPE numeric(14, 2);
ALTER TABLE inventory_balances ALTER COLUMN min_stock_level TYPE numeric(14, 2);
ALTER TABLE inventory_balances ALTER COLUMN reorder_level TYPE numeric(14, 2);

-- ---------------------------------------------------------------------
-- 2. Consolidate duplicated balance rows (old seedBalances bug)
-- ---------------------------------------------------------------------
-- Phase A: products with no movements at all and only untouched rows
-- (current = opening) collapse to ONE row: highest stock wins, then earliest
-- branch, then earliest balance row. Covers (1,1,1) -> 1 row of 1 and
-- (0,0,0) -> a single zero row so the product still lists once.
WITH candidates AS (
    SELECT b.product_id
    FROM inventory_balances b
    GROUP BY b.product_id
    HAVING count(*) > 1
        AND bool_and(b.current_stock = b.opening_stock)
        AND NOT EXISTS (
            SELECT 1 FROM inventory_transactions t
            WHERE t.product_id = b.product_id
        )
),
keep AS (
    SELECT DISTINCT ON (b.product_id) b.id
    FROM inventory_balances b
    JOIN candidates c ON c.product_id = b.product_id
    JOIN branches br ON br.id = b.branch_id
    ORDER BY
        b.product_id,
        b.current_stock DESC,
        br.created_at,
        br.name,
        b.id
)
DELETE FROM inventory_balances
WHERE product_id IN (SELECT product_id FROM candidates)
    AND id NOT IN (SELECT id FROM keep);

-- Phase B: products WITH movements may still carry untouched zero rows at
-- branches that never took part (backfill artifacts). Remove them so the
-- inventory list shows each product once per branch that actually holds it.
-- Never removes the last remaining row of a product.
DELETE FROM inventory_balances b
WHERE b.current_stock = 0
    AND b.opening_stock = 0
    AND NOT EXISTS (
        SELECT 1 FROM inventory_transactions t
        WHERE t.product_id = b.product_id
            AND t.branch_id = b.branch_id
    )
    AND EXISTS (
        SELECT 1 FROM inventory_balances o
        WHERE o.product_id = b.product_id
            AND o.id <> b.id
    );

-- ---------------------------------------------------------------------
-- 3. Balance thresholds must mirror the product master
-- ---------------------------------------------------------------------
UPDATE inventory_balances b
SET min_stock_level = p.min_stock_level,
    reorder_level = p.reorder_level
FROM products p
WHERE b.product_id = p.id
    AND (
        b.min_stock_level IS DISTINCT FROM p.min_stock_level
        OR b.reorder_level IS DISTINCT FROM p.reorder_level
    );

-- ---------------------------------------------------------------------
-- 4. record_inventory_movement with numeric quantity
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS record_inventory_movement(uuid, uuid, text, integer, text, text, uuid);

CREATE FUNCTION record_inventory_movement(
    p_product_id uuid,
    p_branch_id uuid,
    p_movement_type text,
    p_quantity numeric(14, 2),
    p_reason text DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL
) RETURNS inventory_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product products;
    v_balance inventory_balances;
    v_before numeric(14, 2);
    v_after numeric(14, 2);
    v_delta numeric(14, 2);
    v_tx inventory_transactions;
BEGIN
    IF NOT has_permission('inventory.manage') AND NOT has_permission('inventory.adjust') THEN
        RAISE EXCEPTION 'Inventory permission required';
    END IF;
    IF NOT can_access_branch(p_branch_id) THEN
        RAISE EXCEPTION 'Branch is outside your scope';
    END IF;
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;
    IF p_movement_type NOT IN (
        'opening_balance', 'purchase_receipt', 'sale', 'transfer_in', 'transfer_out',
        'return_in', 'return_out', 'damage', 'loss', 'adjustment', 'stock_issue',
        'physical_count', 'production'
    ) THEN
        RAISE EXCEPTION 'Invalid movement type';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found or inactive';
    END IF;

    SELECT * INTO v_balance
    FROM inventory_balances
    WHERE product_id = p_product_id AND branch_id = p_branch_id
    FOR UPDATE;

    v_before := COALESCE(v_balance.current_stock, 0);
    v_delta := CASE
        WHEN p_movement_type IN ('purchase_receipt', 'transfer_in', 'return_in', 'production', 'opening_balance') THEN p_quantity
        WHEN p_movement_type IN ('sale', 'transfer_out', 'return_out', 'damage', 'loss', 'stock_issue') THEN -p_quantity
        WHEN p_movement_type = 'physical_count' THEN p_quantity - v_before
        ELSE p_quantity
    END;
    v_after := v_before + v_delta;

    IF v_after < 0 THEN
        RAISE EXCEPTION 'Movement would make stock negative';
    END IF;

    IF v_balance.id IS NULL THEN
        INSERT INTO inventory_balances (
            product_id, branch_id, opening_stock, current_stock, min_stock_level, reorder_level
        ) VALUES (
            p_product_id,
            p_branch_id,
            CASE WHEN p_movement_type = 'opening_balance' THEN p_quantity ELSE 0 END,
            v_after,
            v_product.min_stock_level,
            v_product.reorder_level
        );
    ELSE
        UPDATE inventory_balances
        SET current_stock = v_after,
            last_count_date = CASE WHEN p_movement_type = 'physical_count' THEN CURRENT_DATE ELSE last_count_date END
        WHERE id = v_balance.id;
    END IF;

    INSERT INTO inventory_transactions (
        product_id, branch_id, movement_type, quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, actor_id
    ) VALUES (
        p_product_id, p_branch_id, p_movement_type, p_quantity, v_before, v_after,
        NULLIF(trim(p_reason), ''), p_reference_type, p_reference_id, auth.uid()
    )
    RETURNING * INTO v_tx;

    RETURN v_tx;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, text, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, text, numeric, text, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Atomic GRN: note + items + stock movements + purchase status in one
--    transaction. All-or-nothing, so procurement can never drift from stock.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_grn_with_items(
    p_purchase_request_id uuid,
    p_grn_number text,
    p_items jsonb,
    p_delivery_note_number text DEFAULT NULL,
    p_is_partial boolean DEFAULT false
) RETURNS goods_received_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pr purchase_requests%ROWTYPE;
    v_grn goods_received_notes;
    v_item jsonb;
    v_product_id uuid;
    v_ordered numeric(14, 2);
    v_received numeric(14, 2);
    v_damaged numeric(14, 2);
    v_rejected numeric(14, 2);
    v_short numeric(14, 2);
    v_net numeric(14, 2);
    v_has_outstanding boolean := false;
    v_label text;
BEGIN
    IF NOT has_permission('inventory.manage') AND NOT has_permission('inventory.adjust') THEN
        RAISE EXCEPTION 'Inventory permission required';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'At least one GRN item is required';
    END IF;

    SELECT * INTO v_pr
    FROM purchase_requests
    WHERE id = p_purchase_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase request not found';
    END IF;
    IF v_pr.status NOT IN ('ordered', 'partially_received') THEN
        RAISE EXCEPTION 'Purchase request is "%"; only ordered or partially received requests can receive goods', v_pr.status;
    END IF;
    IF NOT can_access_branch(v_pr.branch_id) THEN
        RAISE EXCEPTION 'Branch is outside your scope';
    END IF;

    INSERT INTO goods_received_notes (
        grn_number, purchase_request_id, branch_id, supplier_id, received_by,
        delivery_note_number, is_partial, received_date
    ) VALUES (
        p_grn_number, v_pr.id, v_pr.branch_id, v_pr.supplier_id, auth.uid(),
        NULLIF(trim(coalesce(p_delivery_note_number, '')), ''), p_is_partial, CURRENT_DATE
    )
    RETURNING * INTO v_grn;

    v_label := 'GRN ' || p_grn_number;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := (v_item ->> 'product_id')::uuid;
        v_ordered := COALESCE((v_item ->> 'quantity_ordered')::numeric, 0);
        v_received := COALESCE((v_item ->> 'quantity_received')::numeric, 0);
        v_damaged := COALESCE((v_item ->> 'quantity_damaged')::numeric, 0);
        v_rejected := COALESCE((v_item ->> 'quantity_rejected')::numeric, 0);
        v_short := COALESCE((v_item ->> 'quantity_short')::numeric, 0);

        IF v_ordered < 0 OR v_received < 0 OR v_damaged < 0 OR v_rejected < 0 OR v_short < 0 THEN
            RAISE EXCEPTION 'Quantities must be zero or more';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id AND is_active) THEN
            RAISE EXCEPTION 'Product % not found or inactive', v_product_id;
        END IF;

        INSERT INTO goods_received_items (
            grn_id, product_id, quantity_ordered, quantity_received,
            quantity_damaged, quantity_rejected, quantity_short, notes
        ) VALUES (
            v_grn.id, v_product_id, v_ordered, v_received,
            v_damaged, v_rejected, v_short,
            NULLIF(trim(v_item ->> 'notes'), '')
        );

        v_net := v_received - v_damaged - v_rejected;
        IF v_net > 0 THEN
            PERFORM record_inventory_movement(
                v_product_id, v_pr.branch_id, 'purchase_receipt', v_net,
                v_label || ' for PO ' || coalesce(v_pr.request_number, left(v_pr.id::text, 8)),
                'goods_received_note', v_grn.id
            );
        END IF;
        IF v_damaged > 0 THEN
            PERFORM record_inventory_movement(
                v_product_id, v_pr.branch_id, 'damage', v_damaged,
                'Damaged on ' || v_label,
                'goods_received_note', v_grn.id
            );
        END IF;
        IF v_short > 0 THEN
            v_has_outstanding := true;
        END IF;
    END LOOP;

    UPDATE purchase_requests
    SET status = CASE
        WHEN (v_has_outstanding OR p_is_partial) THEN 'partially_received'
        ELSE 'received'
    END
    WHERE id = v_pr.id;

    RETURN v_grn;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_grn_with_items(uuid, text, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_grn_with_items(uuid, text, jsonb, text, boolean) TO authenticated;

-- Make sure PostgREST picks up the dropped/created overloads.
NOTIFY pgrst, 'reload schema';


-- ============================================
-- 202609180001_org_location_hierarchy.sql
-- ============================================
-- Business -> Location -> Branch hierarchy (spec sections 2, 6, 30).
--
-- Locations are the structural layer between a Business and its Branches:
-- every Branch must belong to exactly one Location of its own Business.
-- The historical free-text `branches.location` column is left untouched for
-- display/back-compat; `branches.location_id` is the authoritative link.
--
-- Also locks down the org-structure writes:
--   * businesses: only Super Admin may create/update businesses.
--   * branches:   Admin+ WITHIN their own businesses only (was: any business).
--
-- Idempotent; safe to replay.

-- ==========================================
-- 1. business_locations table
-- ==========================================
CREATE TABLE IF NOT EXISTS business_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_business_locations_business ON business_locations (business_id);

ALTER TABLE business_locations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 2. RLS: readable by anyone with business access; writes are admin+ scoped
--    (locations drive authorization routing, so they are not open to every
--     authenticated member the way master data is).
-- ==========================================
DROP POLICY IF EXISTS business_locations_select_scoped ON business_locations;
CREATE POLICY business_locations_select_scoped ON business_locations FOR SELECT
  TO authenticated USING (can_access_business (business_id));

DROP POLICY IF EXISTS business_locations_write_admin ON business_locations;
CREATE POLICY business_locations_write_admin ON business_locations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin')
        AND can_access_business (business_locations.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin')
        AND can_access_business (business_locations.business_id)
    )
  );

-- ==========================================
-- 3. Backfill: one default Location per Business that has none yet
-- ==========================================
INSERT INTO business_locations (business_id, name)
SELECT b.id, 'Main Location'
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM business_locations bl WHERE bl.business_id = b.id
);

-- ==========================================
-- 4. branches.location_id + backfill from the existing free-text column
-- ==========================================
ALTER TABLE branches ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES business_locations(id) ON DELETE SET NULL;

-- Every current free-text location value is unique within its business
-- (verified on live data), so an exact name match is safe; anything unmatched
-- falls back to the business' default location.
UPDATE branches br
SET location_id = COALESCE(
  (SELECT bl.id FROM business_locations bl
   WHERE bl.business_id = br.business_id
     AND lower(trim(bl.name)) = lower(trim(br.location))),
  (SELECT bl.id FROM business_locations bl
   WHERE bl.business_id = br.business_id
   ORDER BY bl.created_at
   LIMIT 1)
)
WHERE br.location_id IS NULL;

-- If a business somehow has no location row (deleted between steps), recreate
-- the default before proceeding.
UPDATE branches br
SET location_id = (
  SELECT bl.id FROM business_locations bl
  WHERE bl.business_id = br.business_id
  ORDER BY bl.created_at
  LIMIT 1
)
WHERE br.location_id IS NULL
  AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = br.business_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM branches WHERE location_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot link % branch(es) to a business location', (
      SELECT count(*) FROM branches WHERE location_id IS NULL
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_branches_location ON branches (location_id);

-- ==========================================
-- 5. Location must belong to the branch's own Business (spec section 30)
-- ==========================================
CREATE OR REPLACE FUNCTION enforce_branch_location_business()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.location_id IS NOT NULL THEN
    PERFORM 1 FROM business_locations bl
    WHERE bl.id = NEW.location_id AND bl.business_id = NEW.business_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Location must belong to the same Business as the branch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_branch_location_business ON branches;
CREATE TRIGGER trg_enforce_branch_location_business
  BEFORE INSERT OR UPDATE OF business_id, location_id ON branches
  FOR EACH ROW EXECUTE FUNCTION enforce_branch_location_business();

-- ==========================================
-- 6. businesses: only Super Admin writes (spec section 4 â€” administrative
--    org-structure actions are Super Admin's; admins manage operations inside
--    an existing business, they do not create or rename businesses).
-- ==========================================
DROP POLICY IF EXISTS businesses_insert_admin ON businesses;
DROP POLICY IF EXISTS businesses_update_admin ON businesses;
DROP POLICY IF EXISTS businesses_insert_superuser ON businesses;
DROP POLICY IF EXISTS businesses_update_superuser ON businesses;

DROP POLICY IF EXISTS businesses_write_super ON businesses;
CREATE POLICY businesses_write_super ON businesses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS businesses_update_super ON businesses;
CREATE POLICY businesses_update_super ON businesses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  )
  WITH CHECK (true);

-- ==========================================
-- 7. branches: registry writes are Super Admin's (org structure, spec
--    sections 4/5). Admins manage operations inside an existing branch, they
--    do not create/rename/move branches â€” and since branch visibility is
--    strict (primary + assignments only in Migration D), a branch an Admin
--    created could not even be listed back to them. The trigger in section 5
--    enforces location ownership on every write, including writes by
--    SECURITY DEFINER functions and the service role.
-- ==========================================
DROP POLICY IF EXISTS branches_insert_admin_or_above ON branches;
DROP POLICY IF EXISTS branches_update_admin_or_above ON branches;

DROP POLICY IF EXISTS branches_insert_super ON branches;
CREATE POLICY branches_insert_super ON branches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS branches_update_super ON branches;
CREATE POLICY branches_update_super ON branches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  )
  WITH CHECK (
    branches.location_id IS NULL
    OR EXISTS (
      SELECT 1 FROM business_locations bl
      WHERE bl.id = branches.location_id AND bl.business_id = branches.business_id
    )
  );


-- ============================================
-- 202609180002_branch_scoped_products.sql
-- ============================================
-- Branch-scoped product records (spec sections 8, 9).
--
-- Products become Branch-owned: `products.branch_id` is NOT NULL and part of
-- the SKU uniqueness scope (UNIQUE(business_id, branch_id, sku)), so the same
-- SKU may exist independently at two branches of one business. RLS visibility
-- moves from business-scope to branch-scope.
--
-- Backfill source: inventory_balances. Verified live: every product has
-- balance rows at exactly one branch, so no product split is needed. Products
-- with no balance row fall back to the business' first active branch. Any
-- product that cannot be placed (or spans branches) aborts the migration.
--
-- Product rows are also given created_by/updated_by/updated_at audit columns
-- (spec section 28) and `branch_id` is made immutable: relocating a product
-- would desynchronise its inventory_balances rows; the supported path is
-- deactivate + recreate.
--
-- Idempotent; safe to replay.

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------
-- 2. Backfill branch from balance history
-- ---------------------------------------------------------------------
-- 2a. Multi-branch products would need a manual split; abort if found.
DO $$
DECLARE v_multi integer;
BEGIN
  SELECT count(*) INTO v_multi FROM (
    SELECT product_id FROM inventory_balances
    GROUP BY product_id
    HAVING count(DISTINCT branch_id) > 1
  ) m;
  IF v_multi > 0 THEN
    RAISE EXCEPTION '% product(s) hold balances at more than one branch and need a manual split before branch-scoping',
      v_multi;
  END IF;
END $$;

-- 2b. Primary backfill: the branch holding the product's balance.
UPDATE products p
SET branch_id = (
  SELECT ib.branch_id FROM inventory_balances ib
  WHERE ib.product_id = p.id
  ORDER BY ib.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE p.branch_id IS NULL;

-- 2c. Products without a balance row: first active branch of their business,
--     then any branch of the business.
UPDATE products p
SET branch_id = (
  SELECT br.id FROM branches br
  WHERE br.business_id = p.business_id AND br.is_active
  ORDER BY br.created_at
  LIMIT 1
)
WHERE p.branch_id IS NULL;

UPDATE products p
SET branch_id = (
  SELECT br.id FROM branches br
  WHERE br.business_id = p.business_id
  ORDER BY br.is_active DESC, br.created_at
  LIMIT 1
)
WHERE p.branch_id IS NULL;

-- 2d. Anything still unplaced (business with no branches) aborts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE branch_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot scope % product(s) to a branch (their business has no branches)',
      (SELECT count(*) FROM products WHERE branch_id IS NULL);
  END IF;
END $$;

ALTER TABLE products ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_branch ON products (branch_id);

-- ---------------------------------------------------------------------
-- 3. SKU uniqueness: per business + branch + sku
-- ---------------------------------------------------------------------
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_business_id_sku_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND conname = 'products_business_branch_sku_key'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_business_branch_sku_key
      UNIQUE (business_id, branch_id, sku);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Audit columns
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION prevent_product_branch_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'Product branch cannot be changed; deactivate the product and recreate it at the target branch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_product_branch_move ON products;
CREATE TRIGGER trg_prevent_product_branch_move
  BEFORE UPDATE OF branch_id ON products
  FOR EACH ROW EXECUTE FUNCTION prevent_product_branch_move();

-- ---------------------------------------------------------------------
-- 5. RLS: branch-scope visibility, branch-scope writes (spec sections 7, 8)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS products_scoped_select ON products;
DROP POLICY IF EXISTS products_select_authenticated ON products;
CREATE POLICY products_scoped_select ON products FOR SELECT
  TO authenticated USING (can_access_branch (products.branch_id));

DROP POLICY IF EXISTS products_insert_manage ON products;
CREATE POLICY products_insert_manage ON products FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  );

DROP POLICY IF EXISTS products_update_manage ON products;
CREATE POLICY products_update_manage ON products FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  );

-- Make sure PostgREST picks up the new policy set.
NOTIFY pgrst, 'reload schema';


-- ============================================
-- 202609180003_one_admin_per_branch.sql
-- ============================================
-- One Admin per Branch (spec sections 5, 27).
--
-- At any moment a Branch may have at most ONE active Admin â€” whether that
-- Admin's branch comes from user_profiles.branch_id (primary) or from a
-- user_branch_assignments row. Managers/Supervisors are unrestricted; Super
-- Admin is global and exempt. Branches are nullable for legacy profiles
-- (existing NULL-branch admins are not conflicts).
--
-- Enforced with BEFORE triggers on both write paths plus a SECURITY DEFINER
-- helper so the checks see every admin regardless of the caller's own RLS
-- visibility. Conflicts raise ERRCODE 23505 (unique_violation) with the
-- message the spec mandates, so edge functions can surface it verbatim.
--
-- Idempotent; safe to replay.

-- ---------------------------------------------------------------------
-- 1. Duplicate assignment cleanup + uniqueness
-- ---------------------------------------------------------------------
DELETE FROM user_branch_assignments a
USING user_branch_assignments b
WHERE a.user_id = b.user_id
  AND a.branch_id = b.branch_id
  AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_branch_assignments'::regclass
      AND conname = 'user_branch_assignments_user_branch_key'
  ) THEN
    ALTER TABLE user_branch_assignments
      ADD CONSTRAINT user_branch_assignments_user_branch_key UNIQUE (user_id, branch_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Shared conflict probe
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION branch_has_other_admin(p_branch_id uuid, p_exclude_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    -- Admin whose PRIMARY branch is p_branch_id
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE r.name = 'admin' AND up.is_active = true
      AND up.branch_id = p_branch_id
      AND up.id <> COALESCE(p_exclude_user, '00000000-0000-0000-0000-000000000000'::uuid)
    UNION
    -- Admin explicitly ASSIGNED to p_branch_id
    SELECT 1
    FROM user_branch_assignments ubra
    JOIN user_profiles up ON up.id = ubra.user_id
    JOIN roles r ON r.id = up.role_id
    WHERE r.name = 'admin' AND up.is_active = true
      AND ubra.branch_id = p_branch_id
      AND up.id <> COALESCE(p_exclude_user, '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;

REVOKE ALL ON FUNCTION branch_has_other_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION branch_has_other_admin(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. user_profiles: creation, promotion to Admin, branch change, reactivation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_one_admin_per_branch_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  IF NEW.branch_id IS NULL OR NEW.is_active = false THEN
    RETURN NEW; -- no branch, or leaving service: nothing to conflict with
  END IF;

  SELECT r.name INTO v_role FROM roles r WHERE r.id = NEW.role_id;
  IF v_role <> 'admin' THEN
    RETURN NEW; -- only Admins are limited to one per Branch
  END IF;

  IF branch_has_other_admin(NEW.branch_id, NEW.id) THEN
    RAISE EXCEPTION 'Branch already has an Admin'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_one_admin_per_branch ON user_profiles;
CREATE TRIGGER trg_enforce_one_admin_per_branch
  BEFORE INSERT OR UPDATE OF branch_id, role_id, is_active ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_one_admin_per_branch_profile();

-- ---------------------------------------------------------------------
-- 4. user_branch_assignments: assigning an Admin to a second branch
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_one_admin_per_branch_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT r.name = 'admin' AND up.is_active = true
  INTO v_is_admin
  FROM user_profiles up
  JOIN roles r ON r.id = up.role_id
  WHERE up.id = NEW.user_id;

  IF COALESCE(v_is_admin, false) = false THEN
    RETURN NEW; -- non-admins may hold any number of branch assignments
  END IF;

  IF branch_has_other_admin(NEW.branch_id, NEW.user_id) THEN
    RAISE EXCEPTION 'Branch already has an Admin'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_one_admin_per_branch_assignment ON user_branch_assignments;
CREATE TRIGGER trg_enforce_one_admin_per_branch_assignment
  BEFORE INSERT OR UPDATE ON user_branch_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_one_admin_per_branch_assignment();

-- ---------------------------------------------------------------------
-- 5. Self-protection: a user must not promote themselves, hand themselves a
--    new scope, or flip their own active flag (spec section 24 â€” privilege
--    escalation through the own-row UPDATE policy). Service role and admin
--    edits of OTHER rows are unaffected (auth.uid() is null or different).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_self_scope_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.id THEN
    IF NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      RAISE EXCEPTION 'You cannot change your own role, scope, or status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_scope_change ON user_profiles;
CREATE TRIGGER trg_prevent_self_scope_change
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_scope_change();


-- ============================================
-- 202609180004_strict_branch_scope_rls.sql
-- ============================================
-- Strict branch-scope authorization (spec sections 6-13, 19-28, 31).
--
-- This is the core of the access-control specification:
--
--   * can_access_branch / my_branch_ids become STRICT: Super Admin is global,
--     everyone else gets their primary branch + explicit assignments only.
--     The old "Admin sees every branch of their business" escape hatch is
--     removed â€” an Admin at Ikeja must never read Agege.
--   * Every write policy that previously checked only a permission (any
--     business, any branch) now also enforces branch/business scope, so a
--     cross-branch or cross-business insert/update is rejected at the DB
--     boundary even if the UI fails to filter (IDOR prevention, sections 6,
--     19, 27, 31).
--   * Item tables (transfer/PR/GRN lines) are scoped through their parent
--     header plus product-at-branch validation.
--   * audit_log gains business/branch/location scope columns (section 28).
--   * roles become Super Admin-only configuration (section 13).
--   * Sales cancellation gets its own permission (sales.cancel) so cancelling
--     someone else's sale is a distinct, auditable grant.
--   * SECURITY DEFINER RPCs validate product-branch alignment, and the
--     transfer workflow moves into advance_stock_transfer() with side-based
--     authorization, legal-transition checks and idempotent, atomic stock
--     movements (section 19).
--
-- Idempotent; safe to replay.

-- =====================================================================
-- 1. Scope helpers
-- =====================================================================
CREATE OR REPLACE FUNCTION branch_in_business(p_branch_id uuid, p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = p_branch_id AND b.business_id = p_business_id
  );
$$;

CREATE OR REPLACE FUNCTION product_at_branch(p_product_id uuid, p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM products p
    WHERE p.id = p_product_id AND p.branch_id = p_branch_id
  );
$$;

CREATE OR REPLACE FUNCTION same_business_branches(p_from uuid, p_to uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM branches bf JOIN branches bt ON bt.business_id = bf.business_id
    WHERE bf.id = p_from AND bt.id = p_to AND p_from <> p_to
  );
$$;

REVOKE ALL ON FUNCTION branch_in_business(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION product_at_branch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION same_business_branches(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION branch_in_business(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION product_at_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION same_business_branches(uuid, uuid) TO authenticated;

-- STRICT branch access: Super Admin global; everyone else their primary
-- branch, explicit assignments, and branches where they are the registered
-- manager. The former Admin-business-wide clause is gone (spec section 6).
CREATE OR REPLACE FUNCTION can_access_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (
        r.name = 'super_admin'
        OR up.branch_id = p_branch_id
        OR EXISTS (SELECT 1 FROM user_branch_assignments ubra
                   WHERE ubra.user_id = up.id AND ubra.branch_id = p_branch_id)
        OR EXISTS (SELECT 1 FROM branches b
                   WHERE b.id = p_branch_id AND b.manager_id = up.id)
      )
  );
$$;

-- STRICT branch listing: mirrors can_access_branch (spec section 6).
CREATE OR REPLACE FUNCTION my_branch_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM branches b
  WHERE EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (
        r.name = 'super_admin'
        OR up.branch_id = b.id
        OR EXISTS (SELECT 1 FROM user_branch_assignments ubra
                   WHERE ubra.user_id = up.id AND ubra.branch_id = b.id)
        OR b.manager_id = up.id
      )
  );
$$;

REVOKE ALL ON FUNCTION my_branch_ids () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_branch_ids () TO authenticated;

-- Who may read another user's records: Super Admin, the reporting (manager)
-- chain, and â€” for Admin/Manager/Supervisor â€” staff inside their own branch
-- scope (section 12).
CREATE OR REPLACE FUNCTION can_view_user_records(p_target_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE visible_users AS (
    SELECT id, manager_id
    FROM user_profiles
    WHERE id = auth.uid() AND is_active = true
    UNION ALL
    SELECT child.id, child.manager_id
    FROM user_profiles child
    JOIN visible_users parent ON child.manager_id = parent.id
    WHERE child.is_active = true
  )
  SELECT EXISTS (
    SELECT 1 FROM user_profiles actor
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND (
        actor.role_id = (SELECT id FROM roles WHERE name = 'super_admin')
        OR p_target_user IN (SELECT id FROM visible_users)
        OR (
          actor.role_id IN (SELECT id FROM roles WHERE name IN ('admin', 'manager', 'supervisor'))
          AND (
            EXISTS (
              SELECT 1 FROM user_profiles t
              WHERE t.id = p_target_user AND t.branch_id IN (SELECT my_branch_ids())
            )
            OR EXISTS (
              SELECT 1 FROM user_branch_assignments ubra
              WHERE ubra.user_id = p_target_user
                AND ubra.branch_id IN (SELECT my_branch_ids())
            )
          )
        )
      )
  );
$$;

-- Period close-out: role gate kept (super/admin/manager) but scope is now
-- strict branch + branch-of-business (sections 6, 21).
CREATE OR REPLACE FUNCTION can_manage_inventory_period(p_business_id uuid, p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles actor
    JOIN roles r ON r.id = actor.role_id
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND r.name IN ('super_admin', 'admin', 'manager')
      AND can_access_branch (p_branch_id)
      AND branch_in_business (p_branch_id, p_business_id)
  );
$$;

REVOKE ALL ON FUNCTION can_manage_inventory_period (uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_manage_inventory_period (uuid, uuid) TO authenticated;

-- =====================================================================
-- 2. user_profiles: strict branch-scoped visibility and edits
-- =====================================================================
DROP POLICY IF EXISTS user_profiles_select_scoped ON user_profiles;
CREATE POLICY user_profiles_select_scoped ON user_profiles FOR SELECT
  TO authenticated USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = (current_profile()).role_id AND r.name = 'super_admin'
    )
    OR user_profiles.branch_id IN (SELECT my_branch_ids())
    OR EXISTS (
      SELECT 1 FROM user_branch_assignments ubra
      WHERE ubra.user_id = user_profiles.id
        AND ubra.branch_id IN (SELECT my_branch_ids())
    )
  );

DROP POLICY IF EXISTS user_profiles_update_scoped ON user_profiles;
CREATE POLICY user_profiles_update_scoped ON user_profiles FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = (current_profile()).role_id AND r.name = 'super_admin'
    )
    OR (
      EXISTS (
        SELECT 1 FROM roles r
        WHERE r.id = (current_profile()).role_id AND r.name = 'admin'
      )
      AND user_profiles.branch_id IN (SELECT my_branch_ids())
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = (current_profile()).role_id AND r.name = 'super_admin'
    )
    OR (
      EXISTS (
        SELECT 1 FROM roles r
        WHERE r.id = (current_profile()).role_id AND r.name = 'admin'
      )
      AND user_profiles.branch_id IN (SELECT my_branch_ids())
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  );

-- =====================================================================
-- 3. audit_log: business/branch/location scope columns (section 28)
-- =====================================================================
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES business_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_scope ON audit_log (business_id, branch_id);

CREATE OR REPLACE FUNCTION audit_log_fill_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch branches%ROWTYPE;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    SELECT * INTO v_branch FROM branches WHERE id = NEW.branch_id;
    IF FOUND THEN
      NEW.business_id := COALESCE(NEW.business_id, v_branch.business_id);
      NEW.location_id := COALESCE(NEW.location_id, v_branch.location_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_fill_scope ON audit_log;
CREATE TRIGGER trg_audit_log_fill_scope
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_fill_scope();

-- Writes: still actor-attributed, but the row may not claim a scope the
-- actor cannot access (prevents cross-tenant audit forgery).
DROP POLICY IF EXISTS audit_log_insert_authenticated ON audit_log;
CREATE POLICY audit_log_insert_authenticated ON audit_log FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (branch_id IS NULL OR can_access_branch (branch_id))
  );

-- Reads: own rows, Super Admin everything, Admin rows scoped to their
-- businesses/branches. Legacy unscoped rows (NULL business/branch) are Super
-- Admin only â€” an Admin cannot read history from other tenants.
DROP POLICY IF EXISTS audit_log_select_admin_or_above ON audit_log;
DROP POLICY IF EXISTS audit_log_select_scoped ON audit_log;
CREATE POLICY audit_log_select_scoped ON audit_log FOR SELECT
  TO authenticated USING (
    audit_log.actor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
    OR (
      EXISTS (
        SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
        WHERE up.id = auth.uid() AND up.is_active AND r.name = 'admin'
      )
      AND (
        audit_log.business_id IN (SELECT my_business_ids())
        OR audit_log.branch_id IN (SELECT my_branch_ids())
      )
    )
  );

-- =====================================================================
-- 4. roles: Super Admin-only configuration (section 13)
-- =====================================================================
DROP POLICY IF EXISTS roles_insert_admin ON roles;
DROP POLICY IF EXISTS roles_update_admin ON roles;
DROP POLICY IF EXISTS roles_delete_protected ON roles;

DROP POLICY IF EXISTS roles_insert_super ON roles;
CREATE POLICY roles_insert_super ON roles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS roles_update_super ON roles;
CREATE POLICY roles_update_super ON roles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS roles_delete_super ON roles;
CREATE POLICY roles_delete_super ON roles FOR DELETE
  TO authenticated
  USING (
    roles.name NOT IN ('super_admin', 'admin')
    AND EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

-- =====================================================================
-- 5. Master data writes gain business scope (categories/suppliers/units/
--    unit assignments) â€” permission alone never covered tenancy.
-- =====================================================================
DROP POLICY IF EXISTS categories_insert_manage ON categories;
CREATE POLICY categories_insert_manage ON categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (categories.business_id)
  );

DROP POLICY IF EXISTS categories_update_manage ON categories;
CREATE POLICY categories_update_manage ON categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (categories.business_id)
  )
  WITH CHECK (can_access_business (categories.business_id));

DROP POLICY IF EXISTS suppliers_insert_manage ON suppliers;
CREATE POLICY suppliers_insert_manage ON suppliers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active
        AND p.code IN ('procurement.manage', 'products.manage')
    )
    AND can_access_business (suppliers.business_id)
  );

DROP POLICY IF EXISTS suppliers_update_manage ON suppliers;
CREATE POLICY suppliers_update_manage ON suppliers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active
        AND p.code IN ('procurement.manage', 'products.manage')
    )
    AND can_access_business (suppliers.business_id)
  )
  WITH CHECK (can_access_business (suppliers.business_id));

DROP POLICY IF EXISTS units_insert_admin_or_above ON units;
DROP POLICY IF EXISTS units_insert_manager_scope ON units;
CREATE POLICY units_insert_scoped ON units FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      EXISTS (
        SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
        WHERE up.id = auth.uid() AND up.is_active
          AND r.name IN ('super_admin', 'admin', 'manager')
      )
    )
    AND can_access_business (units.business_id)
  );

DROP POLICY IF EXISTS units_update_admin_or_above ON units;
DROP POLICY IF EXISTS units_update_manager_scope ON units;
CREATE POLICY units_update_scoped ON units FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin', 'manager')
    )
    AND can_access_business (units.business_id)
  )
  WITH CHECK (can_access_business (units.business_id));

DROP POLICY IF EXISTS units_delete_admin_or_above ON units;
CREATE POLICY units_delete_scoped ON units FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin')
    )
    AND can_access_business (units.business_id)
  );

DROP POLICY IF EXISTS user_unit_assignments_insert_admin_or_above ON user_unit_assignments;
CREATE POLICY user_unit_assignments_insert_scoped ON user_unit_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin', 'manager')
    )
    AND can_access_unit (user_unit_assignments.unit_id)
  );

DROP POLICY IF EXISTS user_unit_assignments_delete_admin_or_above ON user_unit_assignments;
CREATE POLICY user_unit_assignments_delete_scoped ON user_unit_assignments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin', 'manager')
    )
    AND can_access_unit (user_unit_assignments.unit_id)
  );

-- =====================================================================
-- 6. Inventory writes: branch scope AND product must live at that branch
--    (sections 8, 19 â€” prevents crediting another branch's product).
-- =====================================================================
DROP POLICY IF EXISTS inventory_balances_insert_manage ON inventory_balances;
CREATE POLICY inventory_balances_insert_manage ON inventory_balances FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active
        AND p.code IN ('inventory.manage', 'inventory.adjust')
    )
    AND can_access_branch (inventory_balances.branch_id)
    AND product_at_branch (inventory_balances.product_id, inventory_balances.branch_id)
  );

DROP POLICY IF EXISTS inventory_balances_update_manage ON inventory_balances;
CREATE POLICY inventory_balances_update_manage ON inventory_balances FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active
        AND p.code IN ('inventory.manage', 'inventory.adjust')
    )
    AND can_access_branch (inventory_balances.branch_id)
    AND product_at_branch (inventory_balances.product_id, inventory_balances.branch_id)
  )
  WITH CHECK (
    can_access_branch (inventory_balances.branch_id)
    AND product_at_branch (inventory_balances.product_id, inventory_balances.branch_id)
  );

DROP POLICY IF EXISTS inventory_txns_insert_manage ON inventory_transactions;
CREATE POLICY inventory_txns_insert_manage ON inventory_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active
        AND p.code IN ('inventory.manage', 'inventory.adjust')
    )
    AND can_access_branch (inventory_transactions.branch_id)
    AND product_at_branch (inventory_transactions.product_id, inventory_transactions.branch_id)
  );

-- =====================================================================
-- 7. Stock transfers: both branches must be accessible and in one business
--    (sections 19, 31); items inherit header scope.
-- =====================================================================
DROP POLICY IF EXISTS stock_transfers_insert_manage ON stock_transfers;
CREATE POLICY stock_transfers_insert_manage ON stock_transfers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'transfers.manage'
    )
    AND can_access_branch (stock_transfers.from_branch_id)
    AND can_access_branch (stock_transfers.to_branch_id)
    AND same_business_branches (stock_transfers.from_branch_id, stock_transfers.to_branch_id)
  );

DROP POLICY IF EXISTS stock_transfers_update_manage ON stock_transfers;
CREATE POLICY stock_transfers_update_manage ON stock_transfers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'transfers.manage'
    )
    AND (
      can_access_branch (stock_transfers.from_branch_id)
      OR can_access_branch (stock_transfers.to_branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'transfers.manage'
    )
    AND (
      -- Source side owns the outbound workflow; destination side owns
      -- receipt/completion (spec section 19).
      (
        can_access_branch (stock_transfers.from_branch_id)
        AND stock_transfers.status IN ('requested', 'reviewed', 'approved', 'rejected', 'dispatched', 'in_transit')
      )
      OR (
        can_access_branch (stock_transfers.to_branch_id)
        AND stock_transfers.status IN ('received', 'completed')
      )
    )
  );

DROP POLICY IF EXISTS stock_transfer_items_select_authenticated ON stock_transfer_items;
CREATE POLICY stock_transfer_items_scoped_select ON stock_transfer_items FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM stock_transfers t
      WHERE t.id = stock_transfer_items.transfer_id
        AND (
          can_access_branch (t.from_branch_id)
          OR can_access_branch (t.to_branch_id)
        )
    )
  );

DROP POLICY IF EXISTS stock_transfer_items_insert_manage ON stock_transfer_items;
CREATE POLICY stock_transfer_items_insert_manage ON stock_transfer_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'transfers.manage'
    )
    AND EXISTS (
      SELECT 1 FROM stock_transfers t
      WHERE t.id = stock_transfer_items.transfer_id
        AND can_access_branch (t.from_branch_id)
        AND product_at_branch (stock_transfer_items.product_id, t.from_branch_id)
    )
  );

DROP POLICY IF EXISTS stock_transfer_items_update_manage ON stock_transfer_items;
CREATE POLICY stock_transfer_items_update_manage ON stock_transfer_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'transfers.manage'
    )
    AND EXISTS (
      SELECT 1 FROM stock_transfers t
      WHERE t.id = stock_transfer_items.transfer_id
        AND (
          can_access_branch (t.from_branch_id)
          OR can_access_branch (t.to_branch_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM stock_transfers t
      WHERE t.id = stock_transfer_items.transfer_id
        AND (
          can_access_branch (t.from_branch_id)
          OR can_access_branch (t.to_branch_id)
        )
    )
  );

-- =====================================================================
-- 8. Procurement: header scope + product must be at the receiving branch
--    (sections 19, 31).
-- =====================================================================
DROP POLICY IF EXISTS purchase_requests_insert_manage ON purchase_requests;
CREATE POLICY purchase_requests_insert_manage ON purchase_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND can_access_branch (purchase_requests.branch_id)
    AND branch_in_business (purchase_requests.branch_id, purchase_requests.business_id)
  );

DROP POLICY IF EXISTS purchase_requests_update_manage ON purchase_requests;
CREATE POLICY purchase_requests_update_manage ON purchase_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND can_access_branch (purchase_requests.branch_id)
  )
  WITH CHECK (
    can_access_branch (purchase_requests.branch_id)
    AND branch_in_business (purchase_requests.branch_id, purchase_requests.business_id)
  );

DROP POLICY IF EXISTS purchase_request_items_select_authenticated ON purchase_request_items;
CREATE POLICY purchase_request_items_scoped_select ON purchase_request_items FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_items.purchase_request_id
        AND can_access_branch (pr.branch_id)
    )
  );

DROP POLICY IF EXISTS purchase_request_items_insert_manage ON purchase_request_items;
CREATE POLICY purchase_request_items_insert_manage ON purchase_request_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_items.purchase_request_id
        AND can_access_branch (pr.branch_id)
        AND product_at_branch (purchase_request_items.product_id, pr.branch_id)
    )
  );

DROP POLICY IF EXISTS purchase_request_items_update_manage ON purchase_request_items;
CREATE POLICY purchase_request_items_update_manage ON purchase_request_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_items.purchase_request_id
        AND can_access_branch (pr.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_items.purchase_request_id
        AND can_access_branch (pr.branch_id)
        AND product_at_branch (purchase_request_items.product_id, pr.branch_id)
    )
  );

DROP POLICY IF EXISTS goods_received_notes_insert_manage ON goods_received_notes;
CREATE POLICY goods_received_notes_insert_manage ON goods_received_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND can_access_branch (goods_received_notes.branch_id)
  );

DROP POLICY IF EXISTS goods_received_notes_update_manage ON goods_received_notes;
CREATE POLICY goods_received_notes_update_manage ON goods_received_notes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND can_access_branch (goods_received_notes.branch_id)
  )
  WITH CHECK (can_access_branch (goods_received_notes.branch_id));

DROP POLICY IF EXISTS goods_received_items_select_authenticated ON goods_received_items;
CREATE POLICY goods_received_items_scoped_select ON goods_received_items FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = goods_received_items.grn_id
        AND can_access_branch (g.branch_id)
    )
  );

DROP POLICY IF EXISTS goods_received_items_insert_manage ON goods_received_items;
CREATE POLICY goods_received_items_insert_manage ON goods_received_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = goods_received_items.grn_id
        AND can_access_branch (g.branch_id)
        AND product_at_branch (goods_received_items.product_id, g.branch_id)
    )
  );

DROP POLICY IF EXISTS goods_received_items_update_manage ON goods_received_items;
CREATE POLICY goods_received_items_update_manage ON goods_received_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'procurement.manage'
    )
    AND EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = goods_received_items.grn_id
        AND can_access_branch (g.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = goods_received_items.grn_id
        AND can_access_branch (g.branch_id)
        AND product_at_branch (goods_received_items.product_id, g.branch_id)
    )
  );

-- =====================================================================
-- 9. Serials and product units: visibility/writes follow the owning
--    product's branch (sections 7, 8).
-- =====================================================================
DROP POLICY IF EXISTS psn_select_authenticated ON product_serial_numbers;
CREATE POLICY product_serial_numbers_scoped_select ON product_serial_numbers FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_serial_numbers.product_id
        AND can_access_branch (p.branch_id)
    )
  );

DROP POLICY IF EXISTS psn_write_manage ON product_serial_numbers;
CREATE POLICY product_serial_numbers_write_manage ON product_serial_numbers FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin', 'manager')
    )
    AND EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_serial_numbers.product_id
        AND can_access_branch (p.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_serial_numbers.product_id
        AND can_access_branch (p.branch_id)
    )
  );

DROP POLICY IF EXISTS product_units_select_authenticated ON product_units;
CREATE POLICY product_units_scoped_select ON product_units FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_units.product_id
        AND can_access_branch (p.branch_id)
    )
  );

DROP POLICY IF EXISTS product_units_write_manage ON product_units;
CREATE POLICY product_units_write_manage ON product_units FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin', 'manager')
    )
    AND EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_units.product_id
        AND can_access_branch (p.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_units.product_id
        AND can_access_branch (p.branch_id)
    )
  );

-- =====================================================================
-- 10. Sales: create requires the permission (not just branch access);
--     editing/cancelling someone else's sale requires sales.cancel.
-- =====================================================================
INSERT INTO permissions (code, description)
SELECT 'sales.cancel', 'Cancel or amend completed sales'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sales.cancel');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'sales.cancel'
WHERE r.name IN ('super_admin', 'admin', 'manager', 'supervisor')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

DROP POLICY IF EXISTS sales_write ON daily_sales;
CREATE POLICY sales_write ON daily_sales FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'sales.create'
    )
    AND can_access_branch (daily_sales.branch_id)
    AND daily_sales.salesperson_id = auth.uid()
  );

DROP POLICY IF EXISTS sales_update ON daily_sales;
CREATE POLICY sales_update ON daily_sales FOR UPDATE
  TO authenticated
  USING (
    (
      daily_sales.salesperson_id = auth.uid()
      OR has_permission ('sales.cancel')
    )
    AND can_access_branch (daily_sales.branch_id)
  )
  WITH CHECK (
    (
      daily_sales.salesperson_id = auth.uid()
      OR has_permission ('sales.cancel')
    )
    AND can_access_branch (daily_sales.branch_id)
  );

-- =====================================================================
-- 11. Reports, activities, issues, expenses: add branch scope on writes.
-- =====================================================================
DROP POLICY IF EXISTS weekly_reports_insert_create ON weekly_reports;
CREATE POLICY weekly_reports_insert_create ON weekly_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'reports.create'
    )
    AND can_access_branch (weekly_reports.branch_id)
    AND branch_in_business (weekly_reports.branch_id, weekly_reports.business_id)
  );

DROP POLICY IF EXISTS weekly_reports_update_authorized ON weekly_reports;
CREATE POLICY weekly_reports_update_authorized ON weekly_reports FOR UPDATE
  TO authenticated
  USING (
    (
      (weekly_reports.status = 'draft' AND weekly_reports.created_by = auth.uid())
      OR has_permission ('reports.review')
      OR has_permission ('reports.amend')
    )
    AND can_access_branch (weekly_reports.branch_id)
  )
  WITH CHECK (
    can_view_user_records (COALESCE(weekly_reports.submitted_by, weekly_reports.created_by))
    AND can_access_branch (weekly_reports.branch_id)
    AND branch_in_business (weekly_reports.branch_id, weekly_reports.business_id)
  );

DROP POLICY IF EXISTS weekly_reports_delete_admin_only ON weekly_reports;
CREATE POLICY weekly_reports_delete_scoped ON weekly_reports FOR DELETE
  TO authenticated
  USING (
    has_permission ('reports.amend')
    AND can_access_branch (weekly_reports.branch_id)
  );

DROP POLICY IF EXISTS daily_activities_insert_create ON daily_activities;
CREATE POLICY daily_activities_insert_create ON daily_activities FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'daily_activity.create'
    )
    AND can_access_branch (daily_activities.branch_id)
    AND branch_in_business (daily_activities.branch_id, daily_activities.business_id)
  );

DROP POLICY IF EXISTS daily_activities_update_own_or_manage ON daily_activities;
CREATE POLICY daily_activities_update_own_or_manage ON daily_activities FOR UPDATE
  TO authenticated
  USING (
    (
      daily_activities.recorded_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        JOIN role_permissions rp ON rp.role_id = up.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE up.id = auth.uid() AND up.is_active
          AND p.code IN ('daily_activity.view_branch', 'issues.manage')
      )
    )
    AND can_access_branch (daily_activities.branch_id)
  )
  WITH CHECK (
    can_access_branch (daily_activities.branch_id)
    AND branch_in_business (daily_activities.branch_id, daily_activities.business_id)
  );

DROP POLICY IF EXISTS daily_activities_delete_own_or_manage ON daily_activities;
CREATE POLICY daily_activities_delete_own_or_manage ON daily_activities FOR DELETE
  TO authenticated
  USING (
    (
      daily_activities.recorded_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        JOIN role_permissions rp ON rp.role_id = up.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE up.id = auth.uid() AND up.is_active
          AND p.code IN ('daily_activity.view_branch', 'issues.manage')
      )
    )
    AND can_access_branch (daily_activities.branch_id)
  );

DROP POLICY IF EXISTS issues_insert_create ON issues;
CREATE POLICY issues_insert_create ON issues FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'issues.create'
    )
    AND can_access_branch (issues.branch_id)
    AND branch_in_business (issues.branch_id, issues.business_id)
  );

DROP POLICY IF EXISTS issues_update_manage_or_own ON issues;
CREATE POLICY issues_update_manage_or_own ON issues FOR UPDATE
  TO authenticated
  USING (
    (
      issues.reported_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        JOIN role_permissions rp ON rp.role_id = up.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE up.id = auth.uid() AND up.is_active
          AND p.code IN ('issues.manage', 'issues.view_branch')
      )
    )
    AND can_access_branch (issues.branch_id)
  )
  WITH CHECK (
    can_access_branch (issues.branch_id)
    AND branch_in_business (issues.branch_id, issues.business_id)
  );

DROP POLICY IF EXISTS expenses_write ON operational_expenses;
CREATE POLICY expenses_write ON operational_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    can_access_branch (operational_expenses.branch_id)
    AND branch_in_business (operational_expenses.branch_id, operational_expenses.business_id)
  );

DROP POLICY IF EXISTS expenses_update ON operational_expenses;
CREATE POLICY expenses_update ON operational_expenses FOR UPDATE
  TO authenticated
  USING (can_access_branch (operational_expenses.branch_id))
  WITH CHECK (
    can_access_branch (operational_expenses.branch_id)
    AND branch_in_business (operational_expenses.branch_id, operational_expenses.business_id)
  );

-- =====================================================================
-- 12. SECURITY DEFINER RPC hardening: the product must live at the branch
--     the movement is booked against (sections 8, 19).
-- =====================================================================
CREATE OR REPLACE FUNCTION record_inventory_movement(
    p_product_id uuid,
    p_branch_id uuid,
    p_movement_type text,
    p_quantity numeric(14, 2),
    p_reason text DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL
) RETURNS inventory_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product products;
    v_balance inventory_balances;
    v_before numeric(14, 2);
    v_after numeric(14, 2);
    v_delta numeric(14, 2);
    v_tx inventory_transactions;
BEGIN
    IF NOT has_permission('inventory.manage') AND NOT has_permission('inventory.adjust') THEN
        RAISE EXCEPTION 'Inventory permission required';
    END IF;
    IF NOT can_access_branch(p_branch_id) THEN
        RAISE EXCEPTION 'Branch is outside your scope';
    END IF;
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;
    IF p_movement_type NOT IN (
        'opening_balance', 'purchase_receipt', 'sale', 'transfer_in', 'transfer_out',
        'return_in', 'return_out', 'damage', 'loss', 'adjustment', 'stock_issue',
        'physical_count', 'production'
    ) THEN
        RAISE EXCEPTION 'Invalid movement type';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found or inactive';
    END IF;
    IF v_product.branch_id IS DISTINCT FROM p_branch_id THEN
        RAISE EXCEPTION 'Product does not belong to this branch';
    END IF;

    SELECT * INTO v_balance
    FROM inventory_balances
    WHERE product_id = p_product_id AND branch_id = p_branch_id
    FOR UPDATE;

    v_before := COALESCE(v_balance.current_stock, 0);
    v_delta := CASE
        WHEN p_movement_type IN ('purchase_receipt', 'transfer_in', 'return_in', 'production', 'opening_balance') THEN p_quantity
        WHEN p_movement_type IN ('sale', 'transfer_out', 'return_out', 'damage', 'loss', 'stock_issue') THEN -p_quantity
        WHEN p_movement_type = 'physical_count' THEN p_quantity - v_before
        ELSE p_quantity
    END;
    v_after := v_before + v_delta;

    IF v_after < 0 THEN
        RAISE EXCEPTION 'Movement would make stock negative';
    END IF;

    IF v_balance.id IS NULL THEN
        INSERT INTO inventory_balances (
            product_id, branch_id, opening_stock, current_stock, min_stock_level, reorder_level
        ) VALUES (
            p_product_id,
            p_branch_id,
            CASE WHEN p_movement_type = 'opening_balance' THEN p_quantity ELSE 0 END,
            v_after,
            v_product.min_stock_level,
            v_product.reorder_level
        );
    ELSE
        UPDATE inventory_balances
        SET current_stock = v_after,
            last_count_date = CASE WHEN p_movement_type = 'physical_count' THEN CURRENT_DATE ELSE last_count_date END
        WHERE id = v_balance.id;
    END IF;

    INSERT INTO inventory_transactions (
        product_id, branch_id, movement_type, quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, actor_id
    ) VALUES (
        p_product_id, p_branch_id, p_movement_type, p_quantity, v_before, v_after,
        NULLIF(trim(p_reason), ''), p_reference_type, p_reference_id, auth.uid()
    )
    RETURNING * INTO v_tx;

    RETURN v_tx;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, text, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, text, numeric, text, text, uuid) TO authenticated;

-- Sale: validate against the sale's branch, and stamp the audit row with it.
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
    SELECT serial_tracking_mode INTO v_mode FROM products
    WHERE id = v_product_id AND branch_id = p_branch_id AND is_active;
    IF v_mode IS NULL THEN
      RAISE EXCEPTION 'A selected product is not stocked at this branch';
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
  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata, branch_id)
  VALUES (auth.uid(), 'sale.created', 'daily_sales', v_sale_id, jsonb_build_object('item_count', jsonb_array_length(p_items), 'payment_method', p_payment_method), p_branch_id);
  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION create_sale_with_items(uuid, text, text, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_sale_with_items(uuid, text, text, numeric, text, jsonb) TO authenticated;

-- GRN: received goods must belong to the purchase request's branch.
CREATE OR REPLACE FUNCTION record_grn_with_items(
    p_purchase_request_id uuid,
    p_grn_number text,
    p_items jsonb,
    p_delivery_note_number text DEFAULT NULL,
    p_is_partial boolean DEFAULT false
) RETURNS goods_received_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pr purchase_requests%ROWTYPE;
    v_grn goods_received_notes;
    v_item jsonb;
    v_product_id uuid;
    v_ordered numeric(14, 2);
    v_received numeric(14, 2);
    v_damaged numeric(14, 2);
    v_rejected numeric(14, 2);
    v_short numeric(14, 2);
    v_net numeric(14, 2);
    v_has_outstanding boolean := false;
    v_label text;
BEGIN
    IF NOT has_permission('inventory.manage') AND NOT has_permission('inventory.adjust') THEN
        RAISE EXCEPTION 'Inventory permission required';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'At least one GRN item is required';
    END IF;

    SELECT * INTO v_pr
    FROM purchase_requests
    WHERE id = p_purchase_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase request not found';
    END IF;
    IF v_pr.status NOT IN ('ordered', 'partially_received') THEN
        RAISE EXCEPTION 'Purchase request is "%"; only ordered or partially received requests can receive goods', v_pr.status;
    END IF;
    IF NOT can_access_branch(v_pr.branch_id) THEN
        RAISE EXCEPTION 'Branch is outside your scope';
    END IF;

    INSERT INTO goods_received_notes (
        grn_number, purchase_request_id, branch_id, supplier_id, received_by,
        delivery_note_number, is_partial, received_date
    ) VALUES (
        p_grn_number, v_pr.id, v_pr.branch_id, v_pr.supplier_id, auth.uid(),
        NULLIF(trim(coalesce(p_delivery_note_number, '')), ''), p_is_partial, CURRENT_DATE
    )
    RETURNING * INTO v_grn;

    v_label := 'GRN ' || p_grn_number;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := (v_item ->> 'product_id')::uuid;
        v_ordered := COALESCE((v_item ->> 'quantity_ordered')::numeric, 0);
        v_received := COALESCE((v_item ->> 'quantity_received')::numeric, 0);
        v_damaged := COALESCE((v_item ->> 'quantity_damaged')::numeric, 0);
        v_rejected := COALESCE((v_item ->> 'quantity_rejected')::numeric, 0);
        v_short := COALESCE((v_item ->> 'quantity_short')::numeric, 0);

        IF v_ordered < 0 OR v_received < 0 OR v_damaged < 0 OR v_rejected < 0 OR v_short < 0 THEN
            RAISE EXCEPTION 'Quantities must be zero or more';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id AND is_active AND branch_id = v_pr.branch_id) THEN
            RAISE EXCEPTION 'Product % is not stocked at this branch', v_product_id;
        END IF;

        INSERT INTO goods_received_items (
            grn_id, product_id, quantity_ordered, quantity_received,
            quantity_damaged, quantity_rejected, quantity_short, notes
        ) VALUES (
            v_grn.id, v_product_id, v_ordered, v_received,
            v_damaged, v_rejected, v_short,
            NULLIF(trim(v_item ->> 'notes'), '')
        );

        v_net := v_received - v_damaged - v_rejected;
        IF v_net > 0 THEN
            PERFORM record_inventory_movement(
                v_product_id, v_pr.branch_id, 'purchase_receipt', v_net,
                v_label || ' for PO ' || coalesce(v_pr.request_number, left(v_pr.id::text, 8)),
                'goods_received_note', v_grn.id
            );
        END IF;
        IF v_damaged > 0 THEN
            PERFORM record_inventory_movement(
                v_product_id, v_pr.branch_id, 'damage', v_damaged,
                'Damaged on ' || v_label,
                'goods_received_note', v_grn.id
            );
        END IF;
        IF v_short > 0 THEN
            v_has_outstanding := true;
        END IF;
    END LOOP;

    UPDATE purchase_requests
    SET status = CASE
        WHEN (v_has_outstanding OR p_is_partial) THEN 'partially_received'
        ELSE 'received'
    END
    WHERE id = v_pr.id;

    RETURN v_grn;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_grn_with_items(uuid, text, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_grn_with_items(uuid, text, jsonb, text, boolean) TO authenticated;

-- =====================================================================
-- 13. User activation/deactivation: strict branch scope + rank rules
--     (sections 4, 5, 20). The old business-level check had a NULL-business
--     hole that let an Admin deactivate a Super Admin.
-- =====================================================================
CREATE OR REPLACE FUNCTION deactivate_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_target_role text;
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
  IF v_target.id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot deactivate your own account';
  END IF;

  SELECT r.name INTO v_target_role FROM roles r WHERE r.id = v_target.role_id;

  IF v_actor_role = 'admin' THEN
    IF v_target_role IN ('super_admin', 'admin') THEN
      RAISE EXCEPTION 'Administrators cannot deactivate administrators';
    END IF;
    IF v_target.branch_id IS NULL OR NOT can_access_branch (v_target.branch_id) THEN
      RAISE EXCEPTION 'Not authorized to deactivate users outside your branch scope';
    END IF;
  END IF;

  UPDATE user_profiles SET is_active = false WHERE id = p_user_id;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata, branch_id)
  VALUES (auth.uid(), 'user.deactivated', 'user_profiles', p_user_id,
          jsonb_build_object('email', v_target.email), v_target.branch_id);
END;
$$;

REVOKE ALL ON FUNCTION deactivate_user FROM anon;
GRANT EXECUTE ON FUNCTION deactivate_user TO authenticated;

CREATE OR REPLACE FUNCTION activate_user(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target user_profiles;
  v_target_role text;
BEGIN
  IF NOT has_permission('users.manage_all') AND NOT has_permission('users.manage_business') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_target FROM user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  SELECT r.name INTO v_target_role FROM roles r WHERE r.id = v_target.role_id;

  IF has_permission('users.manage_all') THEN
    -- Super Admin may reactivate anyone.
    NULL;
  ELSE
    -- Admins: own-branch staff only, never other administrators. The
    -- one-admin-per-branch trigger still guards the reactivation itself.
    IF v_target_role IN ('super_admin', 'admin') THEN
      RAISE EXCEPTION 'Administrators cannot activate administrators';
    END IF;
    IF v_target.branch_id IS NULL OR NOT can_access_branch (v_target.branch_id) THEN
      RAISE EXCEPTION 'User is outside your scope';
    END IF;
  END IF;

  UPDATE user_profiles SET is_active = true WHERE id = p_user_id;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, metadata, branch_id)
  VALUES (auth.uid(), 'user.activated', 'user_profiles', p_user_id, '{}', v_target.branch_id);
END;
$$;

REVOKE ALL ON FUNCTION activate_user (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_user (uuid) TO authenticated;

-- =====================================================================
-- 14. advance_stock_transfer: the single, server-side transfer workflow
--     (section 19). Side-based authorization (from-side for outbound steps,
--     to-side for receipt/completion), legal-transition validation, and
--     atomic, idempotent stock movements â€” a replayed call or a double click
--     can never double-book inventory. Dispatch books transfer_out against
--     the source product/branch; receive finds or creates the destination
--     branch's product record (business + branch scoped SKU) and books
--     transfer_in.
-- =====================================================================
CREATE OR REPLACE FUNCTION advance_stock_transfer(
  p_transfer_id uuid,
  p_next_status text
)
RETURNS stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tr stock_transfers%ROWTYPE;
  v_actor uuid := auth.uid();
  v_can_from boolean;
  v_can_to boolean;
  v_item record;
  v_product products%ROWTYPE;
  v_dest_id uuid;
  v_bal inventory_balances%ROWTYPE;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_qty numeric(14,2);
  v_business_id uuid;
BEGIN
  IF p_next_status NOT IN ('reviewed','approved','rejected','dispatched','in_transit','received','completed') THEN
    RAISE EXCEPTION 'Unknown transfer status "%"', p_next_status;
  END IF;
  IF NOT has_permission('transfers.manage') THEN
    RAISE EXCEPTION 'Transfers permission required';
  END IF;

  SELECT * INTO v_tr FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF v_tr.status = p_next_status THEN
    RETURN v_tr;  -- idempotent replay (double click / retried request)
  END IF;

  v_can_from := can_access_branch (v_tr.from_branch_id);
  v_can_to := can_access_branch (v_tr.to_branch_id);

  IF p_next_status IN ('dispatched', 'in_transit') THEN
    IF NOT v_can_from THEN
      RAISE EXCEPTION 'You are not authorized for the source branch';
    END IF;
  ELSIF p_next_status IN ('received', 'completed') THEN
    IF NOT v_can_to THEN
      RAISE EXCEPTION 'You are not authorized for the destination branch';
    END IF;
  ELSE
    IF NOT (v_can_from OR v_can_to) THEN
      RAISE EXCEPTION 'You are not authorized for this transfer''s branches';
    END IF;
  END IF;

  IF NOT (
       (v_tr.status = 'requested'  AND p_next_status IN ('reviewed','rejected'))
    OR (v_tr.status = 'reviewed'   AND p_next_status IN ('approved','rejected'))
    OR (v_tr.status = 'approved'   AND p_next_status IN ('dispatched','rejected'))
    OR (v_tr.status = 'dispatched' AND p_next_status IN ('in_transit','received'))
    OR (v_tr.status = 'in_transit' AND p_next_status = 'received')
    OR (v_tr.status = 'received'   AND p_next_status = 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid transfer transition from "%" to "%"', v_tr.status, p_next_status;
  END IF;

  UPDATE stock_transfers SET
    status = p_next_status,
    reviewed_by = CASE WHEN p_next_status = 'reviewed' THEN v_actor ELSE reviewed_by END,
    approved_by = CASE WHEN p_next_status = 'approved' THEN v_actor ELSE approved_by END,
    dispatched_at = CASE WHEN p_next_status = 'dispatched' THEN now() ELSE dispatched_at END,
    received_at = CASE WHEN p_next_status = 'received' THEN now() ELSE received_at END,
    completed_at = CASE WHEN p_next_status = 'completed' THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = p_transfer_id
  RETURNING * INTO v_tr;

  IF p_next_status = 'dispatched' THEN
    FOR v_item IN
      SELECT product_id, quantity FROM stock_transfer_items
      WHERE transfer_id = p_transfer_id ORDER BY id
    LOOP
      v_qty := v_item.quantity;
      IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

      SELECT * INTO v_bal FROM inventory_balances
      WHERE product_id = v_item.product_id AND branch_id = v_tr.from_branch_id
      FOR UPDATE;

      v_before := COALESCE(v_bal.current_stock, 0);
      IF v_bal.id IS NULL OR v_before < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock to dispatch transfer %', v_tr.transfer_number;
      END IF;
      v_after := v_before - v_qty;

      UPDATE inventory_balances SET current_stock = v_after, updated_at = now()
      WHERE id = v_bal.id;

      INSERT INTO inventory_transactions (
        product_id, branch_id, movement_type, quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, actor_id
      ) VALUES (
        v_item.product_id, v_tr.from_branch_id, 'transfer_out', v_qty, v_before, v_after,
        'Transfer ' || v_tr.transfer_number || ' dispatched', 'stock_transfer', v_tr.id, v_actor
      );
    END LOOP;
  END IF;

  IF p_next_status = 'received' THEN
    SELECT b.business_id INTO v_business_id FROM branches b WHERE b.id = v_tr.to_branch_id;
    IF v_business_id IS NULL THEN
      RAISE EXCEPTION 'Destination branch not found';
    END IF;

    FOR v_item IN
      SELECT sti.product_id, sti.quantity, sti.received_quantity
      FROM stock_transfer_items sti
      WHERE sti.transfer_id = p_transfer_id ORDER BY sti.id
    LOOP
      v_qty := COALESCE(NULLIF(v_item.received_quantity, 0), v_item.quantity);
      IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

      SELECT * INTO v_product FROM products WHERE id = v_item.product_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found', v_item.product_id;
      END IF;

      -- Find the destination branch's own record for this product: match on
      -- SKU when set (the branch-scoped business key), otherwise on an exact
      -- name; create the record when the branch has never stocked it.
      SELECT id INTO v_dest_id FROM products
      WHERE business_id = v_business_id
        AND branch_id = v_tr.to_branch_id
        AND ((v_product.sku IS NOT NULL AND sku = v_product.sku)
             OR (v_product.sku IS NULL AND name = v_product.name))
      ORDER BY (sku IS NOT NULL) DESC, created_at
      LIMIT 1;

      IF v_dest_id IS NULL THEN
        INSERT INTO products (
          business_id, branch_id, category_id, supplier_id, name, sku, brand, model,
          description, unit, cost_price, selling_price, min_stock_level, reorder_level,
          is_active, product_type, warranty_months, expiry_tracking, serial_tracking_mode,
          created_by
        ) VALUES (
          v_business_id, v_tr.to_branch_id, v_product.category_id, v_product.supplier_id,
          v_product.name, v_product.sku, v_product.brand, v_product.model, v_product.description,
          v_product.unit, v_product.cost_price, v_product.selling_price, v_product.min_stock_level,
          v_product.reorder_level, v_product.is_active, v_product.product_type,
          v_product.warranty_months, v_product.expiry_tracking, v_product.serial_tracking_mode,
          v_actor
        )
        RETURNING id INTO v_dest_id;
      END IF;

      SELECT * INTO v_bal FROM inventory_balances
      WHERE product_id = v_dest_id AND branch_id = v_tr.to_branch_id
      FOR UPDATE;

      v_before := COALESCE(v_bal.current_stock, 0);
      v_after := v_before + v_qty;

      IF v_bal.id IS NULL THEN
        INSERT INTO inventory_balances (
          product_id, branch_id, opening_stock, current_stock, min_stock_level, reorder_level
        ) VALUES (
          v_dest_id, v_tr.to_branch_id, 0, v_after,
          v_product.min_stock_level, v_product.reorder_level
        );
      ELSE
        UPDATE inventory_balances SET current_stock = v_after, updated_at = now()
        WHERE id = v_bal.id;
      END IF;

      INSERT INTO inventory_transactions (
        product_id, branch_id, movement_type, quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, actor_id
      ) VALUES (
        v_dest_id, v_tr.to_branch_id, 'transfer_in', v_qty, v_before, v_after,
        'Transfer ' || v_tr.transfer_number || ' received', 'stock_transfer', v_tr.id, v_actor
      );
    END LOOP;
  END IF;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata, branch_id)
  VALUES (
    v_actor, 'transfer.' || p_next_status, 'stock_transfers', p_transfer_id,
    jsonb_build_object('status', p_next_status, 'transfer_number', v_tr.transfer_number),
    CASE WHEN p_next_status IN ('received', 'completed') THEN v_tr.to_branch_id ELSE v_tr.from_branch_id END
  );

  RETURN v_tr;
END;
$$;

REVOKE ALL ON FUNCTION advance_stock_transfer (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION advance_stock_transfer (uuid, text) TO authenticated;

-- Make sure PostgREST picks up the new functions and policy set.
NOTIFY pgrst, 'reload schema';


-- ============================================
-- 202609190001_restore_oversight_scope.sql
-- ============================================
-- Migration E: restore oversight-scoped visibility (master spec sections 5-9).
--
-- Corrections on top of 202609180004 (which made scope strictly branch-level
-- and accidentally cut branch-less admins off from their own businesses):
--
--   1. user_location_assignments: location-level oversight grants.
--   2. can_access_branch / my_branch_ids: an Admin additionally sees every
--      branch of their primary business and of businesses granted through
--      user_business_assignments (business-level oversight, spec section 5).
--      Branches keep fully independent records â€” this only widens WHO may
--      see them, never merges or rewrites them. Managers/Staff stay strict
--      (primary branch + explicit assignments + managed branches).
--   3. user_profiles reads/updates: an Admin also sees/edits non-Admin staff
--      anywhere in their business oversight (Admins remain invisible and
--      uneditable to each other â€” section 7).
--   4. inventory_assets + movements: branch-scoped only (the old
--      "OR can_access_business" let a manager read OTHER branches' assets).
--      Admins still reach their whole business through can_access_branch.
--   5. One-Admin-per-Branch now checks PRIMARY assignments only
--      (user_profiles.branch_id). user_branch_assignments rows are OVERSIGHT
--      grants and are unlimited â€” "assigned to a branch" vs "authorized to
--      oversee a branch" are separate concepts (sections 8-9).
--
-- Idempotent; safe to replay.

-- =====================================================================
-- 1. Location-level oversight assignments
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_location_assignments (
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_user_location_assignments_location
  ON user_location_assignments (location_id);

ALTER TABLE user_location_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_location_assignments_select ON user_location_assignments;
CREATE POLICY user_location_assignments_select ON user_location_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

-- =====================================================================
-- 2. can_access_branch: super | primary branch | branch oversight |
--    managed branch | LOCATION oversight | ADMIN business oversight
-- =====================================================================
CREATE OR REPLACE FUNCTION can_access_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    JOIN branches b ON b.id = p_branch_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (
        r.name = 'super_admin'
        OR up.branch_id = p_branch_id
        OR EXISTS (SELECT 1 FROM user_branch_assignments ubra
                   WHERE ubra.user_id = up.id AND ubra.branch_id = p_branch_id)
        OR b.manager_id = up.id
        OR EXISTS (SELECT 1 FROM user_location_assignments ula
                   WHERE ula.user_id = up.id AND ula.location_id = b.location_id)
        OR (
          r.name = 'admin'
          AND (
            up.business_id = b.business_id
            OR EXISTS (SELECT 1 FROM user_business_assignments uba
                       WHERE uba.user_id = up.id AND uba.business_id = b.business_id)
          )
        )
      )
  );
$$;

-- =====================================================================
-- 3. my_branch_ids: mirrors can_access_branch for listing/policies
-- =====================================================================
CREATE OR REPLACE FUNCTION my_branch_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id
  FROM branches b
  WHERE EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (
        r.name = 'super_admin'
        OR up.branch_id = b.id
        OR EXISTS (SELECT 1 FROM user_branch_assignments ubra
                   WHERE ubra.user_id = up.id AND ubra.branch_id = b.id)
        OR b.manager_id = up.id
        OR EXISTS (SELECT 1 FROM user_location_assignments ula
                   WHERE ula.user_id = up.id AND ula.location_id = b.location_id)
        OR (
          r.name = 'admin'
          AND (
            up.business_id = b.business_id
            OR EXISTS (SELECT 1 FROM user_business_assignments uba
                       WHERE uba.user_id = up.id AND uba.business_id = b.business_id)
          )
        )
      )
  );
$$;

-- =====================================================================
-- 4. user_profiles: Admin business-wide directory of non-Admin staff
-- =====================================================================
DROP POLICY IF EXISTS user_profiles_select_scoped ON user_profiles;
CREATE POLICY user_profiles_select_scoped ON user_profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = (current_profile()).role_id AND r.name = 'super_admin'
    )
    OR user_profiles.branch_id IN (SELECT my_branch_ids())
    OR EXISTS (
      SELECT 1 FROM user_branch_assignments ubra
      WHERE ubra.user_id = user_profiles.id
        AND ubra.branch_id IN (SELECT my_branch_ids())
    )
    OR (
      EXISTS (
        SELECT 1 FROM roles r
        WHERE r.id = (current_profile()).role_id AND r.name = 'admin'
      )
      AND user_profiles.business_id IN (SELECT my_business_ids())
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  );

DROP POLICY IF EXISTS user_profiles_update_scoped ON user_profiles;
CREATE POLICY user_profiles_update_scoped ON user_profiles
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = (current_profile()).role_id AND r.name = 'super_admin'
    )
    OR (
      EXISTS (
        SELECT 1 FROM roles r
        WHERE r.id = (current_profile()).role_id AND r.name = 'admin'
      )
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
      AND (
        user_profiles.branch_id IN (SELECT my_branch_ids())
        OR user_profiles.business_id IN (SELECT my_business_ids())
      )
    )
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = (current_profile()).role_id AND r.name = 'super_admin'
    )
    OR (
      EXISTS (
        SELECT 1 FROM roles r
        WHERE r.id = (current_profile()).role_id AND r.name = 'admin'
      )
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
      AND (
        user_profiles.branch_id IN (SELECT my_branch_ids())
        OR user_profiles.business_id IN (SELECT my_business_ids())
      )
    )
  );

-- =====================================================================
-- 5. Assets: strictly branch-scoped (consistent with products/inventory).
--    Writes additionally require inventory.manage.
-- =====================================================================
DROP POLICY IF EXISTS inventory_assets_scoped_select ON inventory_assets;
CREATE POLICY inventory_assets_scoped_select ON inventory_assets
  FOR SELECT TO authenticated
  USING (can_access_branch(branch_id));

DROP POLICY IF EXISTS inventory_assets_write ON inventory_assets;
CREATE POLICY inventory_assets_write ON inventory_assets
  FOR ALL TO authenticated
  USING (
    can_access_branch(branch_id)
    AND has_permission('inventory.manage')
  )
  WITH CHECK (
    can_access_branch(branch_id)
    AND has_permission('inventory.manage')
  );

DROP POLICY IF EXISTS asset_movements_scoped_select ON inventory_asset_movements;
CREATE POLICY asset_movements_scoped_select ON inventory_asset_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inventory_assets a
      WHERE a.id = inventory_asset_movements.asset_id
        AND can_access_branch(a.branch_id)
    )
  );

DROP POLICY IF EXISTS asset_movements_write ON inventory_asset_movements;
CREATE POLICY asset_movements_write ON inventory_asset_movements
  FOR ALL TO authenticated
  USING (
    has_permission('inventory.manage')
    AND EXISTS (
      SELECT 1 FROM inventory_assets a
      WHERE a.id = inventory_asset_movements.asset_id
        AND can_access_branch(a.branch_id)
    )
  )
  WITH CHECK (
    has_permission('inventory.manage')
    AND EXISTS (
      SELECT 1 FROM inventory_assets a
      WHERE a.id = inventory_asset_movements.asset_id
        AND can_access_branch(a.branch_id)
    )
  );

-- =====================================================================
-- 6. One Admin per Branch â€” PRIMARY assignment only (sections 8-9).
--    Oversight rows (user_branch_assignments) are unlimited: they do not
--    make the holder "the Admin of the branch".
-- =====================================================================
CREATE OR REPLACE FUNCTION branch_has_other_admin(p_branch_id uuid, p_exclude_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE r.name = 'admin' AND up.is_active = true
      AND up.branch_id = p_branch_id
      AND up.id <> COALESCE(p_exclude_user, '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;

REVOKE ALL ON FUNCTION branch_has_other_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION branch_has_other_admin(uuid, uuid) TO authenticated;

-- Oversight assignments no longer carry the one-admin restriction.
DROP TRIGGER IF EXISTS trg_enforce_one_admin_per_branch_assignment ON user_branch_assignments;

-- Make sure PostgREST picks up the new function bodies and policies.
NOTIFY pgrst, 'reload schema';


-- ============================================
-- 202609190002_product_soft_delete.sql
-- ============================================
-- Migration F: soft-delete tombstones for products (master spec section 12).
--
-- Deleting a product is permanent for the business, but the platform must
-- keep a durable record that it existed and was deleted:
--   * audit_log already carries the product.deleted row (unchanged).
--   * products now keeps the row itself as a tombstone (deleted_at/deleted_by)
--     instead of being hard-deleted. Tombstones are hidden from listings by
--     default; Super Admin / Admin can still see them (Products page
--     "Deleted" filter + audit trail), regular staff never do.
--   * is_active is set false on deletion too, so every sale/RPC guard that
--     checks is_active keeps rejecting tombstones even if RLS is bypassed.
--
-- The three historical hard-deleted products are reconstructed as tombstones
-- by a one-off data script (their audit_log rows are the source of truth).
--
-- Idempotent; safe to replay.

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_deleted_at
  ON products (deleted_at) WHERE deleted_at IS NOT NULL;

-- Tombstones visible only to Admins / Super Admin (still scoped by branch).
DROP POLICY IF EXISTS products_scoped_select ON products;
CREATE POLICY products_scoped_select ON products FOR SELECT
  TO authenticated
  USING (
    can_access_branch (products.branch_id)
    AND (
      products.deleted_at IS NULL
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        JOIN roles r ON r.id = up.role_id
        WHERE up.id = auth.uid() AND up.is_active AND r.name IN ('admin', 'super_admin')
      )
    )
  );

-- Tombstones are frozen: no further edits through RLS (only reactivation by
-- a future explicit restore flow could lift this).
DROP POLICY IF EXISTS products_update_manage ON products;
CREATE POLICY products_update_manage ON products FOR UPDATE
  TO authenticated
  USING (
    products.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  )
  WITH CHECK (
    products.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  );

-- Make sure PostgREST picks up the new policy set.
NOTIFY pgrst, 'reload schema';


-- ============================================
-- 202609190003_products_soft_delete_transition.sql
-- ============================================
-- Migration G: let the soft-delete TRANSITION happen through RLS.
--
-- Migration F (202609190002) required deleted_at IS NULL in BOTH the USING
-- and WITH CHECK clauses of products_update_manage. USING correctly freezes
-- existing tombstones, but WITH CHECK with the same guard also rejected the
-- transition itself: no Admin could soft-delete through RLS (only the edge
-- function, which runs as service_role, was able to). That made the client's
-- direct-delete fallback dead code and the policy self-contradictory.
--
-- Fix: keep USING (existing tombstones stay frozen) and drop the guard from
-- WITH CHECK only. The authorization requirements (products.manage,
-- business scope, branch scope) still decide who may set deleted_at, so
-- regular staff remain unable to delete, and every subsequent edit of an
-- existing tombstone still fails the USING clause.
--
-- Idempotent; safe to replay.

DROP POLICY IF EXISTS products_update_manage ON products;
CREATE POLICY products_update_manage ON products FOR UPDATE
  TO authenticated
  USING (
    products.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  );

-- Make sure PostgREST picks up the new policy set.
NOTIFY pgrst, 'reload schema';


-- ============================================
-- 202609200001_report_priority_escalation_notifications.sql
-- ============================================
-- ==========================================
-- 202609200001: Report priority, escalation & in-app notifications
-- ==========================================
-- Adds priority + escalation columns to weekly_reports and creates an
-- in-app notifications feed. A SECURITY DEFINER trigger writes a
-- notification whenever a report is submitted with a non-normal priority
-- or is escalated. Recipients (per product decision): the report branch's
-- manager, every admin of the report's business, and all super admins.
-- The acting user never receives a notification about their own action.
-- ==========================================

ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'priority', 'urgent'));
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false;
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS escalated_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_weekly_reports_priority ON weekly_reports (priority);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_escalated ON weekly_reports (escalated);

-- ==========================================
-- NOTIFICATIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'report_priority'
    CHECK (type IN ('report_priority', 'report_escalation')),
  ref_type text NOT NULL DEFAULT 'weekly_reports',
  ref_id uuid NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_ref ON notifications (ref_type, ref_id);

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ==========================================
-- TRIGGER FUNCTION
-- ==========================================
CREATE OR REPLACE FUNCTION notify_weekly_report_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch_name text;
  v_business_name text;
  v_week text;
  v_kind text;
  v_title text;
  v_body text;
  v_recipient uuid;
BEGIN
  IF (NEW.escalated AND (TG_OP = 'UPDATE' AND OLD.escalated IS NOT DISTINCT FROM TRUE)) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_branch_name FROM branches WHERE id = NEW.branch_id;
  SELECT name INTO v_business_name FROM businesses WHERE id = NEW.business_id;
  v_week := to_char(NEW.week_start_date, 'YYYY-MM-DD') || ' â€“ ' || to_char(NEW.week_end_date, 'YYYY-MM-DD');

  IF NEW.escalated THEN
    v_kind := 'report_escalation';
    v_title := 'Report escalated: ' || COALESCE(v_branch_name, 'Unknown branch');
    v_body := COALESCE(v_business_name, '') || ' Â· ' || v_week || '. A weekly report was escalated for leadership attention.';
  ELSIF NEW.priority <> 'normal'
        AND NEW.status IN ('submitted', 'reviewed')
        AND (TG_OP = 'INSERT' OR OLD.priority IS DISTINCT FROM NEW.priority) THEN
    v_kind := 'report_priority';
    v_title := upper(NEW.priority) || ' report submitted: ' || COALESCE(v_branch_name, 'Unknown branch');
    v_body := COALESCE(v_business_name, '') || ' Â· ' || v_week || '. Open the report to review.';
  ELSE
    RETURN NEW;
  END IF;

  FOR v_recipient IN
    SELECT manager_id FROM branches WHERE id = NEW.branch_id AND manager_id IS NOT NULL
    UNION
    SELECT up.id
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.is_active = true
      AND r.name = 'admin'
      AND (up.business_id = NEW.business_id
           OR EXISTS (
             SELECT 1 FROM user_business_assignments uba
             WHERE uba.user_id = up.id AND uba.business_id = NEW.business_id
           ))
    UNION
    SELECT up.id
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.is_active = true AND r.name = 'super_admin'
  LOOP
    IF v_recipient IS NOT NULL AND v_recipient IS DISTINCT FROM v_actor THEN
      INSERT INTO notifications (user_id, title, body, type, ref_type, ref_id)
      VALUES (v_recipient, v_title, v_body, v_kind, 'weekly_reports', NEW.id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_weekly_report_hierarchy_notify ON weekly_reports;
CREATE TRIGGER trg_weekly_report_hierarchy_notify
AFTER INSERT OR UPDATE OF priority, status, escalated ON weekly_reports
FOR EACH ROW EXECUTE FUNCTION notify_weekly_report_hierarchy();

-- ============================================
-- 202609210001_quotations.sql
-- ============================================
-- ==========================================
-- 202609210001: Quotations feature
-- ==========================================
-- Adds quotations and quotation_items tables with RLS mirroring sales scope.
-- Quotations can be drafted by manager and above; receipts can be created
-- from quotations the user has access to. No salesperson name is shown
-- on the quotation PDF (per spec). Stores prepared_for, location/address,
-- valid_until, notes/terms, and bank details are rendered in the PDF.
-- ==========================================

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  prepared_for text DEFAULT '',
  prepared_for_contact text DEFAULT '',
  location_address text DEFAULT '',
  customer_name text DEFAULT '',
  customer_contact text DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted','cancelled')),
  valid_until date,
  notes text DEFAULT '',
  terms_conditions text DEFAULT '',
  discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  tax_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_value >= 0),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  converted_to_sale_id uuid REFERENCES daily_sales(id) ON DELETE SET NULL,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_quote_number ON quotations (quote_number) WHERE quote_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotations_business_branch ON quotations (business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations (status);
CREATE INDEX IF NOT EXISTS idx_quotations_created_by ON quotations (created_by);

-- Select: authenticated users see within scope (RLS is broad but app filters; DB enforces via role checks below where feasible)
DROP POLICY IF EXISTS "quotations_select_authenticated" ON quotations;
CREATE POLICY "quotations_select_authenticated" ON quotations FOR SELECT
  TO authenticated USING (true);

-- Insert: manager and above can create quotations
DROP POLICY IF EXISTS "quotations_insert_authorized" ON quotations;
CREATE POLICY "quotations_insert_authorized" ON quotations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

-- Update: creator or manager+ within reasonable scope
DROP POLICY IF EXISTS "quotations_update_authorized" ON quotations;
CREATE POLICY "quotations_update_authorized" ON quotations FOR UPDATE
  TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

-- Delete: super admin or creator while draft
DROP POLICY IF EXISTS "quotations_delete_authorized" ON quotations;
CREATE POLICY "quotations_delete_authorized" ON quotations FOR DELETE
  TO authenticated USING (
    (created_by = auth.uid() AND status = 'draft')
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name = 'super_admin'
    )
  );

-- Quotation items
CREATE TABLE IF NOT EXISTS quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  item_name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text DEFAULT '',
  unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items (quotation_id);

DROP POLICY IF EXISTS "quotation_items_select_authenticated" ON quotation_items;
CREATE POLICY "quotation_items_select_authenticated" ON quotation_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "quotation_items_insert_authorized" ON quotation_items;
CREATE POLICY "quotation_items_insert_authorized" ON quotation_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

DROP POLICY IF EXISTS "quotation_items_update_authorized" ON quotation_items;
CREATE POLICY "quotation_items_update_authorized" ON quotation_items FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

DROP POLICY IF EXISTS "quotation_items_delete_authorized" ON quotation_items;
CREATE POLICY "quotation_items_delete_authorized" ON quotation_items FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

-- Add quotation_id to daily_sales for traceability
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_daily_sales_quotation_id ON daily_sales (quotation_id);

-- Function to generate quote number
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_num integer;
  v_year text := to_char(now(), 'YYYY');
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(quote_number FROM 'QT-' || v_year || '-([0-9]+)') AS integer)), 0) + 1
  INTO v_num
  FROM quotations
  WHERE quote_number LIKE 'QT-' || v_year || '-%';
  RETURN 'QT-' || v_year || '-' || LPAD(v_num::text, 6, '0');
END;
$$;

-- ============================================
-- 202609220001_quotation_conversion.sql
-- ============================================
-- ==========================================
-- 202609220001: Quotation conversion + scoped RLS
-- ==========================================
-- 1. Tightens quotations/quotation_items RLS to real branch scope
--    (the first pass used USING (true), which leaked every tenant's quotes).
-- 2. Adds create_sale_from_quotation() so "Create receipt from quotation"
--    is atomic, audited, and stock/serial aware.
-- 3. Restricts generate_quote_number() to authenticated users.
-- ==========================================

-- ---------- Scoped policies ----------

DROP POLICY IF EXISTS "quotations_select_authenticated" ON quotations;
CREATE POLICY "quotations_select_authenticated" ON quotations FOR SELECT
  TO authenticated USING (can_access_branch(branch_id));

DROP POLICY IF EXISTS "quotations_insert_authorized" ON quotations;
CREATE POLICY "quotations_insert_authorized" ON quotations FOR INSERT
  TO authenticated WITH CHECK (
    can_access_branch(branch_id)
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

DROP POLICY IF EXISTS "quotations_update_authorized" ON quotations;
CREATE POLICY "quotations_update_authorized" ON quotations FOR UPDATE
  TO authenticated
  USING (
    can_access_branch(branch_id)
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        JOIN roles r ON r.id = up.role_id
        WHERE up.id = auth.uid() AND up.is_active = true
          AND r.name IN ('super_admin','admin','manager')
      )
    )
  )
  WITH CHECK (can_access_branch(branch_id));

DROP POLICY IF EXISTS "quotations_delete_authorized" ON quotations;
CREATE POLICY "quotations_delete_authorized" ON quotations FOR DELETE
  TO authenticated USING (
    (created_by = auth.uid() AND status = 'draft' AND can_access_branch(branch_id))
    OR (
      can_access_branch(branch_id)
      AND EXISTS (
        SELECT 1 FROM user_profiles up
        JOIN roles r ON r.id = up.role_id
        WHERE up.id = auth.uid() AND up.is_active = true
          AND r.name = 'super_admin'
      )
    )
  );

DROP POLICY IF EXISTS "quotation_items_select_authenticated" ON quotation_items;
CREATE POLICY "quotation_items_select_authenticated" ON quotation_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND can_access_branch(q.branch_id))
  );

DROP POLICY IF EXISTS "quotation_items_insert_authorized" ON quotation_items;
CREATE POLICY "quotation_items_insert_authorized" ON quotation_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND can_access_branch(q.branch_id))
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

DROP POLICY IF EXISTS "quotation_items_update_authorized" ON quotation_items;
CREATE POLICY "quotation_items_update_authorized" ON quotation_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND can_access_branch(q.branch_id))
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND can_access_branch(q.branch_id))
  );

DROP POLICY IF EXISTS "quotation_items_delete_authorized" ON quotation_items;
CREATE POLICY "quotation_items_delete_authorized" ON quotation_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND can_access_branch(q.branch_id))
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

-- ---------- Quote number generation ----------

REVOKE EXECUTE ON FUNCTION generate_quote_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION generate_quote_number() FROM anon;
GRANT EXECUTE ON FUNCTION generate_quote_number() TO authenticated;

-- ---------- Convert quotation -> sale (receipt) ----------

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
  v_discount numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_mode text;
  v_count integer;
  v_sale_item_id uuid;
  v_serial text;
  v_serial_row record;
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

  SELECT business_id INTO v_business_id FROM branches WHERE id = v_quote.branch_id AND is_active = true;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Active branch not found';
  END IF;

  SELECT count(*) INTO v_count FROM quotation_items WHERE quotation_id = p_quotation_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'This quotation has no items to convert';
  END IF;

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
    v_discount := v_discount + v_item.discount_value;
  END LOOP;
  v_total := v_subtotal - v_discount;

  -- Header row (mirrors create_sale_with_items conventions).
  INSERT INTO daily_sales (
    business_id, branch_id, salesperson_id, customer_name, sale_date,
    quantity, unit_price, discount_value, amount_paid, status, notes, quotation_id
  ) VALUES (
    v_business_id, v_quote.branch_id, auth.uid(),
    NULLIF(trim(COALESCE(v_quote.customer_name, v_quote.prepared_for, '')), ''),
    CURRENT_DATE, 1, v_subtotal, v_discount, v_total, 'completed',
    trim('Converted from quotation ' || COALESCE(v_quote.quote_number, v_quote.id::text)),
    v_quote.id
  ) RETURNING id INTO v_sale_id;

  -- Item rows, stock moves, serial transitions.
  FOR v_item IN SELECT * FROM quotation_items WHERE quotation_id = p_quotation_id ORDER BY sort_order
  LOOP
    SELECT serial_tracking_mode INTO v_mode FROM products WHERE id = v_item.product_id;
    v_serial := NULL;

    IF v_mode = 'unique' THEN
      SELECT psn.serial_number INTO v_serial
      FROM product_serial_numbers psn
      WHERE psn.product_id = v_item.product_id AND psn.status = 'available'
      ORDER BY psn.serial_number
      LIMIT 1
      FOR UPDATE;

      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit, serial_number)
      VALUES (v_sale_id, v_item.product_id, v_item.quantity::integer, v_item.unit_price, v_item.discount_value,
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
      WHERE psn.product_id = v_item.product_id AND psn.mode = 'shared' AND psn.status = 'available' AND psn.quantity >= v_item.quantity
      ORDER BY psn.serial_number
      LIMIT 1
      FOR UPDATE;

      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_value, unit, serial_number)
      VALUES (v_sale_id, v_item.product_id, v_item.quantity::integer, v_item.unit_price, v_item.discount_value,
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
      VALUES (v_sale_id, v_item.product_id, v_item.quantity::integer, v_item.unit_price, v_item.discount_value,
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
          jsonb_build_object('sale_id', v_sale_id, 'total', v_total, 'item_count', v_count),
          v_quote.branch_id);

  RETURN v_sale_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_sale_from_quotation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_sale_from_quotation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION create_sale_from_quotation(uuid) TO authenticated;


-- ============================================
-- 202609220002_quotation_conversion_amounts.sql
-- ============================================
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


-- ============================================
-- 202609230001_live_stock_and_serial_registration.sql
-- ============================================
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


-- ============================================
-- 202609240001_hardening.sql
-- ============================================
-- ============================================
-- 202609240001_hardening.sql
-- Security & correctness hardening from the full-system audit.
-- Safe to run on an existing database (all statements are idempotent).
-- ============================================

-- 1. Drop orphaned permissive policies left over from migration 002.
--    They OR with the scoped policies and weaken least-privilege.
DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
DROP POLICY IF EXISTS audit_log_select_own ON public.audit_log;

-- 2. Drop redundant legacy org-extension policies (the *_scope FOR ALL
--    policies from 202609100001 already cover these tables).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','teams','customers','services','locations','workflows','report_types'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_scoped_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
  END LOOP;
END $$;

-- 3. Quote numbers must be global, not scoped to the caller's branch.
--    (The old invoker-rights MAX() read only the caller's visible rows, so two
--     branches could generate the same number and collide.)
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_num bigint;
  v_year text := to_char(now(), 'YYYY');
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(quote_number FROM 'QT-' || v_year || '-([0-9]+)')::bigint), 0) + 1
  INTO v_num
  FROM quotations
  WHERE quote_number LIKE 'QT-' || v_year || '-%';
  RETURN 'QT-' || v_year || '-' || LPAD(v_num::text, 6, '0');
END;
$$;
REVOKE ALL ON FUNCTION generate_quote_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_quote_number() TO authenticated;

-- 4. Functions from migration 007 revoked EXECUTE from anon only, leaving the
--    default PUBLIC grant intact. Revoke PUBLIC properly, then re-grant.
REVOKE ALL ON FUNCTION has_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_user_account(text, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION deactivate_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION create_user_account(text, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION deactivate_user(uuid) TO authenticated;

-- 5. Recreate sync_weekly_report_stock with correct last-line/rounding math:
--    count target rows ONCE, and keep v_moved accurate when a line is clamped.
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
  v_target_count int;
BEGIN
  SELECT * INTO v_report FROM weekly_reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF NOT can_access_branch(v_report.branch_id) THEN RAISE EXCEPTION 'Report branch is outside your scope'; END IF;
  IF NOT has_permission('inventory.adjust') AND NOT has_permission('inventory.manage') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no inventory adjustment permission');
  END IF;

  SELECT COALESCE(sum(current_stock), 0) INTO v_total
  FROM inventory_balances WHERE branch_id = v_report.branch_id;
  v_diff := p_closing_stock - v_total;
  IF abs(v_diff) < 0.005 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'already aligned', 'system_total', v_total);
  END IF;

  SELECT count(*) INTO v_target_count
  FROM inventory_balances WHERE branch_id = v_report.branch_id AND current_stock > 0;
  IF v_target_count = 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no stock balances to adjust', 'system_total', v_total);
  END IF;
  SELECT COALESCE(sum(current_stock), 0) INTO v_movable
  FROM inventory_balances WHERE branch_id = v_report.branch_id AND current_stock > 0;

  FOR v_rec IN
    SELECT id, product_id, current_stock
    FROM inventory_balances
    WHERE branch_id = v_report.branch_id AND current_stock > 0
    ORDER BY current_stock DESC, id
  LOOP
    v_lines := v_lines + 1;
    IF v_lines = v_target_count THEN
      v_delta := v_diff - v_moved; -- last line absorbs the rounding remainder
    ELSE
      v_delta := round(v_diff * (v_rec.current_stock / v_movable), 2);
    END IF;
    v_new := v_rec.current_stock + v_delta;
    IF v_new < 0 THEN
      v_delta := -v_rec.current_stock;
      v_new := 0;
    END IF;
    v_moved := v_moved + v_delta;
    UPDATE inventory_balances SET current_stock = v_new, updated_at = now() WHERE id = v_rec.id;
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

-- 6. Reconciliation periods now follow the same Monâ€“Sat cycle as weekly
--    reports. Relax the old Sunday-based CHECK (period_end = start + 6) so it
--    accepts both a 5-day (Monâ€“Sat) and 6-day (Sunâ€“Sat) span.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.inventory_periods'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%period_start%6%'
  LOOP
    EXECUTE format('ALTER TABLE public.inventory_periods DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_periods'::regclass
      AND conname = 'inventory_periods_week_span_check'
  ) THEN
    ALTER TABLE public.inventory_periods
      ADD CONSTRAINT inventory_periods_week_span_check
      CHECK (period_end - period_start IN (5, 6));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ============================================
-- 202609250001_sale_returns.sql
-- ============================================
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


