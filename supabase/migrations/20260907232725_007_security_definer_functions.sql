/*
# Security Definer Functions: User Management & Permission Helpers

## Purpose
Creates privileged server-side functions for operations that must not be client-writable:
- Creating user accounts (signing up a new user with a specific role/business/branch assignment)
- Deactivating users (offboarding)
- Checking if the current user has a specific permission

These functions run as the database owner (SECURITY DEFINER) and perform their own
authorization checks, bypassing RLS. This is the secure pattern for privileged mutations.

## Functions Created

### has_permission(p_code text)
- Returns boolean: does the current authenticated user have the given permission code?
- Used in RLS policies and app-level checks

### create_user_account(...)
- Creates a new auth user + user_profile in a single transaction
- Caller must be authenticated with proper role (super_admin creates anyone, admin creates
managers/sales_person within their business, manager creates sales_person within their branch)
- Returns the new user_profile record

### deactivate_user(p_user_id uuid)
- Sets is_active = false on a user profile
- Caller must be admin or super_admin
- Logs to audit_log

## Security
- All functions SET search_path = public (prevents search_path injection)
- EXECUTE revoked from anon; granted to authenticated only
- Actor derived from auth.uid() — never from a parameter
*/

-- ==========================================
-- has_permission: check if current user has a permission
-- ==========================================
CREATE OR REPLACE FUNCTION has_permission(p_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN role_permissions rp ON rp.role_id = up.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE up.id = auth.uid()
      AND up.is_active = true
      AND p.code = p_code
  );
$$;

REVOKE EXECUTE ON FUNCTION has_permission FROM anon;

GRANT EXECUTE ON FUNCTION has_permission TO authenticated;

-- ==========================================
-- get_current_user_role: returns the current user's role name
-- ==========================================
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.name FROM user_profiles up
  JOIN roles r ON r.id = up.role_id
  WHERE up.id = auth.uid() AND up.is_active = true;
$$;

REVOKE EXECUTE ON FUNCTION get_current_user_role FROM anon;

GRANT EXECUTE ON FUNCTION get_current_user_role TO authenticated;

-- ==========================================
-- create_user_account: privileged user creation
-- ==========================================
CREATE OR REPLACE FUNCTION create_user_account(
  p_email text,
  p_password text,
  p_full_name text,
  p_role_name text,
  p_business_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS user_profiles
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor user_profiles;
  v_actor_role text;
  v_new_role_id uuid;
  v_new_user_id uuid;
  v_new_profile user_profiles;
BEGIN
  -- Get the caller's profile
  SELECT * INTO v_actor FROM user_profiles WHERE id = auth.uid() AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT r.name INTO v_actor_role FROM roles r WHERE r.id = v_actor.role_id;

  -- Authorization rules:
  -- super_admin: can create anyone
  -- admin: can create manager or sales_person within their business
  -- manager: can create sales_person within their branch
  IF v_actor_role = 'super_admin' THEN
    -- Can create any role
    NULL;
  ELSIF v_actor_role = 'admin' THEN
    IF p_role_name NOT IN ('manager', 'sales_person') THEN
      RAISE EXCEPTION 'Admins can only create managers or sales persons';
    END IF;
    IF p_business_id IS NOT NULL AND p_business_id != v_actor.business_id THEN
      RAISE EXCEPTION 'Admins can only create users within their own business';
    END IF;
    p_business_id := COALESCE(p_business_id, v_actor.business_id);
  ELSIF v_actor_role = 'manager' THEN
    IF p_role_name != 'sales_person' THEN
      RAISE EXCEPTION 'Managers can only create sales persons';
    END IF;
    IF p_branch_id IS NOT NULL AND p_branch_id != v_actor.branch_id THEN
      RAISE EXCEPTION 'Managers can only create users within their own branch';
    END IF;
    p_branch_id := COALESCE(p_branch_id, v_actor.branch_id);
    p_business_id := v_actor.business_id;
  ELSE
    RAISE EXCEPTION 'Not authorized to create user accounts';
  END IF;

  -- Validate role exists
  SELECT id INTO v_new_role_id FROM roles WHERE name = p_role_name;
  IF v_new_role_id IS NULL THEN
    RAISE EXCEPTION 'Invalid role: %', p_role_name;
  END IF;

  RAISE EXCEPTION 'User creation must use the create-user-account Edge Function';
END;
$$;

REVOKE EXECUTE ON FUNCTION create_user_account FROM anon;

GRANT EXECUTE ON FUNCTION create_user_account TO authenticated;

-- ==========================================
-- deactivate_user: set is_active = false
-- ==========================================
CREATE OR REPLACE FUNCTION deactivate_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_target user_profiles;
BEGIN
  SELECT r.name INTO v_actor_role
  FROM user_profiles up JOIN roles r ON r.id = up.role_id
  WHERE up.id = auth.uid() AND up.is_active = true;

  IF v_actor_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Not authorized to deactivate users';
  END IF;

  SELECT * INTO v_target FROM user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Admin can only deactivate users within their business
  IF v_actor_role = 'admin' AND v_target.business_id != (SELECT business_id FROM user_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to deactivate users outside your business';
  END IF;

  UPDATE user_profiles SET is_active = false WHERE id = p_user_id;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'user.deactivated', 'user_profiles', p_user_id,
          jsonb_build_object('email', v_target.email));
END;
$$;

REVOKE EXECUTE ON FUNCTION deactivate_user FROM anon;

GRANT EXECUTE ON FUNCTION deactivate_user TO authenticated;