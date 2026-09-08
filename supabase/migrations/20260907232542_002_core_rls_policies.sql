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
-- BUSINESSES — cross-table policies
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
-- BRANCHES — cross-table policies
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
-- USER_PROFILES — cross-table policies
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
-- AUDIT_LOG — cross-table policies
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
