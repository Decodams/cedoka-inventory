import { supabase } from '@/hooks/useSupabaseQuery';

export interface AuditMetadata {
  [key: string]: string | number | boolean | null;
}

export async function logAudit(
  action: string,
  targetTable: string,
  targetId?: string | null,
  metadata?: AuditMetadata,
  scope?: { business_id?: string | null; branch_id?: string | null },
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from('audit_log').insert({
      actor_id: user?.id ?? null,
      action,
      target_table: targetTable,
      target_id: targetId ?? null,
      metadata: metadata ?? {},
      // Scope columns (spec section 28): when a branch is provided the
      // database trigger derives business/location automatically.
      ...(scope?.branch_id ? { branch_id: scope.branch_id } : {}),
      ...(scope?.business_id ? { business_id: scope.business_id } : {}),
    });
  } catch {
    // Audit logging must never block the primary operation.
  }
}