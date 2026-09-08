import { useState, useMemo } from 'react';
import { Package, Search, AlertTriangle, TrendingDown, TrendingUp, History, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatNumber, formatDateTime } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import { MOVEMENT_TYPE_STYLES, MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_SIGNS } from '@/lib/statusStyles';
import type { InventoryBalance, InventoryTransaction, Branch, MovementType, Product } from '@/types/database';

export function InventoryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'balances' | 'ledger'>('balances');
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [showMovementModal, setShowMovementModal] = useState(false);
  const canManage = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const { data: products } = useSupabaseQuery<Product[]>(
    () => supabase.from('products').select('*').eq('is_active', true).order('name'),
    [],
  );

  const balancesQuery = useMemo(() => {
    let q = supabase
      .from('inventory_balances')
      .select(`*, product:products(*), branch:branches(*)`)
      .order('updated_at', { ascending: false });
    if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    return q;
  }, [isBusinessLevel, user, filterBranch]);

  const { data: balances, loading: loadingBalances, error: errorBalances, refetch: refetchBalances } =
    useSupabaseQuery<InventoryBalance[]>(() => balancesQuery, [balancesQuery]);

  const ledgerQuery = useMemo(() => {
    let q = supabase
      .from('inventory_transactions')
      .select(`*, product:products(*), branch:branches(*), actor:user_profiles!actor_id(full_name)`)
      .order('transaction_date', { ascending: false })
      .limit(100);
    if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    return q;
  }, [isBusinessLevel, user, filterBranch]);

  const { data: transactions, loading: loadingTxns, error: errorTxns, refetch: refetchTxns } =
    useSupabaseQuery<InventoryTransaction[]>(() => ledgerQuery, [ledgerQuery]);

  const filteredBalances = useMemo(() => {
    if (!balances) return [];
    if (!search) return balances;
    const q = search.toLowerCase();
    return balances.filter((b) => b.product?.name?.toLowerCase().includes(q) || (b.product?.sku?.toLowerCase().includes(q) ?? false));
  }, [balances, search]);

  const filteredTxns = useMemo(() => {
    if (!transactions) return [];
    if (!search) return transactions;
    const q = search.toLowerCase();
    return transactions.filter((t) => t.product?.name?.toLowerCase().includes(q) || (t.product?.sku?.toLowerCase().includes(q) ?? false));
  }, [transactions, search]);

  const loading = tab === 'balances' ? loadingBalances : loadingTxns;
  const error = tab === 'balances' ? errorBalances : errorTxns;
  const refetch = tab === 'balances' ? refetchBalances : refetchTxns;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load inventory data." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Inventory</h2>
          <p className="text-sm text-slate-500 mt-0.5">Stock balances and movement history across branches.</p>
        </div>
        {canManage && (
          <Button onClick={() => setShowMovementModal(true)}>
            <Plus size={18} /> Record Movement
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setTab('balances')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'balances' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Stock Balances
          </button>
          <button
            onClick={() => setTab('ledger')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Movement Ledger
          </button>
        </div>
        <div className="relative flex-1 min-w-0">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        {isBusinessLevel && (
          <Select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="sm:w-48">
            <option value="all">All Branches</option>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {tab === 'balances' ? (
        filteredBalances.length > 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Product</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">Branch</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Opening</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Current</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Min</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Reorder</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredBalances.map((b) => {
                    const belowMin = b.current_stock <= b.min_stock_level && b.min_stock_level > 0;
                    const belowReorder = b.current_stock <= b.reorder_level && b.reorder_level > 0;
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                              <Package size={16} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">{b.product?.name}</p>
                              {b.product?.sku && <p className="text-xs text-slate-400">{b.product.sku}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3 hidden sm:table-cell">
                          <span className="text-sm text-slate-600">{b.branch?.name}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-sm text-slate-600">{formatNumber(b.opening_stock)}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-sm font-semibold ${belowMin ? 'text-rose-600' : belowReorder ? 'text-amber-600' : 'text-slate-900'}`}>
                            {formatNumber(b.current_stock)}
                          </span>
                          <span className="text-xs text-slate-400 ml-1">{b.product?.unit}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-sm text-slate-400 hidden md:table-cell">{b.min_stock_level}</td>
                        <td className="px-5 py-3 text-right text-sm text-slate-400 hidden md:table-cell">{b.reorder_level}</td>
                        <td className="px-5 py-3">
                          {belowMin ? (
                            <Badge className="bg-rose-100 text-rose-700 border-rose-200"><AlertTriangle size={10} className="mr-1" />Below Min</Badge>
                          ) : belowReorder ? (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200"><TrendingDown size={10} className="mr-1" />Reorder</Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><TrendingUp size={10} className="mr-1" />OK</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Package size={32} />}
            title="No inventory balances"
            description="Record a stock movement to create inventory balances for your products."
            action={canManage && <Button onClick={() => setShowMovementModal(true)}><Plus size={18} /> Record Movement</Button>}
          />
        )
      ) : (
        filteredTxns.length > 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Date</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Product</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Type</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Qty</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">Branch</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Reason</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredTxns.map((t) => {
                    const sign = MOVEMENT_TYPE_SIGNS[t.movement_type as MovementType];
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDateTime(t.transaction_date)}</td>
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-slate-900 truncate max-w-[160px]">{t.product?.name}</p>
                        </td>
                        <td className="px-5 py-3">
                          <Badge className={MOVEMENT_TYPE_STYLES[t.movement_type as MovementType]}>
                            {MOVEMENT_TYPE_LABELS[t.movement_type as MovementType]}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-sm font-semibold ${sign > 0 ? 'text-emerald-600' : sign < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                            {sign > 0 ? '+' : sign < 0 ? '-' : ''}{formatNumber(t.quantity)}
                          </span>
                        </td>
                        <td className="px-5 py-3 hidden sm:table-cell text-sm text-slate-600">{t.branch?.name}</td>
                        <td className="px-5 py-3 hidden md:table-cell text-sm text-slate-500 max-w-[180px] truncate">{t.reason ?? '—'}</td>
                        <td className="px-5 py-3 hidden lg:table-cell text-sm text-slate-400">{t.actor?.full_name ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<History size={32} />}
            title="No stock movements recorded"
            description="Every stock change — sales, receipts, damages, transfers — will appear here."
            action={canManage && <Button onClick={() => setShowMovementModal(true)}><Plus size={18} /> Record Movement</Button>}
          />
        )
      )}

      {showMovementModal && (
        <MovementModal
          products={products ?? []}
          branches={branches ?? []}
          currentUser={user}
          onClose={() => setShowMovementModal(false)}
          onSaved={() => { refetchBalances(); refetchTxns(); setShowMovementModal(false); }}
        />
      )}
    </div>
  );
}

function MovementModal({
  products, branches, currentUser, onClose, onSaved,
}: {
  products: Product[];
  branches: Branch[];
  currentUser: { id: string; role?: { name: string }; branch_id: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isManager = currentUser?.role?.name === 'manager' || currentUser?.role?.name === 'sales_person';
  const availableBranches = isManager ? branches.filter((b) => b.id === currentUser?.branch_id) : branches;

  const [productId, setProductId] = useState('');
  const [branchId, setBranchId] = useState(currentUser?.branch_id ?? '');
  const [movementType, setMovementType] = useState<MovementType>('purchase_receipt');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const movementTypes: MovementType[] = ['opening_balance', 'purchase_receipt', 'sale', 'transfer_in', 'transfer_out', 'return_in', 'return_out', 'damage', 'loss', 'adjustment', 'stock_issue', 'physical_count'];

  const handleSave = async () => {
    if (!productId || !branchId || !quantity) {
      setError('Product, branch, and quantity are required');
      return;
    }
    setSaving(true);
    setError(null);

    const qty = Number(quantity);
    const signedQty = movementType === 'adjustment' || movementType === 'physical_count' ? qty : Math.abs(qty) * MOVEMENT_TYPE_SIGNS[movementType];

    // Check if balance exists
    const { data: existing } = await supabase
      .from('inventory_balances')
      .select('*')
      .eq('product_id', productId)
      .eq('branch_id', branchId)
      .maybeSingle();

    let quantityBefore = 0;
    let newBalance = 0;

    if (existing) {
      quantityBefore = existing.current_stock;
      newBalance = movementType === 'physical_count'
        ? qty
        : movementType === 'adjustment'
          ? existing.current_stock + qty
          : existing.current_stock + signedQty;

      await supabase
        .from('inventory_balances')
        .update({
          current_stock: newBalance,
          last_count_date: movementType === 'physical_count' ? new Date().toISOString().split('T')[0] : existing.last_count_date,
        })
        .eq('id', existing.id);
    } else {
      newBalance = movementType === 'physical_count' ? qty : movementType === 'adjustment' ? qty : signedQty;
      await supabase
        .from('inventory_balances')
        .insert({
          product_id: productId,
          branch_id: branchId,
          opening_stock: movementType === 'opening_balance' ? qty : newBalance,
          current_stock: newBalance,
        });
    }

    const { error: txnError } = await supabase.from('inventory_transactions').insert({
      product_id: productId,
      branch_id: branchId,
      movement_type: movementType,
      quantity: Math.abs(qty),
      quantity_before: quantityBefore,
      quantity_after: newBalance,
      reason: reason.trim() || null,
      actor_id: currentUser?.id ?? null,
    });

    if (txnError) {
      setError('Could not record the movement.');
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Record Stock Movement" size="md">
      <div className="space-y-4">
        <Select label="Product" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Select a product...</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
        </Select>
        <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={isManager}>
          <option value="">Select a branch...</option>
          {availableBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select label="Movement Type" value={movementType} onChange={(e) => setMovementType(e.target.value as MovementType)}>
          {movementTypes.map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>)}
        </Select>
        <Input label="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Enter quantity" />
        <Textarea label="Reason / Notes" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this movement being recorded?" />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Record Movement'}</Button>
        </div>
      </div>
    </Modal>
  );
}
