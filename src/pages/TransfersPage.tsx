import { useState, useMemo } from 'react';
import { ArrowLeftRight, Plus, Search, Package, ArrowRight, Trash2, Eye } from 'lucide-react';
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
  const [viewTransfer, setViewTransfer] = useState<StockTransfer | null>(null);
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

  const advanceStatus = async (t: StockTransfer, next: TransferStatus, extra: Record<string, unknown> = {}) => {
    // On dispatch: deduct from source branch; on receive: add to dest. Uses atomic RPC per item.
    const { data: items } = await supabase.from('stock_transfer_items').select('*').eq('transfer_id', t.id);
    if (next === 'dispatched' && items?.length) {
      for (const it of items) {
        const { error } = await supabase.rpc('record_inventory_movement', { p_product_id: it.product_id, p_branch_id: t.from_branch_id, p_movement_type: 'transfer_out', p_quantity: it.quantity, p_reason: `Transfer ${t.transfer_number ?? t.id.slice(0,8)} dispatched to ${(t.to_branch as unknown as Branch)?.name ?? ''}`, p_reference_type: 'stock_transfer', p_reference_id: t.id });
        if (error) { console.error(error); }
      }
    }
    if (next === 'received' && items?.length) {
      for (const it of items) {
        await supabase.rpc('record_inventory_movement', { p_product_id: it.product_id, p_branch_id: t.to_branch_id, p_movement_type: 'transfer_in', p_quantity: it.quantity, p_reason: `Transfer ${t.transfer_number ?? t.id.slice(0,8)} received from ${(t.from_branch as unknown as Branch)?.name ?? ''}`, p_reference_type: 'stock_transfer', p_reference_id: t.id });
      }
      // if received_quantity differs, use that if set
      for (const it of items) {
        if (it.received_quantity !== it.quantity) {
          await supabase.from('stock_transfer_items').update({ received_quantity: it.quantity }).eq('id', it.id);
        }
      }
    }
    await supabase.from('stock_transfers').update({ status: next, ...extra }).eq('id', t.id);
    refetch();
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load transfers." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Stock Transfers</h2>
          <p className="text-sm text-slate-500 mt-0.5">Branch-to-branch workflow — Request → Review → Approve → Dispatch (stock out) → In Transit → Receive (stock in) → Complete</p>
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
                <div className="flex items-start gap-3 min-w-0 flex-1 cursor-pointer" onClick={() => setViewTransfer(t)}>
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
                      {t.transfer_number ?? t.id.slice(0, 8)} · {formatDate(t.created_at)}
                      {t.reason && ` · ${t.reason}`}
                    </p>
                    {t.notes && <p className="text-xs text-slate-500 mt-1 line-clamp-1">{t.notes}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => setViewTransfer(t)}><Eye size={14}/>View</Button>
                  {canManage && t.status === 'requested' && (
                    <Button variant="ghost" size="sm" onClick={() => advanceStatus(t, 'reviewed')}>Review</Button>
                  )}
                  {canManage && t.status === 'reviewed' && (
                    <Button variant="ghost" size="sm" onClick={() => advanceStatus(t, 'approved', { approved_by: user?.id })}>Approve</Button>
                  )}
                  {canManage && t.status === 'approved' && (
                    <Button variant="ghost" size="sm" onClick={() => advanceStatus(t, 'dispatched', { dispatched_at: new Date().toISOString() })}>Dispatch</Button>
                  )}
                  {canManage && (t.status === 'dispatched' || t.status === 'in_transit') && (
                    <Button variant="ghost" size="sm" onClick={() => advanceStatus(t, 'received', { received_at: new Date().toISOString() })}>Mark Received</Button>
                  )}
                  {canManage && t.status === 'received' && (
                    <Button variant="ghost" size="sm" onClick={() => advanceStatus(t, 'completed', { completed_at: new Date().toISOString() })}>Complete</Button>
                  )}
                </div>
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
          currentUser={user}
          onClose={() => setShowModal(false)}
          onSaved={() => { refetch(); setShowModal(false); }}
        />
      )}
      {viewTransfer && (
        <TransferDetailModal transfer={viewTransfer} onClose={() => setViewTransfer(null)} />
      )}
    </div>
  );
}

