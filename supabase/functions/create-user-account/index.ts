import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Payload = { p_email: string; p_password: string; p_full_name: string; p_role_name: string; p_business_id?: string | null; p_branch_id?: string | null };

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
  if (actorRole !== 'super_admin' && !(actorRole === 'admin' && ['manager', 'sales_person'].includes(body.p_role_name)) && !(actorRole === 'manager' && body.p_role_name === 'sales_person')) return reply({ error: 'Not authorized to create this role' }, 403);
  const businessId = actorRole === 'manager' ? actor.business_id : body.p_business_id ?? null;
  const branchId = actorRole === 'manager' ? actor.branch_id : body.p_branch_id ?? null;
  if (actorRole === 'admin' && businessId !== actor.business_id) return reply({ error: 'Admins can only create users in their own business' }, 403);
  if (actorRole === 'manager' && branchId !== actor.branch_id) return reply({ error: 'Managers can only create users in their own branch' }, 403);
  const { data: role, error: roleError } = await admin.from('roles').select('id').eq('name', body.p_role_name).maybeSingle();
  if (roleError || !role) return reply({ error: 'Invalid role selected' }, 400);
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: body.p_password, email_confirm: true });
  if (createError || !created.user) return reply({ error: createError?.message ?? 'Could not create Auth user' }, 400);
  const { data: profile, error: profileError } = await admin.from('user_profiles').insert({ id: created.user.id, email, full_name: body.p_full_name.trim(), role_id: role.id, business_id: businessId, branch_id: branchId, is_active: true, created_by: caller.id }).select('*').single();
  if (profileError) { await admin.auth.admin.deleteUser(created.user.id); return reply({ error: profileError.message }, 400); }
  await admin.from('audit_log').insert({ actor_id: caller.id, action: 'user.created', target_table: 'user_profiles', target_id: created.user.id, metadata: { email, role: body.p_role_name, created_by: actorRole } });
  return reply({ profile });
});
