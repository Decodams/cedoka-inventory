import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
  let body: { p_user_id?: string; p_is_active?: boolean; p_action?: 'approve' | 'reject' | 'activate' | 'deactivate'; p_reason?: string };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request body' }, 400); }
  const action = body.p_action ?? (body.p_is_active ? 'activate' : 'deactivate');
  if (!body.p_user_id || !['approve', 'reject', 'activate', 'deactivate'].includes(action) || body.p_user_id === caller.id) return reply({ error: 'Invalid user status request' }, 400);
  const { data: actor, error: actorError } = await admin.from('user_profiles').select('business_id, branch_id, is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active || !['super_admin', 'admin'].includes(actorRole ?? '')) return reply({ error: 'Not authorized' }, 403);
  const { data: target, error: targetError } = await admin.from('user_profiles').select('id, email, business_id, branch_id, role:roles(name)').eq('id', body.p_user_id).maybeSingle();
  if (targetError) return reply({ error: targetError.message }, 500);
  if (!target) return reply({ error: 'User not found' }, 404);
  const targetRole = (target.role as { name?: string } | null)?.name;
  // Super Admin accounts are locked: no status changes through this function.
  if (targetRole === 'super_admin') return reply({ error: 'Super Admin accounts are locked' }, 403);
  // Hierarchy: an actor may only change users strictly below their own rank,
  // so an Admin can never approve, reject, activate or deactivate a fellow Admin.
  const ROLE_RANK: Record<string, number> = { super_admin: 5, admin: 4, manager: 3, supervisor: 2, sales_person: 1, accountant: 1, inventory_officer: 1, transport_officer: 1, auditor: 0, farm_operations_officer: 1 };
  if ((ROLE_RANK[actorRole ?? ''] ?? -1) <= (ROLE_RANK[targetRole ?? ''] ?? -1)) {
    return reply({ error: 'You can only change users below your own rank' }, 403);
  }
  if (actorRole === 'admin') {
    // Service role bypasses RLS, so scope is validated here: the target must
    // sit in the Admin's own branch scope (spec sections 6, 20).
    const accessible = new Set<string>();
    const actorBranch = (actor as { branch_id?: string | null }).branch_id ?? null;
    const actorBusiness = (actor as { business_id?: string | null }).business_id ?? null;
    if (actorBranch) accessible.add(actorBranch);
    const [{ data: branchAssignments }, { data: managedBranches }, { data: businessAssignments }] = await Promise.all([
      admin.from('user_branch_assignments').select('branch_id').eq('user_id', caller.id),
      admin.from('branches').select('id, business_id').eq('manager_id', caller.id),
      admin.from('user_business_assignments').select('business_id').eq('user_id', caller.id),
    ]);
    (branchAssignments ?? []).forEach((row) => accessible.add(row.branch_id));
    (managedBranches ?? []).forEach((row) => accessible.add(row.id));
    const managedBusinesses = new Set<string>();
    if (actorBusiness) managedBusinesses.add(actorBusiness);
    (businessAssignments ?? []).forEach((row) => managedBusinesses.add(row.business_id));
    (managedBranches ?? []).forEach((row) => managedBusinesses.add(row.business_id));
    // Business-level oversight (spec section 5): every branch of the Admin's
    // businesses counts as in-scope.
    if (managedBusinesses.size > 0) {
      const { data: businessBranches } = await admin.from('branches')
        .select('id').in('business_id', [...managedBusinesses]);
      (businessBranches ?? []).forEach((row) => accessible.add(row.id));
    }
    const targetBranch = (target as { branch_id?: string | null }).branch_id ?? null;
    const targetBusiness = (target as { business_id?: string | null }).business_id ?? null;
    const inScope = targetBranch
      ? accessible.has(targetBranch)
      : Boolean(targetBusiness && managedBusinesses.has(targetBusiness));
    if (!inScope) return reply({ error: 'Admins can only manage users in their own branch scope' }, 403);
  }
  const approvalStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : undefined;
  const { error: updateError } = await admin.from('user_profiles').update({
    ...(approvalStatus ? { approval_status: approvalStatus, approval_reason: body.p_reason ?? null, reviewed_by: caller.id, reviewed_at: new Date().toISOString() } : {}),
    ...(!approvalStatus ? { is_active: action === 'activate' } : {}),
    ...(action === 'approve' ? { is_active: true } : {}),
  }).eq('id', target.id);
  if (updateError) return reply({ error: updateError.message }, 400);
  await admin.from('audit_log').insert({ actor_id: caller.id, action: action === 'approve' ? 'user.approved' : action === 'reject' ? 'user.rejected' : action === 'activate' ? 'user.activated' : 'user.deactivated', target_table: 'user_profiles', target_id: target.id, metadata: { email: target.email }, branch_id: target.branch_id ?? null });
  return reply({ success: true });
});
