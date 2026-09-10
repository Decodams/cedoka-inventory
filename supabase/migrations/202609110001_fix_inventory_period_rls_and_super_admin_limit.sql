-- Fix inventory period creation scope and enforce the two-super-admin limit.

CREATE OR REPLACE FUNCTION can_manage_inventory_period(p_business_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles actor
    JOIN roles actor_role ON actor_role.id = actor.role_id
    JOIN branches target_branch ON target_branch.id = p_branch_id
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND target_branch.business_id = p_business_id
      AND (
        actor_role.name = 'super_admin'
        OR (actor_role.name = 'admin' AND actor.business_id = p_business_id)
        OR (actor_role.name = 'manager' AND actor.branch_id = p_branch_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION can_manage_inventory_period (uuid, uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION can_manage_inventory_period (uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS inventory_periods_write ON inventory_periods;

CREATE POLICY inventory_periods_write ON inventory_periods FOR INSERT TO authenticated
WITH
    CHECK (
        can_manage_inventory_period (business_id, branch_id)
    );

DROP POLICY IF EXISTS inventory_periods_update ON inventory_periods;

CREATE POLICY inventory_periods_update ON inventory_periods FOR
UPDATE TO authenticated USING (
    can_manage_inventory_period (business_id, branch_id)
)
WITH
    CHECK (
        can_manage_inventory_period (business_id, branch_id)
    );

DROP POLICY IF EXISTS inventory_lines_write ON inventory_period_lines;

CREATE POLICY inventory_lines_write ON inventory_period_lines FOR INSERT TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM inventory_periods period
            WHERE
                period.id = period_id
                AND can_manage_inventory_period (
                    period.business_id,
                    period.branch_id
                )
        )
    );

DROP POLICY IF EXISTS inventory_lines_update ON inventory_period_lines;

CREATE POLICY inventory_lines_update ON inventory_period_lines FOR
UPDATE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM inventory_periods period
        WHERE
            period.id = period_id
            AND can_manage_inventory_period (
                period.business_id,
                period.branch_id
            )
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM inventory_periods period
            WHERE
                period.id = period_id
                AND can_manage_inventory_period (
                    period.business_id,
                    period.branch_id
                )
        )
    );

CREATE OR REPLACE FUNCTION enforce_super_admin_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  super_admin_role_id uuid;
BEGIN
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin';
  IF NEW.role_id = super_admin_role_id
      AND TG_OP = 'INSERT'
      AND (SELECT count(*) FROM user_profiles WHERE role_id = super_admin_role_id) >= 2 THEN
     RAISE EXCEPTION 'Only two Super Admin accounts are allowed';
  ELSIF NEW.role_id = super_admin_role_id
      AND TG_OP = 'UPDATE'
      AND OLD.role_id <> super_admin_role_id
      AND (SELECT count(*) FROM user_profiles WHERE role_id = super_admin_role_id) >= 2 THEN
    RAISE EXCEPTION 'Only two Super Admin accounts are allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_super_admin_limit ON user_profiles;

CREATE TRIGGER trg_enforce_super_admin_limit
BEFORE INSERT OR UPDATE OF role_id ON user_profiles
FOR EACH ROW EXECUTE FUNCTION enforce_super_admin_limit();