function TransferModal({
  branches, currentUser, onClose, onSaved,
}: {
  branches: Branch[];
  currentUser: { id: string; role?: { name: string }; business_id: string | null; branch_id: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isManager = currentUser?.role?.name === 'manager';
  const [fromBranchId, setFromBranchId] = useState(currentUser?.branch_id ?? '');
  const [toBranchId, setToBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<{ product_id: string; quantity: string }[]>([{ product_id: '', quantity: '1' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFromBranch = branches.find((b) => b.id === fromBranchId);

  const loadProducts = async (bizId: string) => {
    const { data } = await supabase.from('products').select('*').eq('is_active', true).eq('business_id', bizId).order('name');
    setProducts((data as Product[]) ?? []);
  };

  const handleFromChange = (bid: string) => {
    setFromBranchId(bid);
    const br = branches.find((b) => b.id === bid);
    if (br) loadProducts(br.business_id);
  };
  if (selectedFromBranch && products.length === 0) loadProducts(selectedFromBranch.business_id);

  const addItem = () => setItems([...items, { product_id: '', quantity: '1' }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<{ product_id: string; quantity: string }>) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], ...patch };
    setItems(copy);
  };

  const handleSave = async () => {
    if (!fromBranchId || !toBranchId) {
      setError('Both source and destination branches are required');
      return;
    }
    if (fromBranchId === toBranchId) {
      setError('Source and destination must be different');
      return;
    }
    const validItems = items.filter((it) => it.product_id && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      setError('Add at least one product with quantity > 0');
      return;
    }
    setSaving(true);
    setError(null);
    const transferNumber = `TR-${Date.now().toString().slice(-8)}`;
    const { data: tr, error: e } = await supabase.from('stock_transfers').insert({
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      transfer_number: transferNumber,
      status: 'requested',
      reason: reason.trim() || null,
      notes: notes.trim(),
      requested_by: currentUser?.id,
    }).select().single();
    if (e || !tr) { setError('Could not create the transfer. ' + (e?.message ?? '')); setSaving(false); return; }
    const itemsToInsert = validItems.map((it) => ({ transfer_id: tr.id, product_id: it.product_id, quantity: Number(it.quantity), received_quantity: 0 }));
    const { error: ie } = await supabase.from('stock_transfer_items').insert(itemsToInsert);
    if (ie) { setError('Transfer created but items failed: ' + ie.message); }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="New Stock Transfer" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label="From Branch" value={fromBranchId} onChange={(e) => handleFromChange(e.target.value)} disabled={isManager}>
            <option value="">Select source...</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="To Branch" value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
            <option value="">Select destination...</option>
            {branches.filter((b) => b.id !== fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this transfer needed?" />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional details..." />

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Package size={16}/>Items</h4>
            <Button variant="ghost" size="sm" onClick={addItem}><Plus size={14}/>Add Item</Button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <Select value={it.product_id} onChange={(e) => updateItem(idx, { product_id: e.target.value })} className="flex-1">
                  <option value="">Select product...</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
                </Select>
                <Input label={idx === 0 ? 'Qty' : ''} type="number" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} className="w-20" />
                <button onClick={() => removeItem(idx)} className="p-2 rounded-lg text-rose-400 hover:bg-rose-50 mb-0.5"><Trash2 size={16}/></button>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Create Transfer'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function TransferDetailModal({ transfer, onClose }: { transfer: StockTransfer; onClose: () => void }) {
  const [items, setItems] = useState<(typeof transfer & { product?: Product })[]>([]);
  // load items
  if (items.length === 0) {
    supabase.from('stock_transfer_items').select(`*, product:products(*)`).eq('transfer_id', transfer.id).then(({ data }) => { if (data) setItems(data as unknown as typeof items); });
  }
  return (
    <Modal open onClose={onClose} title={`Transfer ${transfer.transfer_number ?? transfer.id.slice(0,8)}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 bg-slate-50 rounded-xl p-4 text-sm">
          <div><p className="text-xs text-slate-400">From</p><p className="font-medium text-slate-900">{(transfer.from_branch as unknown as Branch)?.name}</p></div>
          <div><p className="text-xs text-slate-400">To</p><p className="font-medium text-slate-900">{(transfer.to_branch as unknown as Branch)?.name}</p></div>
          <div><p className="text-xs text-slate-400">Status</p><Badge className={TRANSFER_STATUS_STYLES[transfer.status]}>{TRANSFER_STATUS_LABELS[transfer.status]}</Badge></div>
          <div><p className="text-xs text-slate-400">Created</p><p className="text-slate-600">{formatDate(transfer.created_at)}</p></div>
          {transfer.reason && <div className="col-span-2"><p className="text-xs text-slate-400">Reason</p><p className="text-slate-600">{transfer.reason}</p></div>}
          {transfer.notes && <div className="col-span-2"><p className="text-xs text-slate-400">Notes</p><p className="text-slate-600">{transfer.notes}</p></div>}
        </div>
        <h4 className="text-sm font-semibold text-slate-900">Items</h4>
        {items.length ? (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-500"><th className="text-left px-4 py-2">Product</th><th className="text-right px-4 py-2">Qty</th><th className="text-right px-4 py-2">Received</th></tr></thead>
              <tbody>
                {items.map((it: unknown) => {
                  const row = it as { id: string; product?: Product; quantity: number; received_quantity: number };
                  return <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-2">{row.product?.name ?? row.id.slice(0,8)}</td><td className="text-right px-4 py-2">{row.quantity}</td><td className="text-right px-4 py-2">{row.received_quantity}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-400">No items found.</p>}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
