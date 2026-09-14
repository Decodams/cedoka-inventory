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
-- UNITS — branch-scoped access
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
-- USER_UNIT_ASSIGNMENTS — admin-managed assignments
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