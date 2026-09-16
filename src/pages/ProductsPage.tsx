import { useState, useMemo, useEffect } from 'react';
import { Package, Plus, Pencil, Search, Tag, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import { isFarmBusiness, unitOptionsFor } from '@/lib/business';
import type { Product, Business, BusinessMeasurementUnit, Category, Supplier, UserProfile } from '@/types/database';

export function ProductsPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = isAtLeast(user, 'manager');
  const canManageCategories = hasRole(user, 'super_admin') || hasRole(user, 'admin') || isAtLeast(user, 'manager');
  const canDeleteProduct = hasRole(user, 'super_admin') || hasRole(user, 'admin');

  const isExecutive = hasRole(user, 'super_admin');
  const [page, setPage] = useState(1);
  const pageSize = 30;

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

  const productsQuery = useMemo(() => {
    const from = (page - 1) * pageSize;
    const to = page * pageSize - 1;
    let q = supabase
      .from('products')
      .select(`*, category:categories(id,name), supplier:suppliers(id,name)`, { count: 'exact' })
      .order('name')
      .range(from, to);
    if (!isExecutive && user?.business_id) {
      q = q.eq('business_id', user.business_id);
    }
    if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
    return q;
  }, [isExecutive, user, filterBusiness, page, pageSize]);

  const { data: products, loading, error, refetch } = useSupabaseQuery<Product[]>(
    () => productsQuery,
    [productsQuery],
    { cacheKey: `products:${user?.id ?? 'anon'}:${user?.business_id ?? '-'}:${filterBusiness}` },
  );

  const filtered = useMemo(() => {
    if (!products) return [];
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku?.toLowerCase().includes(q) ?? false) ||
        (p.brand?.toLowerCase().includes(q) ?? false),
    );
  }, [products, search]);

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
        {isExecutive && (
          <Select value={filterBusiness} onChange={(e) => setFilterBusiness(e.target.value)} className="sm:w-56">
            <option value="all">All Businesses</option>
            {businesses?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                    <Package size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">{p.name}</h3>
                    {p.sku && <p className="text-xs text-slate-400">SKU: {p.sku}</p>}
                  </div>
                </div>
                {canManage && (
                  <button
                    onClick={() => { setEditing(p); setShowModal(true); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.category && (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200">
                    <Tag size={10} className="mr-1" />{p.category.name}
                  </Badge>
                )}
                {p.brand && <Badge className="bg-blue-50 text-blue-600 border-blue-100">{p.brand}</Badge>}
                {p.unit && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100">{p.unit}</Badge>}
                {!p.is_active && <Badge className="bg-gray-100 text-gray-500 border-gray-200">Inactive</Badge>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">Cost Price</p>
                  <p className="font-medium text-slate-700">{formatCurrency(Number(p.cost_price))}</p>
                </div>
                <div>
                  <p className="text-slate-400">Selling Price</p>
                  <p className="font-medium text-slate-700">{formatCurrency(Number(p.selling_price))}</p>
                </div>
                <div>
                  <p className="text-slate-400">Min Stock</p>
                  <p className="font-medium text-slate-700">{p.min_stock_level} {p.unit}</p>
                </div>
                <div>
                  <p className="text-slate-400">Reorder At</p>
                  <p className="font-medium text-slate-700">{p.reorder_level} {p.unit}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-slate-100">
          <div className="flex justify-between items-center text-sm text-slate-500">
            <span>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} products</span>
            <span>Page {page} of {Math.ceil(filtered.length / pageSize)}</span>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="ghost" onClick={()=>{setPage(p=> Math.max(1, p - 1));}} disabled={page===1}>
              Prev
            </Button>
            <Button variant="ghost" onClick={()=>{setPage(p=> Math.min(Math.ceil(filtered.length / pageSize), p + 1));}} disabled={page>=Math.ceil(filtered.length / pageSize)}>
              Next
            </Button>
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
          categories={categories ?? []}
          suppliers={suppliers ?? []}
          currentUser={user}
          canDelete={canDeleteProduct}
          measurementUnits={measurementUnits ?? []}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={(message) => { refetch(); refetchCategories(); refetchMeasurementUnits(); setShowModal(false); setEditing(null); if (message) setNotice(message); }}
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
  product, businesses, categories, suppliers, measurementUnits, currentUser, canDelete, onClose, onSaved,
}: {
  product: Product | null;
  businesses: Business[];
  categories: Category[];
  suppliers: Supplier[];
  measurementUnits: BusinessMeasurementUnit[];
  currentUser: { role?: { name: string }; business_id: string | null } | null;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (message?: string) => void;
}) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const availableBusinesses = isExecutive ? businesses : businesses.filter((b) => b.id === currentUser?.business_id);

  const [name, setName] = useState(product?.name ?? '');
  const [businessId, setBusinessId] = useState(product?.business_id ?? currentUser?.business_id ?? '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '');
  const [supplierId, setSupplierId] = useState(product?.supplier_id ?? '');
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
  const [costPrice, setCostPrice] = useState(product?.cost_price?.toString() ?? '0');
  const [sellingPrice, setSellingPrice] = useState(product?.selling_price?.toString() ?? '0');
  const [minStock, setMinStock] = useState(product?.min_stock_level?.toString() ?? '0');
  const [reorderLevel, setReorderLevel] = useState(product?.reorder_level?.toString() ?? '0');
  const [productType, setProductType] = useState(product?.product_type ?? 'simple');
  const [warrantyMonths, setWarrantyMonths] = useState(product?.warranty_months?.toString() ?? '');
  const [expiryTracking, setExpiryTracking] = useState(product?.expiry_tracking ?? false);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBusiness = availableBusinesses.find((b) => b.id === businessId) ?? null;
  const isFarm = isFarmBusiness(selectedBusiness);
  const businessUnits = measurementUnits?.filter((u) => u.business_id === businessId).map((u) => u.name) ?? [];
  const unitPresets = businessUnits.length > 0 ? businessUnits : unitOptionsFor(isFarm);

  const filteredCategories = categories.filter((c) => c.business_id === businessId);
  const filteredSuppliers = suppliers.filter((s) => s.business_id === businessId);

  const handleBusinessChange = (next: string) => {
    setBusinessId(next);
    setCategoryId('');
    setSupplierId('');
    const nextBusiness = availableBusinesses.find((b) => b.id === next) ?? null;
    if (isFarmBusiness(nextBusiness)) {
      setSku('');
      setBrand('');
      setModel('');
      setSupplierId('');
      setWarrantyMonths('');
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
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      business_id: businessId,
      category_id: categoryId || null,
      supplier_id: isFarm ? null : (supplierId || null),
      sku: isFarm ? null : (sku.trim() || null),
      brand: isFarm ? null : (brand.trim() || null),
      model: isFarm ? null : (model.trim() || null),
      description: description.trim(),
      unit: unit.trim(),
      cost_price: Number(costPrice || 0),
      selling_price: Number(sellingPrice || 0),
      min_stock_level: Number(minStock || 0),
      reorder_level: Number(reorderLevel || 0),
      product_type: isFarm ? 'simple' : productType,
      warranty_months: isFarm ? null : (warrantyMonths ? Number(warrantyMonths) : null),
      expiry_tracking: expiryTracking,
      is_active: isActive,
    };
    const seedBalances = async (productId: string) => {
      // Automatically initialize inventory balance rows for active branches in this business
      try {
        const { data: bizBranches } = await supabase
          .from('branches')
          .select('id')
          .eq('business_id', businessId)
          .eq('is_active', true);

        if (bizBranches && bizBranches.length > 0) {
          const balances = bizBranches.map((br) => ({
            product_id: productId,
            branch_id: (br as { id: string }).id,
            opening_stock: 0,
            current_stock: 0,
            min_stock_level: Number(minStock || 0),
            reorder_level: Number(reorderLevel || 0),
          }));
          await supabase.from('inventory_balances').insert(balances);
        }
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
      if (!product && savedId) await seedBalances(savedId);
      if (savedId) await syncUnits(savedId);
      setSaving(false);
      onSaved(product ? 'Product updated successfully.' : 'Product created successfully.');
      return;
    }
    if (!String(fnError.message || '').includes('Failed to send a request')) {
      setError(fnError.message || (product ? 'Could not save changes.' : 'Could not create the product.'));
      setSaving(false);
      return;
    }
    // Fallback: direct table write (works when the caller holds products.manage).
    if (product) {
      const { error: e } = await supabase.from('products').update(payload).eq('id', product.id);
      if (e) {
        console.error('Update product error:', e);
        setError(`Could not save changes: ${e.message}. If this persists, ask a Super Admin to deploy the manage-product function or grant products.manage permission.`);
        setSaving(false);
        return;
      }
      await syncUnits(product.id);
    } else {
      const { data: created, error: e } = await supabase.from('products').insert(payload).select().single();
      if (e || !created) {
        console.error('Insert product error:', e);
        setError(`Could not create product: ${e?.message || 'Database insert error'}. If this persists, ask a Super Admin to deploy the manage-product function or grant products.manage permission.`);
        setSaving(false);
        return;
      }
      await seedBalances((created as { id: string }).id);
      await syncUnits((created as { id: string }).id);
    }

    setSaving(false);
    onSaved(product ? 'Product updated successfully.' : 'Product created successfully.');
  };

  const handleDelete = async () => {
    if (!product) return;
    if (!window.confirm(`Delete product "${product.name}"? Products with sales history will be deactivated instead.`)) return;
    setSaving(true);
    setError(null);

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
        setError(`Could not delete product: ${delErr.message}`);
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
          <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {filteredCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {!isFarm && (
            <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">None</option>
              {filteredSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </div>
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Input label="Cost Price" type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          <Input label="Selling Price" type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
          <Input label={`Min Stock${unit ? ` (${unit})` : ''}`} type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          <Input label={`Reorder Level${unit ? ` (${unit})` : ''}`} type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
        </div>
        {!isFarm && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Select label="Product Type" value={productType} onChange={(e) => setProductType(e.target.value as typeof productType)}>
              <option value="simple">Simple</option>
              <option value="serialized">Serialized</option>
              <option value="batch">Batch</option>
            </Select>
            <Input label="Warranty (months)" type="number" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} placeholder="Optional" />
            <div className="flex flex-col justify-end gap-3 pb-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={expiryTracking} onChange={(e) => setExpiryTracking(e.target.checked)} className="rounded border-slate-300" />
                Expiry tracking
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-slate-300" />
                Active
              </label>
            </div>
          </div>
        )}
        {isFarm && (
          <div className="flex flex-wrap gap-4 pb-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={expiryTracking} onChange={(e) => setExpiryTracking(e.target.checked)} className="rounded border-slate-300" />
              Expiry tracking
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-slate-300" />
              Active
            </label>
          </div>
        )}
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
