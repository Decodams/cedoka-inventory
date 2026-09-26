-- =====================================================================
-- Authorization test suite (spec sections 27 and 31)
--
-- Runs against the LINKED live database:
--   supabase db query --linked -f supabase/tests/authorization_test.sql
--
-- Everything happens inside ONE transaction and is ROLLBACK'd, so the run
-- leaves no fixture data behind (cleanup by construction). Fixtures are
-- inserted by the connected superuser (RLS bypassed), then the suite
-- SET ROLE authenticated and impersonates real-shaped users through
-- request.jwt.claims so auth.uid() and every RLS policy / SECURITY DEFINER
-- helper evaluate exactly as they do in production.
--
-- Expected denials are caught and asserted; any unexpected outcome raises
-- an exception starting with 'TEST FAILED:' which aborts the run. A clean
-- run ends with:  NOTICE:  ALL TESTS PASSED
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- FIXTURES (all rolled back at the end)
--   Business A  -> Branch A1, Branch A2
--   Business B  -> Branch B1
--   Users: admin@A1, admin@A2, admin@B1, manager@A1, salesperson@A1,
--          inventory officer@A1, manager@B1
--   Products: P@A1, P@A2, P@B1 (+ balances, one inventory transaction)
--   Transfers: T1 A1->A2 'requested', T2 A1->A2 'dispatched'
--   Sales: one completed sale at B1 (for cross-tenant visibility checks)
-- ---------------------------------------------------------------------
INSERT INTO public.businesses (id, name, is_active) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'AZ Auth Test Business A', true),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'AZ Auth Test Business B', true);

