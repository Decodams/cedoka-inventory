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
  const { data: actor, error: actorError } = await admin.from('user_profiles').select('business_id, is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active || !['super_admin', 'admin'].includes(actorRole ?? '')) return reply({ error: 'Not authorized' }, 403);
  const { data: target, error: targetError } = await admin.from('user_profiles').select('id, email, business_id').eq('id', body.p_user_id).maybeSingle();
  if (targetError) return reply({ error: targetError.message }, 500);
  if (!target) return reply({ error: 'User not found' }, 404);
  if (actorRole === 'admin' && target.business_id !== actor.business_id) return reply({ error: 'Admins can only manage users in their own business' }, 403);
  const approvalStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : undefined;
  const { error: updateError } = await admin.from('user_profiles').update({
    ...(approvalStatus ? { approval_status: approvalStatus, approval_reason: body.p_reason ?? null, reviewed_by: caller.id, reviewed_at: new Date().toISOString() } : {}),
    ...(!approvalStatus ? { is_active: action === 'activate' } : {}),
    ...(action === 'approve' ? { is_active: true } : {}),
  }).eq('id', target.id);
  if (updateError) return reply({ error: updateError.message }, 400);
  await admin.from('audit_log').insert({ actor_id: caller.id, action: action === 'approve' ? 'user.approved' : action === 'reject' ? 'user.rejected' : action === 'activate' ? 'user.activated' : 'user.deactivated', target_table: 'user_profiles', target_id: target.id, metadata: { email: target.email } });
  return reply({ success: true });
});
