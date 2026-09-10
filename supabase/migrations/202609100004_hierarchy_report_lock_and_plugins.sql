-- Enforce reporting hierarchy, immutable submissions, and per-user dashboard plugins.

CREATE OR REPLACE FUNCTION can_view_user_records(p_target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE visible_users AS (
    SELECT id, manager_id
    FROM user_profiles
    WHERE id = auth.uid() AND is_active = true
    UNION ALL
    SELECT child.id, child.manager_id
    FROM user_profiles child
    JOIN visible_users parent ON child.manager_id = parent.id
    WHERE child.is_active = true
  )
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles actor
    WHERE actor.id = auth.uid()
      AND actor.is_active = true
      AND (
        actor.role_id = (SELECT id FROM roles WHERE name = 'super_admin')
        OR actor.role_id = (SELECT id FROM roles WHERE name = 'admin')
        OR p_target_user IN (SELECT id FROM visible_users)
      )
  );
$$;

REVOKE ALL ON FUNCTION can_view_user_records (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION can_view_user_records (uuid) TO authenticated;

UPDATE user_profiles staff
SET
    manager_id = branch.manager_id
FROM
    branches branch
    JOIN roles staff_role ON staff_role.name = 'sales_person'
WHERE
    staff.branch_id = branch.id
    AND staff.role_id = staff_role.id
    AND staff.manager_id IS NULL
    AND branch.manager_id IS NOT NULL
    AND branch.manager_id <> staff.id;

DROP POLICY IF EXISTS weekly_reports_scoped_select ON weekly_reports;

DROP POLICY IF EXISTS "weekly_reports_select_authenticated" ON weekly_reports;

CREATE POLICY weekly_reports_scoped_select ON weekly_reports FOR
SELECT TO authenticated USING (
        can_view_user_records (
            COALESCE(submitted_by, created_by)
        )
    );

DROP POLICY IF EXISTS weekly_reports_update_authorized ON weekly_reports;

CREATE POLICY weekly_reports_update_authorized ON weekly_reports FOR
UPDATE TO authenticated USING (
    (
        status = 'draft'
        AND created_by = auth.uid ()
    )
    OR has_permission ('reports.review')
    OR has_permission ('reports.amend')
)
WITH
    CHECK (
        can_view_user_records (
            COALESCE(submitted_by, created_by)
        )
    );

DROP POLICY IF EXISTS weekly_reports_delete_admin_only ON weekly_reports;

CREATE POLICY weekly_reports_delete_admin_only ON weekly_reports FOR DELETE TO authenticated USING (
    has_permission ('reports.amend')
);

CREATE OR REPLACE FUNCTION prevent_submitted_report_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('submitted', 'reviewed', 'amended')
     AND NOT has_permission('reports.amend') THEN
    RAISE EXCEPTION 'Submitted reports can only be edited by Admin or Super Admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS daily_activities_scoped_select ON daily_activities;

DROP POLICY IF EXISTS "daily_activities_select_authenticated" ON daily_activities;

CREATE POLICY daily_activities_scoped_select ON daily_activities FOR
SELECT TO authenticated USING (
        can_view_user_records (recorded_by)
    );

DROP POLICY IF EXISTS daily_sales_scoped_select ON daily_sales;

DROP POLICY IF EXISTS "daily_sales_select_authenticated" ON daily_sales;

CREATE POLICY daily_sales_scoped_select ON daily_sales FOR
SELECT TO authenticated USING (
        can_view_user_records (salesperson_id)
    );

DROP POLICY IF EXISTS operational_expenses_scoped_select ON operational_expenses;

DROP POLICY IF EXISTS "operational_expenses_select_authenticated" ON operational_expenses;

CREATE POLICY operational_expenses_scoped_select ON operational_expenses FOR
SELECT TO authenticated USING (
        can_view_user_records (recorded_by)
    );

CREATE TABLE IF NOT EXISTS user_dashboard_plugins (
    user_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
    plugin_key text NOT NULL,
    is_enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now (),
    PRIMARY KEY (user_id, plugin_key)
);

ALTER TABLE user_dashboard_plugins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_dashboard_plugins_own ON user_dashboard_plugins;

CREATE POLICY user_dashboard_plugins_own ON user_dashboard_plugins FOR ALL TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

INSERT INTO
    user_dashboard_plugins (
        user_id,
        plugin_key,
        is_enabled
    )
SELECT id, 'activity_reports', true
FROM user_profiles
ON CONFLICT (user_id, plugin_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_user_profiles_manager_id ON user_profiles (manager_id);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_submitted_by ON weekly_reports (submitted_by);

CREATE INDEX IF NOT EXISTS idx_daily_activities_recorded_by ON daily_activities (recorded_by);

CREATE INDEX IF NOT EXISTS idx_daily_sales_salesperson_id ON daily_sales (salesperson_id);

CREATE INDEX IF NOT EXISTS idx_operational_expenses_recorded_by ON operational_expenses (recorded_by);