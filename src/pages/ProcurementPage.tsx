import { useState, useMemo, useEffect } from 'react';
import { ShoppingCart, Plus, Search, ClipboardCheck, Eye } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import { PURCHASE_STATUS_STYLES, PURCHASE_STATUS_LABELS } from '@/lib/statusStyles';
import type { PurchaseRequest, Business, Branch, Supplier, PurchaseStatus, Product } from '@/types/database';

export function ProcurementPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [grnPurchase, setGrnPurchase] = useState<PurchaseRequest | null>(null);
  const [viewGRNs, setViewGRNs] = useState<PurchaseRequest | null>(null);
  const canManage = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:branches:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: suppliers } = useSupabaseQuery<Supplier[]>(
    () => supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:suppliers:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const purchaseQuery = useMemo(() => {
    let q = supabase
      .from('purchase_requests')
      .select(`*, business:businesses(id,name), branch:branches(id,name), supplier:suppliers(id,name)`)
      .order('created_at', { ascending: false })
      .limit(60);
    if (!isExecutive && isBusinessLevel && user?.business_id) {
      q = q.eq('business_id', user.business_id);
    } else if (!isBusinessLevel && user?.branch_id) {
      q = q.eq('branch_id', user.branch_id);
    }
    if (filterStatus !== 'all') q = q.eq('status', filterStatus as PurchaseStatus);
    return q;
  }, [isExecutive, isBusinessLevel, user, filterStatus]);

  const { data: purchases, loading, error, refetch } = useSupabaseQuery<PurchaseRequest[]>(
    () => purchaseQuery,
    [purchaseQuery],
  );

  const filtered = useMemo(() => {
    if (!purchases) return [];
    if (!search) return purchases;
    const q = search.toLowerCase();
    return purchases.filter(
      (p) => (p.supplier?.name?.toLowerCase().includes(q) ?? false) || (p.branch?.name?.toLowerCase().includes(q) ?? false) || (p.notes?.toLowerCase().includes(q) ?? false),
    );
  }, [purchases, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load procurement records." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Procurement</h2>
          <p className="text-sm text-slate-500 mt-0.5">Purchase requests, orders, and goods received tracking.</p>
        </div>
        {canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Purchase Request</Button>}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search by supplier, branch, or notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="sm:w-48">
          <option value="all">All Statuses</option>
          {Object.entries(PURCHASE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                    <ShoppingCart size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {p.request_number ?? `PR-${p.id.slice(0, 8)}`}
                      </h3>
                      <Badge className={PURCHASE_STATUS_STYLES[p.status]}>{PURCHASE_STATUS_LABELS[p.status]}</Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {p.branch?.name} · {p.business?.name}
                      {p.supplier && ` · Supplier: ${p.supplier.name}`}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span>Est. Cost: {formatCurrency(Number(p.estimated_cost))}</span>
                      {p.expected_delivery_date && <span>Expected: {formatDate(p.expected_delivery_date)}</span>}
                      <span>Created: {formatDate(p.created_at)}</span>
                    </div>
                    {p.notes && <p className="text-sm text-slate-500 mt-1.5 line-clamp-2">{p.notes}</p>}
                  </div>
                </div>
                {canManage && p.status === 'requested' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from('purchase_requests').update({ status: 'ordered', ordered_at: new Date().toISOString(), approved_by: user?.id }).eq('id', p.id);
                      refetch();
                    }}
                  >
                    Approve & Order
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setViewGRNs(p)}><Eye size={14}/>GRNs</Button>
                {canManage && (p.status === 'ordered' || p.status === 'partially_received') && (
                  <Button variant="ghost" size="sm" onClick={() => setGrnPurchase(p)}><ClipboardCheck size={14}/>Record GRN</Button>
                )}
                {canManage && p.status === 'ordered' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from('purchase_requests').update({ status: 'received' }).eq('id', p.id);
                      refetch();
                    }}
                  >
                    Mark Received
                  </Button>
                )}
                {canManage && p.status === 'received' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from('purchase_requests').update({ status: 'completed' }).eq('id', p.id);
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
          icon={<ShoppingCart size={32} />}
          title="No purchase requests"
          description="Create a purchase request to start the procurement process."
          action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Purchase Request</Button>}
        />
      )}

      {showModal && (
        <PurchaseModal
          businesses={businesses ?? []}
          branches={branches ?? []}
          suppliers={suppliers ?? []}
          currentUser={user}
          onClose={() => setShowModal(false)}
          onSaved={() => { refetch(); setShowModal(false); }}
        />
      )}
      {grnPurchase && <GRNModal purchase={grnPurchase} currentUser={user} onClose={() => setGrnPurchase(null)} onSaved={() => { refetch(); setGrnPurchase(null); }} />}
      {viewGRNs && <ViewGRNsModal purchase={viewGRNs} onClose={() => setViewGRNs(null)} />}
    </div>
  );
}

