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
