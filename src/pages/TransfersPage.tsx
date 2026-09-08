import { useState, useMemo } from 'react';
import { ArrowLeftRight, Plus, Search, Package, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/dateUtils';
import { isAtLeast } from '@/lib/rbac';
import { TRANSFER_STATUS_STYLES, TRANSFER_STATUS_LABELS } from '@/lib/statusStyles';
import type { StockTransfer, Branch, Product, TransferStatus } from '@/types/database';

export function TransfersPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const canManage = isAtLeast(user, 'manager');

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const transfersQuery = useMemo(() => {
    let q = supabase
      .from('stock_transfers')
      .select(`*, from_branch:branches!from_branch_id(*), to_branch:branches!to_branch_id(*)`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus as TransferStatus);
    return q;
  }, [filterStatus]);

  const { data: transfers, loading, error, refetch } = useSupabaseQuery<StockTransfer[]>(
    () => transfersQuery,
    [transfersQuery],
  );

  const filtered = useMemo(() => {
    if (!transfers) return [];
    if (!search) return transfers;
    const q = search.toLowerCase();
    return transfers.filter(
      (t) => (t.from_branch?.name?.toLowerCase().includes(q) ?? false) || (t.to_branch?.name?.toLowerCase().includes(q) ?? false) || (t.reason?.toLowerCase().includes(q) ?? false),
    );
  }, [transfers, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load transfers." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Stock Transfers</h2>
          <p className="text-sm text-slate-500 mt-0.5">Track stock movements between branches and locations.</p>
        </div>
        {canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Transfer</Button>}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search by branch or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="sm:w-44">
          <option value="all">All Statuses</option>
          {Object.entries(TRANSFER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((t) => (
            <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                    <ArrowLeftRight size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span>{t.from_branch?.name}</span>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span>{t.to_branch?.name}</span>
                      </div>
                      <Badge className={TRANSFER_STATUS_STYLES[t.status]}>{TRANSFER_STATUS_LABELS[t.status]}</Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatDate(t.created_at)}
                      {t.reason && ` · ${t.reason}`}
                    </p>
                  </div>
                </div>
                {canManage && t.status === 'requested' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from('stock_transfers').update({ status: 'approved', approved_by: user?.id }).eq('id', t.id);
                      refetch();
                    }}
                  >
                    Approve
                  </Button>
                )}
                {canManage && t.status === 'approved' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from('stock_transfers').update({ status: 'dispatched', dispatched_at: new Date().toISOString() }).eq('id', t.id);
                      refetch();
                    }}
                  >
                    Dispatch
                  </Button>
                )}
                {canManage && t.status === 'dispatched' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from('stock_transfers').update({ status: 'received', received_at: new Date().toISOString() }).eq('id', t.id);
                      refetch();
                    }}
                  >
                    Mark Received
                  </Button>
                )}
                {canManage && t.status === 'received' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from('stock_transfers').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', t.id);
                      refetch();
                    }}
                  >
                    Complete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ArrowLeftRight size={32} />}
          title="No stock transfers"
          description="Create a transfer to move stock between branches."
          action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Transfer</Button>}
        />
      )}

      {showModal && (
        <TransferModal
          branches={branches ?? []}
          products={[]}
          currentUser={user}
          onClose={() => setShowModal(false)}
          onSaved={() => { refetch(); setShowModal(false); }}
        />
      )}
    </div>
  );
}

function TransferModal({
  branches, currentUser, onClose, onSaved,
}: {
  branches: Branch[];
  products: Product[];
  currentUser: { id: string; role?: { name: string }; branch_id: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isManager = currentUser?.role?.name === 'manager';
  const [fromBranchId, setFromBranchId] = useState(currentUser?.branch_id ?? '');
  const [toBranchId, setToBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!fromBranchId || !toBranchId) {
      setError('Both source and destination branches are required');
      return;
    }
    if (fromBranchId === toBranchId) {
      setError('Source and destination must be different');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from('stock_transfers').insert({
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      status: 'requested',
      reason: reason.trim() || null,
      notes: notes.trim(),
      requested_by: currentUser?.id,
    });
    if (e) { setError('Could not create the transfer.'); setSaving(false); return; }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="New Stock Transfer" size="md">
      <div className="space-y-4">
        <Select label="From Branch" value={fromBranchId} onChange={(e) => setFromBranchId(e.target.value)} disabled={isManager}>
          <option value="">Select source...</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select label="To Branch" value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
          <option value="">Select destination...</option>
          {branches.filter((b) => b.id !== fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this transfer needed?" />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional details..." />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Create Transfer'}</Button>
        </div>
      </div>
    </Modal>
  );
}
