-- Enable RLS on user_unit_assignments.
--
-- 202609160001 created the SELECT policy for this table but never flipped
-- relrowsecurity on, so the policy was inert (verified: relrowsecurity=false
-- on the live database). Enable it and grant the minimum privileges the
-- SECURITY DEFINER helpers (is_assigned_to_unit, can_access_unit) rely on.

ALTER TABLE user_unit_assignments ENABLE ROW LEVEL SECURITY;

-- The helper functions are SECURITY DEFINER and run as the function owner, so
-- they bypass RLS; authenticated users only need SELECT for the own-rows
-- policy to be meaningful (INSERT/UPDATE/DELETE stay managed by whoever has
-- table grants through service role / edge functions).
DROP POLICY IF EXISTS "user_unit_assignments_select_own_or_admin" ON user_unit_assignments;
CREATE POLICY "user_unit_assignments_select_own_or_admin" ON user_unit_assignments FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR can_access_unit (unit_id)
  );
