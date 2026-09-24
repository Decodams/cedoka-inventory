import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager']);

type ProductFields = {
  name?: string;
  business_id?: string;
  category_id?: string | null;
  supplier_id?: string | null;
  sku?: string | null;
  brand?: string | null;
  model?: string | null;
  description?: string;
  unit?: string;
  cost_price?: number;
  selling_price?: number;
  min_stock_level?: number;
  reorder_level?: number;
  product_type?: string;
  serial_tracking_mode?: string;
  warranty_months?: number | null;
  expiry_tracking?: boolean;
  is_active?: boolean;
};

type Body = { p_action: 'create' | 'update' | 'delete'; p_product_id?: string } & ProductFields;

function sanitizeFields<T extends ProductFields>(fields: T): T {
  const next = { ...fields };
  if (typeof next.name === 'string') next.name = next.name.trim();
  if (typeof next.sku === 'string') next.sku = next.sku.trim() || null;
  if (typeof next.brand === 'string') next.brand = next.brand.trim() || null;
  if (typeof next.model === 'string') next.model = next.model.trim() || null;
  if (typeof next.description === 'string') next.description = next.description.trim();
  if (typeof next.unit === 'string') next.unit = next.unit.trim() || 'pcs';
  for (const key of ['cost_price', 'selling_price', 'min_stock_level', 'reorder_level'] as const) {
    const value = next[key];
    next[key] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  return next;
}

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

  const { p_action, p_product_id } = body;
  if (!p_action || !['create', 'update', 'delete'].includes(p_action)) return reply({ error: 'Valid action (create/update/delete) is required' }, 400);

  const { data: actor, error: actorError } = await admin.from('user_profiles')
    .select('business_id, branch_id, is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active || !actorRole || !ALLOWED_ROLES.has(actorRole)) {
    return reply({ error: 'Only Super Admin, Admin, or Manager can manage products' }, 403);
  }

  const actorBusinessId = (actor as { business_id?: string | null }).business_id ?? null;

  if (p_action === 'delete') {
    if (!p_product_id) return reply({ error: 'Product ID is required to delete' }, 400);
    if (actorRole === 'manager') return reply({ error: 'Managers can deactivate products but cannot delete them' }, 403);
    const { data: target, error: targetError } = await admin.from('products').select('id,business_id,name').eq('id', p_product_id).maybeSingle();
    if (targetError) return reply({ error: targetError.message }, 500);
    if (!target) return reply({ error: 'Product not found' }, 404);
    if (actorRole === 'admin' && actorBusinessId && target.business_id !== actorBusinessId) {
      return reply({ error: 'Admins can only delete products in their own business' }, 403);
    }
    const { data: inUse } = await admin.from('sale_items').select('id').eq('product_id', p_product_id).limit(1);
    if (inUse && inUse.length > 0) {
      const { error: deactivateError } = await admin.from('products').update({ is_active: false }).eq('id', p_product_id);
      if (deactivateError) return reply({ error: deactivateError.message }, 400);
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'product.deactivated_on_delete', target_table: 'products', target_id: p_product_id, metadata: { name: target.name } });
      return reply({ success: true, deactivated: true });
    }
    const { error: deleteError } = await admin.from('products').delete().eq('id', p_product_id);
    if (deleteError) return reply({ error: deleteError.message }, 400);
    await admin.from('audit_log').insert({ actor_id: caller.id, action: 'product.deleted', target_table: 'products', target_id: p_product_id, metadata: { name: target.name } });
    return reply({ success: true });
  }

  const fields = sanitizeFields(body);
  if (p_action === 'create') {
    if (!fields.name) return reply({ error: 'Product name is required' }, 400);
    if (!fields.business_id) return reply({ error: 'Business unit is required' }, 400);
    if (actorRole === 'admin' && actorBusinessId && fields.business_id !== actorBusinessId) {
      return reply({ error: 'Admins can only create products in their own business' }, 403);
    }
    if (actorRole === 'manager' && actorBusinessId && fields.business_id !== actorBusinessId) {
      return reply({ error: 'Managers can only create products in their own business' }, 403);
    }
    const { data: business } = await admin.from('businesses').select('name,category').eq('id', fields.business_id).maybeSingle();
    const hay = `${business?.name ?? ''} ${business?.category ?? ''}`.toLowerCase();
    const isFarm = hay.includes('farm') || hay.includes('agric');
    if (isFarm) {
      fields.sku = null;
      fields.brand = null;
      fields.model = null;
      fields.supplier_id = null;
      fields.warranty_months = null;
    }
    const { data: created, error: createError } = await admin.from('products').insert({
      name: fields.name,
      business_id: fields.business_id,
      category_id: fields.category_id ?? null,
      supplier_id: fields.supplier_id ?? null,
      sku: fields.sku ?? null,
      brand: fields.brand ?? null,
      model: fields.model ?? null,
      description: fields.description ?? '',
      unit: fields.unit ?? 'pcs',
      cost_price: fields.cost_price ?? 0,
      selling_price: fields.selling_price ?? 0,
      min_stock_level: fields.min_stock_level ?? 0,
      reorder_level: fields.reorder_level ?? 0,
      product_type: fields.product_type ?? 'simple',
      serial_tracking_mode: ['none', 'unique', 'shared'].includes(fields.serial_tracking_mode ?? '') ? fields.serial_tracking_mode : 'none',
      warranty_months: fields.warranty_months ?? null,
      expiry_tracking: fields.expiry_tracking ?? false,
      is_active: fields.is_active ?? true,
    }).select('*').single();
    if (createError) return reply({ error: createError.message }, 400);
    await admin.from('audit_log').insert({ actor_id: caller.id, action: 'product.created', target_table: 'products', target_id: created.id, metadata: { name: fields.name, business_id: fields.business_id } });
    return reply({ product: created });
  }

  // update
  if (!p_product_id) return reply({ error: 'Product ID is required to update' }, 400);
  const { data: target, error: targetError } = await admin.from('products').select('id,business_id').eq('id', p_product_id).maybeSingle();
  if (targetError) return reply({ error: targetError.message }, 500);
  if (!target) return reply({ error: 'Product not found' }, 404);
  const effectiveBusinessId = fields.business_id ?? target.business_id;
  if ((actorRole === 'admin' || actorRole === 'manager') && actorBusinessId && effectiveBusinessId !== actorBusinessId) {
    return reply({ error: 'You can only update products in your own business' }, 403);
  }
  const { data: business } = await admin.from('businesses').select('name,category').eq('id', effectiveBusinessId).maybeSingle();
  const hay = `${business?.name ?? ''} ${business?.category ?? ''}`.toLowerCase();
  if (hay.includes('farm') || hay.includes('agric')) {
    fields.sku = null;
    fields.brand = null;
    fields.model = null;
    fields.supplier_id = null;
    fields.warranty_months = null;
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'business_id' || key === 'p_action' || key === 'p_product_id') continue;
    if (value !== undefined) patch[key] = value;
  }
  if (typeof patch['serial_tracking_mode'] === 'string' && !['none', 'unique', 'shared'].includes(patch['serial_tracking_mode'] as string)) {
    return reply({ error: 'Invalid serial tracking mode' }, 400);
  }
  // History protection: a mode with non-available serials cannot be switched
  // off or converted — sold/returned records must stay intact.
  if (typeof patch['serial_tracking_mode'] === 'string') {
    const { data: current } = await admin.from('products').select('serial_tracking_mode').eq('id', p_product_id).maybeSingle();
    const currentMode = (current as { serial_tracking_mode?: string } | null)?.serial_tracking_mode ?? 'none';
    if (currentMode !== 'none' && patch['serial_tracking_mode'] !== currentMode) {
      const { data: historic } = await admin.from('product_serial_numbers').select('id')
        .eq('product_id', p_product_id).neq('status', 'available').limit(1);
      if (historic && historic.length > 0) {
        return reply({ error: 'This product has sold or adjusted serials, so its tracking mode cannot be changed' }, 400);
      }
    }
  }
  if (Object.keys(patch).length === 0) return reply({ error: 'Nothing to update' }, 400);
  const { error: updateError } = await admin.from('products').update(patch).eq('id', p_product_id);
  if (updateError) return reply({ error: updateError.message }, 400);
  await admin.from('audit_log').insert({ actor_id: caller.id, action: 'product.updated', target_table: 'products', target_id: p_product_id, metadata: { fields: Object.keys(patch) } });
  return reply({ success: true });
});
