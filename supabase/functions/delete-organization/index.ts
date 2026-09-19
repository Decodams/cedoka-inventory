import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Entity = 'business' | 'branch' | 'unit' | 'product' | 'role' | 'user';
type Body = { p_entity?: Entity; p_id?: string };

const LOCKED_ROLES = new Set(['super_admin', 'admin']);

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

  const { data: actor, error: actorError } = await admin.from('user_profiles')
    .select('is_active, role:roles(name)').eq('id', caller.id).maybeSingle();
  if (actorError) return reply({ error: actorError.message }, 500);
  const actorRole = (actor?.role as { name?: string } | null)?.name;
  if (!actor?.is_active || actorRole !== 'super_admin') {
    return reply({ error: 'Only a Super Admin can delete organization records' }, 403);
  }

  let body: Body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request body' }, 400); }
  const entity = body.p_entity;
  const id = body.p_id?.trim();
  if (!entity || !['business', 'branch', 'unit', 'product', 'role', 'user'].includes(entity)) {
    return reply({ error: 'Valid entity (business/branch/unit/product/role/user) is required' }, 400);
  }
  if (!id) return reply({ error: 'Record ID is required' }, 400);

  // Resolve the Default bucket (history + orphaned users land here, never deleted).
  const { data: defaultBiz } = await admin.from('businesses').select('id').eq('name', 'Default').maybeSingle();
  const defaultBusinessId = (defaultBiz as { id?: string } | null)?.id ?? null;
  let defaultBranchId: string | null = null;
  if (defaultBusinessId) {
    const { data: defaultBr } = await admin.from('branches').select('id')
      .eq('business_id', defaultBusinessId).eq('name', 'Default').maybeSingle();
    defaultBranchId = (defaultBr as { id?: string } | null)?.id ?? null;
  }
  const needBucket = entity === 'business' || entity === 'branch' || entity === 'product';
  if (needBucket && (!defaultBusinessId || !defaultBranchId)) {
    return reply({ error: 'Default bucket is missing — apply all migrations first' }, 400);
  }

  const fail = async (message: string) => reply({ error: message }, 400);
  const wipe = async (table: string, column: string, value: string) => {
    const { error } = await admin.from(table).delete().eq(column, value);
    if (error) throw new Error(error.message);
  };
  // Move RESTRICT-bound history rows into the Default bucket so the parent can go.
  const moveHistory = async (table: string, businessCol: boolean, branchCol: boolean, businessId: string | null, branchId: string | null) => {
    const patch: Record<string, string | null> = {};
    if (businessCol && businessId && defaultBusinessId) patch['business_id'] = defaultBusinessId;
    if (branchCol && branchId && defaultBranchId) patch['branch_id'] = defaultBranchId;
    if (Object.keys(patch).length === 0) return;
    const conditions: Array<{ column: string; value: string }> = [];
    if (businessCol && businessId) conditions.push({ column: 'business_id', value: businessId });
    if (branchCol && branchId) conditions.push({ column: 'branch_id', value: branchId });
    for (const cond of conditions) {
      const { error } = await admin.from(table).update(patch).eq(cond.column, cond.value);
      if (error && !String(error.message).includes('does not exist')) throw new Error(error.message);
    }
  };

  const deleteBranch = async (branchId: string) => {
    if (branchId === defaultBranchId) throw new Error('The Default branch is protected and cannot be deleted');
    // Staff keep their accounts; scope is cleared for reassignment.
    await admin.from('user_profiles').update({ branch_id: null }).eq('branch_id', branchId)
      .then(({ error }) => { if (error) throw new Error(error.message); });
    await wipe('user_branch_assignments', 'branch_id', branchId);
    // History moves to the Default bucket; open transfers are removed.
    await moveHistory('daily_sales', true, true, null, branchId);
    await moveHistory('daily_activities', true, true, null, branchId);
    await moveHistory('issues', true, true, null, branchId);
    await moveHistory('operational_expenses', true, true, null, branchId);
    await moveHistory('purchase_requests', true, true, null, branchId);
    await moveHistory('inventory_periods', true, true, null, branchId);
    await moveHistory('goods_received_notes', false, true, null, branchId);
    await moveHistory('stock_variances', false, true, null, branchId);
    await moveHistory('inventory_transactions', false, true, null, branchId);
    await moveHistory('weekly_reports', true, true, null, branchId);
    const { data: transfers } = await admin.from('stock_transfers').select('id')
      .or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`);
    for (const t of ((transfers ?? []) as Array<{ id: string }>)) {
      await wipe('stock_transfer_items', 'transfer_id', t.id);
      await wipe('stock_transfers', 'id', t.id);
    }
    // Balance rows cascade; the branch itself goes last.
    const { error } = await admin.from('branches').delete().eq('id', branchId);
    if (error) throw new Error(error.message);
  };

  try {
    if (entity === 'business') {
      const { data: biz } = await admin.from('businesses').select('id,name').eq('id', id).maybeSingle();
      if (!biz) return fail('Business not found');
      if (id === defaultBusinessId) return reply({ error: 'The Default business is protected and cannot be deleted' }, 403);
      // Staff keep accounts; they land in Default for reassignment.
      {
        const { error } = await admin.from('user_profiles')
          .update({ business_id: defaultBusinessId, branch_id: null }).eq('business_id', id);
        if (error) throw new Error(error.message);
      }
      await wipe('user_business_assignments', 'business_id', id);
      // Branches (each carries its own history handling).
      const { data: branches } = await admin.from('branches').select('id').eq('business_id', id);
      for (const b of ((branches ?? []) as Array<{ id: string }>)) {
        if (b.id !== defaultBranchId) await deleteBranch(b.id);
      }
      // Catalog master data goes.
      await wipe('categories', 'business_id', id);
      await wipe('suppliers', 'business_id', id);
      await wipe('business_measurement_units', 'business_id', id);
      for (const table of ['departments', 'teams', 'services', 'locations', 'workflows', 'report_types']) {
        try { await wipe(table, 'business_id', id); } catch (e) {
          const message = String((e as Error).message);
          if (!message.includes('does not exist') && !message.includes('Could not find')) throw e;
        }
      }
      // Products: history-bearing ones move to Default (deactivated); the rest go.
      const { data: products } = await admin.from('products').select('id').eq('business_id', id);
      for (const p of ((products ?? []) as Array<{ id: string }>)) {
        const { data: used1 } = await admin.from('sale_items').select('id').eq('product_id', p.id).limit(1);
        const { data: used2 } = await admin.from('daily_sales').select('id').eq('product_id', p.id).limit(1);
        if ((used1 && used1.length > 0) || (used2 && used2.length > 0)) {
          const { error } = await admin.from('products')
            .update({ business_id: defaultBusinessId, is_active: false }).eq('id', p.id);
          if (error) throw new Error(error.message);
        } else {
          await wipe('product_units', 'product_id', p.id);
          await wipe('products', 'id', p.id);
        }
      }
      // Remaining history at business grain moves to Default.
      await moveHistory('daily_sales', true, false, id, null);
      await moveHistory('daily_activities', true, false, id, null);
      await moveHistory('issues', true, false, id, null);
      await moveHistory('operational_expenses', true, false, id, null);
      await moveHistory('purchase_requests', true, false, id, null);
      await moveHistory('inventory_periods', true, false, id, null);
      await moveHistory('weekly_reports', true, false, id, null);
      const { error: bizError } = await admin.from('businesses').delete().eq('id', id);
      if (bizError) throw new Error(bizError.message);
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'business.deleted', target_table: 'businesses', target_id: id, metadata: { name: (biz as { name?: string }).name } });
      return reply({ success: true });
    }

    if (entity === 'branch') {
      const { data: br } = await admin.from('branches').select('id,name').eq('id', id).maybeSingle();
      if (!br) return fail('Branch not found');
      await deleteBranch(id);
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'branch.deleted', target_table: 'branches', target_id: id, metadata: { name: (br as { name?: string }).name } });
      return reply({ success: true });
    }

    if (entity === 'unit') {
      const { data: unit } = await admin.from('units').select('id,name').eq('id', id).maybeSingle();
      if (!unit) return fail('Unit not found');
      if ((unit as { name?: string }).name?.toLowerCase() === 'default') {
        return reply({ error: 'The Default unit is protected' }, 403);
      }
      await wipe('user_unit_assignments', 'unit_id', id);
      const { error } = await admin.from('units').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'unit.deleted', target_table: 'units', target_id: id, metadata: { name: (unit as { name?: string }).name } });
      return reply({ success: true });
    }

    if (entity === 'product') {
      const { data: prod } = await admin.from('products').select('id,name').eq('id', id).maybeSingle();
      if (!prod) return fail('Product not found');
      const { data: used1 } = await admin.from('sale_items').select('id').eq('product_id', id).limit(1);
      const { data: used2 } = await admin.from('daily_sales').select('id').eq('product_id', id).limit(1);
      if ((used1 && used1.length > 0) || (used2 && used2.length > 0)) {
        const { error } = await admin.from('products')
          .update({ business_id: defaultBusinessId, is_active: false }).eq('id', id);
        if (error) throw new Error(error.message);
        await admin.from('audit_log').insert({ actor_id: caller.id, action: 'product.deactivated_on_delete', target_table: 'products', target_id: id, metadata: { name: (prod as { name?: string }).name } });
        return reply({ success: true, deactivated: true });
      }
      await wipe('product_units', 'product_id', id);
      const { error } = await admin.from('products').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'product.deleted', target_table: 'products', target_id: id, metadata: { name: (prod as { name?: string }).name } });
      return reply({ success: true });
    }

    if (entity === 'role') {
      const { data: role } = await admin.from('roles').select('id,name,display_name').eq('id', id).maybeSingle();
      if (!role) return fail('Role not found');
      const roleName = (role as { name?: string }).name ?? '';
      if (LOCKED_ROLES.has(roleName)) return reply({ error: 'Super Admin and Admin roles are locked and cannot be deleted' }, 403);
      // Staff keep accounts; they fall back to Salesperson for reassignment.
      const { data: fallback } = await admin.from('roles').select('id').eq('name', 'sales_person').maybeSingle();
      const fallbackId = (fallback as { id?: string } | null)?.id ?? null;
      if (!fallbackId) throw new Error('Fallback role is missing');
      {
        const { error } = await admin.from('user_profiles').update({ role_id: fallbackId }).eq('role_id', id);
        if (error) throw new Error(error.message);
      }
      const { error } = await admin.from('roles').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'role.deleted', target_table: 'roles', target_id: id, metadata: { name: roleName } });
      return reply({ success: true, usersReassigned: true });
    }

    // entity === 'user': full delete; attribution columns null out automatically
    // (SET NULL), except the RESTRICT ones which are cleared first.
    const { data: target } = await admin.from('user_profiles').select('id,email,role:roles(name)').eq('id', id).maybeSingle();
    if (!target) return fail('User not found');
    if ((target as { role?: { name?: string } | null }).role?.name === 'super_admin') {
      return reply({ error: 'Super Admin accounts are locked and cannot be deleted' }, 403);
    }
    if (id === caller.id) return reply({ error: 'You cannot delete your own account' }, 403);
    await admin.from('user_profiles').update({ manager_id: null }).eq('manager_id', id)
      .then(({ error }) => { if (error) throw new Error(error.message); });
    await admin.from('inventory_exception_records').update({ reported_by: null }).eq('reported_by', id)
      .then(({ error }) => { if (error && !String(error.message).includes('does not exist')) throw new Error(error.message); });
    await admin.auth.admin.deleteUser(id)
      .then(({ error }) => { if (error) throw new Error(error.message); });
    await admin.from('audit_log').insert({ actor_id: caller.id, action: 'user.deleted', target_table: 'user_profiles', target_id: id, metadata: { email: (target as { email?: string }).email } });
    return reply({ success: true });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Delete failed' }, 400);
  }
});
