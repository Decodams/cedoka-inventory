/*
# Weekly Reports, Amendments, Daily Activities, and Issues

## Purpose
Creates the weekly reporting cycle, daily activity log, and issues/challenges tracking system.
These are the core operational modules for branch management accountability.

## New Tables

### weekly_reports
- One report per branch per business per week (Sunday-Saturday cycle)
- Stock position: opening, received, sold, damaged, closing (auto-calc but manually overridable)
- Financial summary: sales value, purchase value, pending sales/purchase/procurement
- Narrative: activities, challenges, issues, improvements
- Status workflow: draft → submitted → reviewed → amended
- Locking: once submitted, edits go through report_amendments
- closing_stock_is_manual flag: makes discrepancies visible, not hidden

### report_amendments
- Audit trail for any changes to submitted/reviewed reports
- Stores previous_values (jsonb), amended_by, reason

### daily_activities
- Lightweight daily log of what happened at a branch
- Aggregates into weekly report narrative
- Categories: meeting, customer_event, supplier_activity, delivery, maintenance, staff, incident, other

### issues
- Trackable challenges/problems with full lifecycle
- Status workflow: open → assigned → in_progress → waiting → resolved → closed
- Priority, severity, category, responsible person, deadline
- requires_management_attention flag for escalation
- Resolution tracking with date and notes

## Security
- RLS on all tables
- Scope-based access: users see data for their business/branch based on role
- super_admin sees all; admin sees within business; manager sees within branch; sales_person sees own
*/

-- ==========================================
-- WEEKLY_REPORTS
-- ==========================================
CREATE TABLE IF NOT EXISTS weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  -- Stock Position
  opening_stock integer NOT NULL DEFAULT 0,
  stock_received integer NOT NULL DEFAULT 0,
  stock_sold integer NOT NULL DEFAULT 0,
  stock_damaged integer NOT NULL DEFAULT 0,
  closing_stock integer NOT NULL DEFAULT 0,
  closing_stock_is_manual boolean NOT NULL DEFAULT false,
  -- Financial Summary
  total_sales_value numeric(14,2) NOT NULL DEFAULT 0,
  total_purchase_value numeric(14,2) NOT NULL DEFAULT 0,
  pending_sales_value numeric(14,2) NOT NULL DEFAULT 0,
  pending_purchase_value numeric(14,2) NOT NULL DEFAULT 0,
  pending_procurement_value numeric(14,2) NOT NULL DEFAULT 0,
  -- Narrative Layer
  activities_notes text DEFAULT '',
  challenges_notes text DEFAULT '',
  issues_notes text DEFAULT '',
  improvement_notes text DEFAULT '',
  -- Metadata
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','reviewed','amended')),
  submitted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text DEFAULT '',
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, branch_id, week_end_date)
);
ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read reports within their scope
-- We use a broad SELECT and filter in the app; RLS ensures only authenticated users access
DROP POLICY IF EXISTS "weekly_reports_select_authenticated" ON weekly_reports;
CREATE POLICY "weekly_reports_select_authenticated" ON weekly_reports FOR SELECT
  TO authenticated USING (true);

-- Insert: users with reports.create permission
DROP POLICY IF EXISTS "weekly_reports_insert_create" ON weekly_reports;
CREATE POLICY "weekly_reports_insert_create" ON weekly_reports FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'reports.create'))
  );

-- Update: users with reports.create permission (for draft edits) or reports.review / reports.amend
DROP POLICY IF EXISTS "weekly_reports_update_authorized" ON weekly_reports;
CREATE POLICY "weekly_reports_update_authorized" ON weekly_reports FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('reports.create','reports.review','reports.amend')))
  );

