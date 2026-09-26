-- Migration G: let the soft-delete TRANSITION happen through RLS.
--
-- Migration F (202609190002) required deleted_at IS NULL in BOTH the USING
-- and WITH CHECK clauses of products_update_manage. USING correctly freezes
-- existing tombstones, but WITH CHECK with the same guard also rejected the
-- transition itself: no Admin could soft-delete through RLS (only the edge
-- function, which runs as service_role, was able to). That made the client's
-- direct-delete fallback dead code and the policy self-contradictory.
--
-- Fix: keep USING (existing tombstones stay frozen) and drop the guard from
-- WITH CHECK only. The authorization requirements (products.manage,
-- business scope, branch scope) still decide who may set deleted_at, so
-- regular staff remain unable to delete, and every subsequent edit of an
-- existing tombstone still fails the USING clause.
--
-- Idempotent; safe to replay.

DROP POLICY IF EXISTS products_update_manage ON products;
CREATE POLICY products_update_manage ON products FOR UPDATE
  TO authenticated
  USING (
    products.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN role_permissions rp ON rp.role_id = up.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE up.id = auth.uid() AND up.is_active AND p.code = 'products.manage'
    )
    AND can_access_business (products.business_id)
    AND can_access_branch (products.branch_id)
  );

-- Make sure PostgREST picks up the new policy set.
NOTIFY pgrst, 'reload schema';
