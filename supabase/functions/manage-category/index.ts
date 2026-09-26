import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Body = { p_business_id: string; p_name: string; p_description?: string; p_category_id?: string; p_action: 'create' | 'update' | 'delete' };

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

  const { p_business_id, p_name, p_description, p_category_id, p_action } = body;
  if (!p_business_id || !p_action) return reply({ error: 'Business ID and action are required' }, 400);

  const { data: actor, error: actorError } = await admin.from('user_profiles')
    .select('business_id, branch_id, is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active || !['super_admin', 'admin', 'manager'].includes(actorRole ?? '')) return reply({ error: 'Not authorized' }, 403);

  if (actorRole === 'admin' || actorRole === 'manager') {
    // Service role bypasses RLS, so scope is validated here: primary
    // business + explicit assignments (spec section 6).
    const accessible = new Set<string>();
    const actorBiz = (actor as { business_id?: string | null }).business_id ?? null;
    if (actorBiz) accessible.add(actorBiz);
    const [{ data: bizAssignments }, { data: managedBranches }] = await Promise.all([
      admin.from('user_business_assignments').select('business_id').eq('user_id', caller.id),
      admin.from('branches').select('business_id').eq('manager_id', caller.id),
    ]);
    (bizAssignments ?? []).forEach((row) => accessible.add(row.business_id));
    (managedBranches ?? []).forEach((row) => accessible.add(row.business_id));
    if (!accessible.has(p_business_id)) return reply({ error: 'You can only manage categories in your own business' }, 403);
  }

  if (p_action === 'create') {
    if (!p_name?.trim()) return reply({ error: 'Category name is required' }, 400);
    const { data: existing } = await admin.from('categories').select('id').eq('business_id', p_business_id).eq('name', p_name.trim()).maybeSingle();
    if (existing) return reply({ error: 'Category already exists' }, 409);
    const { data: category, error: createError } = await admin.from('categories').insert({
      business_id: p_business_id, name: p_name.trim(), description: p_description?.trim() || null, is_active: true
    }).select('*').single();
    if (createError) return reply({ error: createError.message }, 400);
    await admin.from('audit_log').insert({ actor_id: caller.id, action: 'category.created', target_table: 'categories', target_id: category.id, metadata: { name: p_name.trim(), business_id: p_business_id } });
    return reply({ category });
  }

  if (p_action === 'update') {
    if (!p_category_id) return reply({ error: 'Category ID is required for update' }, 400);
    const { data: target } = await admin.from('categories').select('*').eq('id', p_category_id).eq('business_id', p_business_id).maybeSingle();
    if (!target) return reply({ error: 'Category not found' }, 404);
    const { error: updateError } = await admin.from('categories').update({
      name: p_name?.trim() ?? target.name, description: p_description?.trim() ?? target.description
    }).eq('id', p_category_id);
    if (updateError) return reply({ error: updateError.message }, 400);
    await admin.from('audit_log').insert({ actor_id: caller.id, action: 'category.updated', target_table: 'categories', target_id: p_category_id, metadata: { name: p_name?.trim() } });
    return reply({ success: true });
  }

  if (p_action === 'delete') {
    if (!p_category_id) return reply({ error: 'Category ID is required for delete' }, 400);
    const { data: productsUsing } = await admin.from('products').select('id').eq('category_id', p_category_id).limit(1);
    if (productsUsing && productsUsing.length > 0) return reply({ error: 'Cannot delete category with associated products' }, 400);
    const { error: deleteError } = await admin.from('categories').delete().eq('id', p_category_id).eq('business_id', p_business_id);
    if (deleteError) return reply({ error: deleteError.message }, 400);
    await admin.from('audit_log').insert({ actor_id: caller.id, action: 'category.deleted', target_table: 'categories', target_id: p_category_id, metadata: {} });
    return reply({ success: true });
  }

  return reply({ error: 'Invalid action' }, 400);
});