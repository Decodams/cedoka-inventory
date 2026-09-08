import { useState, useMemo } from 'react';
import { Wallet, Plus, Search, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import { EXPENSE_STATUS_STYLES, EXPENSE_STATUS_LABELS } from '@/lib/statusStyles';
import type { OperationalExpense, Branch } from '@/types/database';

const EXPENSE_CATEGORIES = ['logistics','repairs','petty_cash','operational','utilities','rent','other'];

export function ExpensesPage() {
  const { user } = useAuth();
  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [search, setSearch] = useState('');

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const expensesQuery = useMemo(() => {
    let q = supabase
      .from('operational_expenses')
      .select(`*, branch:branches(*), business:businesses(*)`)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (!isExecutive && isBusinessLevel && user?.business_id) q = q.eq('business_id', user.business_id);
    else if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    if (filterCategory !== 'all') q = q.eq('category', filterCategory);
    return q;
  }, [isExecutive, isBusinessLevel, user, filterBranch, filterStatus, filterCategory]);

  const { data: expenses, loading, error, refetch } = useSupabaseQuery<OperationalExpense[]>(() => expensesQuery, [expensesQuery]);

  const filtered = useMemo(() => {
    if (!expenses) return [];
    if (!search) return expenses;
    const q = search.toLowerCase();
    return expenses.filter((e) => e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q));
  }, [expenses, search]);

  const totalApproved = filtered.filter(e=>e.status==='approved').reduce((s,e)=>s+Number(e.amount),0);
  const totalPending = filtered.filter(e=>e.status==='recorded').reduce((s,e)=>s+Number(e.amount),0);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load expenses." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Operational Expenses</h2>
          <p className="text-sm text-slate-500 mt-0.5">Track logistics, repairs, petty cash, and other operational costs.</p>
        </div>
        <Button onClick={()=>setShowModal(true)}><Plus size={18}/>Record Expense</Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400">Pending Approval</p>
          <p className="text-xl font-bold text-amber-600 mt-1">{formatCurrency(totalPending)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400">Approved (filtered)</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(totalApproved)}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input placeholder="Search description or category..." value={search} onChange={(e)=>setSearch(e.target.value)} className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
        </div>
        <Select value={filterCategory} onChange={(e)=>setFilterCategory(e.target.value)} className="lg:w-40">
          <option value="all">All Categories</option>
          {EXPENSE_CATEGORIES.map((c)=><option key={c} value={c}>{c.replace('_',' ')}</option>)}
        </Select>
        <Select value={filterStatus} onChange={(e)=>setFilterStatus(e.target.value)} className="lg:w-36">
          <option value="all">All Statuses</option>
          {Object.entries(EXPENSE_STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </Select>
        {isBusinessLevel && (
          <Select value={filterBranch} onChange={(e)=>setFilterBranch(e.target.value)} className="lg:w-40">
            <option value="all">All Branches</option>
            {branches?.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length>0 ? (
        <div className="space-y-3">
          {filtered.map((e)=>(
            <div key={e.id} className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><Wallet size={20}/></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900">{formatCurrency(Number(e.amount))}</h3>
                      <Badge className="bg-slate-100 text-slate-600 border-slate-200 capitalize">{e.category.replace('_',' ')}</Badge>
                      <Badge className={EXPENSE_STATUS_STYLES[e.status]}>{EXPENSE_STATUS_LABELS[e.status]}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{e.description}</p>
                    <p className="text-xs text-slate-400 mt-1">{formatDate(e.expense_date)} · {(e.branch as unknown as Branch)?.name}</p>
                  </div>
                </div>
                {isAtLeast(user,'admin') && e.status==='recorded' && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={async()=>{await supabase.from('operational_expenses').update({status:'approved', approved_by:user?.id}).eq('id',e.id); refetch();}}><CheckCircle size={14}/>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={async()=>{await supabase.from('operational_expenses').update({status:'rejected', approved_by:user?.id}).eq('id',e.id); refetch();}}><XCircle size={14}/>Reject</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Wallet size={32}/>} title="No expenses recorded" description="Operational costs appear here and can be approved by managers." action={<Button onClick={()=>setShowModal(true)}><Plus size={18}/>Record Expense</Button>} />
      )}

      {showModal && <ExpenseModal branches={branches ?? []} currentUser={user} onClose={()=>setShowModal(false)} onSaved={()=>{refetch(); setShowModal(false);}}/>}
    </div>
  );
}

function ExpenseModal({ branches, currentUser, onClose, onSaved }: { branches: Branch[]; currentUser: { id: string; role?: { name: string }; business_id: string | null; branch_id: string | null } | null; onClose: ()=>void; onSaved: ()=>void }) {
  const isManager = currentUser?.role?.name === 'manager' || currentUser?.role?.name === 'sales_person';
  const [branchId, setBranchId] = useState(currentUser?.branch_id ?? '');
  const [category, setCategory] = useState('operational');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('0');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string|null>(null);

  const selectedBranch = branches.find(b=>b.id===branchId);

  const handleSave = async () => {
    if (!branchId || !description.trim() || Number(amount)<=0) { setError('Branch, description and positive amount are required'); return; }
    if (!selectedBranch) { setError('Invalid branch'); return; }
    setSaving(true); setError(null);
    const { error: e } = await supabase.from('operational_expenses').insert({
      business_id: selectedBranch.business_id, branch_id: branchId, category, description: description.trim(), amount: Number(amount), expense_date: expenseDate, recorded_by: currentUser?.id, status: 'recorded',
    });
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Record Expense" size="md">
      <div className="space-y-4">
        <Select label="Branch" value={branchId} onChange={(e)=>setBranchId(e.target.value)} disabled={isManager}>
          <option value="">Select...</option>
          {branches.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Category" value={category} onChange={(e)=>setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c)=><option key={c} value={c}>{c.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
          </Select>
          <Input label="Date" type="date" value={expenseDate} onChange={(e)=>setExpenseDate(e.target.value)} />
        </div>
        <Input label="Amount (NGN)" type="number" value={amount} onChange={(e)=>setAmount(e.target.value)} />
        <Textarea label="Description" value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="What was this expense for?" autoFocus />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save Expense'}</Button>
        </div>
      </div>
    </Modal>
  );
}
