import { useMemo, useState } from 'react';
import { Landmark, TrendingUp, TrendingDown, Wallet, Download, Search, Receipt, FileText } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase, useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate, toDateString, daysUntil } from '@/lib/dateUtils';
import { accessibleBusinessIds, fullAccessibleBranchIds, hasRole, isAtLeast } from '@/lib/rbac';
import { downloadCsv, dateFileName } from '@/lib/exportCsv';
import type { DailySale, PurchaseRequest, OperationalExpense, Branch, Business } from '@/types/database';

type Tab = 'receivables' | 'payables' | 'expenses';

export function FinancePage() {
  const { user } = useAuth();
  const isExecutive = hasRole(user, 'super_admin');
  const [tab, setTab] = useState<Tab>('receivables');
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');

  const isSuper = isExecutive;
  const isAdmin = isAtLeast(user, 'admin');
  const bizIds = useMemo(() => accessibleBusinessIds(user), [user]);
  const branchIds = useMemo(() => fullAccessibleBranchIds(user), [user]);

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `fin-branches:${user?.id}`, ttlMs: 60_000 },
  );
  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `fin-biz:${user?.id}`, ttlMs: 60_000 },
  );

  const { data: sales, loading: l1, error: e1, refetch: r1 } = useSupabaseQuery<DailySale[]>(
    () => {
      let q = supabase.from('daily_sales').select('id,customer_name,sale_date,quantity,unit_price,discount_value,amount_paid,status,branch_id,business_id').eq('status', 'completed').order('sale_date', { ascending: false }).limit(1000);
      if (!isSuper) { if (isAdmin && bizIds.length) q = q.in('business_id', bizIds); else if (branchIds.length) q = q.in('branch_id', branchIds); }
      return q;
    },
    [isSuper, isAdmin, bizIds.join(','), branchIds.join(',')],
    { cacheKey: `fin-sales:${user?.id}:${bizIds.join(',')}:${branchIds.join(',')}`, ttlMs: 60_000 },
  );
  const { data: pos, loading: l2, error: e2, refetch: r2 } = useSupabaseQuery<PurchaseRequest[]>(
    () => {
      let q = supabase.from('purchase_requests').select('id,request_number,business_id,branch_id,supplier_id,status,estimated_cost,actual_cost,expected_delivery_date,created_at,supplier:suppliers(id,name)').in('status', ['requested', 'quoted', 'ordered', 'partially_received']).order('created_at', { ascending: false }).limit(1000);
      if (!isSuper) { if (isAdmin && bizIds.length) q = q.in('business_id', bizIds); else if (branchIds.length) q = q.in('branch_id', branchIds); }
      return q;
    },
    [isSuper, isAdmin, bizIds.join(','), branchIds.join(',')],
    { cacheKey: `fin-pos:${user?.id}:${bizIds.join(',')}:${branchIds.join(',')}`, ttlMs: 60_000 },
  );
  const { data: expenses, loading: l3, error: e3, refetch: r3 } = useSupabaseQuery<OperationalExpense[]>(
    () => {
      let q = supabase.from('operational_expenses').select('id,business_id,branch_id,expense_date,category,description,amount,status,recorded_by').order('expense_date', { ascending: false }).limit(1000);
      if (!isSuper) { if (isAdmin && bizIds.length) q = q.in('business_id', bizIds); else if (branchIds.length) q = q.in('branch_id', branchIds); }
      return q;
    },
    [isSuper, isAdmin, bizIds.join(','), branchIds.join(',')],
    { cacheKey: `fin-exp:${user?.id}:${bizIds.join(',')}:${branchIds.join(',')}`, ttlMs: 60_000 },
  );

  const balanceOf = (s: DailySale) => Math.max(0, Number(s.unit_price) * Number(s.quantity) - Number(s.discount_value || 0) - Number(s.amount_paid || 0));
  const receivables = useMemo(() => (sales ?? []).map((s) => ({ ...s, balance: balanceOf(s) })).filter((s) => s.balance > 0), [sales]);
  const payables = useMemo(() => (pos ?? []).map((p) => ({ ...p, outstanding: Math.max(0, Number(p.estimated_cost) - Number(p.actual_cost || 0)) })).filter((p) => p.outstanding > 0), [pos]);
  const pendingExpenses = useMemo(() => (expenses ?? []).filter((x) => x.status === 'recorded'), [expenses]);

  const totalReceivables = receivables.reduce((s, r) => s + r.balance, 0);
  const totalPayables = payables.reduce((s, p) => s + p.outstanding, 0);
  const totalPendingExp = pendingExpenses.reduce((s, x) => s + Number(x.amount), 0);

  const branchName = (id: string | null) => branches?.find((b) => b.id === id)?.name ?? '—';
  const busName = (id: string | null) => businesses?.find((b) => b.id === id)?.name ?? '—';

  const filtered = <T extends { branch_id: string | null }>(list: T[]) => list.filter((r) => filterBranch === 'all' || r.branch_id === filterBranch).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return JSON.stringify(r).toLowerCase().includes(q);
  });

  const exportCsv = () => {
    if (tab === 'receivables') downloadCsv(dateFileName('receivables'), filtered(receivables), [
      { header: 'Date', value: (r) => r.sale_date },
      { header: 'Customer', value: (r) => r.customer_name ?? 'Walk-in' },
      { header: 'Branch', value: (r) => branchName(r.branch_id) },
      { header: 'Business', value: (r) => busName(r.business_id) },
      { header: 'Outstanding', value: (r) => r.balance },
    ]);
    else if (tab === 'payables') downloadCsv(dateFileName('payables'), filtered(payables), [
      { header: 'Request', value: (r) => r.request_number ?? r.id.slice(0, 8) },
      { header: 'Branch', value: (r) => branchName(r.branch_id) },
      { header: 'Supplier', value: (r) => (r as unknown as { supplier?: { name: string } }).supplier?.name ?? '—' },
      { header: 'Status', value: (r) => r.status },
      { header: 'Outstanding', value: (r) => r.outstanding },
      { header: 'Expected', value: (r) => r.expected_delivery_date ?? '' },
    ]);
    else downloadCsv(dateFileName('expenses'), filtered(pendingExpenses), [
      { header: 'Date', value: (r) => r.expense_date },
      { header: 'Category', value: (r) => r.category },
      { header: 'Description', value: (r) => r.description },
      { header: 'Branch', value: (r) => branchName(r.branch_id) },
      { header: 'Amount', value: (r) => r.amount },
      { header: 'Status', value: (r) => r.status },
    ]);
  };

  if (l1 || l2 || l3) return <ListSkeleton rows={6} />;
  if (e1 || e2 || e3) return <ErrorState message="Could not load finance data." onRetry={() => { r1(); r2(); r3(); }} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Finance — Receivables & Payables</h2>
          <p className="text-sm text-slate-500 mt-0.5">Money owed to the business, money owed to suppliers, and pending operational costs.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} className="w-full sm:w-auto"><Download size={17} /> Export CSV</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric label="Receivables (outstanding sales)" value={formatCurrency(totalReceivables)} tone="emerald" icon={<TrendingUp size={18} />} />
        <Metric label="Payables (outstanding orders)" value={formatCurrency(totalPayables)} tone="rose" icon={<TrendingDown size={18} />} />
        <Metric label="Pending expenses (unapproved)" value={formatCurrency(totalPendingExp)} tone="amber" icon={<Wallet size={18} />} />
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {([['receivables', 'Receivables', Receipt], ['payables', 'Payables', FileText], ['expenses', 'Pending Expenses', Landmark]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold sm:text-sm ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-xl outline-none focus:border-slate-900" />
        </div>
        <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="w-full sm:w-52 px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl bg-white outline-none focus:border-slate-900">
          <option value="all">All Branches</option>
          {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {tab === 'receivables' && <List rows={filtered(receivables)} empty="No outstanding receivables — all sales are paid." render={(r) => ({
        title: r.customer_name ?? 'Walk-in',
        sub: `${branchName(r.branch_id)} · ${formatDate(r.sale_date)} · ${busName(r.business_id)}`,
        badge: <Badge className="bg-amber-50 text-amber-700 border-amber-200">Receivable</Badge>,
        amount: formatCurrency(r.balance),
      })} />}

      {tab === 'payables' && <List rows={filtered(payables)} empty="No outstanding purchase orders." render={(p) => ({
        title: p.request_number ?? `PO-${p.id.slice(0, 8)}`,
        sub: `${branchName(p.branch_id)} · ${(p as unknown as { supplier?: { name: string } }).supplier?.name ?? 'No supplier'}${p.expected_delivery_date ? ` · due ${formatDate(p.expected_delivery_date)}` : ''}`,
        badge: <Badge className="bg-rose-50 text-rose-700 border-rose-200">{p.status.replace('_', ' ')}</Badge>,
        amount: formatCurrency(p.outstanding),
      })} />}

      {tab === 'expenses' && <List rows={filtered(pendingExpenses)} empty="No pending expenses awaiting approval." render={(x) => ({
        title: x.description,
        sub: `${x.category.replace('_', ' ')} · ${branchName(x.branch_id)} · ${formatDate(x.expense_date)}`,
        badge: <Badge className="bg-blue-50 text-blue-700 border-blue-200">Awaiting approval · {daysUntil(x.expense_date)}d ago</Badge>,
        amount: formatCurrency(Number(x.amount)),
      })} />}
    </div>
  );
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: 'emerald' | 'rose' | 'amber'; icon: React.ReactNode }) {
  const tones = { emerald: 'text-emerald-600', rose: 'text-rose-600', amber: 'text-amber-600' };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className={`mb-2 ${tones[tone]}`}>{icon}</div>
      <p className="text-xl font-bold text-slate-900 truncate">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{label}</p>
    </div>
  );
}

function List<T>({ rows, empty, render }: { rows: T[]; empty: string; render: (row: T) => { title: string; sub: string; badge: React.ReactNode; amount: string } }) {
  if (!rows.length) return <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-400">{empty}</div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
      {rows.map((row, i) => {
        const v = render(row);
        return (
          <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{v.title}</p>
              <p className="text-xs text-slate-400 truncate">{v.sub}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {v.badge}
              <span className="text-sm font-bold text-slate-900">{v.amount}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
