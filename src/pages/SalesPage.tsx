import { useState, useMemo } from 'react';
import { DollarSign, Plus, Search, Receipt } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import { SALE_STATUS_STYLES, SALE_STATUS_LABELS } from '@/lib/statusStyles';
import type { DailySale, Branch, Product } from '@/types/database';

export function SalesPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DailySale | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [search, setSearch] = useState('');

  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const salesQuery = useMemo(() => {
    let q = supabase
      .from('daily_sales')
      .select(`*, product:products(*), branch:branches(*), salesperson:user_profiles!salesperson_id(full_name)`)
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (!isExecutive && isBusinessLevel && user?.business_id) q = q.eq('business_id', user.business_id);
    else if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    return q;
  }, [isExecutive, isBusinessLevel, user, filterBranch, filterStatus]);

  const { data: sales, loading, error, refetch } = useSupabaseQuery<DailySale[]>(() => salesQuery, [salesQuery]);

  const filtered = useMemo(() => {
    if (!sales) return [];
    if (!search) return sales;
    const q = search.toLowerCase();
    return sales.filter((s) => (s.customer_name?.toLowerCase().includes(q) ?? false) || (s.product as unknown as Product)?.name?.toLowerCase().includes(q));
  }, [sales, search]);

  const totalCompleted = filtered.filter(s=>s.status==='completed').reduce((sum,s)=> sum + Number(s.unit_price)*s.quantity - Number(s.discount_value),0);
  const totalPending = filtered.filter(s=>s.status==='pending').reduce((sum,s)=> sum + Number(s.unit_price)*s.quantity - Number(s.discount_value) - Number(s.amount_paid),0);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load sales." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Daily Sales</h2>
          <p className="text-sm text-slate-500 mt-0.5">Record daily transactions — rolls up into weekly reports automatically.</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowModal(true); }}><Plus size={18} /> Record Sale</Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400">Total Completed (filtered)</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(totalCompleted)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400">Outstanding (Pending)</p>
          <p className="text-xl font-bold text-amber-600 mt-1">{formatCurrency(totalPending)}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search customer or product..." value={search} onChange={(e)=>setSearch(e.target.value)} className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
        </div>
        <Select value={filterStatus} onChange={(e)=>setFilterStatus(e.target.value)} className="sm:w-36">
          <option value="all">All Statuses</option>
          {Object.entries(SALE_STATUS_LABELS).map(([k,v])=> <option key={k} value={k}>{v}</option>)}
        </Select>
        {isBusinessLevel && (
          <Select value={filterBranch} onChange={(e)=>setFilterBranch(e.target.value)} className="sm:w-40">
            <option value="all">All Branches</option>
            {branches?.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length>0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-xs text-slate-500">
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Product / Customer</th>
                  <th className="text-right px-3 py-3">Qty × Price</th>
                  <th className="text-right px-3 py-3">Total</th>
                  <th className="text-right px-3 py-3">Paid</th>
                  <th className="text-left px-3 py-3">Status</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((s)=>{
                  const prod = s.product as unknown as Product;
                  const total = Number(s.unit_price)*s.quantity - Number(s.discount_value);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-xs text-slate-400">{formatDate(s.sale_date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{prod?.name ?? '—'}</p>
                        <p className="text-xs text-slate-400">{s.customer_name ?? 'Walk-in'} {s.branch && `· ${(s.branch as unknown as Branch).name}`}</p>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">{s.quantity} × {formatCurrency(Number(s.unit_price))}{Number(s.discount_value)>0 && <span className="text-rose-500 text-xs"> -{formatCurrency(Number(s.discount_value))}</span>}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatCurrency(total)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{formatCurrency(Number(s.amount_paid))}</td>
                      <td className="px-3 py-3"><Badge className={SALE_STATUS_STYLES[s.status]}>{SALE_STATUS_LABELS[s.status]}</Badge></td>
                      <td className="px-3 py-3">
                        <button onClick={()=>{setEditing(s); setShowModal(true);}} className="p-1 rounded hover:bg-slate-100 text-slate-400"><Receipt size={14}/></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState icon={<DollarSign size={32} />} title="No sales recorded" description="Daily sales feed branch totals and weekly reports." action={<Button onClick={()=>setShowModal(true)}><Plus size={18}/>Record Sale</Button>} />
      )}

      {showModal && <SaleModal sale={editing} branches={branches ?? []} currentUser={user} onClose={()=>{setShowModal(false); setEditing(null);}} onSaved={()=>{refetch(); setShowModal(false); setEditing(null);}} />}
    </div>
  );
}

function SaleModal({ sale, branches, currentUser, onClose, onSaved }: { sale: DailySale | null; branches: Branch[]; currentUser: { id: string; role?: { name: string }; business_id: string | null; branch_id: string | null } | null; onClose: ()=>void; onSaved: ()=>void }) {
  const isManager = currentUser?.role?.name === 'manager' || currentUser?.role?.name === 'sales_person';
  const [branchId, setBranchId] = useState(sale?.branch_id ?? currentUser?.branch_id ?? '');
  const [productId, setProductId] = useState(sale?.product_id ?? '');
  const [products, setProducts] = useState<Product[]>([]);
  const [customerName, setCustomerName] = useState(sale?.customer_name ?? '');
  const [quantity, setQuantity] = useState(sale?.quantity?.toString() ?? '1');
  const [unitPrice, setUnitPrice] = useState(sale?.unit_price?.toString() ?? '0');
  const [discount, setDiscount] = useState(sale?.discount_value?.toString() ?? '0');
  const [amountPaid, setAmountPaid] = useState(sale?.amount_paid?.toString() ?? '0');
  const [saleDate, setSaleDate] = useState(sale?.sale_date ?? new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState(sale?.status ?? 'completed');
  const [notes, setNotes] = useState(sale?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string|null>(null);

  const selectedBranch = branches.find(b=>b.id===branchId);

  // load products for branch business
  const loadProducts = async (bizId: string) => {
    const { data } = await supabase.from('products').select('*').eq('is_active', true).eq('business_id', bizId).order('name');
    setProducts((data as Product[]) ?? []);
  };
  if (selectedBranch && products.length===0) { loadProducts(selectedBranch.business_id); }

  const handleBranchChange = (bid: string) => {
    setBranchId(bid); setProductId('');
    const br = branches.find(b=>b.id===bid);
    if (br) loadProducts(br.business_id);
  };

  const handleSave = async () => {
    if (!branchId || !quantity || Number(quantity)<=0) { setError('Branch and valid quantity are required'); return; }
    if (!selectedBranch) { setError('Invalid branch'); return; }
    setSaving(true); setError(null);
    const payload = {
      business_id: selectedBranch.business_id, branch_id: branchId, product_id: productId || null,
      customer_name: customerName.trim() || null, quantity: Number(quantity), unit_price: Number(unitPrice||0),
      discount_value: Number(discount||0), amount_paid: Number(amountPaid||0), sale_date: saleDate,
      status, notes: notes.trim() || null, salesperson_id: currentUser?.id,
    };
    let err;
    if (sale) { const r = await supabase.from('daily_sales').update(payload).eq('id', sale.id); err = r.error; }
    else { const r = await supabase.from('daily_sales').insert(payload); err = r.error; }
    if (err) { setError(err.message); setSaving(false); return; }
    // optional: write inventory movement for completed sales (stock out)
    if (productId && (status==='completed')) {
      await supabase.rpc('record_inventory_movement', { p_product_id: productId, p_branch_id: branchId, p_movement_type: 'sale', p_quantity: Number(quantity), p_reason: `Sale ${customerName || ''}`.trim() || 'Daily sale', p_reference_type: 'daily_sale', p_reference_id: null });
    }
    setSaving(false); onSaved();
  };

  const total = Number(unitPrice||0)*Number(quantity||0) - Number(discount||0);
  const balance = total - Number(amountPaid||0);

  return (
    <Modal open onClose={onClose} title={sale ? 'Edit Sale' : 'Record Daily Sale'} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Branch" value={branchId} onChange={(e)=>handleBranchChange(e.target.value)} disabled={isManager}>
            <option value="">Select...</option>
            {branches.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Product" value={productId} onChange={(e)=>setProductId(e.target.value)}>
            <option value="">Select product...</option>
            {products.map((p)=><option key={p.id} value={p.id}>{p.name}{p.sku?` (${p.sku})`:''}</option>)}
          </Select>
          <Input label="Customer Name" value={customerName} onChange={(e)=>setCustomerName(e.target.value)} placeholder="Walk-in / customer name" />
          <Input label="Sale Date" type="date" value={saleDate} onChange={(e)=>setSaleDate(e.target.value)} />
          <Input label="Quantity" type="number" value={quantity} onChange={(e)=>setQuantity(e.target.value)} />
          <Input label="Unit Price (NGN)" type="number" value={unitPrice} onChange={(e)=>setUnitPrice(e.target.value)} />
          <Input label="Discount (NGN)" type="number" value={discount} onChange={(e)=>setDiscount(e.target.value)} />
          <Input label="Amount Paid (NGN)" type="number" value={amountPaid} onChange={(e)=>setAmountPaid(e.target.value)} />
          <Select label="Status" value={status} onChange={(e)=>setStatus(e.target.value as typeof status)}>
            {Object.entries(SALE_STATUS_LABELS).map(([k,v])=> <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
          <div><p className="text-xs text-slate-400">Total</p><p className="font-bold text-slate-900">{formatCurrency(total)}</p></div>
          <div><p className="text-xs text-slate-400">Paid</p><p className="font-bold text-emerald-600">{formatCurrency(Number(amountPaid||0))}</p></div>
          <div><p className="text-xs text-slate-400">Balance</p><p className={`font-bold ${balance>0?'text-amber-600':'text-slate-900'}`}>{formatCurrency(balance)}</p></div>
        </div>
        <Textarea label="Notes" value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Payment method, delivery, etc."/>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save Sale'}</Button>
        </div>
      </div>
    </Modal>
  );
}
