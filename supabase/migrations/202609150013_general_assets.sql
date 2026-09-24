-- General Asset Management: comprehensive, traceable asset inventory.
-- Extends existing inventory_balances/transactions without replacing them.

-- Common asset types (extensible via free-text if needed).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_type') THEN
    CREATE TYPE asset_type AS ENUM ('machinery','vehicle','tool','equipment','furniture','electronics','generator','ware','plant','scrap','other');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_condition') THEN
    CREATE TYPE asset_condition AS ENUM ('new','good','fair','poor','damaged','under_repair','scrapped','disposed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_status') THEN
    CREATE TYPE asset_status AS ENUM ('available','in_use','assigned','reserved','under_repair','damaged','missing','in_transit','scrapped','disposed','sold');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  asset_type asset_type NOT NULL DEFAULT 'other',
  name text NOT NULL,
  asset_code text,
  serial_number text,
  description text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit text DEFAULT 'pcs',
  location text,
  department text,
  custodian_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  condition asset_condition NOT NULL DEFAULT 'good',
  status asset_status NOT NULL DEFAULT 'available',
  purchase_date date,
  purchase_cost numeric(14,2) DEFAULT 0,
  current_value numeric(14,2) DEFAULT 0,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  procurement_reference text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_business ON inventory_assets(business_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_branch ON inventory_assets(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_type ON inventory_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_status ON inventory_assets(status);

ALTER TABLE inventory_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_assets_scoped_select ON inventory_assets;
CREATE POLICY inventory_assets_scoped_select ON inventory_assets FOR SELECT TO authenticated USING (can_access_branch(branch_id) OR can_access_business(business_id));
DROP POLICY IF EXISTS inventory_assets_write ON inventory_assets;
CREATE POLICY inventory_assets_write ON inventory_assets FOR ALL TO authenticated USING (can_access_branch(branch_id) OR can_access_business(business_id)) WITH CHECK (can_access_branch(branch_id) OR can_access_business(business_id));

CREATE TABLE IF NOT EXISTS inventory_asset_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES inventory_assets(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  from_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  to_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  from_status asset_status,
  to_status asset_status,
  from_condition asset_condition,
  to_condition asset_condition,
  reason text,
  reference_type text,
  reference_id uuid,
  actor_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_movements_asset ON inventory_asset_movements(asset_id);
ALTER TABLE inventory_asset_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_movements_scoped_select ON inventory_asset_movements;
CREATE POLICY asset_movements_scoped_select ON inventory_asset_movements FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM inventory_assets a WHERE a.id = asset_id AND (can_access_branch(a.branch_id) OR can_access_business(a.business_id))));
DROP POLICY IF EXISTS asset_movements_write ON inventory_asset_movements;
CREATE POLICY asset_movements_write ON inventory_asset_movements FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM inventory_assets a WHERE a.id = asset_id AND (can_access_branch(a.branch_id) OR can_access_business(a.business_id)))) WITH CHECK (EXISTS (SELECT 1 FROM inventory_assets a WHERE a.id = asset_id AND (can_access_branch(a.branch_id) OR can_access_business(a.business_id))));
