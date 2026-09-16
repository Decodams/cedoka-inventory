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