function GRNModal({ purchase, currentUser, onClose, onSaved }: { purchase: PurchaseRequest; currentUser: { id: string } | null; onClose: () => void; onSaved: () => void }) {
  const [deliveryNote, setDeliveryNote] = useState('');
  const [isPartial, setIsPartial] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<{ product_id: string; quantity_ordered: string; quantity_received: string; quantity_damaged: string; quantity_rejected: string; quantity_short: string }[]>([{ product_id: '', quantity_ordered: '0', quantity_received: '0', quantity_damaged: '0', quantity_rejected: '0', quantity_short: '0' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // load products for the purchase's business (effect, not render, to avoid duplicate requests)
  useEffect(() => {
    if (products.length > 0) return;
    let cancelled = false;
    supabase.from('products').select('id,name').eq('is_active', true).eq('business_id', purchase.business_id).order('name').then(({ data }) => {
      if (!cancelled && data) setProducts(data as Product[]);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase.business_id]);

  const handleSave = async () => {
    const valid = items.filter((i) => i.product_id && Number(i.quantity_received) >= 0);
    if (valid.length === 0) { setError('Add at least one product with received quantity'); return; }
    setSaving(true); setError(null);
    const grnNumber = `GRN-${Date.now().toString().slice(-8)}`;
    const { data: grn, error: e } = await supabase.from('goods_received_notes').insert({
      grn_number: grnNumber, purchase_request_id: purchase.id, branch_id: purchase.branch_id, supplier_id: purchase.supplier_id, received_by: currentUser?.id, delivery_note_number: deliveryNote || null, is_partial: isPartial, received_date: new Date().toISOString().split('T')[0],
    }).select().single();
    if (e || !grn) { setError(e?.message ?? 'Could not create GRN'); setSaving(false); return; }
    const toInsert = valid.map((it) => ({ grn_id: grn.id, product_id: it.product_id, quantity_ordered: Number(it.quantity_ordered || 0), quantity_received: Number(it.quantity_received || 0), quantity_damaged: Number(it.quantity_damaged || 0), quantity_rejected: Number(it.quantity_rejected || 0), quantity_short: Number(it.quantity_short || 0) }));
    await supabase.from('goods_received_items').insert(toInsert);
    // inventory only increases by quantity_received (net of damaged/rejected handled separately). Here we use received - damaged - rejected
    for (const it of valid) {
      const netQty = Number(it.quantity_received) - Number(it.quantity_damaged || 0) - Number(it.quantity_rejected || 0);
      if (netQty > 0) {
        await supabase.rpc('record_inventory_movement', { p_product_id: it.product_id, p_branch_id: purchase.branch_id, p_movement_type: 'purchase_receipt', p_quantity: netQty, p_reason: `GRN ${grnNumber} for PO ${purchase.request_number ?? purchase.id.slice(0,8)}`, p_reference_type: 'goods_received_note', p_reference_id: grn.id });
      }
      if (Number(it.quantity_damaged || 0) > 0) {
        await supabase.rpc('record_inventory_movement', { p_product_id: it.product_id, p_branch_id: purchase.branch_id, p_movement_type: 'damage', p_quantity: Number(it.quantity_damaged), p_reason: `Damaged on GRN ${grnNumber}`, p_reference_type: 'goods_received_note', p_reference_id: grn.id });
      }
    }
    // update PR status
    const hasOutstanding = valid.some((it) => Number(it.quantity_short) > 0) || isPartial;
    await supabase.from('purchase_requests').update({ status: hasOutstanding ? 'partially_received' : 'received' }).eq('id', purchase.id);
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={`Record Goods Received — ${purchase.request_number ?? purchase.id.slice(0, 8)}`} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Delivery Note No." value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="Supplier delivery note" />
          <label className="flex items-center gap-2 text-sm text-slate-700 mt-6">
            <input type="checkbox" checked={isPartial} onChange={(e) => setIsPartial(e.target.checked)} className="rounded border-slate-300" />
            Partial delivery (outstanding qty remains)
          </label>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-900">Items — compare ordered vs received / damaged / rejected / short</h4>
            <Button variant="ghost" size="sm" onClick={() => setItems([...items, { product_id: '', quantity_ordered: '0', quantity_received: '0', quantity_damaged: '0', quantity_rejected: '0', quantity_short: '0' }])}><Plus size={14}/>Add Item</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 text-left"><th className="px-2 py-2">Product</th><th className="px-2 py-2">Ordered</th><th className="px-2 py-2">Received</th><th className="px-2 py-2">Damaged</th><th className="px-2 py-2">Rejected</th><th className="px-2 py-2">Short</th><th></th></tr></thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-1 py-1"><Select value={it.product_id} onChange={(e) => { const c = [...items]; c[idx].product_id = e.target.value; setItems(c); }}><option value="">Select...</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></td>
                    <td className="px-1 py-1"><Input type="number" value={it.quantity_ordered} onChange={(e) => { const c = [...items]; c[idx].quantity_ordered = e.target.value; setItems(c); }} className="w-20" /></td>
                    <td className="px-1 py-1"><Input type="number" value={it.quantity_received} onChange={(e) => { const c = [...items]; c[idx].quantity_received = e.target.value; setItems(c); }} className="w-20" /></td>
                    <td className="px-1 py-1"><Input type="number" value={it.quantity_damaged} onChange={(e) => { const c = [...items]; c[idx].quantity_damaged = e.target.value; setItems(c); }} className="w-20" /></td>
                    <td className="px-1 py-1"><Input type="number" value={it.quantity_rejected} onChange={(e) => { const c = [...items]; c[idx].quantity_rejected = e.target.value; setItems(c); }} className="w-20" /></td>
                    <td className="px-1 py-1"><Input type="number" value={it.quantity_short} onChange={(e) => { const c = [...items]; c[idx].quantity_short = e.target.value; setItems(c); }} className="w-20" /></td>
                    <td className="px-1 py-1"><button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-rose-400 hover:text-rose-600 text-xs">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save GRN & Update Stock'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ViewGRNsModal({ purchase, onClose }: { purchase: PurchaseRequest; onClose: () => void }) {
  const [grns, setGrns] = useState<unknown[]>([]);
  // load once (effect, not render, to avoid duplicate requests)
  useEffect(() => {
    let cancelled = false;
    supabase.from('goods_received_notes').select(`*, items:goods_received_items(*, product:products(id,name))`).eq('purchase_request_id', purchase.id).order('created_at', { ascending: false }).then(({ data }) => {
      if (!cancelled && data) setGrns(data);
    });
    return () => { cancelled = true; };
  }, [purchase.id]);
  return (
    <Modal open onClose={onClose} title={`GRNs for ${purchase.request_number ?? purchase.id.slice(0,8)}`} size="lg">
      <div className="space-y-3">
        {(grns as { id: string; grn_number: string; delivery_note_number: string | null; is_partial: boolean; received_date: string; items?: { product?: { name: string }; quantity_ordered: number; quantity_received: number; quantity_damaged: number; quantity_rejected: number; quantity_short: number }[] }[]).length ? (grns as { id: string; grn_number: string; delivery_note_number: string | null; is_partial: boolean; received_date: string; items?: { product?: { name: string }; quantity_ordered: number; quantity_received: number; quantity_damaged: number; quantity_rejected: number; quantity_short: number }[] }[]).map((g) => (
          <div key={g.id} className="border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">{g.grn_number} {g.is_partial && <Badge className="bg-amber-100 text-amber-700 border-amber-200 ml-2">Partial</Badge>}</p>
              <p className="text-xs text-slate-400">{formatDate(g.received_date)}</p>
            </div>
            {g.delivery_note_number && <p className="text-xs text-slate-400">DN: {g.delivery_note_number}</p>}
            <div className="mt-2 text-xs">
              <div className="grid grid-cols-5 gap-2 font-semibold text-slate-500"><span>Product</span><span>Ordered</span><span>Received</span><span>Damaged/Rejected</span><span>Short</span></div>
              {g.items?.map((it, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 text-slate-600 mt-1"><span>{it.product?.name ?? '—'}</span><span>{it.quantity_ordered}</span><span className="text-emerald-600 font-medium">{it.quantity_received}</span><span className="text-rose-600">{it.quantity_damaged + it.quantity_rejected}</span><span className="text-amber-600">{it.quantity_short}</span></div>
              ))}
            </div>
          </div>
        )) : <p className="text-sm text-slate-400 py-6 text-center">No goods received notes yet. Record a GRN when delivery arrives.</p>}
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}

function PurchaseModal({
  businesses, branches, suppliers, currentUser, onClose, onSaved,
}: {
  businesses: Business[];
  branches: Branch[];
  suppliers: Supplier[];
  currentUser: { id: string; role?: { name: string }; business_id: string | null; branch_id: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const isBusinessLevel = currentUser?.role?.name === 'admin';
  const isManager = currentUser?.role?.name === 'manager';

  const availableBusinesses = isExecutive ? businesses : businesses.filter((b) => b.id === currentUser?.business_id);
  const availableBranches = isExecutive ? branches : isBusinessLevel ? branches : branches.filter((b) => b.id === currentUser?.branch_id);

  const [businessId, setBusinessId] = useState(currentUser?.business_id ?? '');
  const [branchId, setBranchId] = useState(currentUser?.branch_id ?? '');
  const [supplierId, setSupplierId] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('0');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredSuppliers = suppliers.filter((s) => s.business_id === businessId);

  const handleSave = async () => {
    if (!businessId || !branchId) {
      setError('Business and branch are required');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from('purchase_requests').insert({
      business_id: businessId,
      branch_id: branchId,
      supplier_id: supplierId || null,
      status: 'requested',
      estimated_cost: Number(estimatedCost || 0),
      expected_delivery_date: expectedDelivery || null,
      notes: notes.trim(),
      requested_by: currentUser?.id,
    });
    if (e) { setError('Could not create the purchase request.'); setSaving(false); return; }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="New Purchase Request" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Business Unit" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setSupplierId(''); }}>
            <option value="">Select...</option>
            {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={isManager}>
            <option value="">Select...</option>
            {availableBranches.filter((b) => !businessId || b.business_id === businessId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">None / Unspecified</option>
            {filteredSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="Estimated Cost" type="number" value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} />
          <Input label="Expected Delivery Date" type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
        </div>
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What items are being requested? Provide details..." />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Create Request'}</Button>
        </div>
      </div>
    </Modal>
  );
}
