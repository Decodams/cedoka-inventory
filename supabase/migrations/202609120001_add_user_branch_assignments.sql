CREATE TABLE IF NOT EXISTS public.user_branch_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  assigned_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_branch_assignments_user_id ON public.user_branch_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_assignments_branch_id ON public.user_branch_assignments (branch_id);