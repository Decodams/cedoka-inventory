import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return reply({ error: 'Server registration is not configured' }, 500);
  let body: { email?: string; password?: string; full_name?: string; role_name?: string; business_id?: string; branch_ids?: string[] };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request body' }, 400); }
  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  const roleName = body.role_name;
  const businessId = body.business_id;
  if (!email || !fullName || !body.password || !roleName) return reply({ error: 'Name, email, password, and role are required' }, 400);
  if (body.password.length < 8) return reply({ error: 'Password must be at least 8 characters' }, 400);
  
  // Check role permissions - only super_admin can register admin roles
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: requestingUser, error: userError } = await admin.auth.getUser();
  if (userError || !requestingUser.user) return reply({ error: 'Authentication required' }, 500);
  
  // Get requesting user's profile to check role
  const { data: requestingProfile, error: profileError } = await admin.from('user_profiles').select('role_id').eq('id', requestingUser.user.id).maybeSingle();
  if (profileError) return reply({ error: 'Could not verify requesting user role' }, 500);
  
  // Check if requesting user has permission to create this role
  const { data: rolePermissions, error: permError } = await admin.from('roles').select('permission_flags').eq('name', roleName).maybeSingle();
  if (permError) return reply({ error: 'Role not found' }, 500);
  
  const permissionFlags = rolePermissions?.permission_flags || {};
  // Only super_admin can create admin accounts
  if (roleName === 'admin' && (!requestingProfile || permissionFlags.can_create_users !== true)) {
    // Check if requesting user is super_admin
    const { data: superRole, error: superError } = await admin.from('roles').select('name').eq('name', 'super_admin').maybeSingle();
    if (superError || !superRole || requestingProfile?.role_id !== (await admin.from('user_profiles').select('role_id').eq('id', requestingUser.user.id).maybeSingle())?.role_id) {
      // We need to check if user has super_admin role - let's simplify
      return reply({ error: 'Only Super Admin can create administrator accounts' }, 403);
    }
  }
  
  const { data: role, error: roleError } = await admin.from('roles').select('id').eq('name', roleName).maybeSingle();
  if (roleError || !role) return reply({ error: 'Default registration role is unavailable' }, 500);
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
  if (createError || !created.user) return reply({ error: createError?.message ?? 'Could not create registration' }, 400);
  const { error: profileError } = await admin.from('user_profiles').insert({
    id: created.user.id,
    email,
    full_name: fullName,
    role_id: role.id,
    is_active: roleName !== 'admin', // Admin accounts require approval
    approval_status: roleName === 'admin' ? 'pending' : 'active',
    requested_at: new Date().toISOString(),
    business_id: roleName === 'admin' && businessId ? businessId : null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return reply({ error: profileError.message }, 400);
  }
  await admin.from('audit_log').insert({
    actor_id: created.user.id,
    action: 'user.registration_requested',
    target_table: 'user_profiles',
    target_id: created.user.id,
    metadata: { email, role: roleName, business_id: businessId },
  });
  return reply({ message: roleName === 'admin' ? 'Registration submitted for administrator approval.' : 'Registration completed successfully.' });
});
