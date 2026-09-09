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
  v_profile_id uuid;
BEGIN
  SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
  IF v_super_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'super_admin role not found';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles WHERE email = 'admin@cedoka.com';

  SELECT id INTO v_existing FROM auth.users WHERE email = 'admin@cedoka.com';

  IF v_existing IS NOT NULL THEN
    -- Reset every auth field needed for a deterministic first login. This also
    -- repairs partially-created rows from an earlier migration attempt.
    UPDATE auth.users
    SET instance_id = (SELECT id FROM auth.instances LIMIT 1),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
      email_confirmed_at = now(),
        encrypted_password = crypt('Cedoka2026', gen_salt('bf')),
        updated_at = now()
    WHERE id = v_existing;
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
      (SELECT id FROM auth.instances LIMIT 1),
      COALESCE(v_profile_id, gen_random_uuid()),
      'authenticated',
      'authenticated',
      'admin@cedoka.com',
      crypt('Cedoka2026', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
    RETURNING id INTO v_user_id;
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