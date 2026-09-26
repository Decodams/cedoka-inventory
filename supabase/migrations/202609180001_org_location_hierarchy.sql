-- Business -> Location -> Branch hierarchy (spec sections 2, 6, 30).
--
-- Locations are the structural layer between a Business and its Branches:
-- every Branch must belong to exactly one Location of its own Business.
-- The historical free-text `branches.location` column is left untouched for
-- display/back-compat; `branches.location_id` is the authoritative link.
--
-- Also locks down the org-structure writes:
--   * businesses: only Super Admin may create/update businesses.
--   * branches:   Admin+ WITHIN their own businesses only (was: any business).
--
-- Idempotent; safe to replay.

-- ==========================================
-- 1. business_locations table
-- ==========================================
CREATE TABLE IF NOT EXISTS business_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_business_locations_business ON business_locations (business_id);

ALTER TABLE business_locations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 2. RLS: readable by anyone with business access; writes are admin+ scoped
--    (locations drive authorization routing, so they are not open to every
--     authenticated member the way master data is).
-- ==========================================
DROP POLICY IF EXISTS business_locations_select_scoped ON business_locations;
CREATE POLICY business_locations_select_scoped ON business_locations FOR SELECT
  TO authenticated USING (can_access_business (business_id));

DROP POLICY IF EXISTS business_locations_write_admin ON business_locations;
CREATE POLICY business_locations_write_admin ON business_locations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin')
        AND can_access_business (business_locations.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active
        AND r.name IN ('super_admin', 'admin')
        AND can_access_business (business_locations.business_id)
    )
  );

-- ==========================================
-- 3. Backfill: one default Location per Business that has none yet
-- ==========================================
INSERT INTO business_locations (business_id, name)
SELECT b.id, 'Main Location'
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM business_locations bl WHERE bl.business_id = b.id
);

-- ==========================================
-- 4. branches.location_id + backfill from the existing free-text column
-- ==========================================
ALTER TABLE branches ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES business_locations(id) ON DELETE SET NULL;

-- Every current free-text location value is unique within its business
-- (verified on live data), so an exact name match is safe; anything unmatched
-- falls back to the business' default location.
UPDATE branches br
SET location_id = COALESCE(
  (SELECT bl.id FROM business_locations bl
   WHERE bl.business_id = br.business_id
     AND lower(trim(bl.name)) = lower(trim(br.location))),
  (SELECT bl.id FROM business_locations bl
   WHERE bl.business_id = br.business_id
   ORDER BY bl.created_at
   LIMIT 1)
)
WHERE br.location_id IS NULL;

-- If a business somehow has no location row (deleted between steps), recreate
-- the default before proceeding.
UPDATE branches br
SET location_id = (
  SELECT bl.id FROM business_locations bl
  WHERE bl.business_id = br.business_id
  ORDER BY bl.created_at
  LIMIT 1
)
WHERE br.location_id IS NULL
  AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = br.business_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM branches WHERE location_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot link % branch(es) to a business location', (
      SELECT count(*) FROM branches WHERE location_id IS NULL
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_branches_location ON branches (location_id);

-- ==========================================
-- 5. Location must belong to the branch's own Business (spec section 30)
-- ==========================================
CREATE OR REPLACE FUNCTION enforce_branch_location_business()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.location_id IS NOT NULL THEN
    PERFORM 1 FROM business_locations bl
    WHERE bl.id = NEW.location_id AND bl.business_id = NEW.business_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Location must belong to the same Business as the branch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_branch_location_business ON branches;
CREATE TRIGGER trg_enforce_branch_location_business
  BEFORE INSERT OR UPDATE OF business_id, location_id ON branches
  FOR EACH ROW EXECUTE FUNCTION enforce_branch_location_business();

-- ==========================================
-- 6. businesses: only Super Admin writes (spec section 4 — administrative
--    org-structure actions are Super Admin's; admins manage operations inside
--    an existing business, they do not create or rename businesses).
-- ==========================================
DROP POLICY IF EXISTS businesses_insert_admin ON businesses;
DROP POLICY IF EXISTS businesses_update_admin ON businesses;
DROP POLICY IF EXISTS businesses_insert_superuser ON businesses;
DROP POLICY IF EXISTS businesses_update_superuser ON businesses;

DROP POLICY IF EXISTS businesses_write_super ON businesses;
CREATE POLICY businesses_write_super ON businesses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS businesses_update_super ON businesses;
CREATE POLICY businesses_update_super ON businesses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  )
  WITH CHECK (true);

-- ==========================================
-- 7. branches: registry writes are Super Admin's (org structure, spec
--    sections 4/5). Admins manage operations inside an existing branch, they
--    do not create/rename/move branches — and since branch visibility is
--    strict (primary + assignments only in Migration D), a branch an Admin
--    created could not even be listed back to them. The trigger in section 5
--    enforces location ownership on every write, including writes by
--    SECURITY DEFINER functions and the service role.
-- ==========================================
DROP POLICY IF EXISTS branches_insert_admin_or_above ON branches;
DROP POLICY IF EXISTS branches_update_admin_or_above ON branches;

DROP POLICY IF EXISTS branches_insert_super ON branches;
CREATE POLICY branches_insert_super ON branches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS branches_update_super ON branches;
CREATE POLICY branches_update_super ON branches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active AND r.name = 'super_admin'
    )
  )
  WITH CHECK (
    branches.location_id IS NULL
    OR EXISTS (
      SELECT 1 FROM business_locations bl
      WHERE bl.id = branches.location_id AND bl.business_id = branches.business_id
    )
  );
