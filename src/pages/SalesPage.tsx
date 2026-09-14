import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase, useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import { hasRole, isAtLeast } from '@/lib/rbac';
import { SALE_STATUS_LABELS, SALE_STATUS_STYLES } from '@/lib/statusStyles';
import { useReceiptPDF } from '@/components/ReceiptPDF';
import type { Branch, DailySale, Product, SaleItem, UserProfile } from '@/types/database';

export function SalesPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const isExecutive = hasRole(user, 'super_admin');
  const businessLevel = isAtLeast(user, 'admin');
  const { downloadReceipt } = useReceiptPDF();
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
    <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-900">Sales</h2><p className="text-sm text-slate-500">Complete one transaction with one or more products.</p></div><Button onClick={() => setShowModal(true)}><Plus size={18} /> Record Sale</Button></div>
    <div className="grid grid-cols-2 gap-4"><Metric label="Completed sales" value={formatCurrency(completed)} /><Metric label="Transactions" value={String(filtered.length)} /></div>
    <div className="flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm" placeholder="Search customer or product..." value={search} onChange={(event) => setSearch(event.target.value)} /></label><Select className="sm:w-40" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{Object.entries(SALE_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>
    {filtered.length ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Sale</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3">Status</th><th /></tr></thead><tbody className="divide-y">{filtered.map((sale) => <tr key={sale.id}><td className="px-4 py-3 text-slate-500">{formatDate(sale.sale_date)}</td><td className="px-4 py-3"><p className="font-medium">{sale.items?.length ? `${sale.items.length} item${sale.items.length === 1 ? '' : 's'}` : sale.product?.name || 'Sale'}</p><p className="text-xs text-slate-400">{sale.customer_name || 'Walk-in'} · {sale.branch?.name || 'Branch'}</p></td><td className="px-3 py-3 text-right font-semibold">{formatCurrency(Number(sale.unit_price) * sale.quantity - Number(sale.discount_value))}</td><td className="px-3 py-3"><Badge className={SALE_STATUS_STYLES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge></td><td className="px-3 py-3"><button className="text-slate-400 hover:text-slate-900" title="Download receipt" onClick={() => downloadReceipt(sale.id)}><Receipt size={16} /></button></td></tr>)}</tbody></table></div></div> : <EmptyState icon={<DollarSign size={32} />} title="No sales recorded" description="Sales will appear here once completed." action={<Button onClick={() => setShowModal(true)}><Plus size={18} />Record Sale</Button>} />}
    {showModal && <SaleModal branches={branches ?? []} currentUser={user} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); refetch(); }} />}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p></div>; }
type CartItem = Omit<SaleItem, 'id' | 'sale_id' | 'created_at'> & { product: Product };
function SaleModal({ branches, currentUser, onClose, onSaved }: { branches: Branch[]; currentUser: UserProfile | null; onClose: () => void; onSaved: () => void }) {
  const canChooseBranch = currentUser?.role?.name === 'admin' || currentUser?.role?.name === 'super_admin';
  const [branchId, setBranchId] = useState(currentUser?.branch_id ?? ''); const [products, setProducts] = useState<Product[]>([]); const [productId, setProductId] = useState(''); const [quantity, setQuantity] = useState('1'); const [unitPrice, setUnitPrice] = useState('0'); const [discount, setDiscount] = useState('0'); const [items, setItems] = useState<CartItem[]>([]); const [customerName, setCustomerName] = useState(''); const [amountPaid, setAmountPaid] = useState('0'); const [paymentMethod, setPaymentMethod] = useState('cash'); const [notes, setNotes] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const branch = branches.find((candidate) => candidate.id === branchId);
  useEffect(() => { if (!branch) { setProducts([]); return; } supabase.from('products').select('*').eq('business_id', branch.business_id).eq('is_active', true).order('name').then(({ data }) => setProducts((data as Product[]) || [])); }, [branch?.id]);
  const selectProduct = (id: string) => { setProductId(id); const product = products.find((candidate) => candidate.id === id); if (product) setUnitPrice(String(product.selling_price)); };
  const addItem = () => { const product = products.find((candidate) => candidate.id === productId); if (!product || Number(quantity) <= 0 || Number(unitPrice) < 0) { setError('Select a product and use a valid quantity and price.'); return; } setItems((current) => [...current, { product, product_id: product.id, quantity: Number(quantity), unit_price: Number(unitPrice), discount_value: Number(discount) || 0 }]); setProductId(''); setQuantity('1'); setUnitPrice('0'); setDiscount('0'); setError(null); };
  const total = items.reduce((sum, item) => sum + item.quantity * item.unit_price - item.discount_value, 0);
  const complete = async () => { if (!branchId || !items.length) { setError('Select a branch and add at least one item.'); return; } setSaving(true); setError(null); const { error: rpcError } = await supabase.rpc('create_sale_with_items', { p_branch_id: branchId, p_customer_name: customerName || null, p_payment_method: paymentMethod, p_amount_paid: Number(amountPaid) || 0, p_notes: notes || null, p_items: items.map(({ product, ...item }) => item) }); setSaving(false); if (rpcError) { setError(rpcError.message); return; } onSaved(); };
  return <Modal open onClose={onClose} title="Record Sale" size="lg"><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Select label="Branch" value={branchId} disabled={!canChooseBranch} onChange={(event) => { setBranchId(event.target.value); setItems([]); }}><option value="">Select branch...</option>{branches.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</Select><Input label="Customer" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Walk-in customer" /></div><div className="rounded-xl border p-4"><p className="mb-3 text-sm font-semibold">Add item</p><div className="grid gap-3 sm:grid-cols-4"><Select value={productId} onChange={(event) => selectProduct(event.target.value)}><option value="">Product...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select><Input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Qty" /><Input type="number" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="Price" /><Button variant="outline" onClick={addItem}>Add</Button></div><Input className="mt-3" label="Item discount (NGN)" type="number" value={discount} onChange={(event) => setDiscount(event.target.value)} /></div>{items.length > 0 && <div className="divide-y rounded-xl border">{items.map((item, index) => <div className="flex items-center justify-between gap-3 p-3 text-sm" key={`${item.product_id}-${index}`}><span>{item.product.name} <span className="text-slate-400">× {item.quantity}</span></span><span className="font-medium">{formatCurrency(item.quantity * item.unit_price - item.discount_value)}</span><button className="text-rose-500" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} aria-label="Remove item"><Trash2 size={16} /></button></div>)}</div>}<div className="grid gap-4 sm:grid-cols-2"><Select label="Payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="transfer">Bank transfer</option><option value="pos">POS</option><option value="credit">Credit</option></Select><Input label="Amount paid (NGN)" type="number" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} /></div><div className="rounded-xl bg-slate-50 p-4 text-center"><p className="text-xs text-slate-400">Total</p><p className="text-xl font-bold">{formatCurrency(total)}</p></div><Textarea label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional sale notes" />{error && <p className="text-sm text-rose-600">{error}</p>}<div className="flex justify-end gap-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={complete} disabled={saving}>{saving ? 'Saving...' : 'Complete Sale'}</Button></div></div></Modal>;
}
