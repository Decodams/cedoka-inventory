-- Stock sync integrity: fractional quantities, single-row balance seeding
-- history cleanup, and an atomic GRN receipt endpoint.
--
-- 1) Widen every quantity/threshold column that still used integers so
--    fractional farm goods (2.5 kg bags, 0.75 crates) flow through transfers,
--    GRNs, ledgers and min/reorder levels without rounding or insert errors.
-- 2) Consolidate balance rows duplicated by the old seedBalances (it copied the
--    same opening stock into EVERY branch of the business, so one product
--    appeared once per branch in inventory). Only untouched rows with zero
--    movements are collapsed; each product keeps exactly one row.
-- 3) Backfill balance min/reorder levels from the product master.
-- 4) record_inventory_movement takes numeric(14,2) instead of integer
--    (the integer signature silently rejected fractional movements).
-- 5) record_grn_with_items: atomic GRN (note + items + stock movements +
--    purchase status) so a failed movement can never desync procurement from
--    inventory again.

-- ---------------------------------------------------------------------
-- 1. Fractional quantity widening
-- ---------------------------------------------------------------------
ALTER TABLE inventory_transactions ALTER COLUMN quantity_before TYPE numeric(14, 2);
ALTER TABLE inventory_transactions ALTER COLUMN quantity_after TYPE numeric(14, 2);

ALTER TABLE stock_transfer_items ALTER COLUMN quantity TYPE numeric(14, 2);
ALTER TABLE stock_transfer_items ALTER COLUMN received_quantity TYPE numeric(14, 2);

ALTER TABLE goods_received_items ALTER COLUMN quantity_ordered TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_received TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_damaged TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_rejected TYPE numeric(14, 2);
ALTER TABLE goods_received_items ALTER COLUMN quantity_short TYPE numeric(14, 2);

ALTER TABLE products ALTER COLUMN min_stock_level TYPE numeric(14, 2);
ALTER TABLE products ALTER COLUMN reorder_level TYPE numeric(14, 2);
ALTER TABLE inventory_balances ALTER COLUMN min_stock_level TYPE numeric(14, 2);
ALTER TABLE inventory_balances ALTER COLUMN reorder_level TYPE numeric(14, 2);

-- ---------------------------------------------------------------------
-- 2. Consolidate duplicated balance rows (old seedBalances bug)
-- ---------------------------------------------------------------------
-- Phase A: products with no movements at all and only untouched rows
-- (current = opening) collapse to ONE row: highest stock wins, then earliest
-- branch, then earliest balance row. Covers (1,1,1) -> 1 row of 1 and
-- (0,0,0) -> a single zero row so the product still lists once.
WITH candidates AS (
    SELECT b.product_id
    FROM inventory_balances b
    GROUP BY b.product_id
    HAVING count(*) > 1
        AND bool_and(b.current_stock = b.opening_stock)
        AND NOT EXISTS (
            SELECT 1 FROM inventory_transactions t
            WHERE t.product_id = b.product_id
        )
),
keep AS (
    SELECT DISTINCT ON (b.product_id) b.id
    FROM inventory_balances b
    JOIN candidates c ON c.product_id = b.product_id
    JOIN branches br ON br.id = b.branch_id
    ORDER BY
        b.product_id,
        b.current_stock DESC,
        br.created_at,
        br.name,
        b.id
)
DELETE FROM inventory_balances
WHERE product_id IN (SELECT product_id FROM candidates)
    AND id NOT IN (SELECT id FROM keep);

-- Phase B: products WITH movements may still carry untouched zero rows at
-- branches that never took part (backfill artifacts). Remove them so the
-- inventory list shows each product once per branch that actually holds it.
-- Never removes the last remaining row of a product.
DELETE FROM inventory_balances b
WHERE b.current_stock = 0
    AND b.opening_stock = 0
    AND NOT EXISTS (
        SELECT 1 FROM inventory_transactions t
        WHERE t.product_id = b.product_id
            AND t.branch_id = b.branch_id
    )
    AND EXISTS (
        SELECT 1 FROM inventory_balances o
        WHERE o.product_id = b.product_id
            AND o.id <> b.id
    );

