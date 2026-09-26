-- Strict branch-scope authorization (spec sections 6-13, 19-28, 31).
--
-- This is the core of the access-control specification:
--
--   * can_access_branch / my_branch_ids become STRICT: Super Admin is global,
--     everyone else gets their primary branch + explicit assignments only.
--     The old "Admin sees every branch of their business" escape hatch is
--     removed — an Admin at Ikeja must never read Agege.
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
-- chain, and — for Admin/Manager/Supervisor — staff inside their own branch
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
-- Admin only — an Admin cannot read history from other tenants.
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
--    unit assignments) — permission alone never covered tenancy.
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
--    (sections 8, 19 — prevents crediting another branch's product).
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
--     atomic, idempotent stock movements — a replayed call or a double click
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
