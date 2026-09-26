import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ROLE_RANK: Record<string, number> = {
  super_admin: 5,
  admin: 4,
  manager: 3,
  supervisor: 2,
  sales_person: 1,
  accountant: 1,
  inventory_officer: 1,
  transport_officer: 1,
  auditor: 0,
  farm_operations_officer: 1,
};

type Body = { p_user_id?: string };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = request.headers.get('Authorization');
  if (!url || !serviceKey || !authHeader) return reply({ error: 'Server authentication is not configured' }, 500);

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller) return reply({ error: 'Not authenticated' }, 401);

  let body: Body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request body' }, 400); }

  const targetUserId = body.p_user_id?.trim();
  if (!targetUserId) return reply({ error: 'User ID is required' }, 400);

  const { data: actor, error: actorError } = await admin.from('user_profiles')
    .select('business_id, branch_id, is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active || !actorRole || !(actorRole in ROLE_RANK)) return reply({ error: 'Not authorized' }, 403);

  const { data: target, error: targetError } = await admin.from('user_profiles')
    .select('id, email, role:roles(name), business_id, branch_id').eq('id', targetUserId).maybeSingle();
  if (targetError) return reply({ error: targetError.message }, 500);
  if (!target) return reply({ error: 'User not found' }, 404);

  const targetRole = (target.role as { name?: string } | null)?.name;

  // Super Admin accounts are locked: no one may delete a super_admin
  if (targetRole === 'super_admin') return reply({ error: 'Super Admin accounts are locked and cannot be deleted' }, 403);
  // An actor cannot delete themselves
  if (targetUserId === caller.id) return reply({ error: 'You cannot delete your own account through this action' }, 403);

  // Actor must rank strictly above target
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole ?? ''] ?? -1;
  if (actorRank <= targetRank) return reply({ error: 'You cannot delete a user at or above your rank' }, 403);

  if (actorRole === 'admin' || actorRole === 'manager') {
    // Service role bypasses RLS, so scope is validated here: the target must
    // sit inside the actor's own branch scope (spec sections 6, 20).
    const accessibleBranches = new Set<string>();
    const accessibleBusinesses = new Set<string>();
    const actorBranch = (actor as { branch_id?: string | null }).branch_id ?? null;
    const actorBusiness = (actor as { business_id?: string | null }).business_id ?? null;
    if (actorBranch) accessibleBranches.add(actorBranch);
    if (actorBusiness) accessibleBusinesses.add(actorBusiness);
    const [{ data: branchAssignments }, { data: managedBranches }, { data: businessAssignments }] = await Promise.all([
      admin.from('user_branch_assignments').select('branch_id').eq('user_id', caller.id),
      admin.from('branches').select('id, business_id').eq('manager_id', caller.id),
      admin.from('user_business_assignments').select('business_id').eq('user_id', caller.id),
    ]);
    (branchAssignments ?? []).forEach((row) => accessibleBranches.add(row.branch_id));
    (managedBranches ?? []).forEach((row) => { accessibleBranches.add(row.id); accessibleBusinesses.add(row.business_id); });
    (businessAssignments ?? []).forEach((row) => accessibleBusinesses.add(row.business_id));
    // Business-level oversight (spec section 5): an Admin of a business may
    // manage staff on every branch of that business. Managers stay scoped.
    if (actorRole === 'admin' && accessibleBusinesses.size > 0) {
      const { data: businessBranches } = await admin.from('branches')
        .select('id, business_id').in('business_id', [...accessibleBusinesses]);
      (businessBranches ?? []).forEach((row) => { accessibleBranches.add(row.id); accessibleBusinesses.add(row.business_id); });
    }
    const targetBranch = (target as { branch_id?: string | null }).branch_id ?? null;
    const targetBusiness = (target as { business_id?: string | null }).business_id ?? null;
    const inScope = targetBranch
      ? accessibleBranches.has(targetBranch)
      : Boolean(targetBusiness && accessibleBusinesses.has(targetBusiness));
    if (!inScope) {
      return reply({ error: actorRole === 'admin'
        ? 'Admins can only delete users within their own branch scope'
        : 'Managers can only delete users within their own branch' }, 403);
    }
  }

  // Clear references that would otherwise block the delete (manager links and
  // the one RESTRICT user reference), then delete auth + profile.
  const { error: subordinateError } = await admin.from('user_profiles').update({ manager_id: null }).eq('manager_id', targetUserId);
  if (subordinateError) return reply({ error: subordinateError.message }, 500);
  const { error: exceptionError } = await admin.from('inventory_exception_records').update({ reported_by: null }).eq('reported_by', targetUserId);
  if (exceptionError && !exceptionError.message.includes('does not exist') && !exceptionError.message.includes('Could not find')) {
    return reply({ error: exceptionError.message }, 500);
  }

  // Delete auth user first, then profile (cascade cleanup)
  const { error: deleteAuthError } = await admin.auth.admin.deleteUser(targetUserId);
  if (deleteAuthError) return reply({ error: deleteAuthError.message }, 500);

  const { error: profileError } = await admin.from('user_profiles').delete().eq('id', targetUserId);
  if (profileError) return reply({ error: profileError.message }, 500);

  await admin.from('audit_log').insert({
    actor_id: caller.id,
    action: 'user.deleted',
    target_table: 'user_profiles',
    target_id: targetUserId,
    metadata: { email: (target as { email?: string }).email },
    branch_id: (target as { branch_id?: string | null }).branch_id ?? null,
  });

  return reply({ success: true });
});
