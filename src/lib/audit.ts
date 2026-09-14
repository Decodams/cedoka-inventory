import { supabase } from '@/hooks/useSupabaseQuery';

export interface AuditMetadata {
  [key: string]: string | number | boolean | null;
}

export async function logAudit(
  action: string,
  targetTable: string,
  targetId?: string | null,
  metadata?: AuditMetadata,
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
    });
  } catch {
    // Audit logging must never block the primary operation.
  }
}