import { useState, useMemo } from 'react';
import {
  Building2,
  AlertTriangle,
  ClipboardList,
  Package,
  Clock,
  CheckCircle2,
  ShoppingCart,
  Users,
  DollarSign,
  BarChart3,
  Activity,
  Target,
  ShoppingBag,
  Receipt,
  MapPin,
  Gauge,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState } from '@/components/ui/States';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate, formatNumber, isOverdue } from '@/lib/dateUtils';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Business, Branch, WeeklyReport, Issue, UserProfile, DailySale, Product } from '@/types/database';

type RoleLevel = 'super_admin' | 'admin' | 'manager' | 'sales_person';

export function DashboardPage() {
  const { user } = useAuth();
  const roleName = user?.role?.name as RoleLevel | undefined;
  const isSuperAdmin = hasRole(user, 'super_admin');
  const isAdmin = isAtLeast(user, 'admin');
  const isSalesPerson = roleName === 'sales_person';

  const [periodRange, setPeriodRange] = useState<'week' | 'month'>('week');

  const businessesQuery = useMemo(() => {
    if (!isSuperAdmin) return supabase.from('businesses').select('*').eq('is_active', true).order('name').limit(1);
    return supabase.from('businesses').select('*').eq('is_active', true).order('name');
  }, [isSuperAdmin]);
  const { data: businesses, loading: loadingBiz } = useSupabaseQuery<Business[]>(() => businessesQuery, []);

  const branchesQuery = useMemo(() => {
    if (!isSuperAdmin && !isAdmin && user?.branch_id) {
      return supabase.from('branches').select('*').eq('is_active', true).eq('id', user.branch_id);
    }
    if (!isSuperAdmin && isAdmin && user?.business_id) {
      return supabase.from('branches').select('*').eq('is_active', true).eq('business_id', user.business_id);
    }
    return supabase.from('branches').select('*').eq('is_active', true).order('name');
  }, [isSuperAdmin, isAdmin, user]);
  const { data: branches } = useSupabaseQuery<Branch[]>(() => branchesQuery, []);

  const reportsQuery = useMemo(() => {
    let q = supabase.from('weekly_reports').select(`*, business:businesses(*), branch:branches(*)`).order('created_at', { ascending: false });
    if (isSuperAdmin) { /* all */ }
    else if (isAdmin && user?.business_id) q = q.eq('business_id', user.business_id);
    else if (user?.branch_id) q = q.eq('branch_id', user.branch_id);
    else if (user?.id) q = q.eq('submitted_by', user.id);
    return q.limit(20);
  }, [isSuperAdmin, isAdmin, user]);
  const { data: weeklyReports } = useSupabaseQuery<WeeklyReport[]>(() => reportsQuery, [reportsQuery]);

  const issuesQuery = useMemo(() => {
    let q = supabase.from('issues').select(`*, branch:branches(name), business:businesses(name)`).neq('status', 'closed').order('created_at', { ascending: false }).limit(10);
    if (!isSuperAdmin && isAdmin && user?.business_id) q = q.eq('business_id', user.business_id);
    else if (!isAdmin && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    return q;
  }, [isSuperAdmin, isAdmin, user]);
  const { data: issues } = useSupabaseQuery<Issue[]>(() => issuesQuery, [issuesQuery]);

  const salesQuery = useMemo(() => {
    if (!isSalesPerson || !user?.branch_id) return supabase.from('daily_sales').select('*').eq('id', '00000000-0000-0000-0000-000000000000').limit(0);
    return supabase.from('daily_sales').select(`*, product:products(*), branch:branches(name)`).eq('branch_id', user.branch_id).eq('salesperson_id', user.id).order('sale_date', { ascending: false }).limit(100);
  }, [isSalesPerson, user]);
  const { data: sales } = useSupabaseQuery<DailySale[]>(() => salesQuery, [salesQuery]);

  const productsQuery = useMemo(() => {
    if (!isSalesPerson || !user?.business_id) return supabase.from('products').select('*').eq('id', '00000000-0000-0000-0000-000000000000').limit(0);
    return supabase.from('products').select('*').eq('business_id', user.business_id).eq('is_active', true).order('name');
  }, [isSalesPerson, user]);
  const { data: products } = useSupabaseQuery<Product[]>(() => productsQuery, [productsQuery]);

  const usersQuery = useMemo(() => {
    if (!isSuperAdmin) return supabase.from('user_profiles').select('*').eq('id', user?.id ?? '00000000-0000-0000-0000-000000000000');
    return supabase.from('user_profiles').select('*, role:roles(name)').eq('is_active', true).order('created_at', { ascending: false }).limit(20);
  }, [isSuperAdmin, user]);
  const { data: users } = useSupabaseQuery<UserProfile[]>(() => usersQuery, [usersQuery]);

  const mySales = useMemo(() => sales ?? [], [sales]);
  const myTotalSales = mySales.filter((s) => s.status === 'completed').reduce((sum, s) => sum + Number(s.unit_price) * s.quantity - Number(s.discount_value), 0);
  const myPendingSales = mySales.filter((s) => s.status === 'pending').reduce((sum, s) => sum + Number(s.unit_price) * s.quantity - Number(s.discount_value), 0);
  const myTotalUnitsSold = mySales.filter((s) => s.status === 'completed').reduce((sum, s) => sum + s.quantity, 0);

  const bestSellingProducts = useMemo(() => {
    if (!isSalesPerson || !products) return [];
    const productSales: Record<string, { name: string; qty: number; revenue: number }> = {};
    mySales.forEach((s) => {
      const pid = s.product_id ?? 'unknown';
      const p = products.find((pr) => pr.id === pid);
      if (!productSales[pid]) productSales[pid] = { name: p?.name ?? 'Unknown', qty: 0, revenue: 0 };
      productSales[pid].qty += s.quantity;
      productSales[pid].revenue += Number(s.unit_price) * s.quantity - Number(s.discount_value);
    });
    return Object.entries(productSales)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [isSalesPerson, mySales, products]);

  const weeklyChartData = useMemo(() => {
    if (!isSalesPerson) {
      const weekMap = new Map<string, { sales: number; purchases: number; sold: number }>();
      weeklyReports?.forEach((r) => {
        const start = new Date(r.week_start_date);
        const key = `${start.getFullYear()}-W${Math.ceil(start.getDate() / 7)}`;
        const existing = weekMap.get(key) ?? { sales: 0, purchases: 0, sold: 0 };
        existing.sales += Number(r.total_sales_value);
        existing.purchases += Number(r.total_purchase_value);
        existing.sold += Number(r.stock_sold);
        weekMap.set(key, existing);
      });
      return Array.from(weekMap.entries()).slice(-6).map(([label, data]) => ({ label, ...data }));
    }
    const dayMap = new Map<string, number>();
    mySales.forEach((s) => {
      const date = s.sale_date;
      const existing = dayMap.get(date) ?? 0;
      dayMap.set(date, existing + (s.status === 'completed' ? Number(s.unit_price) * s.quantity - Number(s.discount_value) : 0));
    });
    return Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-7).map(([label, sales]) => ({ label, sales, purchases: 0, sold: 0 }));
  }, [isSalesPerson, weeklyReports, mySales]);

  if (loadingBiz) return <LoadingState message="Loading dashboard..." />;

  const totalBusinesses = businesses?.length ?? 0;
  const totalBranches = branches?.length ?? 0;
  const totalStaff = users?.length ?? 0;
  const draftReports = weeklyReports?.filter((r) => r.status === 'draft') ?? [];
  const submittedReports = weeklyReports?.filter((r) => r.status === 'submitted') ?? [];
  const totalSalesValue = weeklyReports?.reduce((sum, r) => sum + Number(r.total_sales_value), 0) ?? 0;
  const totalStockSold = weeklyReports?.reduce((sum, r) => sum + Number(r.stock_sold), 0) ?? 0;
  const managementIssues = issues?.filter((i) => i.requires_management_attention) ?? [];
  const overdueIssues = issues?.filter((i) => isOverdue(i.deadline)) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Welcome back, {user?.full_name?.split(' ')[0]}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {isSuperAdmin ? `Group overview — ${totalBusinesses} businesses, ${totalBranches} branches, ${totalStaff} staff` : isAdmin ? `Business overview — ${user?.business?.name}` : isSalesPerson ? `Your sales dashboard` : `Branch overview — ${user?.branch?.name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 capitalize">{user?.role?.display_name}</Badge>
          <span className="text-xs text-slate-400">{formatDate(new Date().toISOString())}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {isSuperAdmin && (
          <>
            <MetricCard icon={<Building2 size={20} />} label="Businesses" value={totalBusinesses.toString()} subtitle="Active" color="slate" />
            <MetricCard icon={<MapPin size={20} />} label="Branches" value={totalBranches.toString()} subtitle="Total locations" color="blue" />
            <MetricCard icon={<Users size={20} />} label="Staff Members" value={totalStaff.toString()} subtitle="Active users" color="emerald" />
            <MetricCard icon={<DollarSign size={20} />} label="Total Sales" value={formatCurrency(totalSalesValue)} subtitle="This week" color="emerald" />
          </>
        )}
        {isAdmin && !isSuperAdmin && (
          <>
            <MetricCard icon={<Building2 size={20} />} label="Business" value={user?.business?.name ?? '—'} subtitle="Active unit" color="slate" />
            <MetricCard icon={<MapPin size={20} />} label="Branches" value={totalBranches.toString()} subtitle="Under management" color="blue" />
            <MetricCard icon={<Users size={20} />} label="Staff" value={totalStaff.toString()} subtitle="Team members" color="emerald" />
            <MetricCard icon={<DollarSign size={20} />} label="Total Sales" value={formatCurrency(totalSalesValue)} subtitle="This week" color="emerald" />
          </>
        )}
        {isSalesPerson && (
          <>
            <MetricCard icon={<Receipt size={20} />} label="My Sales" value={formatCurrency(myTotalSales)} subtitle="Completed" color="emerald" />
            <MetricCard icon={<Clock size={20} />} label="Pending" value={formatCurrency(myPendingSales)} subtitle="Awaiting payment" color="amber" />
            <MetricCard icon={<ShoppingBag size={20} />} label="Units Sold" value={myTotalUnitsSold.toString()} subtitle="This period" color="blue" />
            <MetricCard icon={<Target size={20} />} label="Best Seller" value={bestSellingProducts[0]?.name?.slice(0, 12) ?? '—'} subtitle="Top product" color="slate" />
          </>
        )}
        {!isSuperAdmin && !isAdmin && !isSalesPerson && (
          <>
            <MetricCard icon={<ClipboardList size={20} />} label="Reports" value={submittedReports.length.toString()} subtitle="Submitted this week" color="slate" />
            <MetricCard icon={<DollarSign size={20} />} label="Sales" value={formatCurrency(totalSalesValue)} subtitle="This week" color="emerald" />
            <MetricCard icon={<Package size={20} />} label="Stock Sold" value={formatNumber(totalStockSold)} subtitle="Units" color="blue" />
            <MetricCard icon={<AlertTriangle size={20} />} label="Issues" value={managementIssues.length.toString()} subtitle="Need attention" color="rose" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <BarChart3 size={18} /> Sales & Purchase Trend
            </h3>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => setPeriodRange('week')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${periodRange === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Week</button>
              <button onClick={() => setPeriodRange('month')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${periodRange === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Month</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[400px]">
              <div className="flex items-end gap-2 h-40 px-1">
                {weeklyChartData.slice(-6).map((d, i) => {
                  const maxVal = Math.max(...weeklyChartData.slice(-6).map((item) => Math.max(item.sales, item.purchases)), 1);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end gap-0.5" style={{ height: '120px' }}>
                        <div className="w-1/2 bg-blue-500 rounded-t-xs transition-all duration-500" style={{ height: `${(d.sales / maxVal) * 100}%`, minHeight: d.sales > 0 ? '4px' : '0%' }} title={`Sales: ${formatCurrency(d.sales)}`} />
                        <div className="w-1/2 bg-emerald-500 rounded-t-xs transition-all duration-500" style={{ height: `${(d.purchases / maxVal) * 100}%`, minHeight: d.purchases > 0 ? '4px' : '0%' }} title={`Purchases: ${formatCurrency(d.purchases)}`} />
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 text-center truncate w-full">{d.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-4 mt-3">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-blue-500" /><span className="text-[11px] text-slate-500">Sales</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500" /><span className="text-[11px] text-slate-500">Purchases</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Activity size={18} /> Quick Status
          </h3>
          <div className="space-y-3">
            <StatusItem icon={<ClipboardList size={16} />} label="Draft Reports" value={draftReports.length.toString()} color="amber" />
            <StatusItem icon={<CheckCircle2 size={16} />} label="Submitted" value={submittedReports.length.toString()} color="blue" />
            <StatusItem icon={<AlertTriangle size={16} />} label="Mgmt Issues" value={managementIssues.length.toString()} color="rose" />
            <StatusItem icon={<Clock size={16} />} label="Overdue" value={overdueIssues.length.toString()} color="rose" />
            <StatusItem icon={<ShoppingCart size={16} />} label="Low Stock" value="0" color="blue" />
          </div>
          {isSalesPerson && (
            <div className="pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">Weekly Target</span>
                <span className="text-xs font-semibold text-emerald-600">{myTotalUnitsSold > 0 ? Math.round(myTotalUnitsSold / Math.max(myTotalUnitsSold + myPendingSales / 10, 1) * 100) : 0}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, myTotalUnitsSold / Math.max(myTotalUnitsSold + myPendingSales / 10, 1) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {(isSuperAdmin || isAdmin) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <Users size={18} /> Staff Distribution
            </h3>
            <div className="space-y-3">
              {['super_admin', 'admin', 'manager', 'sales_person'].map((role) => {
                const count = users?.filter((u) => u.role?.name === role).length ?? 0;
                const total = users?.length ?? 1;
                const pct = Math.round((count / total) * 100);
                const colors: Record<string, string> = { super_admin: 'bg-rose-500', admin: 'bg-blue-500', manager: 'bg-emerald-500', sales_person: 'bg-amber-500' };
                return (
                  <div key={role} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-slate-600 capitalize">{role.replace('_', ' ')}</div>
                    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${colors[role]} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-12 text-right text-xs font-semibold text-slate-900">{count}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-3">
              <div className="text-center p-2 bg-slate-50 rounded-xl"><p className="text-lg font-bold text-slate-900">{totalStaff}</p><p className="text-[10px] text-slate-400">Total Staff</p></div>
              <div className="text-center p-2 bg-slate-50 rounded-xl"><p className="text-lg font-bold text-emerald-600">{users?.filter(u => u.is_active).length ?? 0}</p><p className="text-[10px] text-slate-400">Active</p></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <MapPin size={18} /> Branch Performance
            </h3>
            {branches && branches.length > 0 ? (
              <div className="space-y-2">
                {branches.slice(0, 5).map((b) => {
                  const branchReports = weeklyReports?.filter((r) => r.branch_id === b.id) ?? [];
                  const branchSales = branchReports.reduce((s, r) => s + Number(r.total_sales_value), 0);
                  return (
                    <div key={b.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center"><MapPin size={14} className="text-slate-500" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-900 truncate">{b.name}</p>
                        <p className="text-[10px] text-slate-400">{branchReports.length} reports</p>
                      </div>
                      <span className="text-xs font-semibold text-slate-900">{formatCurrency(branchSales)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-6">No branches found</p>
            )}
          </div>
        </div>
      )}

      {managementIssues.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-rose-600" />
            <h3 className="text-sm font-semibold text-rose-900">Requires Management Attention ({managementIssues.length})</h3>
          </div>
          <div className="space-y-2">
            {managementIssues.slice(0, 4).map((issue) => (
              <div key={issue.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-rose-100">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge className="bg-rose-100 text-rose-700 border-rose-200">{issue.priority}</Badge>
                  <span className="text-sm font-medium text-slate-900 truncate">{issue.title}</span>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap ml-3">{issue.branch?.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
          <Gauge size={18} /> Recent Activity
        </h3>
        <div className="space-y-2">
          {weeklyReports && weeklyReports.slice(0, 5).map((report) => (
            <div key={report.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-2 h-2 rounded-full shrink-0 ${report.status === 'submitted' ? 'bg-blue-500' : report.status === 'reviewed' ? 'bg-emerald-500' : report.status === 'draft' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{report.branch?.name}</p>
                  <p className="text-xs text-slate-400">{report.business?.name} · {formatCurrency(Number(report.total_sales_value))} sales</p>
                </div>
              </div>
              <Badge className={`capitalize ${report.status === 'draft' ? 'bg-gray-100 text-gray-600' : report.status === 'submitted' ? 'bg-blue-100 text-blue-700' : report.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{report.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, subtitle, color }: { icon: React.ReactNode; label: string; value: string; subtitle: string; color: string }) {
  const colorMap: Record<string, { bg: string; iconBg: string }> = {
    slate: { bg: 'bg-white', iconBg: 'bg-slate-100 text-slate-600' },
    blue: { bg: 'bg-white', iconBg: 'bg-blue-50 text-blue-600' },
    emerald: { bg: 'bg-white', iconBg: 'bg-emerald-50 text-emerald-600' },
    amber: { bg: 'bg-white', iconBg: 'bg-amber-50 text-amber-600' },
    rose: { bg: 'bg-white', iconBg: 'bg-rose-50 text-rose-600' },
  };
  const c = colorMap[color] ?? colorMap.slate;
  return (
    <div className={`${c.bg} rounded-2xl border border-slate-200 p-4 hover:shadow-md transition-shadow`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`w-9 h-9 rounded-xl ${c.iconBg} flex items-center justify-center`}>{icon}</div>
      </div>
      <p className="text-xl font-bold text-slate-900 leading-tight truncate">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
    </div>
  );
}

function StatusItem({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600', blue: 'text-blue-600', amber: 'text-amber-600', rose: 'text-rose-600', slate: 'text-slate-600'
  };
  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg bg-slate-50 ${colorMap[color] ?? colorMap.slate} flex items-center justify-center`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
      </div>
      <span className={`text-sm font-bold ${colorMap[color] ?? colorMap.slate}`}>{value}</span>
    </div>
  );
}
