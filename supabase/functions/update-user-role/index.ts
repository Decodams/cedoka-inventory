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

type Body = { p_user_id?: string; p_role_name?: string; p_business_id?: string | null; p_branch_id?: string | null; p_business_ids?: string[]; p_branch_ids?: string[] };

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
  const roleName = body.p_role_name?.trim();
  if (!targetUserId || (!roleName && body.p_business_id === undefined && body.p_branch_id === undefined)) {
    return reply({ error: 'User ID and at least one field (role/business/branch) are required' }, 400);
  }

  const { data: actor, error: actorError } = await admin.from('user_profiles')
    .select('business_id, branch_id, is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active || !actorRole || !(actorRole in ROLE_RANK)) return reply({ error: 'Not authorized' }, 403);

  const { data: target, error: targetError } = await admin.from('user_profiles')
    .select('role:roles(name), business_id, branch_id').eq('id', targetUserId).maybeSingle();
  if (targetError) return reply({ error: targetError.message }, 500);
  if (!target) return reply({ error: 'User not found' }, 404);

  const targetRole = (target.role as { name?: string } | null)?.name;

  // Super Admin accounts are locked: no actor may edit a super_admin's role or scope
  if (targetRole === 'super_admin') return reply({ error: 'Super Admin accounts are locked and cannot be edited' }, 403);
  // An actor cannot edit their own assignment
  if (targetUserId === caller.id) return reply({ error: 'You cannot edit your own role through this action' }, 403);

  // Actor must rank strictly above target to reassign them
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole ?? ''] ?? -1;
  if (actorRank <= targetRank) return reply({ error: 'You cannot change the role of a user at or above your rank' }, 403);

  // Business scope enforcement for admins
  if (actorRole === 'admin') {
    const actorBiz = (actor as { business_id?: string | null }).business_id ?? null;
    const biz = body.p_business_id ?? target.business_id;
    if (biz && actorBiz && biz !== actorBiz) return reply({ error: 'Admins can only assign users within their own business' }, 403);
  }

  // Branch scope enforcement for managers
  if (actorRole === 'manager') {
    const actorBranch = (actor as { branch_id?: string | null }).branch_id ?? null;
    if (body.p_branch_id && actorBranch && body.p_branch_id !== actorBranch) return reply({ error: 'Managers can only assign users within their own branch' }, 403);
  }

  // Resolve role if provided
  let roleId: string | null = null;
  if (roleName) {
    const { data: role, error: roleError } = await admin.from('roles').select('id').eq('name', roleName).maybeSingle();
    if (roleError) return reply({ error: roleError.message }, 500);
    if (!role) return reply({ error: 'The target role is unavailable' }, 400);
    roleId = role.id;
  }

  // Only Admin accounts may carry multiple business/branch assignments.  Keep
  // the primary profile fields for compatibility with existing screens.
  const nextRole = roleName ?? targetRole;
  const businessIds = [...new Set((body.p_business_ids ?? (body.p_business_id ? [body.p_business_id] : [])).filter(Boolean))];
  const branchIds = [...new Set((body.p_branch_ids ?? (body.p_branch_id ? [body.p_branch_id] : [])).filter(Boolean))];
  if (nextRole === 'admin') {
    if (!businessIds.length) return reply({ error: 'An Admin must have at least one business assignment' }, 400);
    const { data: validBusinesses } = await admin.from('businesses').select('id').in('id', businessIds);
    if ((validBusinesses?.length ?? 0) !== businessIds.length) return reply({ error: 'One or more selected businesses are invalid' }, 400);
    const { data: validBranches } = branchIds.length ? await admin.from('branches').select('id,business_id').in('id', branchIds) : { data: [] as Array<{ id: string; business_id: string }> };
    if ((validBranches?.length ?? 0) !== branchIds.length || validBranches?.some((branch) => !businessIds.includes(branch.business_id))) return reply({ error: 'Each selected branch must belong to a selected business' }, 400);
    const assignmentsError = await admin.from('user_business_assignments').delete().eq('user_id', targetUserId);
    if (assignmentsError.error) return reply({ error: assignmentsError.error.message }, 500);
    const branchAssignmentsError = await admin.from('user_branch_assignments').delete().eq('user_id', targetUserId);
    if (branchAssignmentsError.error) return reply({ error: branchAssignmentsError.error.message }, 500);
    const { error: insertBusinessError } = await admin.from('user_business_assignments').insert(businessIds.map((business_id) => ({ user_id: targetUserId, business_id })));
    if (insertBusinessError) return reply({ error: insertBusinessError.message }, 500);
    if (branchIds.length) {
      const { error: insertBranchError } = await admin.from('user_branch_assignments').insert(branchIds.map((branch_id) => ({ user_id: targetUserId, branch_id })));
      if (insertBranchError) return reply({ error: insertBranchError.message }, 500);
    }
  }

  const { error: updateError } = await admin.from('user_profiles').update({
    ...(roleId ? { role_id: roleId } : {}),
    ...(nextRole === 'admin' ? { business_id: businessIds[0], branch_id: branchIds[0] ?? null } : {}),
    ...(nextRole !== 'admin' && body.p_business_id !== undefined ? { business_id: body.p_business_id } : {}),
    ...(nextRole !== 'admin' && body.p_branch_id !== undefined ? { branch_id: body.p_branch_id } : {}),
  }).eq('id', targetUserId);
  if (updateError) return reply({ error: updateError.message }, 500);

  await admin.from('audit_log').insert({
    actor_id: caller.id,
    action: 'user.role_updated',
    target_table: 'user_profiles',
    target_id: targetUserId,
    metadata: { role: roleName, business_id: body.p_business_id, branch_id: body.p_branch_id, business_ids: businessIds, branch_ids: branchIds },
  });

  return reply({ success: true });
});
