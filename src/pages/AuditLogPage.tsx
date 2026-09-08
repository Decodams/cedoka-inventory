import { useState, useMemo } from 'react';
import { FileText, Search } from 'lucide-react';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Select } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/dateUtils';
import type { AuditLogEntry } from '@/types/database';

export function AuditLogPage() {
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('all');

  const { data: logs, loading, error, refetch } = useSupabaseQuery<AuditLogEntry[]>(
    () =>
      supabase
        .from('audit_log')
        .select(`*, actor:user_profiles!actor_id(full_name, email)`)
        .order('created_at', { ascending: false })
        .limit(200),
    [],
  );

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter((l) => {
      if (filterAction !== 'all' && l.action !== filterAction) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.action.toLowerCase().includes(q) ||
          l.target_table.toLowerCase().includes(q) ||
          (l.actor?.full_name?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [logs, search, filterAction]);

  const uniqueActions = useMemo(() => {
    if (!logs) return [];
    return [...new Set(logs.map((l) => l.action))].sort();
  }, [logs]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load audit log." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Audit Log</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          A record of all significant actions taken in the system.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search by action, table, or user..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <Select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="sm:w-56">
          <option value="all">All Actions</option>
          {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
      </div>

      {filtered.length > 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">When</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">User</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Action</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{log.actor?.full_name ?? 'System'}</td>
                    <td className="px-5 py-3">
                      <Badge className="bg-slate-100 text-slate-600 border-slate-200">{log.action}</Badge>
                    </td>
                    <td className="px-5 py-3 hidden sm:table-cell text-sm text-slate-400">
                      {log.target_table}
                      {log.target_id && ` · ${log.target_id.slice(0, 8)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<FileText size={32} />}
          title="No audit entries"
          description="Actions taken in the system will be recorded here."
        />
      )}
    </div>
  );
}
