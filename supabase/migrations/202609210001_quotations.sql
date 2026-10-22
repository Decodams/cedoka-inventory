-- ==========================================
-- 202609210001: Quotations feature
-- ==========================================
-- Adds quotations and quotation_items tables with RLS mirroring sales scope.
-- Quotations can be drafted by manager and above; receipts can be created
-- from quotations the user has access to. No salesperson name is shown
-- on the quotation PDF (per spec). Stores prepared_for, location/address,
-- valid_until, notes/terms, and bank details are rendered in the PDF.
-- ==========================================

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  prepared_for text DEFAULT '',
  prepared_for_contact text DEFAULT '',
  location_address text DEFAULT '',
  customer_name text DEFAULT '',
  customer_contact text DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted','cancelled')),
  valid_until date,
  notes text DEFAULT '',
  terms_conditions text DEFAULT '',
  discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  tax_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_value >= 0),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  converted_to_sale_id uuid REFERENCES daily_sales(id) ON DELETE SET NULL,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_quote_number ON quotations (quote_number) WHERE quote_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotations_business_branch ON quotations (business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations (status);
CREATE INDEX IF NOT EXISTS idx_quotations_created_by ON quotations (created_by);

-- Select: authenticated users see within scope (RLS is broad but app filters; DB enforces via role checks below where feasible)
DROP POLICY IF EXISTS "quotations_select_authenticated" ON quotations;
CREATE POLICY "quotations_select_authenticated" ON quotations FOR SELECT
  TO authenticated USING (true);

-- Insert: manager and above can create quotations
DROP POLICY IF EXISTS "quotations_insert_authorized" ON quotations;
CREATE POLICY "quotations_insert_authorized" ON quotations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

-- Update: creator or manager+ within reasonable scope
DROP POLICY IF EXISTS "quotations_update_authorized" ON quotations;
CREATE POLICY "quotations_update_authorized" ON quotations FOR UPDATE
  TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

-- Delete: super admin or creator while draft
DROP POLICY IF EXISTS "quotations_delete_authorized" ON quotations;
CREATE POLICY "quotations_delete_authorized" ON quotations FOR DELETE
  TO authenticated USING (
    (created_by = auth.uid() AND status = 'draft')
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name = 'super_admin'
    )
  );

-- Quotation items
CREATE TABLE IF NOT EXISTS quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  item_name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text DEFAULT '',
  unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items (quotation_id);

DROP POLICY IF EXISTS "quotation_items_select_authenticated" ON quotation_items;
CREATE POLICY "quotation_items_select_authenticated" ON quotation_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "quotation_items_insert_authorized" ON quotation_items;
CREATE POLICY "quotation_items_insert_authorized" ON quotation_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

DROP POLICY IF EXISTS "quotation_items_update_authorized" ON quotation_items;
CREATE POLICY "quotation_items_update_authorized" ON quotation_items FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

DROP POLICY IF EXISTS "quotation_items_delete_authorized" ON quotation_items;
CREATE POLICY "quotation_items_delete_authorized" ON quotation_items FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.is_active = true
        AND r.name IN ('super_admin','admin','manager')
    )
  );

-- Add quotation_id to daily_sales for traceability
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_daily_sales_quotation_id ON daily_sales (quotation_id);

-- Function to generate quote number
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_num integer;
  v_year text := to_char(now(), 'YYYY');
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(quote_number FROM 'QT-' || v_year || '-([0-9]+)') AS integer)), 0) + 1
  INTO v_num
  FROM quotations
  WHERE quote_number LIKE 'QT-' || v_year || '-%';
  RETURN 'QT-' || v_year || '-' || LPAD(v_num::text, 6, '0');
END;
$$;