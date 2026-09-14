import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const NON_REGISTERABLE_ROLES = new Set(['super_admin', 'admin']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return reply({ error: 'Server registration is not configured' }, 500);
  let body: { email?: string; password?: string; full_name?: string; role_name?: string; business_id?: string; branch_id?: string };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request body' }, 400); }
  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  const roleName = body.role_name;
  const businessId = body.business_id;
  const branchId = body.branch_id;
  if (!email || !fullName || !body.password || !roleName || !businessId || !branchId) {
    return reply({ error: 'Full name, email, password, role, business, and branch are required' }, 400);
  }
  if (body.password.length < 8) return reply({ error: 'Password must be at least 8 characters' }, 400);
  if (NON_REGISTERABLE_ROLES.has(roleName)) return reply({ error: 'This role cannot be requested through self registration' }, 403);

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: role, error: roleError } = await admin.from('roles').select('id,name').eq('name', roleName).eq('is_active', true).maybeSingle();
  if (roleError || !role) return reply({ error: 'The selected role is unavailable' }, 400);

  const { data: business, error: businessError } = await admin.from('businesses').select('id').eq('id', businessId).eq('is_active', true).maybeSingle();
  if (businessError || !business) return reply({ error: 'The selected business is unavailable' }, 400);

  const { data: branch, error: branchError } = await admin.from('branches').select('id,business_id').eq('id', branchId).eq('is_active', true).maybeSingle();
  if (branchError || !branch) return reply({ error: 'The selected branch is unavailable' }, 400);
  if (branch.business_id !== businessId) return reply({ error: 'The selected branch does not belong to the chosen business' }, 400);

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
  if (createError || !created.user) return reply({ error: createError?.message ?? 'Could not create registration' }, 400);

  const { error: profileError } = await admin.from('user_profiles').insert({
    id: created.user.id,
    email,
    full_name: fullName,
    role_id: role.id,
    business_id: businessId,
    branch_id: branchId,
    is_active: false,
    approval_status: 'pending',
    requested_at: new Date().toISOString(),
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
    metadata: { email, role: roleName, business_id: businessId, branch_id: branchId },
  });
  return reply({ message: 'Registration submitted. An administrator must approve your account before you can sign in.' });
});