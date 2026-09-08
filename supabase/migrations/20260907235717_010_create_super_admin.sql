/*
# Create Super Admin Account

## Purpose
Creates the initial super_admin user in auth.users and user_profiles.

## Credentials
- Email: admin@cedoka.com
- Password: Cedoka2026
- Role: super_admin (global access, no business/branch assignment)

## Notes
- Password hashed using pgcrypto's crypt() function with bf (blowfish) algorithm
- email_confirmed_at set so login works immediately
- confirmed_at is a generated column — must NOT be inserted
*/

DO $$
DECLARE
  v_user_id uuid;
  v_super_admin_role_id uuid;
  v_existing uuid;
BEGIN
  SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
  IF v_super_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'super_admin role not found';
  END IF;

  SELECT id INTO v_existing FROM user_profiles WHERE email = 'admin@cedoka.com';
  IF v_existing IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_existing FROM auth.users WHERE email = 'admin@cedoka.com';

  IF v_existing IS NOT NULL THEN
    v_user_id := v_existing;
  ELSE
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'admin@cedoka.com',
      crypt('Cedoka2026', gen_salt('bf')),
      now(),
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
    RETURNING id INTO v_user_id;
  END IF;

  INSERT INTO user_profiles (id, email, full_name, role_id, is_active)
  VALUES (v_user_id, 'admin@cedoka.com', 'Cedoka Super Admin', v_super_admin_role_id, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (v_user_id, 'user.created', 'user_profiles', v_user_id,
          jsonb_build_object('email', 'admin@cedoka.com', 'role', 'super_admin', 'source', 'seed'));
END $$;
