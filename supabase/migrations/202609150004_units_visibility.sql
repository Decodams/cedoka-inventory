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