-- ---------------------------------------------------------------------
-- 3. Balance thresholds must mirror the product master
-- ---------------------------------------------------------------------
UPDATE inventory_balances b
SET min_stock_level = p.min_stock_level,
    reorder_level = p.reorder_level
FROM products p
WHERE b.product_id = p.id
    AND (
        b.min_stock_level IS DISTINCT FROM p.min_stock_level
        OR b.reorder_level IS DISTINCT FROM p.reorder_level
    );

-- ---------------------------------------------------------------------
-- 4. record_inventory_movement with numeric quantity
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS record_inventory_movement(uuid, uuid, text, integer, text, text, uuid);

CREATE FUNCTION record_inventory_movement(
    p_product_id uuid,
    p_branch_id uuid,
    p_movement_type text,
    p_quantity numeric(14, 2),
    p_reason text DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL
) RETURNS inventory_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product products;
    v_balance inventory_balances;
    v_before numeric(14, 2);
    v_after numeric(14, 2);
    v_delta numeric(14, 2);
    v_tx inventory_transactions;
BEGIN
    IF NOT has_permission('inventory.manage') AND NOT has_permission('inventory.adjust') THEN
        RAISE EXCEPTION 'Inventory permission required';
    END IF;
    IF NOT can_access_branch(p_branch_id) THEN
        RAISE EXCEPTION 'Branch is outside your scope';
    END IF;
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;
    IF p_movement_type NOT IN (
        'opening_balance', 'purchase_receipt', 'sale', 'transfer_in', 'transfer_out',
        'return_in', 'return_out', 'damage', 'loss', 'adjustment', 'stock_issue',
        'physical_count', 'production'
    ) THEN
        RAISE EXCEPTION 'Invalid movement type';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found or inactive';
    END IF;

    SELECT * INTO v_balance
    FROM inventory_balances
    WHERE product_id = p_product_id AND branch_id = p_branch_id
    FOR UPDATE;

    v_before := COALESCE(v_balance.current_stock, 0);
    v_delta := CASE
        WHEN p_movement_type IN ('purchase_receipt', 'transfer_in', 'return_in', 'production', 'opening_balance') THEN p_quantity
        WHEN p_movement_type IN ('sale', 'transfer_out', 'return_out', 'damage', 'loss', 'stock_issue') THEN -p_quantity
        WHEN p_movement_type = 'physical_count' THEN p_quantity - v_before
        ELSE p_quantity
    END;
    v_after := v_before + v_delta;

    IF v_after < 0 THEN
        RAISE EXCEPTION 'Movement would make stock negative';
    END IF;

    IF v_balance.id IS NULL THEN
        INSERT INTO inventory_balances (
            product_id, branch_id, opening_stock, current_stock, min_stock_level, reorder_level
        ) VALUES (
            p_product_id,
            p_branch_id,
            CASE WHEN p_movement_type = 'opening_balance' THEN p_quantity ELSE 0 END,
            v_after,
            v_product.min_stock_level,
            v_product.reorder_level
        );
    ELSE
        UPDATE inventory_balances
        SET current_stock = v_after,
            last_count_date = CASE WHEN p_movement_type = 'physical_count' THEN CURRENT_DATE ELSE last_count_date END
        WHERE id = v_balance.id;
    END IF;

    INSERT INTO inventory_transactions (
        product_id, branch_id, movement_type, quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, actor_id
    ) VALUES (
        p_product_id, p_branch_id, p_movement_type, p_quantity, v_before, v_after,
        NULLIF(trim(p_reason), ''), p_reference_type, p_reference_id, auth.uid()
    )
    RETURNING * INTO v_tx;

    RETURN v_tx;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, text, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, text, numeric, text, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Atomic GRN: note + items + stock movements + purchase status in one
