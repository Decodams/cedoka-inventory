import { useState, useMemo } from 'react';
import { ShoppingCart, Plus, Search, Package } from 'lucide-react';
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
import type { PurchaseRequest, Business, Branch, Supplier, PurchaseStatus } from '@/types/database';

export function ProcurementPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const canManage = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
  );

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const { data: suppliers } = useSupabaseQuery<Supplier[]>(
    () => supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
    [],
  );

  const purchaseQuery = useMemo(() => {
    let q = supabase
      .from('purchase_requests')
      .select(`*, business:businesses(*), branch:branches(*), supplier:suppliers(*)`)
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
    </div>
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
