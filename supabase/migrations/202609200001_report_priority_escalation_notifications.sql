-- ==========================================
-- 202609200001: Report priority, escalation & in-app notifications
-- ==========================================
-- Adds priority + escalation columns to weekly_reports and creates an
-- in-app notifications feed. A SECURITY DEFINER trigger writes a
-- notification whenever a report is submitted with a non-normal priority
-- or is escalated. Recipients (per product decision): the report branch's
-- manager, every admin of the report's business, and all super admins.
-- The acting user never receives a notification about their own action.
-- ==========================================

ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'priority', 'urgent'));
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false;
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS escalated_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_weekly_reports_priority ON weekly_reports (priority);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_escalated ON weekly_reports (escalated);

-- ==========================================
-- NOTIFICATIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'report_priority'
    CHECK (type IN ('report_priority', 'report_escalation')),
  ref_type text NOT NULL DEFAULT 'weekly_reports',
  ref_id uuid NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_ref ON notifications (ref_type, ref_id);

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ==========================================
-- TRIGGER FUNCTION
-- ==========================================
CREATE OR REPLACE FUNCTION notify_weekly_report_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch_name text;
  v_business_name text;
  v_week text;
  v_kind text;
  v_title text;
  v_body text;
  v_recipient uuid;
BEGIN
  IF (NEW.escalated AND (TG_OP = 'UPDATE' AND OLD.escalated IS NOT DISTINCT FROM TRUE)) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_branch_name FROM branches WHERE id = NEW.branch_id;
  SELECT name INTO v_business_name FROM businesses WHERE id = NEW.business_id;
  v_week := to_char(NEW.week_start_date, 'YYYY-MM-DD') || ' – ' || to_char(NEW.week_end_date, 'YYYY-MM-DD');

  IF NEW.escalated THEN
    v_kind := 'report_escalation';
    v_title := 'Report escalated: ' || COALESCE(v_branch_name, 'Unknown branch');
    v_body := COALESCE(v_business_name, '') || ' · ' || v_week || '. A weekly report was escalated for leadership attention.';
  ELSIF NEW.priority <> 'normal'
        AND NEW.status IN ('submitted', 'reviewed')
        AND (TG_OP = 'INSERT' OR OLD.priority IS DISTINCT FROM NEW.priority) THEN
    v_kind := 'report_priority';
    v_title := upper(NEW.priority) || ' report submitted: ' || COALESCE(v_branch_name, 'Unknown branch');
    v_body := COALESCE(v_business_name, '') || ' · ' || v_week || '. Open the report to review.';
  ELSE
    RETURN NEW;
  END IF;

  FOR v_recipient IN
    SELECT manager_id FROM branches WHERE id = NEW.branch_id AND manager_id IS NOT NULL
    UNION
    SELECT up.id
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.is_active = true
      AND r.name = 'admin'
      AND (up.business_id = NEW.business_id
           OR EXISTS (
             SELECT 1 FROM user_business_assignments uba
             WHERE uba.user_id = up.id AND uba.business_id = NEW.business_id
           ))
    UNION
    SELECT up.id
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.is_active = true AND r.name = 'super_admin'
  LOOP
    IF v_recipient IS NOT NULL AND v_recipient IS DISTINCT FROM v_actor THEN
      INSERT INTO notifications (user_id, title, body, type, ref_type, ref_id)
      VALUES (v_recipient, v_title, v_body, v_kind, 'weekly_reports', NEW.id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_weekly_report_hierarchy_notify ON weekly_reports;
CREATE TRIGGER trg_weekly_report_hierarchy_notify
AFTER INSERT OR UPDATE OF priority, status, escalated ON weekly_reports
FOR EACH ROW EXECUTE FUNCTION notify_weekly_report_hierarchy();