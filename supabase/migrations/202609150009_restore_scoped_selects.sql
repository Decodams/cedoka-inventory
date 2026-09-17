-- Restore the scoped read policies that migration 012's cleanup block
-- dropped without recreating. Without a SELECT policy, RLS silences every
-- read (empty lists, no error) — this is why saved products, categories,
-- suppliers, transfers and inventory rows were invisible while writes
-- worked. Bodies mirror migration 011's design; business/branch scope
-- (including multi-business assignments) is enforced by
-- can_access_business() / can_access_branch().

DROP POLICY IF EXISTS products_scoped_select ON products;
CREATE POLICY products_scoped_select ON products FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

DROP POLICY IF EXISTS categories_scoped_select ON categories;
CREATE POLICY categories_scoped_select ON categories FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

DROP POLICY IF EXISTS suppliers_scoped_select ON suppliers;

CREATE POLICY suppliers_scoped_select ON suppliers FOR
SELECT TO authenticated USING (
        can_access_business (business_id)
    );

DROP POLICY IF EXISTS issues_scoped_select ON issues;
CREATE POLICY issues_scoped_select ON issues FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS purchase_requests_scoped_select ON purchase_requests;
CREATE POLICY purchase_requests_scoped_select ON purchase_requests FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS goods_received_notes_scoped_select ON goods_received_notes;
CREATE POLICY goods_received_notes_scoped_select ON goods_received_notes FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS stock_transfers_scoped_select ON stock_transfers;
CREATE POLICY stock_transfers_scoped_select ON stock_transfers FOR
SELECT TO authenticated USING (
        can_access_branch (from_branch_id)
        OR can_access_branch (to_branch_id)
    );

DROP POLICY IF EXISTS inventory_balances_scoped_select ON inventory_balances;
CREATE POLICY inventory_balances_scoped_select ON inventory_balances FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS inventory_txns_scoped_select ON inventory_transactions;
CREATE POLICY inventory_txns_scoped_select ON inventory_transactions FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS inventory_periods_scoped_select ON inventory_periods;
CREATE POLICY inventory_periods_scoped_select ON inventory_periods FOR
SELECT TO authenticated USING (can_access_branch (branch_id));

DROP POLICY IF EXISTS inventory_period_lines_scoped_select ON inventory_period_lines;
CREATE POLICY inventory_period_lines_scoped_select ON inventory_period_lines FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1
            FROM inventory_periods p
            WHERE
                p.id = period_id
                AND can_access_branch (p.branch_id)
        )
    );

DROP POLICY IF EXISTS stock_variances_scoped_select ON stock_variances;
CREATE POLICY stock_variances_scoped_select ON stock_variances FOR
SELECT TO authenticated USING (can_access_branch (branch_id));
