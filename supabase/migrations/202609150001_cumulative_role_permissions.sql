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