INSERT INTO public.business_locations (id, business_id, name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000001', 'AZ Location A'),
  ('aaaaaaaa-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000002', 'AZ Location B');

INSERT INTO public.branches (id, business_id, name, location_id, is_active) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000001', 'AZ Branch A1', 'aaaaaaaa-0000-4000-8000-000000000011', true),
  ('aaaaaaaa-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000001', 'AZ Branch A2', 'aaaaaaaa-0000-4000-8000-000000000011', true),
  ('aaaaaaaa-0000-4000-8000-000000000023', 'aaaaaaaa-0000-4000-8000-000000000002', 'AZ Branch B1', 'aaaaaaaa-0000-4000-8000-000000000012', true),
  ('aaaaaaaa-0000-4000-8000-000000000024', 'aaaaaaaa-0000-4000-8000-000000000001', 'AZ Branch A3 (vacant)', 'aaaaaaaa-0000-4000-8000-000000000011', true);

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000031', 'az-admin-a1@test.local', 'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000032', 'az-admin-a2@test.local', 'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000033', 'az-admin-b1@test.local', 'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000034', 'az-mgr-a1@test.local',  'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000035', 'az-sp-a1@test.local',   'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000036', 'az-inv-a1@test.local',   'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000038', 'az-mgr-b1@test.local',   'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.user_profiles (id, email, full_name, role_id, business_id, branch_id, is_active, approval_status) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000031', 'az-admin-a1@test.local', 'AZ Admin A1',
    (SELECT id FROM roles WHERE name = 'admin'), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021', true, 'approved'),
  ('aaaaaaaa-0000-4000-8000-000000000032', 'az-admin-a2@test.local', 'AZ Admin A2',
    (SELECT id FROM roles WHERE name = 'admin'), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000022', true, 'approved'),
  ('aaaaaaaa-0000-4000-8000-000000000033', 'az-admin-b1@test.local', 'AZ Admin B1',
    (SELECT id FROM roles WHERE name = 'admin'), 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000023', true, 'approved'),
  ('aaaaaaaa-0000-4000-8000-000000000034', 'az-mgr-a1@test.local', 'AZ Manager A1',
    (SELECT id FROM roles WHERE name = 'manager'), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021', true, 'approved'),
  ('aaaaaaaa-0000-4000-8000-000000000035', 'az-sp-a1@test.local', 'AZ Salesperson A1',
    (SELECT id FROM roles WHERE name = 'sales_person'), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021', true, 'approved'),
  ('aaaaaaaa-0000-4000-8000-000000000036', 'az-inv-a1@test.local', 'AZ Inventory Officer A1',
    (SELECT id FROM roles WHERE name = 'inventory_officer'), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021', true, 'approved'),
  ('aaaaaaaa-0000-4000-8000-000000000038', 'az-mgr-b1@test.local', 'AZ Manager B1',
    (SELECT id FROM roles WHERE name = 'manager'), 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000023', true, 'approved');

INSERT INTO public.products (id, business_id, branch_id, name, sku, unit, cost_price, selling_price, is_active) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021', 'AZ Product A1', 'AZ-A1', 'pcs', 5, 10, true),
  ('aaaaaaaa-0000-4000-8000-000000000042', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000022', 'AZ Product A2', 'AZ-A2', 'pcs', 5, 10, true),
  ('aaaaaaaa-0000-4000-8000-000000000043', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000023', 'AZ Product B1', 'AZ-B1', 'pcs', 5, 10, true);

INSERT INTO public.inventory_balances (id, product_id, branch_id, opening_stock, current_stock) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000051', 'aaaaaaaa-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000021', 10, 10),
  ('aaaaaaaa-0000-4000-8000-000000000052', 'aaaaaaaa-0000-4000-8000-000000000042', 'aaaaaaaa-0000-4000-8000-000000000022', 7, 7),
  ('aaaaaaaa-0000-4000-8000-000000000053', 'aaaaaaaa-0000-4000-8000-000000000043', 'aaaaaaaa-0000-4000-8000-000000000023', 4, 4);

-- A pre-existing transaction at B1 so cross-tenant visibility checks are meaningful.
INSERT INTO public.inventory_transactions (product_id, branch_id, movement_type, quantity, reason, actor_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000043', 'aaaaaaaa-0000-4000-8000-000000000023', 'opening_balance', 4, 'AZ fixture opening',
   'aaaaaaaa-0000-4000-8000-000000000033');

INSERT INTO public.stock_transfers (id, from_branch_id, to_branch_id, requested_by, status, transfer_number) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000061', 'aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000034', 'requested', 'AZ-TR-1'),
  ('aaaaaaaa-0000-4000-8000-000000000062', 'aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000034', 'dispatched', 'AZ-TR-2');

-- A completed sale at B1 recorded by the B1 admin (fixture, for visibility checks).
INSERT INTO public.daily_sales (business_id, branch_id, salesperson_id, sale_date, quantity, unit_price, amount_paid, status, customer_name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000023', 'aaaaaaaa-0000-4000-8000-000000000033', CURRENT_DATE, 1, 10, 10, 'completed', 'AZ Walk-in B1');

-- =====================================================================
-- Impersonation begins: everything below runs as role "authenticated"
-- with request.jwt.claims carrying the acting user's subject.
-- =====================================================================
SET ROLE authenticated;

-- =====================================================================
-- Section 27A: BUSINESS ISOLATION
-- =====================================================================
DO $$
DECLARE
  v_count int;
  v_rows int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);

  SELECT count(*) INTO v_count FROM public.businesses;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: 27A admin must see exactly 1 business, got %', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.businesses WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'TEST FAILED: 27A admin can see the other business';
  END IF;
  RAISE NOTICE 'PASS 27A.1: admin sees only own business';

  UPDATE public.businesses SET name = name WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: 27A admin updated a foreign business (% rows)', v_rows;
  END IF;
  RAISE NOTICE 'PASS 27A.2: admin cannot update a foreign business';

  BEGIN
    INSERT INTO public.businesses (name) VALUES ('AZ Rogue Business');
    RAISE EXCEPTION 'TEST FAILED: 27A admin inserted a business';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27A.3: admin cannot insert a business (super-only writes)';
  END;

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section 27B: LOCATION LAYER
-- =====================================================================
DO $$
DECLARE
  v_count int;
  v_rows int;
  v_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);

  SELECT count(*) INTO v_count FROM public.business_locations;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.business_locations WHERE business_id = 'aaaaaaaa-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'TEST FAILED: 27B admin sees % locations (expected only own business''s)', v_count;
  END IF;
  RAISE NOTICE 'PASS 27B.1: locations are business-scoped for admin';

  INSERT INTO public.business_locations (business_id, name)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'AZ Admin Created Location')
  RETURNING id INTO v_id;
  RAISE NOTICE 'PASS 27B.2: admin can create a location in own business';

  BEGIN
    INSERT INTO public.business_locations (business_id, name)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'AZ Rogue Location');
    RAISE EXCEPTION 'TEST FAILED: 27B admin created a location for a foreign business';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27B.3: admin cannot create a location for a foreign business';
  END;

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section 27C: BRANCH ISOLATION (visibility + write scope)
-- =====================================================================
DO $$
DECLARE
  v_count int;
  v_rows int;
BEGIN
  -- admin@A1: branches
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);
  SELECT count(*) INTO v_count FROM public.branches;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = 'aaaaaaaa-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C admin sees % branches (expected exactly own branch)', v_count;
  END IF;
  RAISE NOTICE 'PASS 27C.1: admin sees exactly own branch';

  BEGIN
    INSERT INTO public.branches (business_id, name)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'AZ Rogue Branch');
    RAISE EXCEPTION 'TEST FAILED: 27C admin inserted a branch (registry is super-only)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27C.2: admin cannot create branches (super-only writes)';
  END;

  UPDATE public.branches SET name = name WHERE id = 'aaaaaaaa-0000-4000-8000-000000000021';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: 27C admin updated own branch (% rows) - registry is super-only', v_rows;
  END IF;
  RAISE NOTICE 'PASS 27C.3: admin cannot edit branch registry rows';

  -- admin@A1: products
  SELECT count(*) INTO v_count FROM public.products;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = 'aaaaaaaa-0000-4000-8000-000000000041') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C admin sees % products (expected only own-branch product)', v_count;
  END IF;
  RAISE NOTICE 'PASS 27C.4: admin sees exactly own-branch products';

  BEGIN
    INSERT INTO public.products (business_id, branch_id, name, unit)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000022', 'AZ Rogue Product A2', 'pcs');
    RAISE EXCEPTION 'TEST FAILED: 27C admin created a product at a foreign branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27C.5: admin cannot create a product at another branch';
  END;

  BEGIN
    INSERT INTO public.products (business_id, branch_id, name, unit)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000021', 'AZ Rogue Product BIZ', 'pcs');
    RAISE EXCEPTION 'TEST FAILED: 27C admin created a product with a foreign business_id';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27C.6: admin cannot create a product for another business';
  END;

  INSERT INTO public.products (business_id, branch_id, name, unit)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021', 'AZ Admin Own Product', 'pcs');
  RAISE NOTICE 'PASS 27C.7: admin can create a product at own branch';

  BEGIN
    UPDATE public.products SET branch_id = 'aaaaaaaa-0000-4000-8000-000000000022'
    WHERE name = 'AZ Admin Own Product';
    RAISE EXCEPTION 'TEST FAILED: 27C product branch was changed (must be immutable)';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%cannot be changed%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27C wrong error for branch move: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27C.8: product branch is immutable';
  END;

  -- balances + transactions
  SELECT count(*) INTO v_count FROM public.inventory_balances;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.inventory_balances WHERE id = 'aaaaaaaa-0000-4000-8000-000000000051') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C admin sees % balances (expected only own branch)', v_count;
  END IF;
  RAISE NOTICE 'PASS 27C.9: admin sees exactly own-branch balances';

  BEGIN
    INSERT INTO public.inventory_balances (product_id, branch_id, current_stock)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000042', 'aaaaaaaa-0000-4000-8000-000000000021', 1);
    RAISE EXCEPTION 'TEST FAILED: 27C balance created for a product at another branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27C.10: balances require the product to live at the same branch';
  END;

  IF EXISTS (SELECT 1 FROM public.inventory_transactions WHERE branch_id <> 'aaaaaaaa-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C admin can see foreign-branch inventory transactions';
  END IF;
  RAISE NOTICE 'PASS 27C.11: admin sees exactly own-branch inventory transactions';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- manager@A1 + salesperson@A1: same strict branch visibility
DO $$
DECLARE
  v_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000034","role":"authenticated"}', true);
  IF EXISTS (SELECT 1 FROM public.products WHERE branch_id <> 'aaaaaaaa-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C manager can see a foreign-branch product';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = 'aaaaaaaa-0000-4000-8000-000000000041') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C manager cannot see own-branch product';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products
             WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000042','aaaaaaaa-0000-4000-8000-000000000043')) THEN
    RAISE EXCEPTION 'TEST FAILED: 27C manager can see foreign fixture products';
  END IF;
  SELECT count(*) INTO v_count FROM public.branches;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: 27C manager sees % branches (expected only own branch)', v_count;
  END IF;
  RAISE NOTICE 'PASS 27C.12: manager sees exactly own-branch products and branches';

  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000035","role":"authenticated"}', true);
  IF EXISTS (SELECT 1 FROM public.products WHERE branch_id <> 'aaaaaaaa-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C salesperson can see a foreign-branch product';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = 'aaaaaaaa-0000-4000-8000-000000000041') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C salesperson cannot see own-branch product';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_balances WHERE branch_id <> 'aaaaaaaa-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'TEST FAILED: 27C salesperson can see foreign-branch balances';
  END IF;
  RAISE NOTICE 'PASS 27C.13: salesperson sees exactly own-branch products and balances';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section 27D: ONE ADMIN PER BRANCH + self-scope protection
-- =====================================================================
DO $$
BEGIN
  -- An admin cannot rewrite their own role/scope (spec section 11).
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);
  BEGIN
    UPDATE public.user_profiles SET role_id = (SELECT id FROM roles WHERE name = 'manager')
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000031';
    RAISE EXCEPTION 'TEST FAILED: 27D admin changed their own role';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%own role%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27D wrong error for self-scope change: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27D.1: self role/scope change is blocked';
  END;

  BEGIN
    UPDATE public.user_profiles SET branch_id = 'aaaaaaaa-0000-4000-8000-000000000024'
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000031';
    RAISE EXCEPTION 'TEST FAILED: 27D admin changed their own branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27D.2: self branch change is blocked';
  END;

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- Trigger-level checks (bypass RLS as the connected superuser; the one-admin
-- and self-scope triggers must fire for EVERYONE, including the service role).
RESET ROLE;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- A second active admin at branch A1 (already held by AZ Admin A1).
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000037', 'az-admin-a1-second@test.local', 'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated');
  BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, role_id, business_id, branch_id, is_active, approval_status)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000037', 'az-admin-a1-second@test.local', 'AZ Admin A1 Second',
      (SELECT id FROM roles WHERE name = 'admin'), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021', true, 'approved');
    RAISE EXCEPTION 'TEST FAILED: 27D second admin created at an occupied branch';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%already has an Admin%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27D wrong error for double admin: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27D.3: second admin at occupied branch rejected';
  END;

  -- Moving an existing admin onto an occupied branch.
  BEGIN
    UPDATE public.user_profiles SET branch_id = 'aaaaaaaa-0000-4000-8000-000000000021'
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000032';
    RAISE EXCEPTION 'TEST FAILED: 27D admin moved onto an occupied branch';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%already has an Admin%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27D wrong error for occupied-branch move: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27D.4: moving an admin onto an occupied branch rejected';
  END;

  -- Assignment rows obey the same rule (spec section 12).
  BEGIN
    INSERT INTO public.user_branch_assignments (user_id, branch_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000032', 'aaaaaaaa-0000-4000-8000-000000000021');
    RAISE EXCEPTION 'TEST FAILED: 27D branch assignment created a second admin at A1';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%already has an Admin%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27D wrong error for assignment conflict: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27D.5: branch assignment cannot create a second admin';
  END;

  -- Positive control: assigning the admin to their own branch is fine.
  INSERT INTO public.user_branch_assignments (user_id, branch_id)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000021');
  RAISE NOTICE 'PASS 27D.6: admin can hold an assignment to their own branch';
END $$;

-- =====================================================================
-- Section 27E: IDOR PROTECTION
-- =====================================================================
SET ROLE authenticated;
DO $$
DECLARE
  v_count int;
  v_rows int;
  v_sale uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);

  -- Cannot even SEE a foreign-branch user (spec section 10).
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000033') THEN
    RAISE EXCEPTION 'TEST FAILED: 27E admin can see a user from another branch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000032') THEN
    RAISE EXCEPTION 'TEST FAILED: 27E admin can see an admin from another branch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000035') THEN
    RAISE EXCEPTION 'TEST FAILED: 27E admin cannot see own-branch staff';
  END IF;
  RAISE NOTICE 'PASS 27E.1: user directory is branch-scoped for admin';

  -- Blind write attempt (RLS quietly matches zero rows).
  UPDATE public.user_profiles SET full_name = 'HACKED'
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000033';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: 27E admin updated a foreign user (% rows)', v_rows;
  END IF;
  RAISE NOTICE 'PASS 27E.2: admin cannot modify a foreign user';

  BEGIN
    INSERT INTO public.roles (name, display_name) VALUES ('az_rogue_role', 'AZ Rogue Role');
    RAISE EXCEPTION 'TEST FAILED: 27E admin created a role (roles are super-only)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27E.3: admin cannot create roles';
  END;
  UPDATE public.roles SET display_name = display_name WHERE name = 'manager';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: 27E admin updated a role (% rows)', v_rows;
  END IF;
  RAISE NOTICE 'PASS 27E.4: admin cannot edit roles';

  BEGIN
    INSERT INTO public.categories (business_id, name)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'AZ Rogue Category');
    RAISE EXCEPTION 'TEST FAILED: 27E admin created a category for a foreign business';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27E.5: category writes are business-scoped (no IDOR)';
  END;

  -- Salesperson cannot edit anyone else''s profile.
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000035","role":"authenticated"}', true);
  UPDATE public.user_profiles SET full_name = 'HACKED'
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000034';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: 27E salesperson updated the manager (% rows)', v_rows;
  END IF;
  RAISE NOTICE 'PASS 27E.6: salesperson cannot modify other users';

  -- Salesperson cannot record a sale at a foreign branch or with a
  -- foreign-branch product (spec section 16/17).
  BEGIN
    PERFORM public.create_sale_with_items(
      'aaaaaaaa-0000-4000-8000-000000000023', 'AZ Rogue Customer', 'cash', 10, NULL,
      '[{"product_id":"aaaaaaaa-0000-4000-8000-000000000043","quantity":1,"unit_price":10}]'::jsonb);
    RAISE EXCEPTION 'TEST FAILED: 27E sale created at a foreign branch';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%outside your assigned scope%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27E wrong error for foreign-branch sale: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27E.7: sale at a foreign branch rejected';
  END;

  BEGIN
    PERFORM public.create_sale_with_items(
      'aaaaaaaa-0000-4000-8000-000000000021', 'AZ Rogue Customer', 'cash', 10, NULL,
      '[{"product_id":"aaaaaaaa-0000-4000-8000-000000000042","quantity":1,"unit_price":10}]'::jsonb);
    RAISE EXCEPTION 'TEST FAILED: 27E sale used a product from another branch';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%not stocked at this branch%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27E wrong error for foreign product in sale: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27E.8: sale with another branch''s product rejected';
  END;

  -- Direct table insert with somebody else''s salesperson_id.
  BEGIN
    INSERT INTO public.daily_sales (business_id, branch_id, salesperson_id, sale_date, quantity, unit_price, amount_paid, status)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000021',
            'aaaaaaaa-0000-4000-8000-000000000034', CURRENT_DATE, 1, 10, 10, 'completed');
    RAISE EXCEPTION 'TEST FAILED: 27E salesperson recorded a sale as another user';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27E.9: salesperson can only record sales as themselves';
  END;

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- Transfers: creation scope, permission gate, side-based workflow (section 19)
DO $$
DECLARE
  v_tr uuid;
  v_status text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000034","role":"authenticated"}', true);

  BEGIN
    INSERT INTO public.stock_transfers (from_branch_id, to_branch_id, requested_by, status, transfer_number)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000023',
            'aaaaaaaa-0000-4000-8000-000000000034', 'requested', 'AZ-TR-ROGUE-B');
    RAISE EXCEPTION 'TEST FAILED: 27E cross-business transfer created';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27E.10: transfer across businesses rejected';
  END;

  BEGIN
    INSERT INTO public.stock_transfers (from_branch_id, to_branch_id, requested_by, status, transfer_number)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000022',
            'aaaaaaaa-0000-4000-8000-000000000034', 'requested', 'AZ-TR-ROGUE-A2');
    RAISE EXCEPTION 'TEST FAILED: 27E transfer to an unassigned branch created';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27E.11: transfer outside branch scope rejected';
  END;

  BEGIN
    INSERT INTO public.stock_transfers (from_branch_id, to_branch_id, requested_by, status, transfer_number)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000021',
            'aaaaaaaa-0000-4000-8000-000000000034', 'requested', 'AZ-TR-LOOP');
    RAISE EXCEPTION 'TEST FAILED: 27E self-transfer (same branch) created';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27E.12: same-branch transfer rejected';
  END;

  -- Manager may review/approve on either side of an in-scope transfer.
  PERFORM public.advance_stock_transfer('aaaaaaaa-0000-4000-8000-000000000061', 'reviewed');
  PERFORM public.advance_stock_transfer('aaaaaaaa-0000-4000-8000-000000000061', 'approved');
  SELECT status INTO v_status FROM public.stock_transfers WHERE id = 'aaaaaaaa-0000-4000-8000-000000000061';
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'TEST FAILED: 27E transfer workflow did not advance (status %)', v_status;
  END IF;
  RAISE NOTICE 'PASS 27E.13: manager can review and approve an in-scope transfer';

  -- Manager sits on the SOURCE side only: receive must be denied.
  BEGIN
    PERFORM public.advance_stock_transfer('aaaaaaaa-0000-4000-8000-000000000062', 'received');
    RAISE EXCEPTION 'TEST FAILED: 27E source-side user received a transfer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%destination branch%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27E wrong error for wrong-side receive: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27E.14: receiving requires destination-branch authorization';
  END;

  -- Salesperson lacks transfers.manage entirely.
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000035","role":"authenticated"}', true);
  BEGIN
    PERFORM public.advance_stock_transfer('aaaaaaaa-0000-4000-8000-000000000061', 'dispatched');
    RAISE EXCEPTION 'TEST FAILED: 27E salesperson advanced a transfer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Transfers permission required%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27E wrong error for salesperson transfer: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27E.15: salesperson cannot act on transfers';
  END;

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- User lifecycle RPCs (sections 10 and 12)
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);

  BEGIN
    PERFORM public.deactivate_user('aaaaaaaa-0000-4000-8000-000000000031');
    RAISE EXCEPTION 'TEST FAILED: 27E admin deactivated their own account';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%own account%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27E wrong error for self-deactivation: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27E.16: self-deactivation blocked';
  END;

  BEGIN
    PERFORM public.deactivate_user('aaaaaaaa-0000-4000-8000-000000000033');
    RAISE EXCEPTION 'TEST FAILED: 27E admin deactivated another admin';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%cannot deactivate administrators%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27E wrong error for admin-on-admin deactivate: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27E.17: admins cannot deactivate other admins';
  END;

  BEGIN
    PERFORM public.deactivate_user('aaaaaaaa-0000-4000-8000-000000000038');
    RAISE EXCEPTION 'TEST FAILED: 27E admin deactivated a manager from another business';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%outside your branch scope%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27E wrong error for out-of-scope deactivate: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27E.18: out-of-scope staff cannot be deactivated';
  END;

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section 27F: AUDITED MOVEMENTS
-- =====================================================================
DO $$
DECLARE
  v_stock numeric;
  v_sale uuid;
  v_loc uuid;
