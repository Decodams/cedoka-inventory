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
  KeyRound,
  ShieldCheck,
  Mail,
  Building2 as BuildingIcon,
  ArrowLeftRight,
} from 'lucide-react';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState } from '@/components/ui/States';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate, formatNumber, isOverdue } from '@/lib/dateUtils';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Business, Branch, WeeklyReport, Issue, UserProfile, DailySale, Product } from '@/types/database';

type RoleLevel = 'super_admin' | 'admin' | 'manager' | 'sales_person' | 'supervisor' | 'accountant' | 'inventory_officer' | 'transport_officer' | 'auditor' | 'farm_operations_officer';

function roleDashboardBlurb(role: string | undefined, businessName?: string | null, branchName?: string | null): string {
  switch (role) {
    case 'super_admin':
      return 'Group overview';
    case 'admin':
      return `Business overview - ${businessName ?? 'all assigned businesses'}`;
    case 'manager':
      return `Branch operations - ${branchName ?? 'your branch'}`;
    case 'supervisor':
      return `Team oversight - ${branchName ?? 'your branch'}`;
    case 'sales_person':
      return 'Your sales dashboard';
    case 'accountant':
      return `Financial reconciliation - ${businessName ?? 'your business'}`;
    case 'inventory_officer':
      return `Stock accuracy - ${branchName ?? 'your branch'}`;
    case 'transport_officer':
      return 'Fleet and logistics activity';
    case 'auditor':
      return 'Read-only oversight';
    case 'farm_operations_officer':
      return `Farm operations - ${branchName ?? 'your branch'}`;
    default:
      return branchName ? `Branch overview - ${branchName}` : 'Your workspace overview';
  }
}

