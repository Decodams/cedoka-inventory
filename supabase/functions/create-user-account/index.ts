import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Payload = { p_email: string; p_password: string; p_full_name: string; p_role_name: string; p_business_id?: string | null; p_branch_id?: string | null; p_business_ids?: string[]; p_branch_ids?: string[] };

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
  let body: Payload;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request body' }, 400); }
  const email = body.p_email?.trim().toLowerCase();
  if (!email || !body.p_password || !body.p_full_name?.trim() || !body.p_role_name) return reply({ error: 'All user fields are required' }, 400);
  if (body.p_password.length < 6) return reply({ error: 'Password must be at least 6 characters' }, 400);
  const { data: actor, error: actorError } = await admin.from('user_profiles').select('business_id, branch_id, is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active) return reply({ error: 'Not authorized' }, 403);
  // Role matrix: Super Admin can create any role; Admin anything but Super Admin;
  // Manager anything but Super Admin/Admin/Manager; others are denied here.
  const MANAGER_CREATABLE = new Set(['sales_person', 'supervisor', 'farm_operations_officer']);
  const roleName = body.p_role_name;
  if (actorRole === 'super_admin') {
    // allowed — Super Admin cap for new Super Admins is checked below
  } else if (actorRole === 'admin') {
    if (roleName === 'super_admin') return reply({ error: 'Only a Super Admin can create another Super Admin' }, 403);
  } else if (actorRole === 'manager') {
    const { data: knownRole } = await admin.from('roles').select('name').eq('name', roleName).maybeSingle();
    const roleKey = (knownRole?.name ?? roleName) as string;
    if (['super_admin', 'admin', 'manager'].includes(roleKey) && !MANAGER_CREATABLE.has(roleKey)) {
      return reply({ error: 'Managers can only create junior staff roles' }, 403);
    }
  } else {
    return reply({ error: 'Not authorized to create users' }, 403);
  }
  if (roleName === 'super_admin') {
    const { data: superAdminRole } = await admin.from('roles').select('id').eq('name', 'super_admin').maybeSingle();
    if (!superAdminRole) return reply({ error: 'Super Admin role is not configured' }, 500);
    const { count: superAdminCount, error: countError } = await admin.from('user_profiles').select('id', { count: 'exact', head: true }).eq('role_id', superAdminRole.id);
    if (countError) return reply({ error: countError.message }, 500);
    if ((superAdminCount ?? 0) >= 2) return reply({ error: 'Only two Super Admin accounts are allowed' }, 409);
  }
  const businessIds = [...new Set((body.p_business_ids ?? (body.p_business_id ? [body.p_business_id] : [])).filter(Boolean))];
  const branchIds = [...new Set((body.p_branch_ids ?? (body.p_branch_id ? [body.p_branch_id] : [])).filter(Boolean))];

  // Service role bypasses RLS, so scope is validated here: the actor's
  // accessible branches (primary + assignments + managed) and businesses
  // (spec sections 6, 12, 20).
  const actorBusinessId = (actor as { business_id?: string | null }).business_id ?? null;
  const actorBranchId = (actor as { branch_id?: string | null }).branch_id ?? null;
  const accessibleBranches = new Set<string>();
  const accessibleBusinesses = new Set<string>();
  const branchBusinessMap = new Map<string, string>();
  if (actorBusinessId) accessibleBusinesses.add(actorBusinessId);
  if (actorBranchId) accessibleBranches.add(actorBranchId);

  const [{ data: branchAssignments }, { data: managedBranches }, { data: businessAssignments }] = await Promise.all([
    admin.from('user_branch_assignments').select('branch_id').eq('user_id', caller.id),
    admin.from('branches').select('id, business_id').eq('manager_id', caller.id),
    admin.from('user_business_assignments').select('business_id').eq('user_id', caller.id),
  ]);
  (branchAssignments ?? []).forEach((row) => accessibleBranches.add(row.branch_id));
  (managedBranches ?? []).forEach((row) => { accessibleBranches.add(row.id); accessibleBusinesses.add(row.business_id); });
  (businessAssignments ?? []).forEach((row) => accessibleBusinesses.add(row.business_id));

  if (branchIds.length) {
    const { data: branchRows } = await admin.from('branches').select('id, business_id').in('id', branchIds);
    (branchRows ?? []).forEach((row) => branchBusinessMap.set(row.id, row.business_id));
    if (actorRole !== 'super_admin') {
      if ((branchRows ?? []).length !== branchIds.length) {
        return reply({ error: 'One or more selected branches do not exist' }, 400);
      }
      if (branchIds.some((branchId) => !accessibleBranches.has(branchId))) {
        return reply({ error: 'One or more selected branches are outside your scope' }, 403);
      }
      (branchRows ?? []).forEach((row) => accessibleBusinesses.add(row.business_id));
      if (businessIds.some((bizId) => !accessibleBusinesses.has(bizId))) {
        return reply({ error: 'One or more selected businesses are outside your scope' }, 403);
      }
    }
    if (businessIds.length && branchIds.some((branchId) => !businessIds.includes(branchBusinessMap.get(branchId) ?? ''))) {
      return reply({ error: 'Selected branches must belong to selected businesses' }, 400);
    }
  } else if (actorRole !== 'super_admin' && businessIds.some((bizId) => !accessibleBusinesses.has(bizId))) {
    return reply({ error: 'One or more selected businesses are outside your scope' }, 403);
  }

  const businessId = actorRole === 'manager'
    ? (branchIds[0] ? branchBusinessMap.get(branchIds[0]) ?? actorBusinessId : actorBusinessId)
    : businessIds[0] ?? (branchIds[0] ? branchBusinessMap.get(branchIds[0]) ?? null : null);
  const branchId = branchIds[0] ?? (actorRole === 'manager' ? actorBranchId : null);
  const { data: role, error: roleError } = await admin.from('roles').select('id').eq('name', body.p_role_name).maybeSingle();
  if (roleError || !role) return reply({ error: 'Invalid role selected' }, 400);
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: body.p_password, email_confirm: true });
  if (createError || !created.user) return reply({ error: createError?.message ?? 'Could not create Auth user' }, 400);
  const { data: profile, error: profileError } = await admin.from('user_profiles').insert({ id: created.user.id, email, full_name: body.p_full_name.trim(), role_id: role.id, business_id: businessId, branch_id: branchId, is_active: true, created_by: caller.id }).select('*').single();
  if (profileError) { await admin.auth.admin.deleteUser(created.user.id); return reply({ error: profileError.message }, 400); }
  if (body.p_role_name === 'admin' || body.p_role_name === 'manager') {
    if (body.p_role_name === 'admin' && !businessIds.length) {
      await admin.auth.admin.deleteUser(created.user.id);
      return reply({ error: 'An Admin needs at least one business assignment' }, 400);
    }
    if (businessIds.length) {
      const { error: businessAssignmentError } = await admin.from('user_business_assignments').insert(businessIds.map((business_id) => ({ user_id: created.user.id, business_id })));
      if (businessAssignmentError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return reply({ error: businessAssignmentError.message }, 500);
      }
    }
    if (branchIds.length) {
      // Branch assignments are how Admins and Managers gain multi-branch
      // scope (spec section 12); conflicts (a second Admin on a branch) are
      // rejected by the one-admin-per-branch trigger with 23505.
      const { error: branchAssignmentError } = await admin.from('user_branch_assignments').insert(branchIds.map((branch_id) => ({ user_id: created.user.id, branch_id })));
      if (branchAssignmentError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return reply({ error: branchAssignmentError.message }, 400);
      }
    }
  }
  await admin.from('audit_log').insert({ actor_id: caller.id, action: 'user.created', target_table: 'user_profiles', target_id: created.user.id, metadata: { email, role: body.p_role_name, created_by: actorRole }, branch_id: branchId });
  return reply({ profile });
});
