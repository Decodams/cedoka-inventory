-- One Admin per Branch (spec sections 5, 27).
--
-- At any moment a Branch may have at most ONE active Admin — whether that
-- Admin's branch comes from user_profiles.branch_id (primary) or from a
-- user_branch_assignments row. Managers/Supervisors are unrestricted; Super
-- Admin is global and exempt. Branches are nullable for legacy profiles
-- (existing NULL-branch admins are not conflicts).
--
-- Enforced with BEFORE triggers on both write paths plus a SECURITY DEFINER
-- helper so the checks see every admin regardless of the caller's own RLS
-- visibility. Conflicts raise ERRCODE 23505 (unique_violation) with the
-- message the spec mandates, so edge functions can surface it verbatim.
--
-- Idempotent; safe to replay.

-- ---------------------------------------------------------------------
-- 1. Duplicate assignment cleanup + uniqueness
-- ---------------------------------------------------------------------
DELETE FROM user_branch_assignments a
USING user_branch_assignments b
WHERE a.user_id = b.user_id
  AND a.branch_id = b.branch_id
  AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_branch_assignments'::regclass
      AND conname = 'user_branch_assignments_user_branch_key'
  ) THEN
    ALTER TABLE user_branch_assignments
      ADD CONSTRAINT user_branch_assignments_user_branch_key UNIQUE (user_id, branch_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Shared conflict probe
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION branch_has_other_admin(p_branch_id uuid, p_exclude_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    -- Admin whose PRIMARY branch is p_branch_id
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE r.name = 'admin' AND up.is_active = true
      AND up.branch_id = p_branch_id
      AND up.id <> COALESCE(p_exclude_user, '00000000-0000-0000-0000-000000000000'::uuid)
    UNION
    -- Admin explicitly ASSIGNED to p_branch_id
    SELECT 1
    FROM user_branch_assignments ubra
    JOIN user_profiles up ON up.id = ubra.user_id
    JOIN roles r ON r.id = up.role_id
    WHERE r.name = 'admin' AND up.is_active = true
      AND ubra.branch_id = p_branch_id
      AND up.id <> COALESCE(p_exclude_user, '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;

REVOKE ALL ON FUNCTION branch_has_other_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION branch_has_other_admin(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. user_profiles: creation, promotion to Admin, branch change, reactivation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_one_admin_per_branch_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  IF NEW.branch_id IS NULL OR NEW.is_active = false THEN
    RETURN NEW; -- no branch, or leaving service: nothing to conflict with
  END IF;

  SELECT r.name INTO v_role FROM roles r WHERE r.id = NEW.role_id;
  IF v_role <> 'admin' THEN
    RETURN NEW; -- only Admins are limited to one per Branch
  END IF;

  IF branch_has_other_admin(NEW.branch_id, NEW.id) THEN
    RAISE EXCEPTION 'Branch already has an Admin'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_one_admin_per_branch ON user_profiles;
CREATE TRIGGER trg_enforce_one_admin_per_branch
  BEFORE INSERT OR UPDATE OF branch_id, role_id, is_active ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_one_admin_per_branch_profile();

-- ---------------------------------------------------------------------
-- 4. user_branch_assignments: assigning an Admin to a second branch
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_one_admin_per_branch_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT r.name = 'admin' AND up.is_active = true
  INTO v_is_admin
  FROM user_profiles up
  JOIN roles r ON r.id = up.role_id
  WHERE up.id = NEW.user_id;

  IF COALESCE(v_is_admin, false) = false THEN
    RETURN NEW; -- non-admins may hold any number of branch assignments
  END IF;

  IF branch_has_other_admin(NEW.branch_id, NEW.user_id) THEN
    RAISE EXCEPTION 'Branch already has an Admin'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_one_admin_per_branch_assignment ON user_branch_assignments;
CREATE TRIGGER trg_enforce_one_admin_per_branch_assignment
  BEFORE INSERT OR UPDATE ON user_branch_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_one_admin_per_branch_assignment();

-- ---------------------------------------------------------------------
-- 5. Self-protection: a user must not promote themselves, hand themselves a
--    new scope, or flip their own active flag (spec section 24 — privilege
--    escalation through the own-row UPDATE policy). Service role and admin
--    edits of OTHER rows are unaffected (auth.uid() is null or different).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_self_scope_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.id THEN
    IF NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      RAISE EXCEPTION 'You cannot change your own role, scope, or status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_scope_change ON user_profiles;
CREATE TRIGGER trg_prevent_self_scope_change
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_scope_change();