export function DashboardPage() {
  const { user, roles } = useAuth();
  const roleName = user?.role?.name as RoleLevel | undefined;
  const isSuperAdmin = hasRole(user, 'super_admin');
  const isAdmin = isAtLeast(user, 'admin');
  const isSalesPerson = roleName === 'sales_person';

  const [periodRange, setPeriodRange] = useState<'week' | 'month'>('week');
  const [showChangePassword, setShowChangePassword] = useState(false);

  // `businesses` is row-scoped for non Super Admins, so this returns exactly the
  // businesses the Admin was added to (plus their primary business).
  const businessesQuery = useMemo(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
  );
  const { data: businesses, loading: loadingBiz } = useSupabaseQuery<Business[]>(() => businessesQuery, [], {
    cacheKey: `dash:businesses:${roleName}:${user?.id ?? 'anon'}`,
    ttlMs: 60_000,
  });

  // Strict branch scope for everyone below Super Admin (mirrors
  // my_branch_ids() in the database).
  const accessibleBranchIds = useMemo(() => {
    if (isSuperAdmin) return [] as string[];
    if (user?.accessible_branch_ids) return user.accessible_branch_ids;
    const ids = new Set<string>();
    if (user?.branch_id) ids.add(user.branch_id);
    for (const id of user?.branch_assignment_ids ?? []) if (id) ids.add(id);
    return [...ids];
  }, [isSuperAdmin, user]);
  const branchScoped = !isSuperAdmin && accessibleBranchIds.length > 0;

  // My Records vs Overseen Records (spec sections 5-9): anyone whose scope
  // reaches beyond their own branch can flip the dashboard between their
  // primary branch, the branches they only oversee, and everything they may
  // see. "Overseen" is exactly accessible − primary.
  const [scopeMode, setScopeMode] = useState<'all' | 'mine' | 'overseen'>('all');
  const primaryBranchId = user?.branch_id ?? null;
  const overseenBranchIds = useMemo(
    () => accessibleBranchIds.filter((id) => id !== primaryBranchId),
    [accessibleBranchIds, primaryBranchId],
  );
  const canSplitScope = !isSuperAdmin && isAtLeast(user, 'manager') && !!primaryBranchId && overseenBranchIds.length > 0;
  const scopedBranchIds = useMemo(() => {
    if (scopeMode === 'mine' && primaryBranchId) return [primaryBranchId];
    if (scopeMode === 'overseen') return overseenBranchIds;
    return accessibleBranchIds;
  }, [scopeMode, primaryBranchId, overseenBranchIds, accessibleBranchIds]);
  const scopeKey = scopedBranchIds.join(',');

  const branchesQuery = useMemo(() => {
    if (isSuperAdmin) return supabase.from('branches').select('*').eq('is_active', true).order('name');
    if (scopedBranchIds.length > 0) {
      return supabase.from('branches').select('*').eq('is_active', true).in('id', scopedBranchIds).order('name');
    }
    if (user?.branch_id) return supabase.from('branches').select('*').eq('is_active', true).eq('id', user.branch_id);
    return supabase.from('branches').select('*').eq('is_active', true).order('name');
  }, [isSuperAdmin, scopedBranchIds, user?.branch_id]);
  const { data: branches } = useSupabaseQuery<Branch[]>(() => branchesQuery, [branchesQuery], {
    cacheKey: `dash:branches:${roleName}:${scopeKey}:${user?.branch_id ?? '-'}`,
    ttlMs: 60_000,
  });

  const reportsQuery = useMemo(() => {
    let q = supabase.from('weekly_reports').select(`*, business:businesses(id,name), branch:branches(id,name)`).order('created_at', { ascending: false });
    if (branchScoped) q = q.in('branch_id', scopedBranchIds);
    return q.limit(20);
  }, [branchScoped, scopedBranchIds]);
  const { data: weeklyReports } = useSupabaseQuery<WeeklyReport[]>(() => reportsQuery, [reportsQuery], {
    cacheKey: `dash:reports:${roleName}:${scopeKey}:${user?.branch_id ?? '-'}:${user?.id ?? '-'}`,
  });

  const issuesQuery = useMemo(() => {
    let q = supabase.from('issues').select(`*, branch:branches(id,name), business:businesses(id,name)`).neq('status', 'closed').order('created_at', { ascending: false }).limit(10);
    if (branchScoped) q = q.in('branch_id', scopedBranchIds);
    return q;
  }, [branchScoped, scopedBranchIds]);
  const { data: issues } = useSupabaseQuery<Issue[]>(() => issuesQuery, [issuesQuery], {
    cacheKey: `dash:issues:${roleName}:${scopeKey}:${user?.branch_id ?? '-'}`,
  });

  const salesActive = isSalesPerson && !!user?.branch_id;
  const salesQuery = useMemo(() => {
    if (!salesActive || !user?.branch_id) return null;
    return supabase.from('daily_sales').select(`*, product:products(id,name), branch:branches(id,name)`).eq('branch_id', user.branch_id).eq('salesperson_id', user.id).order('sale_date', { ascending: false }).limit(100);
  }, [salesActive, user]);
  const { data: sales } = useSupabaseQuery<DailySale[]>(salesQuery ? () => salesQuery : null, [salesQuery], {
    cacheKey: salesActive ? `dash:mysales:${user?.id}` : undefined,
  });

  const productsActive = isSalesPerson && !!user?.branch_id;
  const productsQuery = useMemo(() => {
    if (!productsActive || !user?.branch_id) return null;
    return supabase.from('products').select('id,name').eq('branch_id', user.branch_id).eq('is_active', true).order('name');
  }, [productsActive, user]);
  const { data: products } = useSupabaseQuery<Product[]>(productsQuery ? () => productsQuery : null, [productsQuery], {
    cacheKey: productsActive ? `ref:sp-products:${user?.branch_id}` : undefined,
    ttlMs: 60_000,
  });

  const usersQuery = useMemo(() => {
    if (!isAdmin) return supabase.from('user_profiles').select('*').eq('id', user?.id ?? '00000000-0000-0000-0000-000000000000');
    return supabase.from('user_profiles').select('*, role:roles(id,name,display_name)').eq('is_active', true).order('created_at', { ascending: false }).limit(200);
  }, [isAdmin, user]);
  const { data: users } = useSupabaseQuery<UserProfile[]>(() => usersQuery, [usersQuery], {
    cacheKey: `dash:users:${roleName}:${user?.id ?? '-'}`,
  });

  // Command-center aggregates: catalog size, empty shelves and the approval
  // queue. RLS scopes products/balances/profiles for Admins, so this is safe.
  // Tombstones never count toward catalog KPIs.
  const { data: allProducts } = useSupabaseQuery<Product[]>(
    isAdmin ? () => supabase.from('products').select('id,name,unit,is_active,business_id,branch_id').is('deleted_at', null).order('name').limit(1000) : null,
    [isAdmin],
    { cacheKey: isAdmin ? `dash:admin:products:${user?.id ?? '-'}` : undefined, ttlMs: 60_000 },
  );
  const { data: pendingUsers } = useSupabaseQuery<UserProfile[]>(
    isAdmin ? () => supabase.from('user_profiles').select('id').eq('approval_status', 'pending').limit(100) : null,
    [isAdmin],
    { cacheKey: isAdmin ? `dash:admin:pending:${user?.id ?? '-'}` : undefined, ttlMs: 60_000 },
  );

  // Super Admin command centre: organisation-wide pipeline + activity trail.
  const { data: openTransfers } = useSupabaseQuery<Array<{ id: string; status: string }>>(
    isSuperAdmin
      ? () => supabase.from('stock_transfers').select('id,status')
          .in('status', ['requested', 'reviewed', 'approved', 'dispatched', 'in_transit']).limit(500)
      : null,
    [isSuperAdmin],
    { cacheKey: isSuperAdmin ? `dash:xfer:${user?.id ?? '-'}` : undefined, ttlMs: 60_000 },
  );
  const { data: recentActivity } = useSupabaseQuery<Array<{
    id: string;
    action: string;
    target_table: string | null;
    created_at: string;
    actor_id: string | null;
  }>>(
    isSuperAdmin
      ? () => supabase.from('audit_log').select('id,action,target_table,created_at,actor_id')
          .order('created_at', { ascending: false }).limit(8)
      : null,
    [isSuperAdmin],
    { cacheKey: isSuperAdmin ? `dash:xlog:${user?.id ?? '-'}` : undefined, ttlMs: 30_000 },
  );

  const { data: stockBalances } = useSupabaseQuery<Array<{
    current_stock: number | string;
    min_stock_level: number | string;
    product: { id: string; name: string; unit: string | null; cost_price: number | string } | null;
    branch: { id: string; name: string } | null;
  }>>(
    () => {
      let q = supabase.from('inventory_balances')
        .select('current_stock,min_stock_level, product:products(id,name,unit,cost_price), branch:branches(id,name)')
        .limit(1000);
      if (branchScoped) q = q.in('branch_id', scopedBranchIds);
      return q;
    },
    [branchScoped, scopeKey],
    { cacheKey: `dash:stock:${user?.id ?? 'anon'}:${scopeKey}`, ttlMs: 60_000 },
  );
  const lowStockCount = (stockBalances ?? []).filter(
    (b) => Number(b.min_stock_level) > 0 && Number(b.current_stock) <= Number(b.min_stock_level),
  ).length;
  const outOfStockCount = (stockBalances ?? []).filter((b) => Number(b.current_stock) <= 0).length;
  const totalStockUnits = (stockBalances ?? []).reduce((sum, b) => sum + (Number(b.current_stock) || 0), 0);
  const stockValue = (stockBalances ?? []).reduce(
    (sum, b) => sum + (Number(b.current_stock) || 0) * (Number(b.product?.cost_price ?? 0) || 0),
    0,
  );
  const stockByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of stockBalances ?? []) {
      const name = b.branch?.name ?? 'Unassigned';
      map.set(name, (map.get(name) ?? 0) + (Number(b.current_stock) || 0));
    }
    return Array.from(map.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [stockBalances]);
  const maxBranchQty = useMemo(() => Math.max(...stockByBranch.map((b) => b.qty), 1), [stockByBranch]);
  const topStockProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number }>();
    for (const b of stockBalances ?? []) {
      const name = b.product?.name ?? 'Unknown product';
      const entry = map.get(name) ?? { name, qty: 0 };
      entry.qty += Number(b.current_stock) || 0;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [stockBalances]);
  const lowStockRows = useMemo(
    () => (stockBalances ?? [])
      .filter((b) => Number(b.min_stock_level) > 0 && Number(b.current_stock) <= Number(b.min_stock_level))
      .sort((a, b) => Number(a.current_stock) - Number(b.current_stock))
      .slice(0, 6),
    [stockBalances],
  );

  // Super Admin command centre: one row per business across the organisation.
  const businessBreakdown = useMemo(() => {
    if (!isSuperAdmin) return [] as Array<{ id: string; name: string; branches: number; staff: number; units: number; value: number; low: number }>;
    return (businesses ?? []).map((b) => {
      const bBranchIds = new Set((branches ?? []).filter((x) => x.business_id === b.id).map((x) => x.id));
      const bBalances = (stockBalances ?? []).filter((x) => x.branch != null && bBranchIds.has(x.branch.id));
      const bUnits = bBalances.reduce((s, x) => s + (Number(x.current_stock) || 0), 0);
      const bValue = bBalances.reduce((s, x) => s + (Number(x.current_stock) || 0) * (Number(x.product?.cost_price ?? 0) || 0), 0);
      const bLow = bBalances.filter((x) => Number(x.min_stock_level) > 0 && Number(x.current_stock) <= Number(x.min_stock_level)).length;
      const bStaff = (users ?? []).filter((u) => u.business_id === b.id || (u.branch_id != null && bBranchIds.has(u.branch_id))).length;
      return { id: b.id, name: b.name, branches: bBranchIds.size, staff: bStaff, units: bUnits, value: bValue, low: bLow };
    }).sort((a, z) => z.value - a.value);
  }, [isSuperAdmin, businesses, branches, users, stockBalances]);

  const revenue30Query = useMemo(() => {
    if (!isAdmin) return null;
    const d0 = new Date(Date.now() - 29 * 86400000);
    const since = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    let q = supabase.from('daily_sales').select('sale_date,unit_price,quantity,discount_value,status').gte('sale_date', since).limit(1000);
    if (branchScoped) q = q.in('branch_id', scopedBranchIds);
    return q;
  }, [isAdmin, branchScoped, scopedBranchIds]);
  const { data: recentSales } = useSupabaseQuery<Array<{
    sale_date: string;
    unit_price: number | string;
    quantity: number;
    discount_value: number | string;
    status: string;
  }>>(revenue30Query ? () => revenue30Query : null, [revenue30Query], {
    cacheKey: isAdmin ? `dash:rev30:${roleName}:${scopeKey}:${user?.id ?? '-'}` : undefined,
    ttlMs: 60_000,
  });
  const revenue30 = useMemo(() => {
    const byDate = new Map<string, number>();
    const today = new Date();
    const labels: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      byDate.set(key, 0);
      labels.push(key);
    }
    for (const s of recentSales ?? []) {
      if (s.status !== 'completed') continue;
      const prev = byDate.get(s.sale_date);
      if (prev === undefined) continue;
      byDate.set(s.sale_date, prev + Number(s.unit_price) * s.quantity - Number(s.discount_value));
    }
    return labels.map((label) => ({ label, revenue: byDate.get(label) ?? 0 }));
  }, [recentSales]);
  const maxRevenue30 = useMemo(() => Math.max(...revenue30.map((d) => d.revenue), 1), [revenue30]);

  const mySales = useMemo(() => sales ?? [], [sales]);
  const myTotalSales = mySales.filter((s) => s.status === 'completed').reduce((sum, s) => sum + Number(s.unit_price) * s.quantity - Number(s.discount_value), 0);
  const myPendingSales = mySales.filter((s) => s.status === 'pending').reduce((sum, s) => sum + Number(s.unit_price) * s.quantity - Number(s.discount_value), 0);
  const myTotalUnitsSold = mySales.filter((s) => s.status === 'completed').reduce((sum, s) => sum + s.quantity, 0);

  // Global best sellers (sale_items) for management roles
  const { data: topSaleItems } = useSupabaseQuery<Array<{ product_id: string; quantity: number }>>(
    isSuperAdmin || isAdmin ? () => supabase.from('sale_items').select('product_id,quantity').limit(500) : null,
    [isSuperAdmin, isAdmin],
    { cacheKey: isSuperAdmin || isAdmin ? `dash:topitems:${user?.id ?? 'anon'}` : undefined, ttlMs: 60_000 },
  );

  const bestSellingProducts = useMemo(() => {
    // Salesperson: personal best sellers
    if (isSalesPerson && products) {
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
    }
    // Management: global best sellers from sale_items
    if ((isSuperAdmin || isAdmin) && topSaleItems && allProducts) {
      const totals: Record<string, number> = {};
      for (const row of topSaleItems) totals[row.product_id] = (totals[row.product_id] ?? 0) + Number(row.quantity);
      return Object.entries(totals)
        .map(([id, qty]) => {
          const p = allProducts.find((pr) => pr.id === id);
          return { id, name: p?.name ?? 'Product', qty, revenue: 0 };
        })
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
    }
    return [];
  }, [isSalesPerson, isSuperAdmin, isAdmin, mySales, products, topSaleItems, allProducts]);

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
  const myWeeklyReports = weeklyReports?.filter((report) => report.submitted_by === user?.id) ?? [];
  const mySubmittedReports = myWeeklyReports.filter((report) => report.status !== 'draft').length;
  const myWeeklySales = myWeeklyReports.reduce((sum, report) => sum + Number(report.total_sales_value), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Welcome back, {user?.full_name?.split(' ')[0]}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {roleDashboardBlurb(roleName, user?.business?.name, user?.branch?.name)}
            {isSuperAdmin && ` — ${totalBusinesses} businesses, ${totalBranches} branches, ${totalStaff} staff`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSplitScope && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium" role="group" aria-label="Records scope">
              {([['mine', 'My Records'], ['overseen', `Overseen (${overseenBranchIds.length})`], ['all', 'All']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setScopeMode(mode)}
                  className={`px-3 py-1.5 rounded-md transition-colors ${scopeMode === mode ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 capitalize">{user?.role?.display_name}</Badge>
          <span className="text-xs text-slate-400">{formatDate(new Date().toISOString())}</span>
        </div>
      </div>

      {(
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center text-lg font-bold shrink-0">
                {user?.full_name?.charAt(0)?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">{user?.full_name}</h3>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5 break-all">
                  <Mail size={12} /> {user?.email}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                  <span className="text-xs text-slate-500 flex items-center gap-1 capitalize">
                    <ShieldCheck size={13} className="text-emerald-500" /> {user?.role?.display_name}
                  </span>
                  {user?.business?.name && (
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <BuildingIcon size={13} className="text-blue-500" /> {user.business.name}
                    </span>
                  )}
                  {user?.branch?.name && (
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <MapPin size={13} className="text-rose-500" /> {user.branch.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 active:bg-slate-950 transition-all shadow-sm"
              >
                <KeyRound size={16} /> Change Password
              </button>
            </div>
          </div>
        </div>
      )}

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
            <MetricCard icon={<Building2 size={20} />} label="Business" value={user?.business?.name ?? "-"} subtitle="Active unit" color="slate" />
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
            <MetricCard icon={<Target size={20} />} label="Best Seller" value={bestSellingProducts[0]?.name?.slice(0, 18) ?? "-"} subtitle="Top product" color="slate" />
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

      {isSuperAdmin && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <MetricCard icon={<ArrowLeftRight size={20} />} label="Open Transfers" value={String(openTransfers?.length ?? 0)} subtitle="Requested → in transit" color="blue" />
            <MetricCard icon={<AlertTriangle size={20} />} label="Low Stock Lines" value={String(lowStockCount)} subtitle="Across the organisation" color="amber" />
            <MetricCard icon={<DollarSign size={20} />} label="Stock Value" value={formatCurrency(stockValue)} subtitle="At unit cost, all branches" color="emerald" />
            <MetricCard icon={<Package size={20} />} label="Active Products" value={String(allProducts?.filter((p) => p.is_active).length ?? 0)} subtitle={`${allProducts?.length ?? 0} in catalog`} color="slate" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2 overflow-x-auto">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <Building2 size={18} /> Business Breakdown
              </h3>
              {businessBreakdown.length > 0 ? (
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                      <th className="py-2 pr-4">Business</th>
                      <th className="py-2 pr-4 text-right">Branches</th>
                      <th className="py-2 pr-4 text-right">Staff</th>
                      <th className="py-2 pr-4 text-right">Units</th>
                      <th className="py-2 pr-4 text-right">Stock Value</th>
                      <th className="py-2 text-right">Low Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {businessBreakdown.map((b) => (
                      <tr key={b.id}>
                        <td className="py-2.5 pr-4 font-medium text-slate-900">{b.name}</td>
                        <td className="py-2.5 pr-4 text-right text-slate-600">{b.branches}</td>
                        <td className="py-2.5 pr-4 text-right text-slate-600">{b.staff}</td>
                        <td className="py-2.5 pr-4 text-right text-slate-600">{formatNumber(b.units)}</td>
                        <td className="py-2.5 pr-4 text-right font-medium text-slate-900">{formatCurrency(b.value)}</td>
                        <td className="py-2.5 text-right">
                          {b.low > 0 ? <Badge className="bg-amber-100 text-amber-700 border-amber-200">{b.low}</Badge> : <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-400 text-center py-6">No businesses yet</p>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <Activity size={18} /> Recent Activity
              </h3>
              {(recentActivity ?? []).length > 0 ? (
                <ul className="space-y-3">
                  {recentActivity?.map((a) => {
                    const actor = users?.find((u) => u.id === a.actor_id);
                    return (
                      <li key={a.id} className="flex items-start gap-2.5">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-slate-800">
                            <span className="font-semibold">{actor?.full_name ?? 'System'}</span>{' '}
                            {a.action.replace(/[._]/g, ' ')}
                          </p>
                          <p className="text-[11px] text-slate-400">{a.target_table ?? 'record'} · {formatDate(a.created_at)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-slate-400 text-center py-6">No activity yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <MetricCard icon={<Package size={20} />} label="Products" value={String(allProducts?.length ?? 0)} subtitle={`${allProducts?.filter((p) => p.is_active).length ?? 0} active`} color="blue" />
          <MetricCard icon={<AlertTriangle size={20} />} label="Out of Stock" value={String(outOfStockCount)} subtitle="Zero on hand" color="rose" />
          <MetricCard icon={<Clock size={20} />} label="Pending Approvals" value={String(pendingUsers?.length ?? 0)} subtitle="Awaiting review" color="amber" />
          <MetricCard icon={<Users size={20} />} label="Roles Defined" value={String(roles?.length ?? 0)} subtitle="System roles" color="slate" />
        </div>
      )}

      {isAdmin && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <MetricCard icon={<DollarSign size={20} />} label="Stock Value" value={formatCurrency(stockValue)} subtitle="At unit cost" color="emerald" />
            <MetricCard icon={<ShoppingCart size={20} />} label="Low Stock" value={String(lowStockCount)} subtitle="At or below minimum" color="amber" />
            <MetricCard icon={<Package size={20} />} label="Units On Hand" value={formatNumber(totalStockUnits)} subtitle="Across all branches" color="blue" />
            <MetricCard icon={<MapPin size={20} />} label="Holding Stock" value={String(stockByBranch.length)} subtitle="Branches with balances" color="slate" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <BarChart3 size={18} /> Stock by Branch
              </h3>
              <div className="space-y-3">
                {stockByBranch.length > 0 ? stockByBranch.map((b) => (
                  <div key={b.name} className="flex items-center gap-3">
                    <div className="w-32 text-xs text-slate-600 truncate" title={b.name}>{b.name}</div>
                    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${(b.qty / maxBranchQty) * 100}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs font-semibold text-slate-900">{formatNumber(b.qty)}</div>
                  </div>
                )) : <p className="text-sm text-slate-400 text-center py-6">No stock balances yet</p>}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <Package size={18} /> Most Stocked Products
              </h3>
              <div className="space-y-2">
                {topStockProducts.length > 0 ? topStockProducts.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 text-[10px] font-bold text-slate-400">#{i + 1}</span>
                      <span className="text-xs font-medium text-slate-900 truncate">{p.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">{formatNumber(p.qty)}</span>
                  </div>
                )) : <p className="text-sm text-slate-400 text-center py-6">No stock yet</p>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <AlertTriangle size={18} /> Low Stock Watchlist
              </h3>
              <div className="space-y-2">
                {lowStockRows.length > 0 ? lowStockRows.map((b, i) => (
                  <div key={`${b.product?.id ?? i}-${b.branch?.id ?? i}`} className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">{b.product?.name ?? 'Product'}</p>
                      <p className="text-[10px] text-slate-400">{b.branch?.name ?? 'Unassigned'}</p>
                    </div>
                    <span className={`text-xs font-bold whitespace-nowrap ${Number(b.current_stock) <= 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {formatNumber(Number(b.current_stock))} / min {formatNumber(Number(b.min_stock_level))}
                    </span>
                  </div>
                )) : <p className="text-sm text-slate-400 text-center py-6">All products above minimum</p>}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <BarChart3 size={18} /> Revenue - Last 30 Days
                </h3>
                <Badge className="bg-blue-100 text-blue-700 border-blue-200">{formatCurrency(revenue30.reduce((s, d) => s + d.revenue, 0))}</Badge>
              </div>
              <div className="flex items-end gap-[3px] h-32">
                {revenue30.map((d) => (
                  <div
                    key={d.label}
                    className="flex-1 bg-blue-500 rounded-t-sm transition-all duration-500 hover:bg-blue-600"
                    style={{ height: `${d.revenue > 0 ? Math.max((d.revenue / maxRevenue30) * 100, 4) : 2}%` }}
                    title={`${d.label}: ${formatCurrency(d.revenue)}`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400">
                <span>{revenue30[0]?.label.slice(5)}</span>
                <span>Completed sales</span>
                <span>{revenue30[revenue30.length - 1]?.label.slice(5)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {(isSuperAdmin || isAdmin) && bestSellingProducts.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-2"><Target size={14} /> Best Selling Item</p>
            <p className="text-lg font-bold text-slate-900 mt-1 truncate">{bestSellingProducts[0].name} - {bestSellingProducts[0].qty} units sold</p>
            <p className="text-xs text-slate-500 mt-1">Top performer across all sales</p>
          </div>
          <div className="hidden sm:flex w-12 h-12 rounded-xl bg-white border border-emerald-200 items-center justify-center shrink-0"><Target size={20} className="text-emerald-600" /></div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Target size={18} /> Your weekly performance</h3>
            <p className="text-xs text-slate-500 mt-1">A quick view of the work recorded under your account.</p>
          </div>
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">This week</Badge>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <ScorecardMetric label="Reports submitted" value={mySubmittedReports.toString()} />
          <ScorecardMetric label="Reported sales" value={formatCurrency(myWeeklySales)} />
          <ScorecardMetric label="Activity" value={myWeeklyReports.length > 0 ? 'On track' : 'Start logging'} />
        </div>
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
            <StatusItem icon={<ShoppingCart size={16} />} label="Low Stock" value={lowStockCount.toString()} color="blue" />
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
              {(roles && roles.length > 0 ? roles : []).map((r) => {
                const count = users?.filter((u) => u.role?.name === r.name).length ?? 0;
                const total = users?.length ?? 1;
                const pct = Math.round((count / total) * 100);
                const colors: Record<string, string> = { super_admin: 'bg-rose-500', admin: 'bg-blue-500', manager: 'bg-emerald-500', sales_person: 'bg-amber-500' };
                const bar = colors[r.name] ?? 'bg-slate-400';
                return (
                  <div key={r.id} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-slate-600 capitalize truncate" title={r.display_name}>{r.display_name}</div>
                    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${bar} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
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

      <ChangePasswordModal open={showChangePassword} onClose={() => setShowChangePassword(false)} />
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

function ScorecardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-lg font-bold text-slate-900 truncate">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
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


