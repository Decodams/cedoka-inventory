/*
# Create Super Admin Account

## Purpose
Creates the initial super_admin user in auth.users and user_profiles.

## Notes
- Create the Auth user in Supabase Dashboard before applying this migration.
*/

DO $$
DECLARE
  v_user_id uuid;
  v_super_admin_role_id uuid;
BEGIN
  SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
  IF v_super_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'super_admin role not found';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@cedoka.com';
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Create admin@cedoka.com in Supabase Dashboard > Authentication > Users, then run this migration again.';
    RETURN;
  END IF;

  INSERT INTO user_profiles (id, email, full_name, role_id, is_active)
  VALUES (v_user_id, 'admin@cedoka.com', 'Cedoka Super Admin', v_super_admin_role_id, true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role_id = EXCLUDED.role_id,
    is_active = true;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (v_user_id, 'user.created', 'user_profiles', v_user_id,
          jsonb_build_object('email', 'admin@cedoka.com', 'role', 'super_admin', 'source', 'seed'));
END $$;