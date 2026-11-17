-- ============================================
-- 202609240001_hardening.sql
-- Security & correctness hardening from the full-system audit.
-- Safe to run on an existing database (all statements are idempotent).
-- ============================================

-- 1. Drop orphaned permissive policies left over from migration 002.
--    They OR with the scoped policies and weaken least-privilege.
DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
DROP POLICY IF EXISTS audit_log_select_own ON public.audit_log;

-- 2. Drop redundant legacy org-extension policies (the *_scope FOR ALL
--    policies from 202609100001 already cover these tables).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','teams','customers','services','locations','workflows','report_types'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_scoped_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
  END LOOP;
END $$;

-- 3. Quote numbers must be global, not scoped to the caller's branch.
--    (The old invoker-rights MAX() read only the caller's visible rows, so two
--     branches could generate the same number and collide.)
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_num bigint;
  v_year text := to_char(now(), 'YYYY');
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(quote_number FROM 'QT-' || v_year || '-([0-9]+)')::bigint), 0) + 1
  INTO v_num
  FROM quotations
  WHERE quote_number LIKE 'QT-' || v_year || '-%';
  RETURN 'QT-' || v_year || '-' || LPAD(v_num::text, 6, '0');
END;
$$;
REVOKE ALL ON FUNCTION generate_quote_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_quote_number() TO authenticated;

-- 4. Functions from migration 007 revoked EXECUTE from anon only, leaving the
--    default PUBLIC grant intact. Revoke PUBLIC properly, then re-grant.
REVOKE ALL ON FUNCTION has_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_user_account(text, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION deactivate_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION create_user_account(text, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION deactivate_user(uuid) TO authenticated;

-- 5. Recreate sync_weekly_report_stock with correct last-line/rounding math:
--    count target rows ONCE, and keep v_moved accurate when a line is clamped.
CREATE OR REPLACE FUNCTION sync_weekly_report_stock(
  p_report_id uuid,
  p_closing_stock numeric,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_report weekly_reports%rowtype;
  v_total numeric;
  v_diff numeric;
  v_movable numeric;
  v_rec record;
  v_delta numeric;
  v_new numeric;
  v_moved numeric := 0;
  v_lines int := 0;
  v_target_count int;
BEGIN
  SELECT * INTO v_report FROM weekly_reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF NOT can_access_branch(v_report.branch_id) THEN RAISE EXCEPTION 'Report branch is outside your scope'; END IF;
  IF NOT has_permission('inventory.adjust') AND NOT has_permission('inventory.manage') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no inventory adjustment permission');
  END IF;

  SELECT COALESCE(sum(current_stock), 0) INTO v_total
  FROM inventory_balances WHERE branch_id = v_report.branch_id;
  v_diff := p_closing_stock - v_total;
  IF abs(v_diff) < 0.005 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'already aligned', 'system_total', v_total);
  END IF;

  SELECT count(*) INTO v_target_count
  FROM inventory_balances WHERE branch_id = v_report.branch_id AND current_stock > 0;
  IF v_target_count = 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no stock balances to adjust', 'system_total', v_total);
  END IF;
  SELECT COALESCE(sum(current_stock), 0) INTO v_movable
  FROM inventory_balances WHERE branch_id = v_report.branch_id AND current_stock > 0;

  FOR v_rec IN
    SELECT id, product_id, current_stock
    FROM inventory_balances
    WHERE branch_id = v_report.branch_id AND current_stock > 0
    ORDER BY current_stock DESC, id
  LOOP
    v_lines := v_lines + 1;
    IF v_lines = v_target_count THEN
      v_delta := v_diff - v_moved; -- last line absorbs the rounding remainder
    ELSE
      v_delta := round(v_diff * (v_rec.current_stock / v_movable), 2);
    END IF;
    v_new := v_rec.current_stock + v_delta;
    IF v_new < 0 THEN
      v_delta := -v_rec.current_stock;
      v_new := 0;
    END IF;
    v_moved := v_moved + v_delta;
    UPDATE inventory_balances SET current_stock = v_new, updated_at = now() WHERE id = v_rec.id;
    INSERT INTO inventory_transactions
      (product_id, branch_id, movement_type, quantity, quantity_before, quantity_after,
       reason, reference_type, reference_id, actor_id, transaction_date)
    VALUES
      (v_rec.product_id, v_report.branch_id, 'physical_count', abs(v_delta),
       v_rec.current_stock, v_new,
       COALESCE(NULLIF(btrim(p_reason), ''), 'Weekly report closing stock reconciliation'),
       'weekly_report', p_report_id, auth.uid(), now());
  END LOOP;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'report.stock_synced', 'weekly_reports', p_report_id,
          jsonb_build_object('branch_id', v_report.branch_id, 'week_end', v_report.week_end_date,
                             'previous_system_total', v_total, 'reported_closing', p_closing_stock,
                             'difference', v_diff, 'lines_adjusted', v_lines));
  RETURN jsonb_build_object('applied', true, 'system_total', v_total,
                            'reported_closing', p_closing_stock, 'difference', v_diff,
                            'lines_adjusted', v_lines);
END;
$$;
REVOKE ALL ON FUNCTION sync_weekly_report_stock(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_weekly_report_stock(uuid, numeric, text) TO authenticated;

-- 6. Reconciliation periods now follow the same Mon–Sat cycle as weekly
--    reports. Relax the old Sunday-based CHECK (period_end = start + 6) so it
--    accepts both a 5-day (Mon–Sat) and 6-day (Sun–Sat) span.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.inventory_periods'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%period_start%6%'
  LOOP
    EXECUTE format('ALTER TABLE public.inventory_periods DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_periods'::regclass
      AND conname = 'inventory_periods_week_span_check'
  ) THEN
    ALTER TABLE public.inventory_periods
      ADD CONSTRAINT inventory_periods_week_span_check
      CHECK (period_end - period_start IN (5, 6));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
