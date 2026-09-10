/* Fix recursive user_profiles RLS policies. */

DROP POLICY IF EXISTS "user_profiles_select_own" ON user_profiles;

DROP POLICY IF EXISTS "user_profiles_select_admin_or_above" ON user_profiles;

DROP POLICY IF EXISTS "user_profiles_select_manager" ON user_profiles;

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

DROP POLICY IF EXISTS "user_profiles_update_admin_or_above" ON user_profiles;

CREATE POLICY user_profiles_update_scoped ON user_profiles FOR
UPDATE TO authenticated USING (
    auth.uid () = id
    OR EXISTS (
        SELECT 1
        FROM roles r
        WHERE
            r.id = (current_profile ()).role_id
            AND r.name IN ('super_admin', 'admin')
    )
)
WITH
    CHECK (
        auth.uid () = id
        OR EXISTS (
            SELECT 1
            FROM roles r
            WHERE
                r.id = (current_profile ()).role_id
                AND r.name IN ('super_admin', 'admin')
        )
    );