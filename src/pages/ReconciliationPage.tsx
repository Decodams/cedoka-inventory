import { useState, useMemo, useCallback } from 'react';
import { ClipboardCheck, Plus, AlertTriangle, Search, History, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatNumber, formatDate, getWeekStart, getWeekEnd, toDateString } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import { PERIOD_STATUS_STYLES, PERIOD_STATUS_LABELS, VARIANCE_STATUS_STYLES } from '@/lib/statusStyles';
import type { InventoryPeriod, InventoryPeriodLine, StockVariance, Branch, Product, Business } from '@/types/database';

/* ——— Main Page ——— */
export function ReconciliationPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const [selectedPeriod, setSelectedPeriod] = useState<InventoryPeriod | null>(null);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [filterBranch, setFilterBranch] = useState('all');

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const periodsQuery = useMemo(() => {
    let q = supabase
      .from('inventory_periods')
      .select(`*, branch:branches(*), business:businesses(*)`)
      .order('period_end', { ascending: false })
      .limit(60);
    if (!isExecutive && !isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (!isExecutive && isBusinessLevel && user?.business_id) q = q.eq('business_id', user.business_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    return q;
  }, [isExecutive, isBusinessLevel, user, filterBranch]);

  const { data: periods, loading, error, refetch } = useSupabaseQuery<InventoryPeriod[]>(() => periodsQuery, [periodsQuery]);

  if (selectedPeriod) {
    return (
      <PeriodDetailView
        period={selectedPeriod}
        onBack={() => { setSelectedPeriod(null); refetch(); }}
        onRefresh={refetch}
      />
    );
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load reconciliation periods." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Stock Reconciliation</h2>
          <p className="text-sm text-slate-500 mt-0.5">Weekly product-level reconciliation · Expected vs physical count · Variance tracking</p>
        </div>
        {canManage && <Button onClick={() => setShowPeriodModal(true)}><Plus size={18} /> New Period</Button>}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs font-medium text-blue-700">Formula per product:</p>
        <p className="text-xs text-blue-600 mt-1">Opening + Received + Transfers In + Authorized Additions − Sales/Issues − Transfers Out − Damages − Returns/Deductions ± Adjustments = <span className="font-semibold">Expected Closing</span> · compare with physical count → variance</p>
      </div>

      {isBusinessLevel && (
        <Select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="w-56">
          <option value="all">All Branches</option>
          {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      )}

      {periods && periods.length > 0 ? (
        <div className="space-y-3">
          {periods.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 cursor-pointer" onClick={() => setSelectedPeriod(p)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{(p.branch as unknown as Branch)?.name ?? p.branch_id.slice(0, 8)}</h3>
                    <Badge className={PERIOD_STATUS_STYLES[p.status]}>{PERIOD_STATUS_LABELS[p.status]}</Badge>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{formatDate(p.period_start)} – {formatDate(p.period_end)} · {(p.business as unknown as Business)?.name ?? ''}</p>
                </div>
                <span className="text-xs text-slate-400">{formatDate(p.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<ClipboardCheck size={32} />} title="No reconciliation periods" description="Create a weekly period to reconcile stock per-product and track variances." action={canManage && <Button onClick={() => setShowPeriodModal(true)}><Plus size={18} /> New Period</Button>} />
      )}

      {showPeriodModal && (
        <NewPeriodModal branches={branches ?? []} currentUser={user} onClose={() => setShowPeriodModal(false)} onSaved={() => { refetch(); setShowPeriodModal(false); }} />
      )}
    </div>
  );
}

/* ——— New Period Modal ——— */
function NewPeriodModal({ branches, currentUser, onClose, onSaved }: { branches: Branch[]; currentUser: { id: string; role?: { name: string }; business_id: string | null; branch_id: string | null } | null; onClose: () => void; onSaved: () => void; }) {
  const isManager = currentUser?.role?.name === 'manager' || currentUser?.role?.name === 'sales_person';
  const [branchId, setBranchId] = useState(currentUser?.branch_id ?? '');
  const [periodEnd, setPeriodEnd] = useState(toDateString(getWeekEnd(new Date())));
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetch products for selected branch business
  // load products when branch changes
  const loadProducts = useCallback(async (bizId: string) => {
    const { data } = await supabase.from('products').select('*').eq('is_active', true).eq('business_id', bizId).order('name');
    setProducts((data as Product[]) ?? []);
  }, []);

  const handleBranchChange = (bid: string) => {
    setBranchId(bid);
    const br = branches.find((b) => b.id === bid);
    if (br) loadProducts(br.business_id);
  };

  const handleCreate = async () => {
    if (!branchId) { setError('Select a branch'); return; }
    const br = branches.find((b) => b.id === branchId);
    if (!br) { setError('Invalid branch'); return; }
    setSaving(true); setError(null);
    const ws = toDateString(getWeekStart(new Date(periodEnd)));
    const we = periodEnd;
    // derive business_id from branch
    // check duplicate
    const { data: existing } = await supabase.from('inventory_periods').select('id').eq('branch_id', branchId).eq('period_end', we).maybeSingle();
    if (existing) { setError('A period already exists for this branch/week'); setSaving(false); return; }

    const { data: period, error: e } = await supabase.from('inventory_periods').insert({
      business_id: br.business_id, branch_id: branchId, period_start: ws, period_end: we, status: 'open',
    }).select().single();
    if (e || !period) { setError('Could not create period. ' + (e?.message ?? '')); setSaving(false); return; }

    // auto-create lines: derive opening from last approved period's physical closing or current inventory_balances
    const bizProducts = products.length ? products : (await supabase.from('products').select('*').eq('is_active', true).eq('business_id', br.business_id).then(r=>r.data as Product[] ?? []));
    // fetch prior period lines for auto-opening
    const { data: priorPeriod } = await supabase.from('inventory_periods').select('id').eq('branch_id', branchId).neq('id', period.id).order('period_end', {ascending:false}).limit(1).maybeSingle();
    const priorLines: Record<string, number> = {};
    if (priorPeriod) {
      const { data: lines } = await supabase.from('inventory_period_lines').select('product_id, physical_closing_quantity, expected_closing_quantity').eq('period_id', priorPeriod.id);
      lines?.forEach((l: {product_id:string; physical_closing_quantity:number|null; expected_closing_quantity:number}) => { priorLines[l.product_id] = l.physical_closing_quantity ?? l.expected_closing_quantity; });
    }
    // also fetch current balances as fallback
    const { data: balances } = await supabase.from('inventory_balances').select('product_id, current_stock').eq('branch_id', branchId);
    const balanceMap: Record<string, number> = {}; balances?.forEach((b: {product_id:string; current_stock:number})=> balanceMap[b.product_id]=b.current_stock);

    const linesToInsert = bizProducts.map((p) => ({
      period_id: period.id, product_id: p.id,
      opening_quantity: priorLines[p.id] ?? balanceMap[p.id] ?? 0,
    }));
    if (linesToInsert.length) {
      await supabase.from('inventory_period_lines').insert(linesToInsert);
    }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title="New Reconciliation Period" size="md">
      <div className="space-y-4">
        <Select label="Branch" value={branchId} onChange={(e) => handleBranchChange(e.target.value)} disabled={isManager}>
          <option value="">Select a branch...</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Week Ending (Saturday)" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        <p className="text-xs text-slate-400">Week start will be auto-derived as Sunday. Opening stock per product is carried forward from the prior approved period.</p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create Period'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ——— Period Detail ——— */
function PeriodDetailView({ period, onBack, onRefresh }: { period: InventoryPeriod; onBack: () => void; onRefresh: () => void; }) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showVarianceModal, setShowVarianceModal] = useState<InventoryPeriodLine | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const canManage = isAtLeast(user, 'manager');
  const canApprove = isAtLeast(user, 'admin');

  const { data: lines, loading, error, refetch } = useSupabaseQuery<InventoryPeriodLine[]>(
    () => supabase.from('inventory_period_lines').select(`*, product:products(*)`)
      .eq('period_id', period.id).order('product:products(name)'),
    [period.id],
  );

  const { data: variances } = useSupabaseQuery<StockVariance[]>(
    () => supabase.from('stock_variances').select(`*, product:products(*), branch:branches(*)`).in('period_line_id', (lines?.map(l=>l.id) ?? ['00000000-0000-0000-0000-000000000000'])).order('created_at', {ascending:false}),
    [lines?.map(l=>l.id).join(',')],
  );

  const filtered = useMemo(() => {
    if (!lines) return [];
    if (!search) return lines;
    const q = search.toLowerCase();
    return lines.filter((l) => (l.product as unknown as Product)?.name?.toLowerCase().includes(q) || (l.product as unknown as Product)?.sku?.toLowerCase().includes(q));
  }, [lines, search]);

  const pendingVariances = variances?.filter(v=>v.approval_status==='pending') ?? [];
  const totalVarianceQty = variances?.reduce((s,v)=> s+Math.abs(v.variance_quantity),0) ?? 0;

  const handleStatusChange = async (status: string) => {
    await supabase.from('inventory_periods').update({ status, approved_by: status==='approved'?user?.id:null, approved_at: status==='approved'?new Date().toISOString():null }).eq('id', period.id);
    onRefresh(); onBack();
  };

  const handleLineUpdate = async (line: InventoryPeriodLine, patch: Partial<InventoryPeriodLine>) => {
    await supabase.from('inventory_period_lines').update(patch).eq('id', line.id);
    refetch();
  };

  const handleCount = async (line: InventoryPeriodLine, val: number) => {
    await supabase.from('inventory_period_lines').update({ physical_closing_quantity: val, counted_by: user?.id, counted_at: new Date().toISOString() }).eq('id', line.id);
    // auto-create variance if mismatch
    const expected = line.expected_closing_quantity;
    const diff = val - expected;
    if (diff !== 0) {
      const existing = variances?.find(v=>v.period_line_id===line.id);
      if (!existing) {
        await supabase.from('stock_variances').insert({
          period_line_id: line.id, branch_id: period.branch_id, product_id: line.product_id,
          variance_quantity: diff, requires_management_attention: Math.abs(diff) > 5,
          created_by: user?.id,
        });
      }
    }
    refetch();
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load period details." onRetry={refetch} />;

  const isLocked = period.status === 'approved';

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">← Back to Reconciliation</button>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{formatDate(period.period_start)} – {formatDate(period.period_end)}</h2>
              <Badge className={PERIOD_STATUS_STYLES[period.status]}>{PERIOD_STATUS_LABELS[period.status]}</Badge>
            </div>
            <p className="text-sm text-slate-400 mt-1">{(period.branch as unknown as Branch)?.name} · {(period.business as unknown as Business)?.name}</p>
          </div>
          <div className="flex gap-2">
            {period.status === 'open' && canManage && <Button size="sm" onClick={()=>handleStatusChange('submitted')}>Submit for Approval</Button>}
            {period.status === 'submitted' && canApprove && <><Button size="sm" onClick={()=>handleStatusChange('approved')}><CheckCircle size={14}/>Approve</Button><Button variant="outline" size="sm" onClick={()=>handleStatusChange('open')}>Reopen</Button></>}
            {period.status === 'approved' && canApprove && <Button variant="outline" size="sm" onClick={()=>handleStatusChange('amended')}>Amend</Button>}
          </div>
        </div>
        {(variances?.length ?? 0) > 0 && (
          <div className="mt-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertTriangle size={16} className="text-amber-600"/>
            <span className="text-sm text-amber-700">{variances?.length} variance(s) detected — total absolute variance {formatNumber(totalVarianceQty)} · {pendingVariances.length} pending approval</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input placeholder="Search product..." value={search} onChange={(e)=>setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"/>
        </div>
        {canManage && !isLocked && <Button variant="outline" size="sm" onClick={()=>setShowAddProduct(true)}><Plus size={14}/>Add Product Line</Button>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-xs text-slate-500">
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-right px-2 py-3">Opening</th>
                <th className="text-right px-2 py-3">Received</th>
                <th className="text-right px-2 py-3">In (Tfr)</th>
                <th className="text-right px-2 py-3 hidden md:table-cell">Additions</th>
                <th className="text-right px-2 py-3">Sales/Issues</th>
                <th className="text-right px-2 py-3">Out (Tfr)</th>
                <th className="text-right px-2 py-3">Damage</th>
                <th className="text-right px-2 py-3 hidden md:table-cell">Returns</th>
                <th className="text-right px-2 py-3 hidden lg:table-cell">Adj.</th>
                <th className="text-right px-3 py-3 bg-slate-100">Expected</th>
                <th className="text-right px-3 py-3">Physical</th>
                <th className="text-right px-3 py-3">Variance</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((l) => {
                const prod = l.product as unknown as Product;
                const variance = l.physical_closing_quantity !== null ? l.physical_closing_quantity - l.expected_closing_quantity : null;
                const hasVariance = variance !== null && variance !== 0;
                return (
                  <tr key={l.id} className={`hover:bg-slate-50/50 ${hasVariance ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900 truncate max-w-[150px]">{prod?.name}</p>
                      {prod?.sku && <p className="text-xs text-slate-400">{prod.sku}</p>}
                    </td>
                    <td className="text-right px-2"><EditableCell value={l.opening_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{opening_quantity:v})}/></td>
                    <td className="text-right px-2"><EditableCell value={l.received_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{received_quantity:v})}/></td>
                    <td className="text-right px-2"><EditableCell value={l.transfer_in_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{transfer_in_quantity:v})}/></td>
                    <td className="text-right px-2 hidden md:table-cell"><EditableCell value={l.authorized_additions_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{authorized_additions_quantity:v})}/></td>
                    <td className="text-right px-2"><EditableCell value={l.sales_issues_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{sales_issues_quantity:v})}/></td>
                    <td className="text-right px-2"><EditableCell value={l.transfer_out_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{transfer_out_quantity:v})}/></td>
                    <td className="text-right px-2"><EditableCell value={l.damage_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{damage_quantity:v})}/></td>
                    <td className="text-right px-2 hidden md:table-cell"><EditableCell value={l.returns_deductions_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{returns_deductions_quantity:v})}/></td>
                    <td className="text-right px-2 hidden lg:table-cell"><EditableCell value={l.adjustment_quantity} disabled={isLocked} onSave={(v)=>handleLineUpdate(l,{adjustment_quantity:v})}/></td>
                    <td className="text-right px-3 font-semibold bg-slate-50">{formatNumber(l.expected_closing_quantity)}</td>
                    <td className="text-right px-3">
                      <EditableCell value={l.physical_closing_quantity} placeholder="Count..." disabled={isLocked} onSave={(v)=>handleCount(l, v)} />
                    </td>
                    <td className="text-right px-3">
                      {variance === null ? <span className="text-slate-300">—</span> :
                        <span className={`font-bold ${hasVariance ? (variance! < 0 ? 'text-rose-600' : 'text-emerald-600') : 'text-slate-600'}`}>
                          {variance! > 0 ? '+' : ''}{formatNumber(variance!)}
                        </span>}
                    </td>
                    <td className="px-2">
                      {hasVariance && <button onClick={()=>setShowVarianceModal(l)} className="p-1 rounded hover:bg-amber-100 text-amber-600"><AlertTriangle size={14}/></button>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length===0 && <tr><td colSpan={14} className="text-center py-10 text-slate-400">No product lines. Add products to this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {variances && variances.length>0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><History size={16}/> Variances ({variances.length})</h3>
          <div className="space-y-2">
            {variances.map((v)=>(
              <div key={v.id} className="flex items-center justify-between border border-slate-100 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{(v.product as unknown as Product)?.name} · <span className={`font-bold ${v.variance_quantity<0?'text-rose-600':'text-emerald-600'}`}>{v.variance_quantity>0?'+':''}{formatNumber(v.variance_quantity)}</span></p>
                  <p className="text-xs text-slate-400">{v.possible_reason ?? v.explanation ?? 'No reason recorded'}{v.requires_management_attention && ' · ⚠ Requires Management Attention'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={VARIANCE_STATUS_STYLES[v.approval_status]}>{v.approval_status}</Badge>
                  {v.approval_status==='pending' && canApprove && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={async()=>{await supabase.from('stock_variances').update({approval_status:'approved', approved_by:user?.id, approved_at:new Date().toISOString()}).eq('id',v.id); refetch();}}><CheckCircle size={14}/>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={async()=>{await supabase.from('stock_variances').update({approval_status:'rejected', approved_by:user?.id, approved_at:new Date().toISOString()}).eq('id',v.id); refetch();}}><XCircle size={14}/>Reject</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showVarianceModal && (
        <VarianceDetailModal line={showVarianceModal} variance={variances?.find(v=>v.period_line_id===showVarianceModal.id) ?? null} onClose={()=>setShowVarianceModal(null)} onSaved={()=>{refetch(); setShowVarianceModal(null);}}/>
      )}
      {showAddProduct && <AddProductLineModal period={period} existingIds={lines?.map(l=>l.product_id) ?? []} onClose={()=>setShowAddProduct(false)} onSaved={()=>{refetch(); setShowAddProduct(false);}}/>}
    </div>
  );
}

function EditableCell({ value, disabled, placeholder, onSave }: { value: number|null; disabled?: boolean; placeholder?: string; onSave: (v:number)=>void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value?.toString() ?? '');
  if (disabled) return <span className="text-slate-700">{value===null ? '—' : formatNumber(value)}</span>;
  if (!editing) return <button onClick={()=>{setVal(value?.toString()??''); setEditing(true);}} className="w-full text-right py-1 px-1.5 rounded hover:bg-white border border-transparent hover:border-slate-200">{value===null ? <span className="text-slate-300 text-xs">{placeholder ?? '—'}</span> : formatNumber(value)}</button>;
  return (
    <input autoFocus value={val} onChange={(e)=>setVal(e.target.value)} onBlur={()=>{const n=Number(val); if(!isNaN(n)){onSave(n);} setEditing(false);}} onKeyDown={(e)=>{if(e.key==='Enter'){const n=Number(val); if(!isNaN(n)) onSave(n); setEditing(false);} if(e.key==='Escape') setEditing(false);}} className="w-16 text-right border border-slate-300 rounded px-1.5 py-1 text-sm outline-none focus:border-slate-900" type="number"/>
  );
}

function VarianceDetailModal({ line, variance, onClose, onSaved }: { line: InventoryPeriodLine; variance: StockVariance | null; onClose: ()=>void; onSaved: ()=>void }) {
  const [reason, setReason] = useState(variance?.possible_reason ?? '');
  const [explanation, setExplanation] = useState(variance?.explanation ?? '');
  const [evidence, setEvidence] = useState(variance?.supporting_evidence ?? '');
  const [requiresAttention, setRequiresAttention] = useState(variance?.requires_management_attention ?? Math.abs(variance?.variance_quantity ?? 0) > 5);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    if (variance) {
      await supabase.from('stock_variances').update({ possible_reason: reason || null, explanation: explanation || null, supporting_evidence: evidence || null, requires_management_attention: requiresAttention }).eq('id', variance.id);
    }
    setSaving(false); onSaved();
  };
  const prod = line.product as unknown as Product;
  const expected = line.expected_closing_quantity;
  const physical = line.physical_closing_quantity;
  const diff = physical!==null ? physical - expected : 0;

  return (
    <Modal open onClose={onClose} title={`Variance — ${prod?.name ?? 'Product'}`} size="md">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
          <div><p className="text-xs text-slate-500">Expected</p><p className="text-lg font-bold text-slate-900">{formatNumber(expected)}</p></div>
          <div><p className="text-xs text-slate-500">Physical</p><p className="text-lg font-bold text-slate-900">{physical===null?'—':formatNumber(physical)}</p></div>
          <div><p className="text-xs text-slate-500">Variance</p><p className={`text-lg font-bold ${diff<0?'text-rose-600':'text-emerald-600'}`}>{diff>0?'+':''}{formatNumber(diff)}</p></div>
        </div>
        <Input label="Possible Reason" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="e.g. breakage, theft, miscount"/>
        <Textarea label="Explanation" value={explanation} onChange={(e)=>setExplanation(e.target.value)} placeholder="Detailed explanation..."/>
        <Textarea label="Supporting Evidence" value={evidence} onChange={(e)=>setEvidence(e.target.value)} placeholder="Photos, documents, references..."/>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={requiresAttention} onChange={(e)=>setRequiresAttention(e.target.checked)} className="rounded border-slate-300"/>
          <AlertTriangle size={14} className="text-amber-600"/> Requires Management Attention (auto-escalated if absolute variance &gt; 5)
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function AddProductLineModal({ period, existingIds, onClose, onSaved }: { period: InventoryPeriod; existingIds: string[]; onClose: ()=>void; onSaved: ()=>void }) {
  const [productId, setProductId] = useState('');
  const [opening, setOpening] = useState('0');
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);

  // load products for business
  useState(() => {
    supabase.from('products').select('*').eq('is_active', true).eq('business_id', period.business_id).order('name').then(({data})=> setProducts((data as Product[]) ?? []));
  });

  // useEffect pattern without hook import side effect - do via query hook alternative
  // Actually just query inside
  const available = products.filter(p=> !existingIds.includes(p.id));

  const handleAdd = async () => {
    if (!productId) return;
    setSaving(true);
    await supabase.from('inventory_period_lines').insert({ period_id: period.id, product_id: productId, opening_quantity: Number(opening||0) });
    setSaving(false); onSaved();
  };

  // lazy load
  if (products.length===0) {
    supabase.from('products').select('*').eq('is_active', true).eq('business_id', period.business_id).order('name').then(({data})=> { if(data && products.length===0) setProducts(data as Product[]); });
  }

  return (
    <Modal open onClose={onClose} title="Add Product Line" size="md">
      <div className="space-y-4">
        <Select label="Product" value={productId} onChange={(e)=>setProductId(e.target.value)}>
          <option value="">Select product...</option>
          {available.map((p)=><option key={p.id} value={p.id}>{p.name}{p.sku?` (${p.sku})`:''}</option>)}
        </Select>
        <Input label="Opening Quantity" type="number" value={opening} onChange={(e)=>setOpening(e.target.value)}/>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd} disabled={saving || !productId}>{saving?'Adding...':'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}
