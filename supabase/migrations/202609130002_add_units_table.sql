CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text DEFAULT '',
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_units_business_id ON public.units (business_id);
CREATE INDEX IF NOT EXISTS idx_units_branch_id ON public.units (branch_id);
CREATE INDEX IF NOT EXISTS idx_units_is_active ON public.units (is_active);

-- Unit-to-user assignment table (many-to-many: users can belong to multiple units)
CREATE TABLE IF NOT EXISTS user_unit_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_unit_assignments_user_id ON public.user_unit_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_unit_assignments_unit_id ON public.user_unit_assignments (unit_id);