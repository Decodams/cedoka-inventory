-- Per-business measurement units (e.g. Farm: bag/crate/basket/kilo,
-- Electronics: pcs/carton/pack). Products and sales use these so each
-- business measures stock and sells in its own proper units.

CREATE TABLE IF NOT EXISTS business_measurement_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bmu_business_id ON business_measurement_units (business_id);

ALTER TABLE business_measurement_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bmu_select_authenticated" ON business_measurement_units;
CREATE POLICY "bmu_select_authenticated" ON business_measurement_units FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "bmu_write_manage" ON business_measurement_units;
CREATE POLICY "bmu_write_manage" ON business_measurement_units FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin', 'manager'))
    )
    AND can_access_business(business_measurement_units.business_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.is_active = true
        AND up.role_id IN (SELECT id FROM roles WHERE name IN ('super_admin', 'admin', 'manager'))
    )
    AND can_access_business(business_measurement_units.business_id)
  );

-- Seed farm-style units for agricultural businesses.
INSERT INTO business_measurement_units (business_id, name)
SELECT b.id, u.unit_name
FROM businesses b
CROSS JOIN (VALUES
  ('bag'), ('crate'), ('basket'), ('kilo'), ('kg'),
  ('unit'), ('bundle'), ('tuber'), ('dozen'), ('sack'), ('carton')
) AS u(unit_name)
WHERE lower(b.name) LIKE '%farm%' OR lower(COALESCE(b.category, '')) LIKE '%agric%'
ON CONFLICT (business_id, name) DO NOTHING;

-- Seed retail-style units for every other business.
INSERT INTO business_measurement_units (business_id, name)
SELECT b.id, u.unit_name
FROM businesses b
CROSS JOIN (VALUES
  ('pcs'), ('box'), ('carton'), ('pack'), ('set'),
  ('pair'), ('kg'), ('litre'), ('meter')
) AS u(unit_name)
WHERE NOT (lower(b.name) LIKE '%farm%' OR lower(COALESCE(b.category, '')) LIKE '%agric%')
ON CONFLICT (business_id, name) DO NOTHING;
