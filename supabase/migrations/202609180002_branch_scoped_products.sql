-- Branch-scoped product records (spec sections 8, 9).
--
-- Products become Branch-owned: `products.branch_id` is NOT NULL and part of
-- the SKU uniqueness scope (UNIQUE(business_id, branch_id, sku)), so the same
-- SKU may exist independently at two branches of one business. RLS visibility
-- moves from business-scope to branch-scope.
--
-- Backfill source: inventory_balances. Verified live: every product has
-- balance rows at exactly one branch, so no product split is needed. Products
-- with no balance row fall back to the business' first active branch. Any
-- product that cannot be placed (or spans branches) aborts the migration.
--
-- Product rows are also given created_by/updated_by/updated_at audit columns
-- (spec section 28) and `branch_id` is made immutable: relocating a product
-- would desynchronise its inventory_balances rows; the supported path is
-- deactivate + recreate.
--
-- Idempotent; safe to replay.

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------
-- 2. Backfill branch from balance history
-- ---------------------------------------------------------------------
-- 2a. Multi-branch products would need a manual split; abort if found.
DO $$
DECLARE v_multi integer;
BEGIN
  SELECT count(*) INTO v_multi FROM (
    SELECT product_id FROM inventory_balances
    GROUP BY product_id
    HAVING count(DISTINCT branch_id) > 1
  ) m;
  IF v_multi > 0 THEN
    RAISE EXCEPTION '% product(s) hold balances at more than one branch and need a manual split before branch-scoping',
      v_multi;
  END IF;
END $$;

-- 2b. Primary backfill: the branch holding the product's balance.
UPDATE products p
SET branch_id = (
  SELECT ib.branch_id FROM inventory_balances ib
  WHERE ib.product_id = p.id
  ORDER BY ib.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE p.branch_id IS NULL;

-- 2c. Products without a balance row: first active branch of their business,
--     then any branch of the business.
UPDATE products p
SET branch_id = (
  SELECT br.id FROM branches br
  WHERE br.business_id = p.business_id AND br.is_active
  ORDER BY br.created_at
  LIMIT 1
)
WHERE p.branch_id IS NULL;

UPDATE products p
SET branch_id = (
  SELECT br.id FROM branches br
  WHERE br.business_id = p.business_id
  ORDER BY br.is_active DESC, br.created_at
  LIMIT 1
)
WHERE p.branch_id IS NULL;

-- 2d. Anything still unplaced (business with no branches) aborts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE branch_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot scope % product(s) to a branch (their business has no branches)',
      (SELECT count(*) FROM products WHERE branch_id IS NULL);
  END IF;
END $$;

ALTER TABLE products ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_branch ON products (branch_id);

-- ---------------------------------------------------------------------
-- 3. SKU uniqueness: per business + branch + sku
-- ---------------------------------------------------------------------
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_business_id_sku_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND conname = 'products_business_branch_sku_key'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_business_branch_sku_key
      UNIQUE (business_id, branch_id, sku);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Audit columns
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION prevent_product_branch_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'Product branch cannot be changed; deactivate the product and recreate it at the target branch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_product_branch_move ON products;
CREATE TRIGGER trg_prevent_product_branch_move
  BEFORE UPDATE OF branch_id ON products
  FOR EACH ROW EXECUTE FUNCTION prevent_product_branch_move();

-- ---------------------------------------------------------------------
-- 5. RLS: branch-scope visibility, branch-scope writes (spec sections 7, 8)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS products_scoped_select ON products;
DROP POLICY IF EXISTS products_select_authenticated ON products;
CREATE POLICY products_scoped_select ON products FOR SELECT
  TO authenticated USING (can_access_branch (products.branch_id));

DROP POLICY IF EXISTS products_insert_manage ON products;
CREATE POLICY products_insert_manage ON products FOR INSERT
  TO authenticated
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

DROP POLICY IF EXISTS products_update_manage ON products;
CREATE POLICY products_update_manage ON products FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
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
