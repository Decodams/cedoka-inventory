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
-- 2. businesses — scoped reads
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
-- 3. branches — scoped reads
-- ==========================================
DROP POLICY IF EXISTS "branches_select_authenticated" ON branches;
DROP POLICY IF EXISTS "branches_select_scoped" ON branches;
CREATE POLICY "branches_select_scoped" ON branches FOR SELECT
  TO authenticated USING (
    branches.id IN (SELECT my_branch_ids())
  );

-- ==========================================
-- 4. user_profiles — an Admin only sees staff inside the businesses the Admin
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
