-- =====================================================================
-- Quotation authorization + conversion test suite
--
-- Runs against the LINKED live database:
--   supabase db query --linked -f supabase/tests/quotation_test.sql
--
-- Everything happens inside ONE transaction and is ROLLBACK'd, so the run
-- leaves no fixture data behind. Fixtures are inserted by the connected
-- superuser (RLS bypassed), then the suite SET ROLE authenticated and
-- impersonates real-shaped users through request.jwt.claims.
--
-- Expected denials are caught and asserted; any unexpected outcome raises
-- an exception starting with 'TEST FAILED:' which aborts the run. A clean
-- run ends with:  NOTICE:  ALL TESTS PASSED
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- FIXTURES (all rolled back at the end)
--   Business A -> Branch A1 ; Business B -> Branch B1
--   Users: manager@A1, manager@B1, salesperson@A1
--   Product P@A1 with 10 units of stock
-- ---------------------------------------------------------------------
INSERT INTO public.businesses (id, name, is_active) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'AZ Quote Business A', true),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'AZ Quote Business B', true);

INSERT INTO public.business_locations (id, business_id, name) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000011', 'bbbbbbbb-0000-4000-8000-000000000001', 'AZ Quote Location A'),
  ('bbbbbbbb-0000-4000-8000-000000000012', 'bbbbbbbb-0000-4000-8000-000000000002', 'AZ Quote Location B');

