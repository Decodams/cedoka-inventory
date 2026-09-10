import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return reply({ error: 'Server registration is not configured' }, 500);
  let body: { email?: string; password?: string; full_name?: string };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request body' }, 400); }
  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  if (!email || !fullName || !body.password) return reply({ error: 'Name, email, and password are required' }, 400);
  if (body.password.length < 8) return reply({ error: 'Password must be at least 8 characters' }, 400);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: role, error: roleError } = await admin.from('roles').select('id').eq('name', 'sales_person').maybeSingle();
  if (roleError || !role) return reply({ error: 'Default registration role is unavailable' }, 500);
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
  if (createError || !created.user) return reply({ error: createError?.message ?? 'Could not create registration' }, 400);
  const { error: profileError } = await admin.from('user_profiles').insert({
    id: created.user.id,
    email,
    full_name: fullName,
    role_id: role.id,
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
    metadata: { email, role: 'sales_person' },
  });
  return reply({ message: 'Registration submitted for administrator approval.' });
});