--    transaction. All-or-nothing, so procurement can never drift from stock.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_grn_with_items(
    p_purchase_request_id uuid,
    p_grn_number text,
    p_items jsonb,
    p_delivery_note_number text DEFAULT NULL,
    p_is_partial boolean DEFAULT false
) RETURNS goods_received_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pr purchase_requests%ROWTYPE;
    v_grn goods_received_notes;
    v_item jsonb;
    v_product_id uuid;
    v_ordered numeric(14, 2);
    v_received numeric(14, 2);
    v_damaged numeric(14, 2);
    v_rejected numeric(14, 2);
    v_short numeric(14, 2);
    v_net numeric(14, 2);
    v_has_outstanding boolean := false;
    v_label text;
BEGIN
    IF NOT has_permission('inventory.manage') AND NOT has_permission('inventory.adjust') THEN
        RAISE EXCEPTION 'Inventory permission required';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'At least one GRN item is required';
    END IF;

    SELECT * INTO v_pr
    FROM purchase_requests
    WHERE id = p_purchase_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase request not found';
    END IF;
    IF v_pr.status NOT IN ('ordered', 'partially_received') THEN
        RAISE EXCEPTION 'Purchase request is "%"; only ordered or partially received requests can receive goods', v_pr.status;
    END IF;
    IF NOT can_access_branch(v_pr.branch_id) THEN
        RAISE EXCEPTION 'Branch is outside your scope';
    END IF;

    INSERT INTO goods_received_notes (
        grn_number, purchase_request_id, branch_id, supplier_id, received_by,
        delivery_note_number, is_partial, received_date
    ) VALUES (
        p_grn_number, v_pr.id, v_pr.branch_id, v_pr.supplier_id, auth.uid(),
        NULLIF(trim(coalesce(p_delivery_note_number, '')), ''), p_is_partial, CURRENT_DATE
    )
    RETURNING * INTO v_grn;

    v_label := 'GRN ' || p_grn_number;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := (v_item ->> 'product_id')::uuid;
        v_ordered := COALESCE((v_item ->> 'quantity_ordered')::numeric, 0);
        v_received := COALESCE((v_item ->> 'quantity_received')::numeric, 0);
        v_damaged := COALESCE((v_item ->> 'quantity_damaged')::numeric, 0);
        v_rejected := COALESCE((v_item ->> 'quantity_rejected')::numeric, 0);
        v_short := COALESCE((v_item ->> 'quantity_short')::numeric, 0);

        IF v_ordered < 0 OR v_received < 0 OR v_damaged < 0 OR v_rejected < 0 OR v_short < 0 THEN
            RAISE EXCEPTION 'Quantities must be zero or more';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id AND is_active) THEN
            RAISE EXCEPTION 'Product % not found or inactive', v_product_id;
        END IF;

        INSERT INTO goods_received_items (
            grn_id, product_id, quantity_ordered, quantity_received,
            quantity_damaged, quantity_rejected, quantity_short, notes
        ) VALUES (
            v_grn.id, v_product_id, v_ordered, v_received,
            v_damaged, v_rejected, v_short,
            NULLIF(trim(v_item ->> 'notes'), '')
        );

        v_net := v_received - v_damaged - v_rejected;
        IF v_net > 0 THEN
            PERFORM record_inventory_movement(
                v_product_id, v_pr.branch_id, 'purchase_receipt', v_net,
                v_label || ' for PO ' || coalesce(v_pr.request_number, left(v_pr.id::text, 8)),
                'goods_received_note', v_grn.id
            );
        END IF;
        IF v_damaged > 0 THEN
            PERFORM record_inventory_movement(
                v_product_id, v_pr.branch_id, 'damage', v_damaged,
                'Damaged on ' || v_label,
                'goods_received_note', v_grn.id
            );
        END IF;
        IF v_short > 0 THEN
            v_has_outstanding := true;
        END IF;
    END LOOP;

    UPDATE purchase_requests
    SET status = CASE
        WHEN (v_has_outstanding OR p_is_partial) THEN 'partially_received'
        ELSE 'received'
    END
    WHERE id = v_pr.id;

    RETURN v_grn;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_grn_with_items(uuid, text, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_grn_with_items(uuid, text, jsonb, text, boolean) TO authenticated;

-- Make sure PostgREST picks up the dropped/created overloads.
NOTIFY pgrst, 'reload schema';
