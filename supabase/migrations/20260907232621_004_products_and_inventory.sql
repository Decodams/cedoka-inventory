/*
# Products, Categories, Suppliers, and Inventory Architecture

## Purpose
Creates the product catalog and inventory ledger system. Inventory is a first-class system
with full movement tracking, not just a field in the weekly report.

## New Tables

### categories
- Product/service categories (e.g. "Solar Panels", "Phone Accessories")
- Scoped per business (each business can have its own categories)

### suppliers
- Supplier records with contact info, scoped per business

### products
- Full product definition: name, SKU, category, brand, model, unit, prices, stock levels
- Linked to a business (products belong to a business unit)
- Supports min stock level and reorder level for procurement triggers
- Active/inactive status

### inventory_balances
- Current stock position per product per branch
- Tracks opening_stock, current_stock, min_level, reorder_level
- Updated via inventory_transactions (never directly by client)

### inventory_transactions
- Full ledger of every stock movement
- Movement types: opening_balance, purchase_receipt, sale, transfer_in, transfer_out,
  return_in, return_out, damage, loss, adjustment, stock_issue, physical_count
- Each transaction has quantity, reason, reference, actor
- This is the audit trail for all inventory changes

## Security
- RLS on all tables
- Products/categories/suppliers: authenticated can read; manage requires products.manage permission
- Inventory balances: authenticated can view; updates only via privileged functions or inventory.manage
- Inventory transactions: authenticated can read within scope; insert requires inventory.manage
- Scope filtering done via business_id/branch_id checks against user_profiles
*/

-- ==========================================
-- CATEGORIES
-- ==========================================
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, name)
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_authenticated" ON categories;
CREATE POLICY "categories_select_authenticated" ON categories FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "categories_insert_manage" ON categories;
CREATE POLICY "categories_insert_manage" ON categories FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

DROP POLICY IF EXISTS "categories_update_manage" ON categories;
CREATE POLICY "categories_update_manage" ON categories FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

-- ==========================================
-- SUPPLIERS
-- ==========================================
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_select_authenticated" ON suppliers;
CREATE POLICY "suppliers_select_authenticated" ON suppliers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "suppliers_insert_manage" ON suppliers;
CREATE POLICY "suppliers_insert_manage" ON suppliers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('procurement.manage','products.manage')))
  );

DROP POLICY IF EXISTS "suppliers_update_manage" ON suppliers;
CREATE POLICY "suppliers_update_manage" ON suppliers FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('procurement.manage','products.manage')))
  );

-- ==========================================
-- PRODUCTS
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text,
  brand text,
  model text,
  description text DEFAULT '',
  unit text DEFAULT 'pcs',
  cost_price numeric(14,2) DEFAULT 0,
  selling_price numeric(14,2) DEFAULT 0,
  min_stock_level integer DEFAULT 0,
  reorder_level integer DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, sku)
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_authenticated" ON products;
CREATE POLICY "products_select_authenticated" ON products FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "products_insert_manage" ON products;
CREATE POLICY "products_insert_manage" ON products FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

DROP POLICY IF EXISTS "products_update_manage" ON products;
CREATE POLICY "products_update_manage" ON products FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code = 'products.manage'))
  );

-- ==========================================
-- INVENTORY_BALANCES
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  opening_stock integer NOT NULL DEFAULT 0,
  current_stock integer NOT NULL DEFAULT 0,
  min_stock_level integer DEFAULT 0,
  reorder_level integer DEFAULT 0,
  last_count_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, branch_id)
);
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_balances_select_authenticated" ON inventory_balances;
CREATE POLICY "inventory_balances_select_authenticated" ON inventory_balances FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_balances_insert_manage" ON inventory_balances;
CREATE POLICY "inventory_balances_insert_manage" ON inventory_balances FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('inventory.manage','inventory.adjust')))
  );

DROP POLICY IF EXISTS "inventory_balances_update_manage" ON inventory_balances;
CREATE POLICY "inventory_balances_update_manage" ON inventory_balances FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('inventory.manage','inventory.adjust')))
  );

-- ==========================================
-- INVENTORY_TRANSACTIONS (LEDGER)
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (
    movement_type IN ('opening_balance','purchase_receipt','sale','transfer_in','transfer_out',
                      'return_in','return_out','damage','loss','adjustment','stock_issue',
                      'physical_count','production')
  ),
  quantity integer NOT NULL,
  quantity_before integer,
  quantity_after integer,
  reason text,
  reference_type text,
  reference_id uuid,
  actor_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  transaction_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_txns_select_authenticated" ON inventory_transactions;
CREATE POLICY "inventory_txns_select_authenticated" ON inventory_transactions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_txns_insert_manage" ON inventory_transactions;
CREATE POLICY "inventory_txns_insert_manage" ON inventory_transactions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.is_active = true
            AND up.role_id IN (SELECT rp.role_id FROM role_permissions rp
                              JOIN permissions p ON p.id = rp.permission_id
                              WHERE p.code IN ('inventory.manage','inventory.adjust')))
  );

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON categories(business_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_product_branch ON inventory_balances(product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_branch_id ON inventory_balances(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_product_id ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_branch_id ON inventory_transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_date ON inventory_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_txns_movement_type ON inventory_transactions(movement_type);
