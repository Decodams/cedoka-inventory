import { useState, useMemo, useEffect } from 'react';
import { Package, Plus, Pencil, Search, Tag, Trash2, Power } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase, clearQueryCache } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import { isFarmBusiness, unitOptionsFor } from '@/lib/business';
import { edgeErrorMessage } from '@/lib/edge';
import { logAudit } from '@/lib/audit';
import type { Product, Business, BusinessMeasurementUnit, Category, ProductSerialNumber, SerialTrackingMode, Supplier, UserProfile } from '@/types/database';

export function ProductsPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canManage = isAtLeast(user, 'manager');
  const canManageCategories = hasRole(user, 'super_admin') || hasRole(user, 'admin') || isAtLeast(user, 'manager');
  const canDeleteProduct = hasRole(user, 'super_admin') || hasRole(user, 'admin');

  const isExecutive = hasRole(user, 'super_admin');
  const isAdmin = isAtLeast(user, 'admin');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [detail, setDetail] = useState<Product | null>(null);

  useEffect(() => { setPage(1); }, [search, filterBusiness, user?.business_id]);

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: categories, refetch: refetchCategories } = useSupabaseQuery<Category[]>(
    () => supabase.from('categories').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:categories:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: measurementUnits, refetch: refetchMeasurementUnits } = useSupabaseQuery<BusinessMeasurementUnit[]>(
    () => supabase.from('business_measurement_units').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:munits:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: suppliers, refetch: refetchSuppliers } = useSupabaseQuery<Supplier[]>(
    () => supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:suppliers:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  // Admins oversee their own business plus any assigned businesses — the
  // product list must cover all of them, not just the primary business.
  const { data: myBusinessAssignments } = useSupabaseQuery<Array<{ business_id: string }>>(
    user?.id ? () => supabase.from('user_business_assignments').select('business_id').eq('user_id', user?.id ?? '') : null,
    [user?.id],
    { cacheKey: `assign:biz:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const accessibleBusinessIds = useMemo(() => {
    if (isExecutive || !isAdmin) return null;
    const set = new Set<string>();
    if (user?.business_id) set.add(user.business_id);
    for (const a of myBusinessAssignments ?? []) if (a.business_id) set.add(a.business_id);
    return [...set];
  }, [isExecutive, isAdmin, user?.business_id, myBusinessAssignments]);

  const visibleBusinesses = useMemo(() => {
    if (isExecutive) return businesses ?? [];
    if (isAdmin && accessibleBusinessIds && accessibleBusinessIds.length > 0) {
      return (businesses ?? []).filter((b) => accessibleBusinessIds.includes(b.id));
    }
    return (businesses ?? []).filter((b) => b.id === user?.business_id);
  }, [isExecutive, isAdmin, businesses, accessibleBusinessIds, user?.business_id]);

  const productsQuery = useMemo(() => {
    const from = (page - 1) * pageSize;
    const to = page * pageSize - 1;
    let q = supabase
      .from('products')
      .select(`*, category:categories(id,name), supplier:suppliers(id,name), business:businesses(id,name)`, { count: 'exact' })
      .order('name')
      .range(from, to);
    if (!isExecutive) {
      if (isAdmin) {
        if (accessibleBusinessIds && accessibleBusinessIds.length > 0) {
          q = q.in('business_id', accessibleBusinessIds);
        }
      } else if (user?.business_id) {
        q = q.eq('business_id', user.business_id);
      }
    }
    if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
    // Search runs server-side across the whole catalog (not just this page).
    const needle = search.trim();
    if (needle) {
      const safe = needle.replace(/[,%()\\]/g, ' ').trim();
      if (safe) q = q.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,brand.ilike.%${safe}%`);
    }
    return q;
  }, [isExecutive, isAdmin, user, accessibleBusinessIds, filterBusiness, search, page, pageSize]);

  const { data: products, loading, error, count, refetch } = useSupabaseQuery<Product[]>(
    () => productsQuery,
    [productsQuery],
    { cacheKey: `products:${user?.id ?? 'anon'}:${user?.business_id ?? '-'}:${filterBusiness}:${(accessibleBusinessIds ?? []).join(',')}:${page}:${search.trim().toLowerCase()}` },
  );

  // Global serial search: find products by serial number across the catalog.
  const serialNeedle = search.trim();
  const { data: serialMatches } = useSupabaseQuery<Array<{ product: Product | null }>>(
    serialNeedle
      ? () => supabase
          .from('product_serial_numbers')
          .select('product:products(*)')
          .ilike('serial_number', `%${serialNeedle.replace(/[%_]/g, '')}%`)
          .limit(20)
      : null,
    [search],
    { cacheKey: serialNeedle ? `serial-search:${serialNeedle.toLowerCase()}` : undefined, ttlMs: 30_000 },
  );

  const serialMatchedIds = useMemo(
    () => new Set((serialMatches ?? []).map((r) => r.product?.id).filter((id): id is string => !!id)),
    [serialMatches],
  );

  const filtered = useMemo(() => {
    // Name/SKU/brand search already ran server-side in productsQuery; this only
    // appends products found via global serial search.
    const base = products ?? [];
    if (!serialNeedle) return base;
    const extras = (serialMatches ?? [])
      .map((r) => r.product)
      .filter((p): p is Product => !!p && !base.some((b) => b.id === p.id))
      .filter((p) => {
        if (isExecutive) return true;
        if (isAdmin) return !accessibleBusinessIds || accessibleBusinessIds.length === 0 || accessibleBusinessIds.includes(p.business_id);
        return !user?.business_id || p.business_id === user.business_id;
      });
    return [...base, ...extras];
  }, [products, serialMatches, serialNeedle, isExecutive, isAdmin, accessibleBusinessIds, user?.business_id]);

  // Real stock per product (sum of inventory_balances rows visible to this
  // user's branch scope). Powers the Stock column and the detail modal.
  const filteredIds = useMemo(() => [...new Set(filtered.map((p) => p.id))], [filtered]);
  const idsKey = filteredIds.join(',');
  const { data: balanceRows, refetch: refetchBalances } = useSupabaseQuery<Array<{ product_id: string; current_stock: number | string }>>(
    idsKey
      ? () => supabase.from('inventory_balances').select('product_id, current_stock').in('product_id', idsKey.split(','))
      : null,
    [idsKey],
    { cacheKey: idsKey ? `prodstock:${user?.id ?? 'anon'}:${idsKey}` : undefined, ttlMs: 15_000 },
  );

  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of balanceRows ?? []) {
      m.set(r.product_id, (m.get(r.product_id) ?? 0) + (Number(r.current_stock) || 0));
    }
    return m;
  }, [balanceRows]);

  const toggleProductActive = async (p: Product) => {
    setNotice(null);
    setActionError(null);
    const { error: toggleErr } = await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id);
    if (toggleErr) {
      setActionError(`Could not ${p.is_active ? 'deactivate' : 'activate'} product: ${toggleErr.message}`);
      return;
    }
    clearQueryCache('products:');
    refetch();
    setNotice(`Product "${p.name}" ${p.is_active ? 'deactivated' : 'activated'} successfully.`);
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load products." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Products</h2>
          <p className="text-sm text-slate-500 mt-0.5">Manage your product catalog across business units.</p>
        </div>
        <div className="flex gap-2">
          {canManageCategories && (
            <Button variant="outline" onClick={() => setShowCategories(true)}>
              <Tag size={18} /> Categories
            </Button>
          )}
          {canManage && (
            <Button onClick={() => { setEditing(null); setShowModal(true); }}>
              <Plus size={18} /> Add Product
            </Button>
          )}
        </div>
      </div>

      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{actionError}</p>}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search by name, SKU, or brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        {(isExecutive || isAdmin) && (
          <Select value={filterBusiness} onChange={(e) => setFilterBusiness(e.target.value)} className="sm:w-56">
            <option value="all">All Businesses</option>
            {visibleBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length > 0 ? (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Name</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Category</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Brand</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Unit</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Cost</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Price</th>
                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Stock</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 sm:px-5">Status</th>
                    <th className="px-3 py-3 sm:px-5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((p) => {
                    const stock = stockByProduct.get(p.id) ?? 0;
                    const minLevel = Number(p.min_stock_level) || 0;
                    const stockClass = stock <= 0
                      ? 'text-rose-600'
                      : minLevel > 0 && stock <= minLevel
                        ? 'text-amber-600'
                        : 'text-slate-700';
                    return (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                      onClick={() => setDetail(p)}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') setDetail(p); }}
                    >
                      <td className="px-3 py-3 sm:px-5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm font-semibold shrink-0">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                            {p.sku && <p className="text-xs text-slate-400 truncate">SKU: {p.sku}</p>}
                            {serialMatchedIds.has(p.id) && <p className="text-[11px] font-medium text-blue-600 truncate">Serial match: {search.trim()}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 sm:px-5">{p.category ? <Badge className="bg-slate-100 text-slate-600 border-slate-200"><Tag size={10} className="mr-1" />{p.category.name}</Badge> : <span className="text-slate-400 text-sm">—</span>}</td>
                      <td className="px-3 py-3 sm:px-5">{p.brand ? <span className="text-sm text-slate-600">{p.brand}</span> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3 sm:px-5"><Badge className="bg-emerald-50 text-emerald-700 border-emerald-100">{p.unit}</Badge></td>
                      <td className="text-right px-3 py-3 sm:px-5 text-sm text-slate-600">{formatCurrency(Number(p.cost_price))}</td>
                      <td className="text-right px-3 py-3 sm:px-5 text-sm font-medium text-slate-900">{formatCurrency(Number(p.selling_price))}</td>
                      <td className={`text-right px-3 py-3 sm:px-5 text-sm font-medium ${stockClass}`}>
                        {stock} {p.unit}
                        {minLevel > 0 && stock > 0 && stock <= minLevel && (
                          <span className="block text-[11px] font-normal text-amber-600">min {minLevel}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 sm:px-5">
                        <Badge className={p.is_active ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 sm:px-5 text-right">
                        {canManage && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleProductActive(p); }}
                              title={p.is_active ? 'Deactivate product' : 'Activate product'}
                              aria-label={p.is_active ? `Deactivate ${p.name}` : `Activate ${p.name}`}
                              className={`p-1.5 rounded-lg hover:bg-slate-100 ${p.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-amber-500 hover:text-amber-600'}`}
                            >
                              <Power size={15} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditing(p); setShowModal(true); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <Pencil size={15} />
                            </button>
                          </div>
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
                <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1} to {(page - 1) * pageSize + filtered.length} of {Math.max(count ?? 0, filtered.length)} products</span>
                <span>Page {page} of {Math.max(1, Math.ceil(Math.max(count ?? 0, filtered.length) / pageSize))}</span>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="ghost" onClick={()=>{setPage(p=> Math.max(1, p - 1));}} disabled={page===1}>
                  Prev
                </Button>
                <Button variant="ghost" onClick={()=>{setPage(p=> Math.min(Math.max(1, Math.ceil(Math.max(count ?? 0, filtered.length) / pageSize)), p + 1));}} disabled={page>=Math.max(1, Math.ceil(Math.max(count ?? 0, filtered.length) / pageSize))}>
                  Next
                </Button>
              </div>
            </div>
          </div>
          </>
        ) : (
          <EmptyState
            icon={<Package size={32} />}
            title="No products found"
            description="Add your first product to start tracking inventory and stock levels."
            action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> Add Product</Button>}
          />
        )}

      {showModal && (
        <ProductFormModal
          product={editing}
          businesses={businesses ?? []}
          currentUser={user}
          canDelete={canDeleteProduct}
          measurementUnits={measurementUnits ?? []}
          allProducts={products ?? []}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={(message) => { clearQueryCache('products:'); clearQueryCache('prodstock:'); setPage(1); refetch(); refetchBalances(); refetchCategories(); refetchMeasurementUnits(); setShowModal(false); setEditing(null); if (message) setNotice(message); }}
        />
      )}

      {detail && (
        <ProductDetailModal
          product={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detail); setDetail(null); setShowModal(true); }}
        />
      )}

      {showCategories && (
        <CategoryManagerModal
          businesses={businesses ?? []}
          categories={categories ?? []}
          measurementUnits={measurementUnits ?? []}
          suppliers={suppliers ?? []}
          currentUser={user}
          onClose={() => setShowCategories(false)}
          onChanged={() => { refetchCategories(); refetchMeasurementUnits(); refetchSuppliers(); }}
        />
      )}
    </div>
  );
}

const DETAIL_MOVEMENT_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  purchase_receipt: 'Purchase receipt (GRN)',
  sale: 'Sale',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  return_in: 'Return in',
  return_out: 'Return out',
  damage: 'Damage',
  loss: 'Loss',
  adjustment: 'Adjustment',
  stock_issue: 'Stock issue',
  physical_count: 'Physical count',
  production: 'Production',
};

