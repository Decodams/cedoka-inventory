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