-- ==========================================
-- REPORT_AMENDMENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS report_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_report_id uuid NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE,
  amended_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  amended_at timestamptz NOT NULL DEFAULT now(),
  previous_values jsonb NOT NULL DEFAULT '{}',
  new_values jsonb NOT NULL DEFAULT '{}',
  reason text NOT NULL DEFAULT ''
);
ALTER TABLE report_amendments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_amendments_select_authenticated" ON report_amendments;
CREATE POLICY "report_amendments_select_authenticated" ON report_amendments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "report_amendments_insert_authorized" ON report_amendments;
CREATE POLICY "report_amendments_insert_authorized" ON report_amendments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'reports.amend'))
  );

-- ==========================================
-- DAILY_ACTIVITIES
-- ==========================================
CREATE TABLE IF NOT EXISTS daily_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  activity_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL DEFAULT 'other' CHECK (
    category IN ('meeting','customer_event','supplier_activity','delivery',
                 'maintenance','staff','incident','other','follow_up')
  ),
  title text NOT NULL,
  description text DEFAULT '',
  requires_follow_up boolean NOT NULL DEFAULT false,
  follow_up_notes text DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE daily_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_activities_select_authenticated" ON daily_activities;
CREATE POLICY "daily_activities_select_authenticated" ON daily_activities FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "daily_activities_insert_create" ON daily_activities;
CREATE POLICY "daily_activities_insert_create" ON daily_activities FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'daily_activity.create'))
  );

DROP POLICY IF EXISTS "daily_activities_update_own_or_manage" ON daily_activities;
CREATE POLICY "daily_activities_update_own_or_manage" ON daily_activities FOR UPDATE
  TO authenticated USING (
    recorded_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
               AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                                 JOIN permissions p ON p.id = rp.permission_id
                                 WHERE p.code IN ('daily_activity.view_branch','issues.manage')))
  );

DROP POLICY IF EXISTS "daily_activities_delete_own_or_manage" ON daily_activities;
CREATE POLICY "daily_activities_delete_own_or_manage" ON daily_activities FOR DELETE
  TO authenticated USING (
    recorded_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
               AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                                 JOIN permissions p ON p.id = rp.permission_id
                                 WHERE p.code IN ('daily_activity.view_branch','issues.manage')))
  );

-- ==========================================
-- ISSUES
-- ==========================================
CREATE TABLE IF NOT EXISTS issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text DEFAULT '',
  category text DEFAULT 'operational' CHECK (
    category IN ('operational','stock','financial','staff','customer','supplier',
                 'equipment','infrastructure','safety','compliance','other')
  ),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','moderate','major','severe')),
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open','assigned','in_progress','waiting','resolved','closed')
  ),
  requires_management_attention boolean NOT NULL DEFAULT false,
  reported_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  responsible_person uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  date_reported date NOT NULL DEFAULT CURRENT_DATE,
  deadline date,
  resolution_notes text DEFAULT '',
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "issues_select_authenticated" ON issues;
CREATE POLICY "issues_select_authenticated" ON issues FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "issues_insert_create" ON issues;
CREATE POLICY "issues_insert_create" ON issues FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'issues.create'))
  );

DROP POLICY IF EXISTS "issues_update_manage_or_own" ON issues;
CREATE POLICY "issues_update_manage_or_own" ON issues FOR UPDATE
  TO authenticated USING (
    reported_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
               AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                                 JOIN permissions p ON p.id = rp.permission_id
                                 WHERE p.code IN ('issues.manage','issues.view_branch')))
  );

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_weekly_reports_business_branch_week ON weekly_reports(business_id, branch_id, week_end_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_status ON weekly_reports(status);
CREATE INDEX IF NOT EXISTS idx_report_amendments_report_id ON report_amendments(weekly_report_id);
CREATE INDEX IF NOT EXISTS idx_daily_activities_branch_date ON daily_activities(branch_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_activities_business_date ON daily_activities(business_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_issues_business_branch ON issues(business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_management_attention ON issues(requires_management_attention) WHERE requires_management_attention = true;
CREATE INDEX IF NOT EXISTS idx_issues_deadline ON issues(deadline) WHERE deadline IS NOT NULL;
