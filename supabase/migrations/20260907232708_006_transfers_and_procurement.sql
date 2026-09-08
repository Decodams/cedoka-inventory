/*
# Stock Transfers and Procurement Architecture

## Purpose
Creates stock transfer workflow (branch-to-branch) and procurement lifecycle (purchase requests
through goods received). Inventory only increases when goods are confirmed received, not when
a purchase request is entered.

## New Tables

### stock_transfers
- Branch-to-branch stock transfer tracking
- Workflow: request → review → approved → dispatched → in_transit → received → completed
- Tracks source branch (transfer_out) and destination branch (transfer_in)
- Product, quantity, reason, actor

### stock_transfer_items
- Line items for a transfer (multiple products per transfer)

### purchase_requests
- Procurement lifecycle: request → quoted → ordered → partially_received → received → completed
- Linked to business, branch, supplier
- Financial values: estimated_cost, actual_cost

### purchase_request_items
- Line items: product, quantity ordered, quantity received, unit price
- Outstanding quantity = ordered - received

### goods_received_notes
- Record goods arrival against purchase orders
- Compare ordered vs received, shortages, damaged, rejected
- Supports partial deliveries
- Updates inventory when confirmed

## Security
- RLS on all tables
- transfers.manage / transfers.view permissions for stock_transfers
- procurement.manage / procurement.view for purchase_requests and goods_received_notes
- All authenticated users can read (scope filtering in app)
*/

-- ==========================================
-- STOCK_TRANSFERS
-- ==========================================
CREATE TABLE IF NOT EXISTS stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text,
  from_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  to_branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested','reviewed','approved','dispatched','in_transit','received','completed','rejected')
  ),
  reason text,
  requested_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  dispatched_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_select_authenticated" ON stock_transfers;
CREATE POLICY "stock_transfers_select_authenticated" ON stock_transfers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "stock_transfers_insert_manage" ON stock_transfers;
CREATE POLICY "stock_transfers_insert_manage" ON stock_transfers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

DROP POLICY IF EXISTS "stock_transfers_update_manage" ON stock_transfers;
CREATE POLICY "stock_transfers_update_manage" ON stock_transfers FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

-- ==========================================
-- STOCK_TRANSFER_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  received_quantity integer DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfer_items_select_authenticated" ON stock_transfer_items;
CREATE POLICY "stock_transfer_items_select_authenticated" ON stock_transfer_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "stock_transfer_items_insert_manage" ON stock_transfer_items;
CREATE POLICY "stock_transfer_items_insert_manage" ON stock_transfer_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

DROP POLICY IF EXISTS "stock_transfer_items_update_manage" ON stock_transfer_items;
CREATE POLICY "stock_transfer_items_update_manage" ON stock_transfer_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'transfers.manage'))
  );

-- ==========================================
-- PURCHASE_REQUESTS
-- ==========================================
CREATE TABLE IF NOT EXISTS purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested','quoted','ordered','partially_received','received','completed','rejected','cancelled')
  ),
  estimated_cost numeric(14,2) DEFAULT 0,
  actual_cost numeric(14,2) DEFAULT 0,
  requested_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ordered_at timestamptz,
  expected_delivery_date date,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_requests_select_authenticated" ON purchase_requests;
CREATE POLICY "purchase_requests_select_authenticated" ON purchase_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_requests_insert_manage" ON purchase_requests;
CREATE POLICY "purchase_requests_insert_manage" ON purchase_requests FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "purchase_requests_update_manage" ON purchase_requests;
CREATE POLICY "purchase_requests_update_manage" ON purchase_requests FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- PURCHASE_REQUEST_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS purchase_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received integer NOT NULL DEFAULT 0,
  unit_price numeric(14,2) DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchase_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_request_items_select_authenticated" ON purchase_request_items;
CREATE POLICY "purchase_request_items_select_authenticated" ON purchase_request_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_request_items_insert_manage" ON purchase_request_items;
CREATE POLICY "purchase_request_items_insert_manage" ON purchase_request_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "purchase_request_items_update_manage" ON purchase_request_items;
CREATE POLICY "purchase_request_items_update_manage" ON purchase_request_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- GOODS_RECEIVED_NOTES
-- ==========================================
CREATE TABLE IF NOT EXISTS goods_received_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text,
  purchase_request_id uuid REFERENCES purchase_requests(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  received_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  delivery_note_number text,
  is_partial boolean NOT NULL DEFAULT false,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goods_received_notes_select_authenticated" ON goods_received_notes;
CREATE POLICY "goods_received_notes_select_authenticated" ON goods_received_notes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "goods_received_notes_insert_manage" ON goods_received_notes;
CREATE POLICY "goods_received_notes_insert_manage" ON goods_received_notes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "goods_received_notes_update_manage" ON goods_received_notes;
CREATE POLICY "goods_received_notes_update_manage" ON goods_received_notes FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- GOODS_RECEIVED_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS goods_received_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES goods_received_notes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_ordered integer NOT NULL DEFAULT 0,
  quantity_received integer NOT NULL DEFAULT 0,
  quantity_damaged integer NOT NULL DEFAULT 0,
  quantity_rejected integer NOT NULL DEFAULT 0,
  quantity_short integer NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE goods_received_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goods_received_items_select_authenticated" ON goods_received_items;
CREATE POLICY "goods_received_items_select_authenticated" ON goods_received_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "goods_received_items_insert_manage" ON goods_received_items;
CREATE POLICY "goods_received_items_insert_manage" ON goods_received_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

DROP POLICY IF EXISTS "goods_received_items_update_manage" ON goods_received_items;
CREATE POLICY "goods_received_items_update_manage" ON goods_received_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'procurement.manage'))
  );

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_branch ON stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_branch ON stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_business_branch ON purchase_requests(business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_pr_id ON purchase_request_items(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_branch ON goods_received_notes(branch_id);
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_pr ON goods_received_notes(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_goods_received_items_grn ON goods_received_items(grn_id);
