import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Plus, Minus, Receipt, Search, Trash2, Check, Printer } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase, useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import { hasRole, isAtLeast } from '@/lib/rbac';
import { formatUnitQuantity } from '@/lib/business';
import { SALE_STATUS_LABELS, SALE_STATUS_STYLES } from '@/lib/statusStyles';
import { useReceiptPDF } from '@/components/ReceiptPDF';
import { SaleDetailModal } from '@/components/SaleDetailModal';
import logoUrl from '@/logo.jpeg';
import type { Branch, DailySale, Product, SaleItem, UserProfile } from '@/types/database';

export function SalesPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [viewSaleId, setViewSaleId] = useState<string | null>(null);
  const canViewDetails = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const businessLevel = isAtLeast(user, 'admin');
  const { downloadReceipt, printReceipt } = useReceiptPDF();
  const { data: branches } = useSupabaseQuery<Branch[]>(() => supabase.from('branches').select('*').eq('is_active', true).order('name'), [], { cacheKey: `sales-branches:${user?.id}`, ttlMs: 60_000 });
  const { data: sales, loading, error, refetch } = useSupabaseQuery<DailySale[]>(() => {
    let query = supabase.from('daily_sales').select('*, product:products(id,name), items:sale_items(id,quantity,unit_price,discount_value,product:products(id,name)), branch:branches(id,name)', { count: 'exact' }).order('created_at', { ascending: false }).limit(100);
    if (!isExecutive && businessLevel && user?.business_id) query = query.eq('business_id', user.business_id);
    if (!businessLevel && user?.branch_id) query = query.eq('branch_id', user.branch_id);
    if (status !== 'all') query = query.eq('status', status);
    return query;
  }, [user?.id, user?.business_id, user?.branch_id, isExecutive, businessLevel, status], { cacheKey: `sales:${user?.id}:${status}` });
  const filtered = useMemo(() => (sales ?? []).filter((sale) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return sale.customer_name?.toLowerCase().includes(query) || sale.product?.name.toLowerCase().includes(query) || sale.items?.some((item) => item.product?.name.toLowerCase().includes(query));
  }), [sales, search]);
  const completed = filtered.filter((sale) => sale.status === 'completed').reduce((sum, sale) => sum + Number(sale.unit_price) * sale.quantity - Number(sale.discount_value), 0);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load sales." onRetry={refetch} />;
  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Sales</h2>
        <p className="text-sm text-slate-500">Complete one transaction with one or more products.</p>
      </div>
      <Button onClick={() => setShowModal(true)} className="w-full sm:w-auto"><Plus size={18} /> Record Sale</Button></div>
    <div className="grid grid-cols-2 gap-4"><Metric label="Completed sales" value={formatCurrency(completed)} /><Metric label="Transactions" value={String(filtered.length)} /></div>
    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="relative flex-1">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm" placeholder="Search customer or product..." value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <Select className="sm:w-40" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">All statuses</option>
        {Object.entries(SALE_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </Select>
    </div>
    {receiptError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{receiptError}</p>}
    {filtered.length ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Sale</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3">Status</th><th /></tr></thead><tbody className="divide-y">{filtered.map((sale) => <tr key={sale.id} onClick={canViewDetails ? () => setViewSaleId(sale.id) : undefined} title={canViewDetails ? 'View sale details' : undefined} className={canViewDetails ? 'cursor-pointer' : undefined}><td className="px-4 py-3 text-slate-500">{formatDate(sale.sale_date)}</td><td className="px-4 py-3"><p className="font-medium">{sale.items?.length ? `${sale.items.length} item${sale.items.length === 1 ? '' : 's'}` : sale.product?.name || 'Sale'}</p><p className="text-xs text-slate-400">{sale.customer_name || 'Walk-in'} · {sale.branch?.name || 'Branch'}</p></td><td className="px-3 py-3 text-right font-semibold">{formatCurrency(Number(sale.unit_price) * sale.quantity - Number(sale.discount_value))}</td><td className="px-3 py-3"><Badge className={SALE_STATUS_STYLES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge></td><td className="px-3 py-3"><span className="inline-flex items-center gap-1"><button className="text-slate-400 hover:text-slate-900" title="Download receipt" onClick={(e) => { e.stopPropagation(); setReceiptError(null); downloadReceipt(sale.id).catch((err: unknown) => setReceiptError(err instanceof Error ? err.message : 'Could not download the receipt.')); }}><Receipt size={16} /></button><button className="text-slate-400 hover:text-slate-900" title="Print receipt" onClick={(e) => { e.stopPropagation(); setReceiptError(null); printReceipt(sale.id).catch((err: unknown) => setReceiptError(err instanceof Error ? err.message : 'Could not print the receipt.')); }}><Printer size={16} /></button></span></td></tr>)}</tbody></table></div></div> : <EmptyState icon={<DollarSign size={32} />} title="No sales recorded" description="Sales will appear here once completed." action={<Button onClick={() => setShowModal(true)}><Plus size={18} />Record Sale</Button>} />}
    {showModal && <SaleModal branches={branches ?? []} currentUser={user} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); refetch(); }} />}
    {viewSaleId && <SaleDetailModal saleId={viewSaleId} onClose={() => setViewSaleId(null)} />}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p></div>; }