BEGIN
  -- Inventory officer records a movement in own branch (spec section 18).
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000036","role":"authenticated"}', true);

  BEGIN
    PERFORM public.record_inventory_movement(
      'aaaaaaaa-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000023',
      'purchase_receipt', 1, 'AZ cross-branch attempt', NULL, NULL);
    RAISE EXCEPTION 'TEST FAILED: 27F movement booked at a foreign branch';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%outside your scope%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27F wrong error for foreign-branch movement: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27F.1: movement at a foreign branch rejected';
  END;

  BEGIN
    PERFORM public.record_inventory_movement(
      'aaaaaaaa-0000-4000-8000-000000000042', 'aaaaaaaa-0000-4000-8000-000000000021',
      'purchase_receipt', 1, 'AZ wrong product', NULL, NULL);
    RAISE EXCEPTION 'TEST FAILED: 27F movement used a product from another branch';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%does not belong to this branch%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27F wrong error for foreign product movement: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27F.2: product/branch mismatch rejected';
  END;

  BEGIN
    PERFORM public.record_inventory_movement(
      'aaaaaaaa-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000021',
      'purchase_receipt', -3, 'AZ negative attempt', NULL, NULL);
    RAISE EXCEPTION 'TEST FAILED: 27F negative quantity accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%greater than zero%' THEN
      RAISE EXCEPTION 'TEST FAILED: 27F wrong error for negative quantity: %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS 27F.3: negative movement quantity rejected';
  END;

  PERFORM public.record_inventory_movement(
    'aaaaaaaa-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000021',
    'purchase_receipt', 1, 'AZ authorized receipt', NULL, NULL);
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_transactions
    WHERE product_id = 'aaaaaaaa-0000-4000-8000-000000000041'
      AND branch_id = 'aaaaaaaa-0000-4000-8000-000000000021'
      AND movement_type = 'purchase_receipt'
      AND actor_id = 'aaaaaaaa-0000-4000-8000-000000000036'
      AND reason = 'AZ authorized receipt') THEN
    RAISE EXCEPTION 'TEST FAILED: 27F movement did not write an attributable transaction row';
  END IF;
  SELECT current_stock INTO v_stock FROM public.inventory_balances
  WHERE product_id = 'aaaaaaaa-0000-4000-8000-000000000041'
    AND branch_id = 'aaaaaaaa-0000-4000-8000-000000000021';
  IF v_stock <> 11 THEN
    RAISE EXCEPTION 'TEST FAILED: 27F expected stock 11 after receipt, got %', v_stock;
  END IF;
  RAISE NOTICE 'PASS 27F.4: authorized movement booked and balance updated';

  -- Sale flow writes sale + movement + audit rows (section 28).
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000035","role":"authenticated"}', true);
  v_sale := public.create_sale_with_items(
    'aaaaaaaa-0000-4000-8000-000000000021', 'AZ Test Customer', 'cash', 10, 'AZ test sale',
    '[{"product_id":"aaaaaaaa-0000-4000-8000-000000000041","quantity":1,"unit_price":10}]'::jsonb);
  IF v_sale IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: 27F sale returned no id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_transactions
    WHERE reference_type = 'daily_sale' AND reference_id = v_sale
      AND branch_id = 'aaaaaaaa-0000-4000-8000-000000000021'
      AND movement_type = 'sale'
      AND actor_id = 'aaaaaaaa-0000-4000-8000-000000000035') THEN
    RAISE EXCEPTION 'TEST FAILED: 27F sale did not write an attributable movement';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE actor_id = 'aaaaaaaa-0000-4000-8000-000000000035'
      AND action = 'sale.created'
      AND target_id = v_sale
      AND branch_id = 'aaaaaaaa-0000-4000-8000-000000000021'
      AND business_id = 'aaaaaaaa-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'TEST FAILED: 27F sale audit row missing or unscoped (branch/business columns)';
  END IF;
  SELECT current_stock INTO v_stock FROM public.inventory_balances
  WHERE product_id = 'aaaaaaaa-0000-4000-8000-000000000041'
    AND branch_id = 'aaaaaaaa-0000-4000-8000-000000000021';
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'TEST FAILED: 27F expected stock 10 after sale, got %', v_stock;
  END IF;
  RAISE NOTICE 'PASS 27F.5: sale written with movement and scoped audit row';

  -- Deactivation is audited too (done as admin@A1, target own-branch staff).
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);
  PERFORM public.deactivate_user('aaaaaaaa-0000-4000-8000-000000000035');
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000035' AND is_active = false) THEN
    RAISE EXCEPTION 'TEST FAILED: 27F deactivate_user did not deactivate the target';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE actor_id = 'aaaaaaaa-0000-4000-8000-000000000031'
      AND action = 'user.deactivated'
      AND target_id = 'aaaaaaaa-0000-4000-8000-000000000035'
      AND branch_id = 'aaaaaaaa-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'TEST FAILED: 27F deactivation audit row missing';
  END IF;
  PERFORM public.activate_user('aaaaaaaa-0000-4000-8000-000000000035');
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000035' AND is_active = true) THEN
    RAISE EXCEPTION 'TEST FAILED: 27F activate_user did not reactivate the target';
  END IF;
  RAISE NOTICE 'PASS 27F.6: deactivation/reactivation works and is audited';

  -- audit_log insert policy: own actor + own branch only; scope auto-filled.
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000034","role":"authenticated"}', true);
  BEGIN
    INSERT INTO public.audit_log (actor_id, action, target_table, branch_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000034', 'az.test', 'x', 'aaaaaaaa-0000-4000-8000-000000000023');
    RAISE EXCEPTION 'TEST FAILED: 27F audit row accepted for a foreign branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27F.7: audit rows cannot target foreign branches';
  END;

  BEGIN
    INSERT INTO public.audit_log (actor_id, action, target_table, branch_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000031', 'az.test', 'x', 'aaaaaaaa-0000-4000-8000-000000000021');
    RAISE EXCEPTION 'TEST FAILED: 27F audit row accepted with another actor';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27F.8: audit rows must be written by their own actor';
  END;

  INSERT INTO public.audit_log (actor_id, action, target_table, branch_id)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000034', 'az.test', 'x', 'aaaaaaaa-0000-4000-8000-000000000021')
  RETURNING id INTO v_loc;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE id = v_loc
      AND business_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      AND branch_id = 'aaaaaaaa-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'TEST FAILED: 27F audit scope columns were not auto-filled';
  END IF;
  RAISE NOTICE 'PASS 27F.9: own-branch audit row written with auto-filled scope';

  -- Manager sees only their own audit rows among the test rows.
  IF EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE action = 'az.test'
      AND actor_id <> 'aaaaaaaa-0000-4000-8000-000000000034') THEN
    RAISE EXCEPTION 'TEST FAILED: 27F manager can see another actor''s audit rows';
  END IF;
  RAISE NOTICE 'PASS 27F.10: audit visibility is actor-scoped';

  -- Cross-tenant sale stays invisible to Business A staff.
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}', true);
  IF EXISTS (
    SELECT 1 FROM public.daily_sales
    WHERE branch_id = 'aaaaaaaa-0000-4000-8000-000000000023') THEN
    RAISE EXCEPTION 'TEST FAILED: 27F admin can see Business B sales';
  END IF;
  RAISE NOTICE 'PASS 27F.11: cross-tenant sales invisible to Business A';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Super Admin positive controls (the reference point for every rule)
