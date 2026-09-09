-- FIX ADMIN LOGIN - copy everything below and Run in Supabase SQL Editor
create extension if not exists pgcrypto;
do $$
declare v_id uuid; v_role uuid; v_inst uuid;
begin
  select id into v_inst from auth.instances limit 1;
  delete from public.user_profiles where email='admin@cedoka.com';
  delete from auth.users where email='admin@cedoka.com';
  select id into v_role from public.roles where name='super_admin';
  if v_role is null then raise exception 'Run migrations 001-003 first: roles missing'; end if;
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_inst, gen_random_uuid(),'authenticated','authenticated','admin@cedoka.com',crypt('Cedoka2026', gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()) returning id into v_id;
  insert into public.user_profiles (id,email,full_name,role_id,is_active) values (v_id,'admin@cedoka.com','Cedoka Super Admin',v_role,true);
  raise notice 'FIXED: %', v_id;
end $$;
select email, email_confirmed_at is not null as confirmed, left(encrypted_password,4) as hash_ok from auth.users where email='admin@cedoka.com';
select email, is_active from public.user_profiles where email='admin@cedoka.com';
