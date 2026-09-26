-- Migration E: restore oversight-scoped visibility (master spec sections 5-9).
--
-- Corrections on top of 202609180004 (which made scope strictly branch-level
-- and accidentally cut branch-less admins off from their own businesses):
--
--   1. user_location_assignments: location-level oversight grants.
--   2. can_access_branch / my_branch_ids: an Admin additionally sees every
--      branch of their primary business and of businesses granted through
--      user_business_assignments (business-level oversight, spec section 5).
--      Branches keep fully independent records — this only widens WHO may
--      see them, never merges or rewrites them. Managers/Staff stay strict
--      (primary branch + explicit assignments + managed branches).
--   3. user_profiles reads/updates: an Admin also sees/edits non-Admin staff
--      anywhere in their business oversight (Admins remain invisible and
--      uneditable to each other — section 7).
--   4. inventory_assets + movements: branch-scoped only (the old
--      "OR can_access_business" let a manager read OTHER branches' assets).
--      Admins still reach their whole business through can_access_branch.
--   5. One-Admin-per-Branch now checks PRIMARY assignments only
--      (user_profiles.branch_id). user_branch_assignments rows are OVERSIGHT
--      grants and are unlimited — "assigned to a branch" vs "authorized to
--      oversee a branch" are separate concepts (sections 8-9).
--
-- Idempotent; safe to replay.

-- =====================================================================
-- 1. Location-level oversight assignments
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_location_assignments (
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_user_location_assignments_location
  ON user_location_assignments (location_id);

ALTER TABLE user_location_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_location_assignments_select ON user_location_assignments;
CREATE POLICY user_location_assignments_select ON user_location_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

-- =====================================================================
-- 2. can_access_branch: super | primary branch | branch oversight |
--    managed branch | LOCATION oversight | ADMIN business oversight
-- =====================================================================
CREATE OR REPLACE FUNCTION can_access_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    JOIN branches b ON b.id = p_branch_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (
        r.name = 'super_admin'
        OR up.branch_id = p_branch_id
        OR EXISTS (SELECT 1 FROM user_branch_assignments ubra
                   WHERE ubra.user_id = up.id AND ubra.branch_id = p_branch_id)
        OR b.manager_id = up.id
        OR EXISTS (SELECT 1 FROM user_location_assignments ula
                   WHERE ula.user_id = up.id AND ula.location_id = b.location_id)
        OR (
          r.name = 'admin'
          AND (
            up.business_id = b.business_id
            OR EXISTS (SELECT 1 FROM user_business_assignments uba
                       WHERE uba.user_id = up.id AND uba.business_id = b.business_id)
          )
        )
      )
  );
$$;

-- =====================================================================
-- 3. my_branch_ids: mirrors can_access_branch for listing/policies
-- =====================================================================
CREATE OR REPLACE FUNCTION my_branch_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id
  FROM branches b
  WHERE EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid() AND up.is_active
      AND (
        r.name = 'super_admin'
        OR up.branch_id = b.id
        OR EXISTS (SELECT 1 FROM user_branch_assignments ubra
                   WHERE ubra.user_id = up.id AND ubra.branch_id = b.id)
        OR b.manager_id = up.id
        OR EXISTS (SELECT 1 FROM user_location_assignments ula
                   WHERE ula.user_id = up.id AND ula.location_id = b.location_id)
        OR (
          r.name = 'admin'
          AND (
            up.business_id = b.business_id
            OR EXISTS (SELECT 1 FROM user_business_assignments uba
                       WHERE uba.user_id = up.id AND uba.business_id = b.business_id)
          )
        )
      )
  );
$$;

-- =====================================================================
-- 4. user_profiles: Admin business-wide directory of non-Admin staff
-- =====================================================================
DROP POLICY IF EXISTS user_profiles_select_scoped ON user_profiles;
CREATE POLICY user_profiles_select_scoped ON user_profiles
  FOR SELECT TO authenticated
  USING (
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
    OR (
      EXISTS (
        SELECT 1 FROM roles r
        WHERE r.id = (current_profile()).role_id AND r.name = 'admin'
      )
      AND user_profiles.business_id IN (SELECT my_business_ids())
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
    )
  );

DROP POLICY IF EXISTS user_profiles_update_scoped ON user_profiles;
CREATE POLICY user_profiles_update_scoped ON user_profiles
  FOR UPDATE TO authenticated
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
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
      AND (
        user_profiles.branch_id IN (SELECT my_branch_ids())
        OR user_profiles.business_id IN (SELECT my_business_ids())
      )
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
      AND user_profiles.role_id NOT IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin'))
      AND (
        user_profiles.branch_id IN (SELECT my_branch_ids())
        OR user_profiles.business_id IN (SELECT my_business_ids())
      )
    )
  );

-- =====================================================================
-- 5. Assets: strictly branch-scoped (consistent with products/inventory).
--    Writes additionally require inventory.manage.
-- =====================================================================
DROP POLICY IF EXISTS inventory_assets_scoped_select ON inventory_assets;
CREATE POLICY inventory_assets_scoped_select ON inventory_assets
  FOR SELECT TO authenticated
  USING (can_access_branch(branch_id));

DROP POLICY IF EXISTS inventory_assets_write ON inventory_assets;
CREATE POLICY inventory_assets_write ON inventory_assets
  FOR ALL TO authenticated
  USING (
    can_access_branch(branch_id)
    AND has_permission('inventory.manage')
  )
  WITH CHECK (
    can_access_branch(branch_id)
    AND has_permission('inventory.manage')
  );

DROP POLICY IF EXISTS asset_movements_scoped_select ON inventory_asset_movements;
CREATE POLICY asset_movements_scoped_select ON inventory_asset_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inventory_assets a
      WHERE a.id = inventory_asset_movements.asset_id
        AND can_access_branch(a.branch_id)
    )
  );

DROP POLICY IF EXISTS asset_movements_write ON inventory_asset_movements;
CREATE POLICY asset_movements_write ON inventory_asset_movements
  FOR ALL TO authenticated
  USING (
    has_permission('inventory.manage')
    AND EXISTS (
      SELECT 1 FROM inventory_assets a
      WHERE a.id = inventory_asset_movements.asset_id
        AND can_access_branch(a.branch_id)
    )
  )
  WITH CHECK (
    has_permission('inventory.manage')
    AND EXISTS (
      SELECT 1 FROM inventory_assets a
      WHERE a.id = inventory_asset_movements.asset_id
        AND can_access_branch(a.branch_id)
    )
  );

-- =====================================================================
-- 6. One Admin per Branch — PRIMARY assignment only (sections 8-9).
--    Oversight rows (user_branch_assignments) are unlimited: they do not
--    make the holder "the Admin of the branch".
-- =====================================================================
CREATE OR REPLACE FUNCTION branch_has_other_admin(p_branch_id uuid, p_exclude_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE r.name = 'admin' AND up.is_active = true
      AND up.branch_id = p_branch_id
      AND up.id <> COALESCE(p_exclude_user, '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;

REVOKE ALL ON FUNCTION branch_has_other_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION branch_has_other_admin(uuid, uuid) TO authenticated;

-- Oversight assignments no longer carry the one-admin restriction.
DROP TRIGGER IF EXISTS trg_enforce_one_admin_per_branch_assignment ON user_branch_assignments;

-- Make sure PostgREST picks up the new function bodies and policies.
NOTIFY pgrst, 'reload schema';