function ProductDetailModal({ product, onClose, onEdit }: {
  product: Product;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [balances, setBalances] = useState<Array<{
    branch: { name: string } | null;
    current_stock: number | string;
    min_stock_level: number | string;
    updated_at: string;
  }>>([]);
  const [serials, setSerials] = useState<ProductSerialNumber[]>([]);
  const [movements, setMovements] = useState<Array<{
    id: string;
    movement_type: string;
    quantity: number | string;
    reason: string | null;
    branch: { name: string } | null;
    created_at: string;
  }>>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const [balRes, serRes, movRes] = await Promise.all([
          supabase.from('inventory_balances')
            .select('branch:branches(name), current_stock, min_stock_level, updated_at')
            .eq('product_id', product.id)
            .order('updated_at', { ascending: false }),
          supabase.from('product_serial_numbers')
            .select('*')
            .eq('product_id', product.id)
            .order('created_at'),
          supabase.from('inventory_transactions')
            .select('id, movement_type, quantity, reason, branch:branches(name), created_at')
            .eq('product_id', product.id)
            .order('created_at', { ascending: false })
            .limit(10),
        ]);
        if (!mounted) return;
        const firstErr = balRes.error ?? serRes.error ?? movRes.error;
        if (firstErr) setDetailError(firstErr.message);
        setBalances((balRes.data ?? []) as unknown as typeof balances);
        setSerials((serRes.data ?? []) as unknown as ProductSerialNumber[]);
        setMovements((movRes.data ?? []) as unknown as typeof movements);
      } catch (err) {
        if (mounted) setDetailError(err instanceof Error ? err.message : 'Could not load inventory details.');
      } finally {
        if (mounted) setDetailLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [product.id]);

  const totalStock = balances.reduce((sum, b) => sum + (Number(b.current_stock) || 0), 0);
  const minLevel = Number(product.min_stock_level) || 0;

  return (
    <Modal open onClose={onClose} title={product.name} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={product.is_active ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
              {product.is_active ? 'Active' : 'Inactive'}
            </Badge>
            <Badge className="bg-slate-100 text-slate-600 border-slate-200">{product.product_type}</Badge>
            <Badge className="bg-slate-100 text-slate-600 border-slate-200">Serials: {product.serial_tracking_mode}</Badge>
            <Badge className={totalStock <= 0 ? 'bg-rose-100 text-rose-700 border-rose-200' : minLevel > 0 && totalStock <= minLevel ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}>
              Stock: {totalStock} {product.unit}
            </Badge>
          </div>
          <Button variant="outline" onClick={onEdit}><Pencil size={15} /> Edit</Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {([
            ['SKU', product.sku || '—'],
            ['Brand', product.brand || '—'],
            ['Model', product.model || '—'],
            ['Category', product.category?.name ?? '—'],
            ['Business', product.business?.name ?? '—'],
            ['Supplier', product.supplier?.name ?? '—'],
            ['Unit', product.unit],
            ['Cost', formatCurrency(Number(product.cost_price))],
            ['Price', formatCurrency(Number(product.selling_price))],
            ['Min stock', `${product.min_stock_level} ${product.unit}`],
            ['Reorder level', `${product.reorder_level} ${product.unit}`],
            ['Warranty', product.warranty_months ? `${product.warranty_months} months` : '—'],
          ] as Array<[string, string]>).map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
              <p className="text-slate-800 font-medium truncate">{value}</p>
            </div>
          ))}
        </div>
        {product.description && <p className="text-sm text-slate-600">{product.description}</p>}

        {detailError && <p role="alert" className="text-sm text-rose-600">{detailError}</p>}
        {detailLoading ? (
          <p className="text-sm text-slate-400">Loading inventory details…</p>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Stock by branch</h3>
              {balances.length === 0 ? (
                <p className="text-sm text-slate-400">No balance rows yet — stock at a branch is created on the first sale, transfer, or receipt.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                        <th className="text-left px-3 py-2">Branch</th>
                        <th className="text-right px-3 py-2">Stock</th>
                        <th className="text-right px-3 py-2">Min</th>
                        <th className="text-right px-3 py-2">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {balances.map((b, i) => (
                        <tr key={`${b.branch?.name ?? 'x'}-${i}`}>
                          <td className="px-3 py-2">{b.branch?.name ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-medium">{Number(b.current_stock)} {product.unit}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{Number(b.min_stock_level)}</td>
                          <td className="px-3 py-2 text-right text-slate-400">{formatDate(b.updated_at)}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <td className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right">{totalStock} {product.unit}</td>
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Serial numbers ({serials.length})</h3>
              {serials.length === 0 ? (
                <p className="text-sm text-slate-400">
                  {product.serial_tracking_mode === 'none'
                    ? 'Serial tracking is off for this product.'
                    : 'No serial numbers recorded yet.'}
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-50">
                  {serials.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="font-mono text-slate-700 truncate">{s.serial_number}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {s.quantity > 1 && <span className="text-xs text-slate-400">×{s.quantity}</span>}
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.status === 'available' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : s.status === 'sold' ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {s.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Recent movements</h3>
              {movements.length === 0 ? (
                <p className="text-sm text-slate-400">No stock movements yet.</p>
              ) : (
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-50 text-sm">
                  {movements.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-slate-800 font-medium">{DETAIL_MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}</p>
                        <p className="text-xs text-slate-400 truncate">{m.branch?.name ?? '—'}{m.reason ? ` · ${m.reason}` : ''}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-medium text-slate-800">{Number(m.quantity)} {product.unit}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(m.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function CategoryManagerModal({
  businesses, categories, measurementUnits, suppliers, currentUser, onClose, onChanged,
}: {
  businesses: Business[];
  categories: Category[];
  measurementUnits: BusinessMeasurementUnit[];
  suppliers: Supplier[];
  currentUser: UserProfile | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isExecutive = hasRole(currentUser, 'super_admin');
  const [businessId, setBusinessId] = useState(
    isExecutive ? (businesses[0]?.id ?? '') : (currentUser?.business_id ?? ''),
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleBusinesses = isExecutive ? businesses : businesses.filter((b) => b.id === currentUser?.business_id);
  const list = categories.filter((c) => !businessId || c.business_id === businessId);
  const unitList = measurementUnits.filter((u) => !businessId || u.business_id === businessId);
  const [unitName, setUnitName] = useState('');

  const handleAddUnit = async () => {
    if (!businessId) { setError('Select a business first.'); return; }
    if (!unitName.trim()) { setError('Unit name is required.'); return; }
    setBusy(true); setError(null);
    const { error: unitErr } = await supabase.from('business_measurement_units').insert({
      business_id: businessId, name: unitName.trim().toLowerCase(), description: '', is_active: true,
    });
    if (unitErr) {
      setError(unitErr.message.includes('duplicate') || unitErr.code === '23505' ? 'This unit already exists for the business.' : unitErr.message);
      setBusy(false);
      return;
    }
    setUnitName(''); onChanged(); setBusy(false);
  };

  const handleDeleteUnit = async (unitId: string, unitLabel: string) => {
    if (!window.confirm(`Delete unit "${unitLabel}"? Products already using it keep their unit text.`)) return;
    setBusy(true); setError(null);
    const { error: unitErr } = await supabase.from('business_measurement_units').delete().eq('id', unitId);
    if (unitErr) { setError(unitErr.message); setBusy(false); return; }
    onChanged(); setBusy(false);
  };

  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const supplierList = suppliers.filter((s) => !businessId || s.business_id === businessId);

  const handleAddSupplier = async () => {
    if (!businessId) { setError('Select a business first.'); return; }
    if (!supplierName.trim()) { setError('Supplier name is required.'); return; }
    setBusy(true); setError(null);
    const { error: supErr } = await supabase.from('suppliers').insert({
      business_id: businessId, name: supplierName.trim(),
      contact_person: null, phone: supplierPhone.trim() || null,
      email: null, address: null, is_active: true,
    });
    if (supErr) {
      setError(supErr.message.includes('duplicate') || supErr.code === '23505' ? 'This supplier already exists.' : supErr.message);
      setBusy(false);
      return;
    }
    setSupplierName(''); setSupplierPhone(''); onChanged(); setBusy(false);
  };

  const handleToggleSupplier = async (s: Supplier) => {
    setBusy(true); setError(null);
    const { error: supErr } = await supabase.from('suppliers').update({ is_active: !s.is_active }).eq('id', s.id);
    if (supErr) { setError(supErr.message); setBusy(false); return; }
    onChanged(); setBusy(false);
  };

  const callManage = async (body: Record<string, unknown>) => {
    const { error: fnError } = await supabase.functions.invoke('manage-category', { body });
    if (fnError) {
      // Direct Supabase table fallback
      const action = body.p_action as string;
      const bizId = body.p_business_id as string;
      const catName = body.p_name as string;
      const catDesc = body.p_description as string | undefined;
      const catId = body.p_category_id as string | undefined;

      if (action === 'create') {
        const { error: dirErr } = await supabase.from('categories').insert({
          business_id: bizId,
          name: catName,
          description: catDesc || '',
          is_active: true,
        });
        if (dirErr) throw new Error(dirErr.message);
      } else if (action === 'update' && catId) {
        const { error: dirErr } = await supabase.from('categories').update({
          name: catName,
          description: catDesc || '',
        }).eq('id', catId);
        if (dirErr) throw new Error(dirErr.message);
      } else if (action === 'delete' && catId) {
        const { data: prods } = await supabase.from('products').select('id').eq('category_id', catId).limit(1);
        if (prods && prods.length > 0) throw new Error('Cannot delete category with assigned products.');
        const { error: dirErr } = await supabase.from('categories').delete().eq('id', catId);
        if (dirErr) throw new Error(dirErr.message);
      }
    }
  };

  const handleCreate = async () => {
    if (!businessId) { setError('Select a business first.'); return; }
    if (!name.trim()) { setError('Category name is required.'); return; }
    setBusy(true); setError(null);
    try {
      await callManage({ p_action: 'create', p_business_id: businessId, p_name: name.trim(), p_description: description.trim() || undefined });
      setName(''); setDescription(''); onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the category.');
    }
    setBusy(false);
  };

  const startEdit = (c: Category) => { setEditingId(c.id); setEditName(c.name); setError(null); };

  const handleUpdate = async (c: Category) => {
    if (!editName.trim()) { setError('Category name is required.'); return; }
    setBusy(true); setError(null);
    try {
      await callManage({ p_action: 'update', p_business_id: c.business_id, p_category_id: c.id, p_name: editName.trim() });
      setEditingId(null); onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the category.');
    }
    setBusy(false);
  };

  const handleDelete = async (c: Category) => {
    if (!window.confirm(`Delete category "${c.name}"? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      await callManage({ p_action: 'delete', p_business_id: c.business_id, p_category_id: c.id });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the category.');
    }
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} title="Manage Categories & Units" size="md">
      <div className="space-y-4">
        <Select label="Business Unit" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
          <option value="">Select...</option>
          {visibleBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <p className="text-xs text-slate-400">Categories and measurement units are per business — Farm can have Grains/Vegetables measured in bags, crates or kilos, while Electronics uses its own categories and pieces or cartons.</p>
        <div className="rounded-xl border border-slate-200 divide-y max-h-64 overflow-y-auto">
          {list.length === 0 && <p className="p-4 text-sm text-slate-400">No categories for this business yet.</p>}
          {list.map((c) => (
            <div key={c.id} className="flex items-center gap-2 p-3">
              {editingId === c.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900"
                    autoFocus
                  />
                  <Button size="sm" onClick={() => handleUpdate(c)} disabled={busy}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-slate-800 truncate">{c.name}</span>
                  <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Rename category">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600" title="Delete category">
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Add category</p>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grains, Vegetables" />
          <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={busy}>{busy ? 'Saving...' : 'Add Category'}</Button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Measurement units for this business</p>
          {unitList.length === 0 && <p className="text-sm text-slate-400">No custom units yet — products fall back to the default list.</p>}
          <div className="flex flex-wrap gap-2">
            {unitList.map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                {u.name}
                <button onClick={() => handleDeleteUnit(u.id, u.name)} className="text-emerald-400 hover:text-rose-600" title={`Delete unit ${u.name}`} aria-label={`Delete unit ${u.name}`}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input label="New unit" value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="e.g. crate, kilo, pack" className="flex-1" />
            <div className="flex items-end">
              <Button onClick={handleAddUnit} disabled={busy}>{busy ? 'Saving...' : 'Add Unit'}</Button>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Suppliers for this business</p>
          {supplierList.length === 0 && <p className="text-sm text-slate-400">No suppliers yet.</p>}
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 max-h-40 overflow-y-auto">
            {supplierList.map((s) => (
              <div key={s.id} className="flex items-center gap-2 p-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                  <p className="text-xs text-slate-400 truncate">{[s.phone, !s.is_active ? 'Inactive' : ''].filter(Boolean).join(' · ') || 'Active'}</p>
                </div>
                <button onClick={() => handleToggleSupplier(s)} className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 shrink-0" title={s.is_active ? 'Deactivate supplier' : 'Reactivate supplier'}>
                  {s.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="New supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Adaeze Farms" />
            <Input label="Phone (optional)" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} placeholder="e.g. 0803..." />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleAddSupplier} disabled={busy}>{busy ? 'Saving...' : 'Add Supplier'}</Button>
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

function ProductFormModal({
  product, businesses, measurementUnits, allProducts, currentUser, canDelete, onClose, onSaved,
}: {
  product: Product | null;
  businesses: Business[];
  measurementUnits: BusinessMeasurementUnit[];
  allProducts: Product[];
  currentUser: { role?: { name: string }; business_id: string | null; branch_id?: string | null } | null;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (message?: string) => void;
}) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const availableBusinesses = isExecutive ? businesses : businesses.filter((b) => b.id === currentUser?.business_id);

  const [name, setName] = useState(product?.name ?? '');
  const [businessId, setBusinessId] = useState(product?.business_id ?? currentUser?.business_id ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [model, setModel] = useState(product?.model ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [extraUnits, setExtraUnits] = useState<string[]>([]);

  useEffect(() => {
    if (!product) { setExtraUnits([]); return; }
    supabase.from('product_units').select('unit_name').eq('product_id', product.id).then(({ data }) => {
      if (data) {
        setExtraUnits(
          (data as Array<{ unit_name: string }>).map((r) => r.unit_name).filter((n) => n && n !== product.unit),
        );
      }
    });
  }, [product]);
  const [serialMode, setSerialMode] = useState<SerialTrackingMode>(product?.serial_tracking_mode ?? 'none');
  const [serials, setSerials] = useState<ProductSerialNumber[]>([]);
  const [serialSearch, setSerialSearch] = useState('');
  const [serialStatusFilter, setSerialStatusFilter] = useState('all');
  const [bulkText, setBulkText] = useState('');
  const [sharedSerial, setSharedSerial] = useState('');
  const [sharedQty, setSharedQty] = useState('');
  const [stagedSerials, setStagedSerials] = useState<string[]>([]);
  const [stagedGroups, setStagedGroups] = useState<Array<{ serial: string; qty: number }>>([]);
  const [editingSerialId, setEditingSerialId] = useState<string | null>(null);
  const [editingSerialName, setEditingSerialName] = useState('');
  const [serialBusy, setSerialBusy] = useState(false);

  const loadSerials = async (productId: string) => {
    const { data } = await supabase.from('product_serial_numbers').select('*').eq('product_id', productId).order('created_at');
    setSerials(((data ?? []) as ProductSerialNumber[]));
  };

  useEffect(() => {
    if (!product) { setSerials([]); setStagedSerials([]); setStagedGroups([]); return; }
    loadSerials(product.id);
  }, [product]);

  const unusedSerial = (s: ProductSerialNumber) => s.status === 'available' && !s.sale_id;

  const persistUniqueSerial = async (productId: string, rawName: string): Promise<boolean> => {
    const name = rawName.trim();
    if (!name) return false;
    const { data: dup } = await supabase.from('product_serial_numbers').select('id').eq('product_id', productId).eq('serial_number', name).limit(1);
    if (dup && (dup as Array<unknown>).length > 0) {
      setError(`Serial number ${name} already exists for this product.`);
      return false;
    }
    const { data, error } = await supabase.from('product_serial_numbers').insert({
      product_id: productId, serial_number: name, mode: 'unique', status: 'available', quantity: 1,
    }).select('id').single();
    if (error) { setError(error.message); return false; }
    await logAudit('serial.created', 'product_serial_numbers', (data as { id: string }).id, { product_id: productId, serial_number: name });
    return true;
  };

  const persistSharedGroup = async (productId: string, rawName: string, qty: number): Promise<boolean> => {
    const name = rawName.trim();
    if (!name || !(qty > 0)) return false;
    const { data, error } = await supabase.from('product_serial_numbers').insert({
      product_id: productId, serial_number: name, mode: 'shared', status: 'available', quantity: qty,
    }).select('id').single();
    if (error) { setError(error.message); return false; }
    await logAudit('serial.created', 'product_serial_numbers', (data as { id: string }).id, { product_id: productId, serial_number: name, quantity: qty });
    return true;
  };

  const handleBulkAdd = async () => {
    if (!product) return;
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { setError('Enter at least one serial number.'); return; }
    setSerialBusy(true); setError(null);
    let added = 0; let skipped = 0;
    for (const line of lines) {
      const ok = await persistUniqueSerial(product.id, line);
      if (ok) added += 1; else skipped += 1;
    }
    setBulkText('');
    await loadSerials(product.id);
    setSerialBusy(false);
    if (skipped > 0) setError(`${added} serial(s) added, ${skipped} skipped as duplicates.`);
  };

  const handleRenameSerial = async (s: ProductSerialNumber) => {
    if (!unusedSerial(s)) { setError('Only unused serial numbers can be renamed.'); return; }
    const name = editingSerialName.trim();
    if (!name) { setError('Serial number is required.'); return; }
    setSerialBusy(true); setError(null);
    const { data: dup } = await supabase.from('product_serial_numbers').select('id').eq('product_id', s.product_id).eq('serial_number', name).limit(1);
    if (dup && (dup as Array<unknown>).length > 0) {
      setError(`Serial number ${name} already exists for this product.`);
      setSerialBusy(false);
      return;
    }
    const { error } = await supabase.from('product_serial_numbers').update({ serial_number: name }).eq('id', s.id);
    if (error) { setError(error.message); setSerialBusy(false); return; }
    await logAudit('serial.renamed', 'product_serial_numbers', s.id, { from: s.serial_number, to: name });
    setEditingSerialId(null);
    if (product) await loadSerials(product.id);
    setSerialBusy(false);
  };

  const handleDeleteSerial = async (s: ProductSerialNumber) => {
    if (!unusedSerial(s)) { setError('Only unused serial numbers can be deleted. Sold serials stay with their sale.'); return; }
    if (!window.confirm(`Remove serial "${s.serial_number}"? This cannot be undone.`)) return;
    setSerialBusy(true); setError(null);
    const { error } = await supabase.from('product_serial_numbers').delete().eq('id', s.id);
    if (error) { setError(error.message); setSerialBusy(false); return; }
    await logAudit('serial.deleted', 'product_serial_numbers', s.id, { serial_number: s.serial_number });
    if (product) await loadSerials(product.id);
    setSerialBusy(false);
  };

  const handleSerialStatus = async (s: ProductSerialNumber, status: ProductSerialNumber['status']) => {
    setSerialBusy(true); setError(null);
    const { error } = await supabase.from('product_serial_numbers').update({ status }).eq('id', s.id);
    if (error) { setError(error.message); setSerialBusy(false); return; }
    await logAudit('serial.status_changed', 'product_serial_numbers', s.id, { from: s.status, to: status });
    if (product) await loadSerials(product.id);
    setSerialBusy(false);
  };

  const visibleSerials = serials.filter((s) => {
    if (serialStatusFilter !== 'all' && s.status !== serialStatusFilter) return false;
    if (serialSearch && !s.serial_number.toLowerCase().includes(serialSearch.trim().toLowerCase())) return false;
    return true;
  });
  const availableSerialCount = serials.filter((s) => s.status === 'available').length;
  const [costPrice, setCostPrice] = useState(product?.cost_price?.toString() ?? '0');
  const [sellingPrice, setSellingPrice] = useState(product?.selling_price?.toString() ?? '0');
  const [openingStock, setOpeningStock] = useState('');
  const [minStockLevel, setMinStockLevel] = useState(product?.min_stock_level?.toString() ?? '0');
  const [reorderLevel, setReorderLevel] = useState(product?.reorder_level?.toString() ?? '0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBusiness = availableBusinesses.find((b) => b.id === businessId) ?? null;
  const isFarm = isFarmBusiness(selectedBusiness);
  const businessUnits = measurementUnits?.filter((u) => u.business_id === businessId).map((u) => u.name) ?? [];
  const unitPresets = businessUnits.length > 0 ? businessUnits : unitOptionsFor(isFarm);

  const handleBusinessChange = (next: string) => {
    setBusinessId(next);
    const nextBusiness = availableBusinesses.find((b) => b.id === next) ?? null;
    if (isFarmBusiness(nextBusiness)) {
      setSku('');
      setBrand('');
      setModel('');
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !businessId) {
      setError('Name and business unit are required');
      return;
    }
    if (!unit.trim()) {
      setError(isFarm ? 'Unit is required (e.g. bag, crate, basket, kilo)' : 'Unit is required (e.g. pcs, box)');
      return;
    }
    const duplicate = allProducts.find((p) => p.id !== product?.id && p.business_id === businessId && p.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (duplicate) {
      setError(`A product named "${duplicate.name}" already exists. Edit it instead of adding a duplicate.`);
      return;
    }
    const openingQty = product ? 0 : Math.max(0, Number(openingStock || 0));
    if (!product && !(openingQty >= 0)) {
      setError('Opening stock must be zero or more.');
      return;
    }
    const minVal = Math.max(0, Number(minStockLevel || 0) || 0);
    const reorderVal = Math.max(0, Number(reorderLevel || 0) || 0);
    if (!Number.isFinite(Number(minStockLevel || 0)) || !Number.isFinite(Number(reorderLevel || 0))) {
      setError('Min stock and reorder levels must be numbers.');
      return;
    }
    if (product && product.serial_tracking_mode !== 'none' && serialMode !== product.serial_tracking_mode && serials.some((s) => s.status !== 'available')) {
      setError('This product has sold or adjusted serials, so its tracking mode cannot be changed. Sold history stays intact.');
      return;
    }
    const persistStagedSerials = async (productId: string) => {
      for (const s of stagedSerials) {
        const ok = await persistUniqueSerial(productId, s);
        if (!ok) return false;
      }
      for (const g of stagedGroups) {
        const ok = await persistSharedGroup(productId, g.serial, g.qty);
        if (!ok) return false;
      }
      return true;
    };
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      business_id: businessId,
      category_id: product?.category_id ?? null,
      supplier_id: isFarm ? null : (product?.supplier_id ?? null),
      sku: isFarm ? null : (sku.trim() || null),
      brand: isFarm ? null : (brand.trim() || null),
      model: isFarm ? null : (model.trim() || null),
      description: description.trim(),
      unit: unit.trim(),
      cost_price: Number(costPrice || 0),
      selling_price: Number(sellingPrice || 0),
      min_stock_level: minVal,
      reorder_level: reorderVal,
      product_type: product?.product_type ?? 'simple',
      serial_tracking_mode: serialMode,
      warranty_months: isFarm ? null : (product?.warranty_months ?? null),
      expiry_tracking: product?.expiry_tracking ?? false,
      is_active: product?.is_active ?? true,
    };
    const diagnoseAccess = async (): Promise<string> => {
      // Explains *why* the database refused the write (missing profile,
      // inactive account, wrong role, or unapplied permission seeds).
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return 'You are not signed in. Sign in again and retry.';
        const { data: profile } = await supabase.from('user_profiles')
          .select('is_active, role_id, role:roles(name,display_name)').eq('id', authUser.id).maybeSingle();
        const typed = profile as { is_active?: boolean; role_id?: string; role?: { name?: string; display_name?: string } } | null;
        if (!typed) return `No staff profile exists for ${authUser.email}. Ask an administrator to create and approve your account.`;
        const roleLabel = typed.role?.display_name ?? typed.role?.name ?? 'unknown';
        if (!typed.is_active) return `Your account (${authUser.email}) is deactivated. Ask an administrator to reactivate it.`;
        if (typed.role_id) {
          const { data: grants } = await supabase.from('role_permissions')
            .select('permission:permissions(code)').eq('role_id', typed.role_id);
          const rows = ((grants ?? []) as unknown) as Array<{ permission: Array<{ code: string }> | { code: string } | null }>;
          const codes = rows.flatMap((g) => {
            const p = g.permission;
            const list = Array.isArray(p) ? p : p ? [p] : [];
            return list.map((x) => x.code);
          }).filter(Boolean);
          if (!codes.includes('products.manage')) {
            return `Your role (${roleLabel}) lacks the products.manage permission in the live database. Ask a Super Admin to run 'supabase db push' to apply all migrations (including role seeds), then reload and retry.`;
          }
          return `Your role (${roleLabel}) holds products.manage, so the denial is unexpected — the live database is likely behind on migrations. Ask a Super Admin to run 'supabase db push'.`;
        }
        return `Your profile has no role assigned. Ask an administrator to set your role.`;
      } catch {
        return 'If this persists, ask a Super Admin to deploy the manage-product function or grant products.manage permission.';
      }
    };
    const seedBalances = async (productId: string, opening: number) => {
      // Seed exactly ONE balance row so a new product never repeats once per
      // branch (the historic 3× duplication): the creator's own branch when it
      // belongs to this business, otherwise the first active branch. Other
      // branches get their rows lazily via record_inventory_movement (sales,
      // transfers, GRN), which also copies the product's min/reorder levels.
      try {
        const { data: bizBranches } = await supabase
          .from('branches')
          .select('id, created_at')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .order('created_at');

        const branches = (bizBranches ?? []) as Array<{ id: string }>;
        if (branches.length === 0) return;
        const ownBranch = currentUser?.branch_id && branches.some((b) => b.id === currentUser?.branch_id)
          ? currentUser.branch_id
          : undefined;
        const targetBranch = ownBranch ?? branches[0].id;
        const { error: seedErr } = await supabase.from('inventory_balances').insert({
          product_id: productId,
          branch_id: targetBranch,
          opening_stock: opening,
          current_stock: opening,
          min_stock_level: payload.min_stock_level,
          reorder_level: payload.reorder_level,
        });
        if (seedErr) console.warn('Balance seeding note:', seedErr.message);
      } catch (balanceErr) {
        console.warn('Auto balance seeding note:', balanceErr);
      }
    };
    const syncUnits = async (productId: string) => {
      // Extra sale units (e.g. eggs per crate/dozen/piece). Non-blocking: the
      // primary unit on the product row always works even if this table is missing.
      try {
        const desired = [...new Set([unit.trim(), ...extraUnits.map((u) => u.trim())].filter(Boolean))];
        await supabase.from('product_units').delete().eq('product_id', productId);
        if (desired.length > 0) {
          const { error: unitErr } = await supabase.from('product_units').insert(
            desired.map((unit_name) => ({ product_id: productId, unit_name, is_default: unit_name === unit.trim() })),
          );
          if (unitErr) console.warn('Product units sync note:', unitErr.message);
        }
      } catch (unitErr) {
        console.warn('Product units sync note:', unitErr);
      }
    };
    // Primary path: manage-product edge function (role-checked, bypasses RLS).
    const { data: edgeData, error: fnError } = await supabase.functions.invoke('manage-product', {
      body: product ? { p_action: 'update', p_product_id: product.id, ...payload } : { p_action: 'create', ...payload },
    });
    if (!fnError) {
      const savedId = product ? product.id : (edgeData as { product?: { id: string } } | null)?.product?.id;
      if (!product && savedId) await seedBalances(savedId, openingQty);
      if (savedId) await syncUnits(savedId);
      if (!product && savedId) {
        const stagedOk = await persistStagedSerials(savedId);
        if (!stagedOk) {
          setSaving(false);
          onSaved('Product created, but some serial numbers were skipped as duplicates. Edit the product to review them.');
          return;
        }
      }
      setSaving(false);
      onSaved(product ? 'Product updated successfully.' : 'Product created successfully.');
      return;
    }
    if (!String(fnError.message || '').includes('Failed to send a request')) {
      setError(await edgeErrorMessage(fnError, product ? 'Could not save changes.' : 'Could not create the product.'));
      setSaving(false);
      return;
    }
    // Fallback: direct table write (works when the caller holds products.manage).
    if (product) {
      const { error: e } = await supabase.from('products').update(payload).eq('id', product.id);
      if (e) {
        console.error('Update product error:', e);
        setError(`Could not save changes: ${e.message}. ${await diagnoseAccess()}`);
        setSaving(false);
        return;
      }
      await syncUnits(product.id);
    } else {
      const { data: created, error: e } = await supabase.from('products').insert(payload).select().single();
      if (e || !created) {
        console.error('Insert product error:', e);
        setError(`Could not create product: ${e?.message || 'Database insert error'}. ${await diagnoseAccess()}`);
        setSaving(false);
        return;
      }
      await seedBalances((created as { id: string }).id, openingQty);
      await syncUnits((created as { id: string }).id);
      if (!product) {
        const stagedOk = await persistStagedSerials((created as { id: string }).id);
        if (!stagedOk) {
          setSaving(false);
          onSaved('Product created, but some serial numbers were skipped as duplicates. Edit the product to review them.');
          return;
        }
      }
    }

    setSaving(false);
    onSaved(product ? 'Product updated successfully.' : 'Product created successfully.');
  };

  const handleDelete = async () => {
    if (!product) return;
    // Super Admin deletes go through the organization engine: clean products
    // are removed, ones with sales history move to Default (deactivated).
    if (hasRole(currentUser as UserProfile | null, 'super_admin')) {
      if (!window.confirm(`Permanently delete product "${product.name}"? Items with sales history move to Default (deactivated) so records stay intact. This cannot be undone.`)) return;
      setSaving(true);
      setError(null);
      const { data: orgData, error: orgError } = await supabase.functions.invoke('delete-organization', {
        body: { p_entity: 'product', p_id: product.id },
      });
      if (!orgError) {
        setSaving(false);
        onSaved((orgData as { deactivated?: boolean } | null)?.deactivated
          ? 'Product has sales history, so it was moved to Default and deactivated.'
          : 'Product deleted successfully.');
        return;
      }
      if (!String(orgError.message || '').includes('Failed to send a request')) {
        setError(await edgeErrorMessage(orgError, 'Could not delete the product.'));
        setSaving(false);
        return;
      }
      // Edge unreachable: fall through to the manage-product path below.
    } else if (!window.confirm(`Delete product "${product.name}"? Products with sales history will be deactivated instead.`)) return;
    setSaving(true);
    setError(null);

    // Primary path: manage-product edge function (handles history check + RLS).
    const { data: edgeData, error: fnError } = await supabase.functions.invoke('manage-product', {
      body: { p_action: 'delete', p_product_id: product.id },
    });
    if (!fnError) {
      setSaving(false);
      onSaved((edgeData as { deactivated?: boolean } | null)?.deactivated
        ? 'Product has sales history, so it was deactivated instead of deleted.'
        : 'Product deleted successfully.');
      return;
    }
    if (!String(fnError.message || '').includes('Failed to send a request')) {
      setError(await edgeErrorMessage(fnError, 'Could not delete the product.'));
      setSaving(false);
      return;
    }
    // Fallback: direct write (deactivate when there is history, since products
    // have no direct-delete policy).
    const { data: salesUsing } = await supabase.from('daily_sales').select('id').eq('product_id', product.id).limit(1);
    const { data: itemsUsing } = await supabase.from('sale_items').select('id').eq('product_id', product.id).limit(1);
    const hasSalesHistory = (salesUsing && salesUsing.length > 0) || (itemsUsing && itemsUsing.length > 0);

    if (hasSalesHistory) {
      const { error: deactErr } = await supabase.from('products').update({ is_active: false }).eq('id', product.id);
      if (deactErr) {
        setError(`Could not deactivate product: ${deactErr.message}`);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved('Product has sales history, so it was deactivated instead of deleted.');
      return;
    } else {
      const { error: delErr } = await supabase.from('products').delete().eq('id', product.id);
      if (delErr) {
        setError(`Could not delete product: ${delErr.message}. Ask a Super Admin to deploy the manage-product function.`);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved('Product deleted successfully.');
    }
  };

  return (
    <Modal open onClose={onClose} title={product ? 'Edit Product' : 'Add Product'} size="lg">
      <div className="space-y-4">
        {isFarm && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
            Farm product mode: brand, SKU, model and supplier fields are hidden. Measure stock in bags, crates, baskets, kilos or units.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Product Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={isFarm ? 'e.g. Cassava Tubers' : 'e.g. iTel Solar Panel 100W'} autoFocus />
          <Select label="Business Unit" value={businessId} onChange={(e) => handleBusinessChange(e.target.value)} disabled={!!product}>
            <option value="">Select...</option>
            {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          {!isFarm && (
            <>
              <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Unique identifier" />
              <Input label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
              <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} />
            </>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Input
              label={isFarm ? 'Primary unit (bag, crate, basket, kilo, unit...)' : 'Primary unit'}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={isFarm ? 'e.g. crate' : 'e.g. pcs'}
              list="product-unit-options"
            />
            <datalist id="product-unit-options">
              {unitPresets.map((u) => <option key={u} value={u} />)}
            </datalist>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="w-full text-xs text-slate-500">Also sold as (e.g. eggs per crate, dozen or piece):</span>
              {unitPresets.filter((u) => u !== unit.trim()).map((u) => (
                <div
                  key={u}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer select-none ${extraUnits.includes(u) ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                  onClick={() => { setExtraUnits((prev) => (extraUnits.includes(u) ? prev.filter((x) => x !== u) : [...prev, u])); }}
                >
                  {u}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">Serial Number Tracking</p>
            {serialMode !== 'none' && product && (
              <span className="text-xs text-slate-500">{availableSerialCount} available</span>
            )}
          </div>
          <Select
            label="Tracking mode"
            value={serialMode}
            onChange={(e) => setSerialMode(e.target.value as SerialTrackingMode)}
          >
            <option value="none">No Serial Number</option>
            <option value="unique">Unique Serial Number Per Unit</option>
            <option value="shared">Shared Serial Number</option>
          </Select>
          {serialMode === 'none' && (
            <p className="text-xs text-slate-400">Quantity-only tracking. Serial fields stay hidden everywhere for this product.</p>
          )}
          {serialMode !== 'none' && !product && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                {serialMode === 'unique'
                  ? 'Add one serial per physical unit now (optional); the rest can be added after saving. Duplicates are rejected.'
                  : 'Add one or more shared serial groups now (optional); the rest can be added after saving.'}
              </p>
              {serialMode === 'unique' ? (
                <>
                  <div className="flex gap-2">
                    <Input label="Serial number" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder="e.g. PT001" className="flex-1" />
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        onClick={() => {
                          const name = bulkText.trim();
                          if (!name) { setError('Enter a serial number.'); return; }
                          if (stagedSerials.some((s) => s.toLowerCase() === name.toLowerCase())) { setError(`Serial number ${name} is already in the list.`); return; }
                          setStagedSerials((prev) => [...prev, name]);
                          setBulkText('');
                          setError(null);
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                  {stagedSerials.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {stagedSerials.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 rounded-full bg-slate-900 text-white px-2.5 py-0.5 text-xs font-medium">
                          {s}
                          <button type="button" aria-label={`Remove ${s}`} onClick={() => setStagedSerials((prev) => prev.filter((x) => x !== s))} className="hover:text-rose-300">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Input label="Group serial" value={sharedSerial} onChange={(e) => setSharedSerial(e.target.value)} placeholder="e.g. BAT-2026-001" />
                    </div>
                    <Input label="Units" type="number" min="1" step="1" value={sharedQty} onChange={(e) => setSharedQty(e.target.value)} placeholder="10" />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        const name = sharedSerial.trim();
                        const qty = Math.floor(Number(sharedQty));
                        if (!name) { setError('Enter a group serial.'); return; }
                        if (!(qty > 0)) { setError('Enter how many units the group covers.'); return; }
                        if (stagedGroups.some((g) => g.serial.toLowerCase() === name.toLowerCase())) { setError(`Group ${name} is already in the list.`); return; }
                        setStagedGroups((prev) => [...prev, { serial: name, qty }]);
                        setSharedSerial('');
                        setSharedQty('');
                        setError(null);
                      }}
                    >
                      Add Group
                    </Button>
                  </div>
                  {stagedGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {stagedGroups.map((g) => (
                        <span key={g.serial} className="inline-flex items-center gap-1 rounded-full bg-slate-900 text-white px-2.5 py-0.5 text-xs font-medium">
                          {g.serial} · {g.qty}
                          <button type="button" aria-label={`Remove ${g.serial}`} onClick={() => setStagedGroups((prev) => prev.filter((x) => x.serial !== g.serial))} className="hover:text-rose-300">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {serialMode !== 'none' && product && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input
                    value={serialSearch}
                    onChange={(e) => setSerialSearch(e.target.value)}
                    placeholder="Search serials..."
                    className="w-full pl-3 pr-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900"
                  />
                </div>
                <select
                  value={serialStatusFilter}
                  onChange={(e) => setSerialStatusFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 bg-white"
                  aria-label="Filter by status"
                >
                  <option value="all">All statuses</option>
                  <option value="available">Available</option>
                  <option value="sold">Sold</option>
                  <option value="reserved">Reserved</option>
                  <option value="returned">Returned</option>
                  <option value="damaged">Damaged</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              {serialMode === 'unique' && (
                <div className="space-y-2">
                  <Textarea
                    label="Bulk add (one serial per line)"
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={'PT001\nPT002\nPT003'}
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleBulkAdd} disabled={serialBusy}>{serialBusy ? 'Adding...' : 'Add Serials'}</Button>
                  </div>
                </div>
              )}
              {serialMode === 'shared' && (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Input label="Group serial" value={sharedSerial} onChange={(e) => setSharedSerial(e.target.value)} placeholder="e.g. BATCH-A" />
                    </div>
                    <Input label="Units" type="number" min="1" step="1" value={sharedQty} onChange={(e) => setSharedQty(e.target.value)} placeholder="6" />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={serialBusy}
                      onClick={async () => {
                        const name = sharedSerial.trim();
                        const qty = Math.floor(Number(sharedQty));
                        if (!name) { setError('Enter a group serial.'); return; }
                        if (!(qty > 0) || !product) { setError('Enter how many units the group covers.'); return; }
                        setSerialBusy(true); setError(null);
                        const ok = await persistSharedGroup(product.id, name, qty);
                        if (ok) { setSharedSerial(''); setSharedQty(''); await loadSerials(product.id); }
                        setSerialBusy(false);
                      }}
                    >
                      {serialBusy ? 'Adding...' : 'Add Group'}
                    </Button>
                  </div>
                </div>
              )}
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 max-h-56 overflow-y-auto">
                {visibleSerials.length === 0 && (
                  <p className="p-3 text-sm text-slate-400">
                    {serials.length === 0 ? 'No serial numbers yet.' : 'No serials match the current filter.'}
                  </p>
                )}
                {visibleSerials.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 p-2.5">
                    {editingSerialId === s.id ? (
                      <>
                        <input
                          value={editingSerialName}
                          onChange={(e) => setEditingSerialName(e.target.value)}
                          className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900"
                          autoFocus
                        />
                        <Button size="sm" onClick={() => handleRenameSerial(s)} disabled={serialBusy}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingSerialId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{s.serial_number}</p>
                          <p className="text-[11px] text-slate-400">
                            {s.mode === 'shared' ? `Group · ${s.quantity} left` : 'Unique unit'}
                          </p>
                        </div>
                        <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.status === 'available' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : s.status === 'sold' ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {s.status}
                        </span>
                        {unusedSerial(s) && (
                          <>
                            <button
                              type="button"
                              title="Rename serial"
                              onClick={() => { setEditingSerialId(s.id); setEditingSerialName(s.serial_number); setError(null); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              title="Delete serial"
                              onClick={() => handleDeleteSerial(s)}
                              className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 shrink-0"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {!unusedSerial(s) && s.status !== 'sold' && (
                          <select
                            value={s.status}
                            disabled={serialBusy}
                            onChange={(e) => handleSerialStatus(s, e.target.value as ProductSerialNumber['status'])}
                            className="px-2 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:border-slate-900 bg-white shrink-0"
                            aria-label={`Change status of ${s.serial_number}`}
                          >
                            {(['available', 'reserved', 'cancelled', 'returned', 'damaged', 'lost'] as const).map((st) => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input label="Cost Price" type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          <Input label="Selling Price" type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
          {!product && (
            <Input label={`Stock Quantity${unit ? ` (${unit})` : ''}`} type="number" min="0" step="any" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} placeholder="0" />
          )}
          <Input label="Min Stock Level" type="number" min="0" step="any" value={minStockLevel} onChange={(e) => setMinStockLevel(e.target.value)} placeholder="0" />
          <Input label="Reorder Level" type="number" min="0" step="any" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} placeholder="0" />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-between gap-3 pt-2">
          <div>
            {product && canDelete && (
              <Button variant="ghost" onClick={handleDelete} disabled={saving} className="text-rose-600 hover:text-rose-700">
                <Trash2 size={16} /> Delete
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