type CartItem = Omit<SaleItem, 'id' | 'sale_id' | 'created_at'> & { product: Product };

function SaleModal({ branches, currentUser, onClose, onSaved }: { branches: Branch[]; currentUser: UserProfile | null; onClose: () => void; onSaved: () => void }) {
  const { downloadReceipt, printReceipt } = useReceiptPDF();
  const canChooseBranch = currentUser?.role?.name === 'admin' || currentUser?.role?.name === 'super_admin';
  const [branchId, setBranchId] = useState(currentUser?.branch_id ?? '');
  const [products, setProducts] = useState<Product[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({});
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [query, setQuery] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [serial, setSerial] = useState('');
  const [lineUnit, setLineUnit] = useState('');
  const [productUnits, setProductUnits] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [paidTouched, setPaidTouched] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedSaleId, setCompletedSaleId] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  const branch = branches.find((candidate) => candidate.id === branchId) ?? null;
  const branchKey = branch?.id ?? '';
  const branchBusinessId = branch?.business_id ?? '';

  useEffect(() => {
    if (!canChooseBranch && currentUser?.branch_id && !branchId) setBranchId(currentUser.branch_id);
  }, [canChooseBranch, currentUser?.branch_id, branchId]);

  useEffect(() => {
    if (!branchId && branches.length === 1) setBranchId(branches[0].id);
  }, [branches, branchId]);

  useEffect(() => {
    if (!branchKey) { setProducts([]); setStockByProduct({}); return; }
    setLoadingProducts(true);
    supabase
      .from('products')
      .select('*')
      .eq('business_id', branchBusinessId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        setProducts((data as Product[]) || []);
        setLoadingProducts(false);
      });
    supabase
      .from('inventory_balances')
      .select('product_id,current_stock')
      .eq('branch_id', branchKey)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        for (const row of (data ?? []) as Array<{ product_id: string; current_stock: number | string }>) {
          map[row.product_id] = Number(row.current_stock) || 0;
        }
        setStockByProduct(map);
      });
    supabase
      .from('product_units')
      .select('product_id,unit_name')
      .then(({ data }) => {
        const map: Record<string, string[]> = {};
        for (const row of (data ?? []) as Array<{ product_id: string; unit_name: string }>) {
          if (!map[row.product_id]) map[row.product_id] = [];
          if (row.unit_name && !map[row.product_id].includes(row.unit_name)) map[row.product_id].push(row.unit_name);
        }
        setProductUnits(map);
      });
  }, [branchKey, branchBusinessId]);

  const [hideOutOfStock, setHideOutOfStock] = useState(false);

  const stockOf = (pid: string): number | undefined => stockByProduct[pid];

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
      : products;
    const inStockFirst = hideOutOfStock
      ? list.filter((p) => (stockByProduct[p.id] ?? 1) > 0)
      : list;
    return inStockFirst.slice(0, 60);
  }, [products, query, hideOutOfStock, stockByProduct]);

  const selectedProduct = products.find((candidate) => candidate.id === productId) ?? null;

  const unitsForProduct = (p: Product): string[] => {
    const extras = productUnits[p.id] ?? [];
    const base = [...new Set([p.unit || 'unit', ...extras])];
    return base.length > 0 ? base : ['unit'];
  };

  const selectProduct = (id: string) => {
    setProductId(id);
    const product = products.find((candidate) => candidate.id === id);
    if (product) {
      setUnitPrice(String(product.selling_price));
      setLineUnit(product.unit || 'unit');
      setSerial('');
    }
    setError(null);
  };

  const stepQuantity = (delta: number) => {
    setQuantity((current) => {
      const next = (Number(current) || 0) + delta;
      return String(next < 0 ? 0 : Math.round(next * 100) / 100);
    });
  };

  const pushToCart = (product: Product, qty: number, price: number, disc: number, saleUnit: string, serial: string | null) => {
    setItems((current) => {
      const existing = current.findIndex((it) => it.product_id === product.id && it.unit_price === price && it.discount_value === disc && (it.unit ?? product.unit) === saleUnit && (it.serial_number ?? null) === (serial ?? null));
      if (existing >= 0) {
        const next = [...current];
        next[existing] = { ...next[existing], quantity: Math.round((next[existing].quantity + qty) * 100) / 100 };
        return next;
      }
      return [...current, { product, product_id: product.id, quantity: qty, unit_price: price, discount_value: disc, unit: saleUnit, serial_number: serial }];
    });
  };

  const quickAdd = (product: Product) => {
    const stock = stockOf(product.id);
    const alreadyInCart = items.filter((it) => it.product_id === product.id).reduce((sum, it) => sum + it.quantity, 0);
    if (stock !== undefined && alreadyInCart + 1 > stock) {
      setError(`Only ${formatUnitQuantity(stock, product.unit)} of ${product.name} is in stock at this branch.`);
      return;
    }
    pushToCart(product, 1, Number(product.selling_price) || 0, 0, product.unit || 'unit', null);
    setError(null);
  };

  const addItem = () => {
    const product = products.find((candidate) => candidate.id === productId);
    const qty = Number(quantity);
    const price = Number(unitPrice);
    const disc = Number(discount) || 0;
    if (!product || !(qty > 0) || !(price >= 0)) {
      setError('Select a product and enter a valid quantity and price.');
      return;
    }
    const alreadyInCart = items.filter((it) => it.product_id === product.id).reduce((sum, it) => sum + it.quantity, 0);
    const available = stockByProduct[product.id];
    if (available !== undefined && qty + alreadyInCart > available) {
      setError(`Only ${formatUnitQuantity(available, product.unit)} of ${product.name} is in stock at this branch.`);
      return;
    }
    const saleUnit = lineUnit || product.unit || 'unit';
    const saleSerial = serial.trim() || null;
    pushToCart(product, qty, price, disc, saleUnit, saleSerial);
    setProductId('');
    setQuery('');
    setQuantity('1');
    setUnitPrice('0');
    setDiscount('0');
    setSerial('');
    setError(null);
  };

  const total = items.reduce((sum, item) => sum + item.quantity * item.unit_price - item.discount_value, 0);

  useEffect(() => {
    if (!paidTouched) setAmountPaid(total > 0 ? String(Math.round(total * 100) / 100) : '');
  }, [total, paidTouched]);

  const paid = Number(amountPaid) || 0;
  const change = paid - total;

  const complete = async () => {
    if (!branchId) { setError('Select a branch first.'); return; }
    if (!items.length) { setError('Add at least one item to the sale.'); return; }
    setSaving(true);
    setError(null);
    const { data: saleId, error: rpcError } = await supabase.rpc('create_sale_with_items', {
      p_branch_id: branchId,
      p_customer_name: customerName.trim() || null,
      p_payment_method: paymentMethod,
      p_amount_paid: paid,
      p_notes: notes.trim() || null,
      p_items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price, discount_value: item.discount_value, unit: item.unit ?? item.product.unit ?? null, serial_number: item.serial_number ?? null })),
    });
    setSaving(false);
    if (rpcError) { setError(rpcError.message); return; }
    if (typeof saleId === 'string' && saleId) {
      setCompletedSaleId(saleId);
    } else {
      onSaved();
    }
  };

  const startNewSale = () => {
    setItems([]);
    setProductId('');
    setQuery('');
    setQuantity('1');
    setUnitPrice('0');
    setDiscount('0');
    setSerial('');
    setCustomerName('');
    setAmountPaid('');
    setPaidTouched(false);
    setNotes('');
    setCompletedSaleId(null);
    setError(null);
  };

  return (
    <Modal open onClose={onClose} title={completedSaleId ? 'Sale Completed' : 'Record Sale'} size="lg">
      {completedSaleId ? (
      <div className="space-y-4 text-center py-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
          <Check size={24} />
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-900">Sale completed</p>
          <p className="text-sm text-slate-500 mt-1">{formatCurrency(total)} · {items.length} item{items.length === 1 ? '' : 's'} · {customerName.trim() || 'Walk-in customer'}</p>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
          <Button variant="outline" onClick={async () => { setReceiptBusy(true); setError(null); try { await downloadReceipt(completedSaleId); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not download the receipt.'); } setReceiptBusy(false); }} disabled={receiptBusy}>
            <Receipt size={16} /> {receiptBusy ? 'Preparing...' : 'Download PDF'}
          </Button>
          <Button variant="outline" onClick={async () => { setReceiptBusy(true); setError(null); try { await printReceipt(completedSaleId); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not print the receipt.'); } setReceiptBusy(false); }} disabled={receiptBusy}>
            <Printer size={16} /> Print
          </Button>
        </div>
        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <Button onClick={startNewSale}><Plus size={16} /> New Sale</Button>
          <Button variant="ghost" onClick={onSaved}>Done</Button>
        </div>
      </div>
      ) : (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Branch" value={branchId} disabled={!canChooseBranch} onChange={(event) => { setBranchId(event.target.value); setItems([]); }}>
            <option value="">Select branch...</option>
            {(canChooseBranch ? branches : branches.filter((candidate) => candidate.id === branchId)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </Select>
          <Input label="Customer" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Walk-in customer" />
        </div>

        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Add items</p>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={branchKey ? 'Type to search products...' : 'Select a branch first...'}
              disabled={!branchKey}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50"
            />
          </div>
          {branchKey && (
            <div>
              <label className="flex items-center gap-2 text-xs text-slate-500 mb-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={hideOutOfStock} onChange={(e) => setHideOutOfStock(e.target.checked)} className="rounded border-slate-300" />
                Hide out-of-stock products
              </label>
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
              {loadingProducts && <p className="p-3 text-sm text-slate-400">Loading products...</p>}
              {!loadingProducts && visibleProducts.length === 0 && (
                <p className="p-3 text-sm text-slate-400">{products.length === 0 ? 'No active products in this branch\u2019s business.' : 'No products match your search.'}</p>
              )}
              {visibleProducts.map((p) => {
                const stock = stockOf(p.id);
                const outOfStock = stock !== undefined && stock <= 0;
                return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (outOfStock) { setError(`${p.name} is out of stock at this branch and cannot be added.`); return; }
                    selectProduct(p.id);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (outOfStock) { setError(`${p.name} is out of stock at this branch and cannot be added.`); } else selectProduct(p.id); } }}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm ${outOfStock ? 'opacity-60' : 'hover:bg-slate-50 cursor-pointer'} ${productId === p.id ? 'bg-slate-900/[0.04]' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{p.name}</span>
                    <span className="block text-xs text-slate-400">{formatUnitQuantity(1, p.unit)} · {formatCurrency(Number(p.selling_price))}</span>
                  </span>
                  {stock !== undefined && (
                    <span className={`text-xs font-medium shrink-0 ${stock > 0 ? 'text-slate-400' : 'text-rose-500'}`}>
                      {stock > 0 ? `${formatUnitQuantity(stock, p.unit)} in stock` : 'Out of stock'}
                    </span>
                  )}
                  <span className="flex items-center gap-1 shrink-0">
                    {!outOfStock && (
                      <button
                        type="button"
                        title={`Quick add 1 ${p.unit || 'unit'} of ${p.name}`}
                        aria-label={`Quick add ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); quickAdd(p); }}
                        className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-900 hover:text-white hover:border-slate-900"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                    {productId === p.id && <span className="text-xs font-semibold text-emerald-600">Selected</span>}
                  </span>
                </div>
                );
              })}
              </div>
            </div>
          )}
          {selectedProduct && (
            <div className="rounded-lg bg-slate-50 p-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-800">{selectedProduct.name}</span>
                <span className="text-slate-500">{formatCurrency(Number(unitPrice) || 0)} per {lineUnit || selectedProduct.unit || 'unit'}</span>
              </div>
              <Select label="Unit" value={lineUnit || selectedProduct.unit || 'unit'} onChange={(event) => setLineUnit(event.target.value)}>
                {unitsForProduct(selectedProduct).map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
              <Input label="Serial Number (optional)" value={serial} onChange={(event) => setSerial(event.target.value)} placeholder="e.g. SN123456" />
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Qty{selectedProduct.unit ? ` (${selectedProduct.unit})` : ''}</label>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => stepQuantity(-1)} className="p-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-white" aria-label="Decrease quantity">
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }}
                      className="w-full px-2 py-2 text-sm text-center border border-slate-300 rounded-lg outline-none focus:border-slate-900"
                    />
                    <button type="button" onClick={() => stepQuantity(1)} className="p-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-white" aria-label="Increase quantity">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <Input label="Price" type="number" min="0" step="any" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
                <Input label="Discount" type="number" min="0" step="any" value={discount} onChange={(event) => setDiscount(event.target.value)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Line total: <strong className="text-slate-800">{formatCurrency((Number(quantity) || 0) * (Number(unitPrice) || 0) - (Number(discount) || 0))}</strong>
                  {' '}· {formatUnitQuantity(Number(quantity) || 0, selectedProduct.unit)}
                </span>
                <Button size="sm" onClick={addItem}><Plus size={14} /> Add item</Button>
              </div>
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="divide-y rounded-xl border border-slate-200">
            {items.map((item, index) => (
              <div className="flex items-center justify-between gap-3 p-3 text-sm" key={`${item.product_id}-${index}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{item.product.name}</span>
                  <span className="block text-xs text-slate-400">{formatUnitQuantity(item.quantity, item.unit ?? item.product.unit)} @ {formatCurrency(item.unit_price)}{item.discount_value > 0 ? ` (-${formatCurrency(item.discount_value)})` : ''}{item.serial_number ? ` · SN: ${item.serial_number}` : ''}</span>
                </span>
                <span className="font-semibold shrink-0">{formatCurrency(item.quantity * item.unit_price - item.discount_value)}</span>
                <button className="text-rose-500 hover:text-rose-700 shrink-0" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} aria-label="Remove item">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
            <option value="cash">Cash</option>
            <option value="transfer">Bank transfer</option>
            <option value="pos">POS</option>
            <option value="credit">Credit</option>
          </Select>
          <Input
            label="Amount paid"
            type="number"
            min="0"
            step="any"
            value={amountPaid}
            onChange={(event) => { setAmountPaid(event.target.value); setPaidTouched(true); }}
          />
        </div>

        {items.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <p className="px-4 pt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Receipt preview</p>
            <div className="p-4 max-w-sm mx-auto text-center">
              <img src={logoUrl} alt="Cedoka" className="h-12 w-12 object-contain mx-auto rounded-lg" />
              <p className="mt-3 text-sm font-bold tracking-wide text-slate-900">CEDOKA GLOBAL LIMITED</p>
              <p className="text-[11px] text-slate-500">35, Ailegun Road, Ejigbo, Lagos</p>
              <p className="text-[11px] text-slate-500">Top Mak Plaza, Awka</p>
              <p className="text-[11px] text-slate-500">07045851131 | 09128817136 | 09074190070 | cedokamall@gmail.com | cedokamall.com</p>
              <div className="my-2 border-t border-dashed border-slate-300" />
              <p className="text-xs font-bold tracking-widest text-slate-900">SALES RECEIPT</p>
              <div className="mt-2 text-left text-[11px] text-slate-600 space-y-0.5">
                <p>Date: {formatDate(new Date().toISOString().slice(0, 10))}</p>
                <p>Branch: {branch?.name ?? '-'}</p>
                <p>Customer: {customerName.trim() || 'Walk-in'}</p>
                <p>Attendant: {(currentUser?.full_name ?? 'Staff').split(' ')[0]}</p>
              </div>
              <table className="mt-2 w-full text-[11px]">
                <thead>
                  <tr className="border-y border-slate-200 text-left text-slate-500">
                    <th className="py-1 pr-2 font-semibold">Item</th>
                    <th className="py-1 pr-2 font-semibold text-right">Qty</th>
                    <th className="py-1 pr-2 font-semibold">Unit</th>
                    <th className="py-1 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={`${item.product_id}-${index}`} className="border-b border-slate-100 text-slate-700">
                      <td className="py-1 pr-2 text-left">
                        {item.product.name}
                        {item.serial_number && <span className="block text-[10px] text-slate-400">SN: {item.serial_number}</span>}
                      </td>
                      <td className="py-1 pr-2 text-right">{item.quantity}</td>
                      <td className="py-1 pr-2">{item.unit ?? item.product.unit ?? '-'}</td>
                      <td className="py-1 text-right font-medium">{formatCurrency(item.quantity * item.unit_price - item.discount_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-right text-[11px] text-slate-700 space-y-0.5">
                <p>Discount: {formatCurrency(items.reduce((sum, item) => sum + item.discount_value, 0))}</p>
                <p className="text-sm font-bold text-slate-900">Total: {formatCurrency(total)}</p>
                <p>Amount paid: {formatCurrency(paid)}</p>
                <p>Balance: {formatCurrency(total - paid)}</p>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Thank you for your business.</p>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-slate-50 p-4 text-center space-y-1">
          <p className="text-xs text-slate-400">Total ({items.length} item{items.length === 1 ? '' : 's'})</p>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(total)}</p>
          {items.length > 0 && (
            <p className={`text-sm font-medium ${change < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {change < 0 ? `Balance due: ${formatCurrency(Math.abs(change))}` : `Change: ${formatCurrency(change)}`}
            </p>
          )}
        </div>

        <Textarea label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional sale notes" />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={complete} disabled={saving || items.length === 0}>{saving ? 'Saving...' : `Complete Sale · ${formatCurrency(total)}`}</Button>
        </div>
      </div>
      )}
    </Modal>
  );
}