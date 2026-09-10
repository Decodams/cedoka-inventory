/* Public staff registration and administrator approval workflow. */

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved' CHECK (
    approval_status IN (
        'pending',
        'approved',
        'rejected'
    )
);

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS approval_reason text;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now ();

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES user_profiles (id) ON DELETE SET NULL;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_profiles_approval_status ON user_profiles (approval_status);

DROP POLICY IF EXISTS user_profiles_select_scoped ON user_profiles;

CREATE POLICY user_profiles_select_scoped ON user_profiles FOR
SELECT TO authenticated USING (
        auth.uid () = id
        OR EXISTS (
            SELECT 1
            FROM roles r
            WHERE
                r.id = (current_profile ()).role_id
                AND r.name IN ('super_admin', 'admin')
        )
        OR (
            EXISTS (
                SELECT 1
                FROM roles r
                WHERE
                    r.id = (current_profile ()).role_id
                    AND r.name = 'manager'
            )
            AND branch_id = (current_profile ()).branch_id
        )
    );