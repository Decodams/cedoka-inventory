/*
# Seed System Roles, Permissions, and Role-Permission Mapping

## Purpose
Populates the RBAC foundation with 4 system roles and a comprehensive permission catalog.
This is data, not schema — but it's applied as a migration so it's reproducible.

## Roles Seeded
1. super_admin — Full system access, creates businesses/admins
2. admin — General Manager, manages branches/managers within business(es)
3. manager — Branch Manager, manages single branch, submits weekly reports
4. sales_person — Front-line staff, logs daily sales/stock, sees own data

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