-- =====================================================================
DO $$
DECLARE
  v_count int;
  v_rows int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"f87e2e5f-c52e-4b9f-8ac0-d9ce3601c6f2","role":"authenticated"}', true);

  SELECT count(*) INTO v_count FROM public.businesses
  WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: super admin sees % of 2 fixture businesses', v_count;
  END IF;
  RAISE NOTICE 'PASS SUPER.1: super admin sees every business';

  SELECT count(*) INTO v_count FROM public.branches
  WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000021','aaaaaaaa-0000-4000-8000-000000000022','aaaaaaaa-0000-4000-8000-000000000023','aaaaaaaa-0000-4000-8000-000000000024');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED: super admin sees % of 4 fixture branches', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.products
  WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000041','aaaaaaaa-0000-4000-8000-000000000042','aaaaaaaa-0000-4000-8000-000000000043');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED: super admin sees % of 3 fixture products', v_count;
  END IF;
  RAISE NOTICE 'PASS SUPER.2: super admin sees every branch and product';

  UPDATE public.businesses SET name = name
  WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: super admin updated % of 2 fixture businesses', v_rows;
  END IF;
  RAISE NOTICE 'PASS SUPER.3: super admin can edit businesses';

  INSERT INTO public.branches (business_id, name)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'AZ Super Created Branch');
  RAISE NOTICE 'PASS SUPER.4: super admin can create branches';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section 31: runner result
-- =====================================================================
RESET ROLE;
DO $$
BEGIN
  RAISE NOTICE 'ALL TESTS PASSED';
END $$;

ROLLBACK;

SELECT 'ALL TESTS PASSED' AS result, 'authorization_test.sql completed; transaction rolled back' AS note;
