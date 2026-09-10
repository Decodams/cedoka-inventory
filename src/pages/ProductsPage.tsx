import { useState, useMemo } from 'react';
import { Package, Plus, Pencil, Search, Tag } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import type { Product, Business, Category, Supplier } from '@/types/database';

export function ProductsPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const canManage = isAtLeast(user, 'manager');

  const isExecutive = hasRole(user, 'super_admin');

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: categories } = useSupabaseQuery<Category[]>(
    () => supabase.from('categories').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:categories:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: suppliers } = useSupabaseQuery<Supplier[]>(
    () => supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:suppliers:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const productsQuery = useMemo(() => {
    let q = supabase
      .from('products')
      .select(`*, category:categories(id,name), supplier:suppliers(id,name)`)
      .order('name');
    if (!isExecutive && user?.business_id) {
      q = q.eq('business_id', user.business_id);
    }
    if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
    return q;
  }, [isExecutive, user, filterBusiness]);

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Products</h2>
          <p className="text-sm text-slate-500 mt-0.5">Manage your product catalog across business units.</p>
        </div>
        {canManage && (
          <Button onClick={() => { setEditing(null); setShowModal(true); }}>
            <Plus size={18} /> Add Product
          </Button>
        )}
      </div>

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
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={() => { refetch(); setShowModal(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ProductFormModal({
  product, businesses, categories, suppliers, currentUser, onClose, onSaved,
}: {
  product: Product | null;
  businesses: Business[];
  categories: Category[];
  suppliers: Supplier[];
  currentUser: { role?: { name: string }; business_id: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
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
  const [unit, setUnit] = useState(product?.unit ?? 'pcs');
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

  const filteredCategories = categories.filter((c) => c.business_id === businessId);
  const filteredSuppliers = suppliers.filter((s) => s.business_id === businessId);

  const handleSave = async () => {
    if (!name.trim() || !businessId) {
      setError('Name and business unit are required');
      return;
    }
    setSaving(true);
    setError(null);
    const data = {
      name: name.trim(),
      business_id: businessId,
      category_id: categoryId || null,
      supplier_id: supplierId || null,
      sku: sku.trim() || null,
      brand: brand.trim() || null,
      model: model.trim() || null,
      description: description.trim(),
      unit,
      cost_price: Number(costPrice || 0),
      selling_price: Number(sellingPrice || 0),
      min_stock_level: Number(minStock || 0),
      reorder_level: Number(reorderLevel || 0),
      product_type: productType,
      warranty_months: warrantyMonths ? Number(warrantyMonths) : null,
      expiry_tracking: expiryTracking,
      is_active: isActive,
    };
    if (product) {
      const { error: e } = await supabase.from('products').update(data).eq('id', product.id);
      if (e) { setError('Could not save changes.'); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('products').insert(data);
      if (e) { setError('Could not create the product.'); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={product ? 'Edit Product' : 'Add Product'} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Product Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. iTel Solar Panel 100W" autoFocus />
          <Select label="Business Unit" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setCategoryId(''); setSupplierId(''); }} disabled={!!product}>
            <option value="">Select...</option>
            {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Unique identifier" />
          <Input label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} />
          <Input label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, box, kg" />
          <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {filteredCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">None</option>
            {filteredSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Input label="Cost Price" type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          <Input label="Selling Price" type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
          <Input label="Min Stock" type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          <Input label="Reorder Level" type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
        </div>
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
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
