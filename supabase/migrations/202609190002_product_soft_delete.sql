-- Migration F: soft-delete tombstones for products (master spec section 12).
--
-- Deleting a product is permanent for the business, but the platform must
-- keep a durable record that it existed and was deleted:
--   * audit_log already carries the product.deleted row (unchanged).
--   * products now keeps the row itself as a tombstone (deleted_at/deleted_by)
--     instead of being hard-deleted. Tombstones are hidden from listings by
--     default; Super Admin / Admin can still see them (Products page
--     "Deleted" filter + audit trail), regular staff never do.
--   * is_active is set false on deletion too, so every sale/RPC guard that
--     checks is_active keeps rejecting tombstones even if RLS is bypassed.
--
-- The three historical hard-deleted products are reconstructed as tombstones
-- by a one-off data script (their audit_log rows are the source of truth).
--
-- Idempotent; safe to replay.

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_deleted_at
  ON products (deleted_at) WHERE deleted_at IS NOT NULL;

-- Tombstones visible only to Admins / Super Admin (still scoped by branch).
DROP POLICY IF EXISTS products_scoped_select ON products;
CREATE POLICY products_scoped_select ON products FOR SELECT
  TO authenticated
  USING (
    can_access_branch (products.branch_id)
    AND (
      products.deleted_at IS NULL
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        JOIN roles r ON r.id = up.role_id
        WHERE up.id = auth.uid() AND up.is_active AND r.name IN ('admin', 'super_admin')
      )
    )
  );

-- Tombstones are frozen: no further edits through RLS (only reactivation by
-- a future explicit restore flow could lift this).
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
    products.deleted_at IS NULL
    AND EXISTS (
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