INSERT INTO public.branches (id, business_id, name, location_id, is_active) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000021', 'bbbbbbbb-0000-4000-8000-000000000001', 'AZ Quote Branch A1', 'bbbbbbbb-0000-4000-8000-000000000011', true),
  ('bbbbbbbb-0000-4000-8000-000000000023', 'bbbbbbbb-0000-4000-8000-000000000002', 'AZ Quote Branch B1', 'bbbbbbbb-0000-4000-8000-000000000012', true);

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000031', 'az-quote-mgr-a1@test.local',   'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000032', 'az-quote-mgr-b1@test.local',   'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000033', 'az-quote-sp-a1@test.local',    'not-a-real-hash', now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.user_profiles (id, email, full_name, role_id, business_id, branch_id, is_active, approval_status) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000031', 'az-quote-mgr-a1@test.local', 'AZ Quote Manager A1',
    (SELECT id FROM roles WHERE name = 'manager'), 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000021', true, 'approved'),
  ('bbbbbbbb-0000-4000-8000-000000000032', 'az-quote-mgr-b1@test.local', 'AZ Quote Manager B1',
    (SELECT id FROM roles WHERE name = 'manager'), 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000023', true, 'approved'),
  ('bbbbbbbb-0000-4000-8000-000000000033', 'az-quote-sp-a1@test.local', 'AZ Quote Salesperson A1',
    (SELECT id FROM roles WHERE name = 'sales_person'), 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000021', true, 'approved');

INSERT INTO public.products (id, business_id, branch_id, name, sku, unit, cost_price, selling_price, is_active) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000041', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000021', 'AZ Quote Product A1', 'AZ-Q-A1', 'pcs', 5, 10, true),
  ('bbbbbbbb-0000-4000-8000-000000000042', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000021', 'AZ Quote Product A1 Second', 'AZ-Q-A1-2', 'pcs', 8, 20, true);

INSERT INTO public.inventory_balances (id, product_id, branch_id, opening_stock, current_stock) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000051', 'bbbbbbbb-0000-4000-8000-000000000041', 'bbbbbbbb-0000-4000-8000-000000000021', 10, 10),
  ('bbbbbbbb-0000-4000-8000-000000000052', 'bbbbbbbb-0000-4000-8000-000000000042', 'bbbbbbbb-0000-4000-8000-000000000021', 10, 10);

-- =====================================================================
-- Impersonation begins
-- =====================================================================
SET ROLE authenticated;

-- =====================================================================
-- Section Q1: manager@A1 can draft a quotation in their own branch
-- =====================================================================
DO $$
DECLARE
  v_quote_id uuid;
  v_num text;
  v_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  SELECT public.generate_quote_number() INTO v_num;
  IF v_num IS NULL OR v_num NOT LIKE 'QT-%' THEN
    RAISE EXCEPTION 'TEST FAILED: Q1 quote number not generated (%', v_num;
  END IF;
  RAISE NOTICE 'PASS Q1.0: quote number generated (%)', v_num;

  INSERT INTO public.quotations (
    id, quote_number, business_id, branch_id, prepared_for, customer_name,
    status, subtotal, total_amount, created_by
  ) VALUES (
    'bbbbbbbb-0000-4000-8000-000000000101', v_num, 'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000021', 'AZ Customer Ltd', 'AZ Customer Ltd',
    'draft', 40, 40, auth.uid()
  );
  v_quote_id := 'bbbbbbbb-0000-4000-8000-000000000101';

  INSERT INTO public.quotation_items (quotation_id, product_id, item_name, quantity, unit_price, line_total, sort_order)
  VALUES (v_quote_id, 'bbbbbbbb-0000-4000-8000-000000000041', 'AZ Quote Product A1', 4, 10, 40, 0);

  SELECT count(*) INTO v_count FROM public.quotations WHERE id = v_quote_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Q1 manager cannot read back own quotation';
  END IF;
  RAISE NOTICE 'PASS Q1.1: manager drafted a quotation in own branch';

  SELECT count(*) INTO v_count FROM public.quotation_items WHERE quotation_id = v_quote_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Q1 manager cannot read back own quotation items';
  END IF;
  RAISE NOTICE 'PASS Q1.2: manager read back own quotation items';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q2: cross-tenant isolation
-- =====================================================================
DO $$
DECLARE
  v_count int;
  v_rows int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000032","role":"authenticated"}', true);

  SELECT count(*) INTO v_count FROM public.quotations
  WHERE id = 'bbbbbbbb-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Q2 manager at B1 can read the A1 quotation';
  END IF;
  RAISE NOTICE 'PASS Q2.1: manager at B1 cannot read the A1 quotation';

  UPDATE public.quotations SET prepared_for = 'hijacked'
  WHERE id = 'bbbbbbbb-0000-4000-8000-000000000101';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Q2 manager at B1 updated the A1 quotation';
  END IF;
  RAISE NOTICE 'PASS Q2.2: manager at B1 cannot update the A1 quotation';

  SELECT count(*) INTO v_count FROM public.quotation_items
  WHERE quotation_id = 'bbbbbbbb-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Q2 manager at B1 can read A1 quotation items';
  END IF;
  RAISE NOTICE 'PASS Q2.3: manager at B1 cannot read A1 quotation items';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q3: role gate - sales_person cannot draft quotations
-- =====================================================================
DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000033","role":"authenticated"}', true);

  BEGIN
    INSERT INTO public.quotations (
      business_id, branch_id, prepared_for, status, created_by
    ) VALUES (
      'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000021',
      'AZ Denied', 'draft', auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: Q3 sales_person was allowed to draft a quotation';
  END IF;
  RAISE NOTICE 'PASS Q3.1: sales_person cannot draft a quotation';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q4: out-of-branch insert is denied
-- =====================================================================
DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  BEGIN
    INSERT INTO public.quotations (
      business_id, branch_id, prepared_for, status, created_by
    ) VALUES (
      'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000023',
      'AZ Wrong Branch', 'draft', auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: Q4 manager drafted a quotation outside their branch scope';
  END IF;
  RAISE NOTICE 'PASS Q4.1: manager cannot draft a quotation in another branch';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q5: conversion to a receipt (sale)
-- =====================================================================
DO $$
DECLARE
  v_sale_id uuid;
  v_count int;
  v_stock numeric;
  v_status text;
  v_link uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  SELECT public.create_sale_from_quotation('bbbbbbbb-0000-4000-8000-000000000101') INTO v_sale_id;
  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: Q5 conversion returned no sale id';
  END IF;
  RAISE NOTICE 'PASS Q5.1: quotation converted to sale (%)', v_sale_id;

  SELECT current_stock INTO v_stock FROM public.inventory_balances
  WHERE product_id = 'bbbbbbbb-0000-4000-8000-000000000041'
    AND branch_id = 'bbbbbbbb-0000-4000-8000-000000000021';
  IF v_stock <> 6 THEN
    RAISE EXCEPTION 'TEST FAILED: Q5 stock after conversion is %, expected 6', v_stock;
  END IF;
  RAISE NOTICE 'PASS Q5.2: stock decremented from 10 to 6';

  SELECT count(*) INTO v_count FROM public.sale_items
  WHERE sale_id = v_sale_id AND product_id = 'bbbbbbbb-0000-4000-8000-000000000041';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Q5 sale has % item rows, expected 1', v_count;
  END IF;
  RAISE NOTICE 'PASS Q5.3: sale item written from the quotation';

  SELECT status, converted_to_sale_id INTO v_status, v_link
  FROM public.quotations WHERE id = 'bbbbbbbb-0000-4000-8000-000000000101';
  IF v_status <> 'converted' OR v_link <> v_sale_id THEN
    RAISE EXCEPTION 'TEST FAILED: Q5 quotation not marked converted (%, %)', v_status, v_link;
  END IF;
  RAISE NOTICE 'PASS Q5.4: quotation marked converted and linked to the sale';

  SELECT count(*) INTO v_count FROM public.inventory_transactions
  WHERE reference_type = 'daily_sale' AND reference_id = v_sale_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Q5 inventory transaction missing (got %)', v_count;
  END IF;
  RAISE NOTICE 'PASS Q5.5: inventory movement recorded for the sale';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q6: double conversion is refused
-- =====================================================================
DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  BEGIN
    PERFORM public.create_sale_from_quotation('bbbbbbbb-0000-4000-8000-000000000101');
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: Q6 a converted quotation was converted again';
  END IF;
  RAISE NOTICE 'PASS Q6.1: double conversion is refused';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q7: cross-tenant conversion is refused
-- =====================================================================
DO $$
DECLARE
  v_denied boolean := false;
  v_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000032","role":"authenticated"}', true);

  -- Manager at B1 may draft their own quotation in their own branch.
  INSERT INTO public.quotations (
    id, quote_number, business_id, branch_id, prepared_for, status, subtotal, total_amount, created_by
  ) VALUES (
    'bbbbbbbb-0000-4000-8000-000000000102', 'QT-TEST-B1', 'bbbbbbbb-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000023', 'AZ B1 Quote', 'draft', 0, 0, auth.uid()
  );
  SELECT count(*) INTO v_count FROM public.quotations
  WHERE id = 'bbbbbbbb-0000-4000-8000-000000000102';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: Q7 manager at B1 cannot read back own quotation';
  END IF;
  RAISE NOTICE 'PASS Q7.1: manager at B1 drafted a quotation in own branch';

  -- ...but may not convert somebody else's quotation.
  BEGIN
    PERFORM public.create_sale_from_quotation('bbbbbbbb-0000-4000-8000-000000000101');
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: Q7 manager at B1 converted the A1 quotation';
  END IF;
  RAISE NOTICE 'PASS Q7.2: manager at B1 cannot convert the A1 quotation';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q8: a custom item (no linked product) blocks conversion
-- =====================================================================
DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  INSERT INTO public.quotations (
    id, quote_number, business_id, branch_id, prepared_for, status, subtotal, total_amount, created_by
  ) VALUES (
    'bbbbbbbb-0000-4000-8000-000000000103', 'QT-TEST-CUSTOM', 'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000021', 'AZ Custom Quote', 'draft', 10, 10, auth.uid()
  );

  INSERT INTO public.quotation_items (quotation_id, product_id, item_name, quantity, unit_price, line_total, sort_order)
  VALUES ('bbbbbbbb-0000-4000-8000-000000000103', NULL, 'AZ Custom Line', 1, 10, 10, 0);

  BEGIN
    PERFORM public.create_sale_from_quotation('bbbbbbbb-0000-4000-8000-000000000103');
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: Q8 a quotation with an unlinked custom item was converted';
  END IF;
  RAISE NOTICE 'PASS Q8.1: custom item without a product blocks conversion';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q9: insufficient stock blocks conversion
-- =====================================================================
DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  INSERT INTO public.quotations (
    id, quote_number, business_id, branch_id, prepared_for, status, subtotal, total_amount, created_by
  ) VALUES (
    'bbbbbbbb-0000-4000-8000-000000000104', 'QT-TEST-STOCK', 'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000021', 'AZ Oversell Quote', 'draft', 999, 999, auth.uid()
  );

  INSERT INTO public.quotation_items (quotation_id, product_id, item_name, quantity, unit_price, line_total, sort_order)
  VALUES ('bbbbbbbb-0000-4000-8000-000000000104', 'bbbbbbbb-0000-4000-8000-000000000041', 'AZ Oversell Line', 999, 1, 999, 0);

  BEGIN
    PERFORM public.create_sale_from_quotation('bbbbbbbb-0000-4000-8000-000000000104');
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: Q9 a quotation beyond available stock was converted';
  END IF;
  RAISE NOTICE 'PASS Q9.1: insufficient stock blocks conversion';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q10: the receipt built from a quotation shows the right numbers
--
-- The receipt PDF derives every figure from the sale rows:
--   total    = SUM(qty * unit_price - sale_items.discount_value)
--   subtotal = total + daily_sales.discount_value
--   balance  = total - daily_sales.amount_paid
-- A quotation carrying a header discount must convert into a sale whose
-- discount, total and balance all agree with the quotation.
-- =====================================================================
DO $$
DECLARE
  v_sale_id uuid;
  v_header_discount numeric;
  v_item_discount numeric;
  v_gross numeric;
  v_receipt_total numeric;
  v_amount_paid numeric;
  v_quote_total numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  INSERT INTO public.quotations (
    id, quote_number, business_id, branch_id, prepared_for, status,
    discount_value, subtotal, total_amount, created_by
  ) VALUES (
    'bbbbbbbb-0000-4000-8000-000000000105', 'QT-TEST-AMOUNTS', 'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000021', 'AZ Amounts Quote', 'draft',
    4, 40, 36, auth.uid()
  );

  -- 2 x 10 = 20 gross  +  1 x 20 = 20 gross  ->  subtotal 40, discount 4, total 36
  INSERT INTO public.quotation_items (quotation_id, product_id, item_name, quantity, unit_price, line_total, sort_order)
  VALUES
    ('bbbbbbbb-0000-4000-8000-000000000105', 'bbbbbbbb-0000-4000-8000-000000000041', 'AZ Line One', 2, 10, 20, 0),
    ('bbbbbbbb-0000-4000-8000-000000000105', 'bbbbbbbb-0000-4000-8000-000000000042', 'AZ Line Two', 1, 20, 20, 1);

  SELECT public.create_sale_from_quotation('bbbbbbbb-0000-4000-8000-000000000105') INTO v_sale_id;
  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: Q10 conversion returned no sale id';
  END IF;

  SELECT discount_value INTO v_header_discount FROM public.daily_sales WHERE id = v_sale_id;
  SELECT COALESCE(SUM(discount_value), 0) INTO v_item_discount FROM public.sale_items WHERE sale_id = v_sale_id;
  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_gross FROM public.sale_items WHERE sale_id = v_sale_id;
  SELECT COALESCE(SUM(quantity * unit_price - discount_value), 0) INTO v_receipt_total
    FROM public.sale_items WHERE sale_id = v_sale_id;
  SELECT amount_paid INTO v_amount_paid FROM public.daily_sales WHERE id = v_sale_id;
  SELECT total_amount INTO v_quote_total FROM public.quotations WHERE id = 'bbbbbbbb-0000-4000-8000-000000000105';

  IF v_header_discount <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED: Q10 sale header discount is %, expected 4', v_header_discount;
  END IF;
  RAISE NOTICE 'PASS Q10.1: header discount carried onto the sale';

  IF v_item_discount <> v_header_discount THEN
    RAISE EXCEPTION 'TEST FAILED: Q10 item discounts (%) do not match the header discount (%)', v_item_discount, v_header_discount;
  END IF;
  RAISE NOTICE 'PASS Q10.2: the discount was allocated across the line items';

  IF v_gross <> 40 THEN
    RAISE EXCEPTION 'TEST FAILED: Q10 receipt subtotal is %, expected 40', v_gross;
  END IF;
  RAISE NOTICE 'PASS Q10.3: receipt subtotal equals the quotation subtotal';

  IF v_receipt_total <> v_quote_total THEN
    RAISE EXCEPTION 'TEST FAILED: Q10 receipt total is %, quotation total is %', v_receipt_total, v_quote_total;
  END IF;
  RAISE NOTICE 'PASS Q10.4: receipt total equals the quotation total';

  IF v_amount_paid <> v_receipt_total THEN
    RAISE EXCEPTION 'TEST FAILED: Q10 amount paid is %, receipt total is %', v_amount_paid, v_receipt_total;
  END IF;
  IF (v_receipt_total - v_amount_paid) <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Q10 receipt balance is not zero';
  END IF;
  RAISE NOTICE 'PASS Q10.5: receipt balance is zero';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Section Q11: a quotation that carries VAT cannot be converted
-- (the receipt document has no VAT line and would mis-state the total)
-- =====================================================================
DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000031","role":"authenticated"}', true);

  INSERT INTO public.quotations (
    id, quote_number, business_id, branch_id, prepared_for, status,
    tax_value, subtotal, total_amount, created_by
  ) VALUES (
    'bbbbbbbb-0000-4000-8000-000000000106', 'QT-TEST-VAT', 'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000021', 'AZ VAT Quote', 'draft',
    5, 100, 105, auth.uid()
  );

  INSERT INTO public.quotation_items (quotation_id, product_id, item_name, quantity, unit_price, line_total, sort_order)
  VALUES ('bbbbbbbb-0000-4000-8000-000000000106', 'bbbbbbbb-0000-4000-8000-000000000041', 'AZ VAT Line', 5, 20, 100, 0);

  BEGIN
    PERFORM public.create_sale_from_quotation('bbbbbbbb-0000-4000-8000-000000000106');
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: Q11 a quotation carrying VAT was converted';
  END IF;
  RAISE NOTICE 'PASS Q11.1: a VAT quotation cannot be converted';

  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

-- =====================================================================
-- Runner result
-- =====================================================================
RESET ROLE;
DO $$
BEGIN
  RAISE NOTICE 'ALL TESTS PASSED';
END $$;

ROLLBACK;

SELECT 'ALL TESTS PASSED' AS result, 'quotation_test.sql completed; transaction rolled back' AS note;
