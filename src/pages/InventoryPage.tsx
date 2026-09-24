import { useState, useMemo, useEffect } from 'react';
import { Package, Search, AlertTriangle, TrendingDown, TrendingUp, History, Plus, Wrench, Eye, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatNumber, formatDateTime } from '@/lib/dateUtils';
import { isAtLeast } from '@/lib/rbac';
import { MOVEMENT_TYPE_STYLES, MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_SIGNS } from '@/lib/statusStyles';
import { logAudit } from '@/lib/audit';
import type { InventoryBalance, InventoryTransaction, Branch, MovementType, Product, InventoryAsset, InventoryAssetMovement, AssetType, AssetStatus, AssetCondition } from '@/types/database';

export function InventoryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'balances' | 'ledger' | 'assets'>('balances');
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<InventoryAsset | null>(null);
  const [viewAsset, setViewAsset] = useState<InventoryAsset | null>(null);
  const canManage = isAtLeast(user, 'manager');
  const isBusinessLevel = isAtLeast(user, 'admin');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  useEffect(() => { setPage(1); }, [search, filterBranch, tab]);

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:branches:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: products } = useSupabaseQuery<Product[]>(
    () => supabase.from('products').select('id,business_id,name,sku,unit').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:products:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const balancesQuery = useMemo(() => {
    const from = (page - 1) * pageSize;
    const to = page * pageSize - 1;
    let q = supabase
      .from('inventory_balances')
      .select(`*, product:products(id,name,sku,unit), branch:branches(id,name)`, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    return q;
  }, [isBusinessLevel, user, filterBranch, page, pageSize]);

  const { data: balances, loading: loadingBalances, error: errorBalances, refetch: refetchBalances } =
    useSupabaseQuery<InventoryBalance[]>(
      () => balancesQuery,
      [balancesQuery],
      { cacheKey: `inv:balances:${user?.id ?? 'anon'}:${user?.branch_id ?? '-'}:${filterBranch}` },
    );

  const ledgerQuery = useMemo(() => {
    const from = (page - 1) * pageSize;
    const to = page * pageSize - 1;
    let q = supabase
      .from('inventory_transactions')
      .select(`*, product:products(id,name,sku), branch:branches(id,name), actor:user_profiles!actor_id(full_name)`, { count: 'exact' })
      .order('transaction_date', { ascending: false })
      .range(from, to);
    if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    return q;
  }, [isBusinessLevel, user, filterBranch, page, pageSize]);

  const { data: transactions, loading: loadingTxns, error: errorTxns, refetch: refetchTxns } =
    useSupabaseQuery<InventoryTransaction[]>(
      () => ledgerQuery,
      [ledgerQuery],
      { cacheKey: `inv:ledger:${user?.id ?? 'anon'}:${user?.branch_id ?? '-'}:${filterBranch}` },
    );

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

  const assetsQuery = useMemo(() => {
    const from = (page - 1) * pageSize;
    const to = page * pageSize - 1;
    let q = supabase.from('inventory_assets').select(`*, branch:branches(id,name), custodian:user_profiles!custodian_id(full_name)`, { count: 'exact' }).order('updated_at', { ascending: false }).range(from, to);
    if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    return q;
  }, [isBusinessLevel, user, filterBranch, page, pageSize]);
  const { data: assets, loading: loadingAssets, error: errorAssets, refetch: refetchAssets } = useSupabaseQuery<InventoryAsset[]>(() => assetsQuery, [assetsQuery], { cacheKey: `inv:assets:${user?.id ?? 'anon'}:${user?.branch_id ?? '-'}:${filterBranch}` });
  const filteredAssets = useMemo(() => {
    if (!assets) return [];
    if (!search) return assets;
    const q = search.toLowerCase();
    return assets.filter((a) => a.name.toLowerCase().includes(q) || (a.asset_code?.toLowerCase().includes(q) ?? false) || (a.serial_number?.toLowerCase().includes(q) ?? false) || a.asset_type.toLowerCase().includes(q));
  }, [assets, search]);

  const totalAssets = assets?.length ?? 0;
  const availableAssets = assets?.filter((a) => a.status === 'available').length ?? 0;
  const inUseAssets = assets?.filter((a) => a.status === 'in_use' || a.status === 'assigned').length ?? 0;

  const loading = tab === 'balances' ? loadingBalances : tab === 'assets' ? loadingAssets : loadingTxns;
  const error = tab === 'balances' ? errorBalances : tab === 'assets' ? errorAssets : errorTxns;
  const refetch = tab === 'balances' ? refetchBalances : tab === 'assets' ? refetchAssets : refetchTxns;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load inventory data." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Inventory</h2>
          <p className="text-sm text-slate-500 mt-0.5">Stock, general assets and movement history — one source of truth.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button onClick={() => setShowMovementModal(true)}>
              <Plus size={18} /> Record Movement
            </Button>
          )}
          {canManage && (
            <Button variant="outline" onClick={() => { setEditingAsset(null); setShowAssetModal(true); }}>
              <Wrench size={18} /> Add Asset
            </Button>
          )}
        </div>
      </div>

      {/* Overview metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Stock Products</p><p className="text-lg font-bold text-slate-900">{balances?.length ?? 0}</p><p className="text-xs text-slate-500">Tracked balances</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-400">General Assets</p><p className="text-lg font-bold text-slate-900">{totalAssets}</p><p className="text-xs text-emerald-600">{availableAssets} available · {inUseAssets} in use</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-400">Available Assets</p><p className="text-lg font-bold text-emerald-600">{availableAssets}</p><p className="text-xs text-slate-500">Ready for use</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-400">In Use</p><p className="text-lg font-bold text-blue-600">{inUseAssets}</p><p className="text-xs text-slate-500">Assigned / in use</p></div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto w-full sm:w-auto shrink-0">
          <button
            onClick={() => setTab('balances')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${tab === 'balances' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Stock Balances
          </button>
          <button
            onClick={() => setTab('assets')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${tab === 'assets' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            General Assets
          </button>
          <button
            onClick={() => setTab('ledger')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${tab === 'ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Movement Ledger
          </button>
        </div>
        <div className="relative flex-1 min-w-0 w-full">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        {isBusinessLevel && (
          <Select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="w-full sm:w-48">
            <option value="all">All Branches</option>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {tab === 'assets' ? (
        filteredAssets.length > 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Asset</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden sm:table-cell">Type</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden md:table-cell">Location</th>
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Condition</th>
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Status</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden lg:table-cell">Qty</th>
                    <th className="px-3 py-3 sm:px-5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredAssets.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/50">
                      <td className="px-3 py-3 sm:px-5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><Wrench size={14} /></div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{a.name}</p>
                            <p className="text-xs text-slate-400 truncate">{a.asset_code ?? a.serial_number ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 sm:px-5 hidden sm:table-cell"><Badge className="bg-slate-100 text-slate-600 border-slate-200 capitalize">{a.asset_type}</Badge></td>
                      <td className="px-3 py-3 sm:px-5 hidden md:table-cell text-sm text-slate-600 truncate max-w-[160px]">{a.branch?.name ?? a.location ?? '—'}</td>
                      <td className="px-3 py-3 sm:px-5 text-center"><Badge className={a.condition === 'damaged' || a.condition === 'poor' ? 'bg-rose-100 text-rose-700 border-rose-200' : a.condition === 'under_repair' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}>{a.condition}</Badge></td>
                      <td className="px-3 py-3 sm:px-5 text-center"><Badge className={a.status === 'available' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : a.status === 'damaged' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-600 border-slate-200'}>{a.status}</Badge></td>
                      <td className="px-3 py-3 sm:px-5 hidden lg:table-cell text-right text-sm font-medium text-slate-900">{a.quantity} {a.unit}</td>
                      <td className="px-3 py-3 sm:px-5 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setViewAsset(a)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="View history"><Eye size={14} /></button>
                          {canManage && <button onClick={() => { setEditingAsset(a); setShowAssetModal(true); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Edit asset"><Pencil size={14} /></button>}
                          {canManage && <button onClick={async () => { if (!confirm(`Delete asset "${a.name}"?`)) return; const { error } = await supabase.from('inventory_assets').delete().eq('id', a.id); if (!error) refetchAssets(); }} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600" title="Delete asset"><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-1 text-sm text-slate-500 text-center sm:text-left">
              <span>Showing {filteredAssets.length} assets</span>
              <span>Page {page} of {Math.ceil(filteredAssets.length / pageSize)}</span>
            </div>
          </div>
        ) : (
          <EmptyState icon={<Wrench size={32} />} title="No general assets" description="Record generators, vehicles, tools and other company assets here." action={canManage && <Button onClick={() => { setEditingAsset(null); setShowAssetModal(true); }}><Plus size={18} /> Add Asset</Button>} />
        )
      ) : tab === 'balances' ? (
        filteredBalances.length > 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Product</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden sm:table-cell">Branch</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Opening</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Current</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden md:table-cell">Min</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden md:table-cell">Reorder</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredBalances.map((b) => {
                    const belowMin = b.current_stock <= b.min_stock_level && b.min_stock_level > 0;
                    const belowReorder = b.current_stock <= b.reorder_level && b.reorder_level > 0;
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-3 sm:px-5">
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
                        <td className="px-3 py-3 sm:px-5 hidden sm:table-cell">
                          <span className="text-sm text-slate-600">{b.branch?.name}</span>
                        </td>
                        <td className="px-3 py-3 sm:px-5 text-right text-sm text-slate-600">{formatNumber(b.opening_stock)}</td>
                        <td className="px-3 py-3 sm:px-5 text-right">
                          <span className={`text-sm font-semibold ${belowMin ? 'text-rose-600' : belowReorder ? 'text-amber-600' : 'text-slate-900'}`}>
                            {formatNumber(b.current_stock)}
                          </span>
                          <span className="text-xs text-slate-400 ml-1">{b.product?.unit}</span>
                        </td>
                        <td className="px-3 py-3 sm:px-5 text-right text-sm text-slate-400 hidden md:table-cell">{b.min_stock_level}</td>
                        <td className="px-3 py-3 sm:px-5 text-right text-sm text-slate-400 hidden md:table-cell">{b.reorder_level}</td>
                        <td className="px-3 py-3 sm:px-5">
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
            <div className="p-4 border-t border-slate-100">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-1 text-sm text-slate-500 text-center sm:text-left">
                <span>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredBalances.length)} of {filteredBalances.length} balances</span>
                <span>Page {page} of {Math.ceil(filteredBalances.length / pageSize)}</span>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="ghost" onClick={()=>{setPage(p=> Math.max(1, p - 1));}} disabled={page===1}>
                  Prev
                </Button>
                <Button variant="ghost" onClick={()=>{setPage(p=> Math.min(Math.ceil(filteredBalances.length / pageSize), p + 1));}} disabled={page>=Math.ceil(filteredBalances.length / pageSize)}>
                  Next
                </Button>
              </div>
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
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Date</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Product</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Type</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Qty</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden sm:table-cell">Branch</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden md:table-cell">Reason</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5 hidden lg:table-cell">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredTxns.map((t) => {
                    const sign = MOVEMENT_TYPE_SIGNS[t.movement_type as MovementType];
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-3 sm:px-5 text-xs text-slate-400 whitespace-nowrap">{formatDateTime(t.transaction_date)}</td>
                        <td className="px-3 py-3 sm:px-5">
                          <p className="text-sm font-medium text-slate-900 truncate max-w-[160px]">{t.product?.name}</p>
                        </td>
                        <td className="px-3 py-3 sm:px-5">
                          <Badge className={MOVEMENT_TYPE_STYLES[t.movement_type as MovementType]}>
                            {MOVEMENT_TYPE_LABELS[t.movement_type as MovementType]}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 sm:px-5 text-right">
                          <span className={`text-sm font-semibold ${sign > 0 ? 'text-emerald-600' : sign < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                            {sign > 0 ? '+' : sign < 0 ? '-' : ''}{formatNumber(t.quantity)}
                          </span>
                        </td>
                        <td className="px-3 py-3 sm:px-5 hidden sm:table-cell text-sm text-slate-600">{t.branch?.name}</td>
                        <td className="px-3 py-3 sm:px-5 hidden md:table-cell text-sm text-slate-500 max-w-[180px] truncate">{t.reason ?? '—'}</td>
                        <td className="px-3 py-3 sm:px-5 hidden lg:table-cell text-sm text-slate-400">{t.actor?.full_name ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-slate-100">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-1 text-sm text-slate-500 text-center sm:text-left">
                <span>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredTxns.length)} of {filteredTxns.length} movements</span>
                <span>Page {page} of {Math.ceil(filteredTxns.length / pageSize)}</span>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="ghost" onClick={()=>{setPage(p=> Math.max(1, p - 1));}} disabled={page===1}>
                  Prev
                </Button>
                <Button variant="ghost" onClick={()=>{setPage(p=> Math.min(Math.ceil(filteredTxns.length / pageSize), p + 1));}} disabled={page>=Math.ceil(filteredTxns.length / pageSize)}>
                  Next
                </Button>
              </div>
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
      {showAssetModal && (
        <AssetModal asset={editingAsset} branches={branches ?? []} onClose={() => { setShowAssetModal(false); setEditingAsset(null); }} onSaved={() => { refetchAssets(); setShowAssetModal(false); setEditingAsset(null); }} />
      )}
      {viewAsset && (
        <AssetHistoryModal asset={viewAsset} onClose={() => setViewAsset(null)} />
      )}
    </div>
  );
}

function AssetHistoryModal({ asset, onClose }: { asset: InventoryAsset; onClose: () => void }) {
  const { data: movements } = useSupabaseQuery<InventoryAssetMovement[]>(() => supabase.from('inventory_asset_movements').select('*').eq('asset_id', asset.id).order('created_at', { ascending: false }), [asset.id], { cacheKey: `asset:history:${asset.id}` });
  return (
    <Modal open onClose={onClose} title={`${asset.name} — History`} size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-slate-400">Current status</p><p className="font-medium capitalize">{asset.status} · {asset.condition}</p></div>
          <div><p className="text-xs text-slate-400">Custodian</p><p className="font-medium">{asset.custodian?.full_name ?? '—'}</p></div>
          <div><p className="text-xs text-slate-400">Location</p><p className="font-medium">{asset.branch?.name ?? asset.location ?? '—'}</p></div>
          <div><p className="text-xs text-slate-400">Quantity</p><p className="font-medium">{asset.quantity} {asset.unit}</p></div>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Movement history</h4>
          {!movements || movements.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No movements recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {movements.map((m) => (
                <div key={m.id} className="flex gap-3 text-sm border border-slate-100 rounded-lg px-3 py-2">
                  <div className="w-2 h-2 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 capitalize">{m.movement_type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-slate-500 truncate">{m.reason ?? '—'} {m.from_status ? `· ${m.from_status} → ${m.to_status}` : ''}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AssetModal({ asset, branches, onClose, onSaved }: { asset: InventoryAsset | null; branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState(asset?.name ?? '');
  const [assetCode, setAssetCode] = useState(asset?.asset_code ?? '');
  const [assetType, setAssetType] = useState<AssetType>(asset?.asset_type ?? 'other');
  const [branchId, setBranchId] = useState(asset?.branch_id ?? user?.branch_id ?? '');
  const [quantity, setQuantity] = useState(asset?.quantity?.toString() ?? '1');
  const [location, setLocation] = useState(asset?.location ?? '');
  const [condition, setCondition] = useState<AssetCondition>(asset?.condition ?? 'good');
  const [status, setStatus] = useState<AssetStatus>(asset?.status ?? 'available');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleSave = async () => {
    if (!name.trim() || !branchId) { setError('Name and branch are required'); return; }
    setSaving(true); setError(null);
    const payload: Record<string, unknown> = { business_id: branches.find((b) => b.id === branchId)?.business_id, branch_id: branchId, asset_type: assetType, name: name.trim(), asset_code: assetCode.trim() || null, quantity: Number(quantity) || 1, location: location.trim() || null, condition, status };
    let savedId = asset?.id ?? null;
    if (asset) {
      const { error } = await supabase.from('inventory_assets').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', asset.id);
      if (error) { setError(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('inventory_assets').insert({ ...payload, created_by: user?.id }).select('id').single();
      if (error) { setError(error.message); setSaving(false); return; }
      savedId = (data as { id: string }).id;
    }
    if (savedId) await supabase.from('inventory_asset_movements').insert({ asset_id: savedId, movement_type: asset ? 'adjustment' : 'receipt', quantity: Number(quantity) || 0, to_branch_id: branchId, to_status: status, to_condition: condition, reason: asset ? 'Asset updated' : 'Asset created', actor_id: user?.id });
    await logAudit(asset ? 'asset.updated' : 'asset.created', 'inventory_assets', savedId, { name: name.trim(), asset_type: assetType });
    setSaving(false); onSaved();
  };
  return (
    <Modal open onClose={onClose} title={asset ? 'Edit Asset' : 'Add General Asset'} size="md">
      <div className="space-y-4">
        <Input label="Asset Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Generator 5kVA, Toyota Hilux" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Asset Code" value={assetCode} onChange={(e) => setAssetCode(e.target.value)} placeholder="Optional" />
          <Select label="Type" value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
            {(['machinery','vehicle','tool','equipment','furniture','electronics','generator','ware','plant','scrap','other'] as AssetType[]).map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Select branch...</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Warehouse A" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as AssetCondition)}>
            {(['new','good','fair','poor','damaged','under_repair','scrapped','disposed'] as AssetCondition[]).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
            {(['available','in_use','assigned','reserved','under_repair','damaged','missing','in_transit','scrapped','disposed','sold'] as AssetStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : asset ? 'Save Changes' : 'Add Asset'}</Button>
        </div>
      </div>
    </Modal>
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
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Quantity must be a whole number greater than zero');
      setSaving(false);
      return;
    }

    const { error: txnError } = await supabase.rpc('record_inventory_movement', {
      p_product_id: productId,
      p_branch_id: branchId,
      p_movement_type: movementType,
      p_quantity: Math.abs(qty),
      p_reason: reason.trim() || null,
      p_reference_type: 'manual_entry',
      p_reference_id: null,
    });

    if (txnError) {
      setError('Could not record the movement.');
      setSaving(false);
      return;
    }
    await logAudit(`inventory.${movementType}`, 'inventory_movements', null, {
      product_id: productId,
      branch_id: branchId,
      movement_type: movementType,
      quantity: Math.abs(qty),
      reason: reason.trim() || null,
    });
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
