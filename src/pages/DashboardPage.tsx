import { useMemo } from 'react';
import {
  Building2,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
  Package,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { Badge } from '@/components/ui/Badge';
import {
  formatCurrency,
  formatDate,
  weekRangeString,
  getWeekEnd,
  toDateString,
  daysUntil,
  isOverdue,
} from '@/lib/dateUtils';
import {
  ISSUE_STATUS_STYLES,
  ISSUE_STATUS_LABELS,
  ISSUE_PRIORITY_STYLES,
  ISSUE_PRIORITY_LABELS,
} from '@/lib/statusStyles';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Business, Branch, WeeklyReport, Issue } from '@/types/database';

export function DashboardPage() {
  const { user } = useAuth();
  const roleName = user?.role?.name ?? null;
  const weekEnd = toDateString(getWeekEnd(new Date()));

  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  // Fetch businesses (for executive/admin)
  const { data: businesses, loading: loadingBiz, error: errorBiz } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
  );

  // Fetch branches (for executive/admin)
  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  // Fetch this week's reports
  const reportsQuery = useMemo(() => {
    if (isExecutive) {
      return supabase
        .from('weekly_reports')
        .select(
          `*, business:businesses(*), branch:branches(*), submitted_by_user:user_profiles!submitted_by(full_name)`,
        )
        .eq('week_end_date', weekEnd)
        .order('created_at', { ascending: false });
    }
    if (isBusinessLevel && user?.business_id) {
      return supabase
        .from('weekly_reports')
        .select(
          `*, business:businesses(*), branch:branches(*), submitted_by_user:user_profiles!submitted_by(full_name)`,
        )
        .eq('week_end_date', weekEnd)
        .eq('business_id', user.business_id)
        .order('created_at', { ascending: false });
    }
    if (user?.branch_id) {
      return supabase
        .from('weekly_reports')
        .select(
          `*, business:businesses(*), branch:branches(*), submitted_by_user:user_profiles!submitted_by(full_name)`,
        )
        .eq('week_end_date', weekEnd)
        .eq('branch_id', user.branch_id)
        .order('created_at', { ascending: false });
    }
    return supabase
      .from('weekly_reports')
      .select(
        `*, business:businesses(*), branch:branches(*), submitted_by_user:user_profiles!submitted_by(full_name)`,
      )
      .eq('week_end_date', weekEnd)
      .eq('submitted_by', user?.id ?? '')
      .order('created_at', { ascending: false });
  }, [isExecutive, isBusinessLevel, user, weekEnd]);

  const { data: weeklyReports, loading: loadingReports, error: errorReports } =
    useSupabaseQuery<WeeklyReport[]>(() => reportsQuery, [reportsQuery]);

  // Fetch issues requiring management attention
  const issuesQuery = useMemo(() => {
    let q = supabase
      .from('issues')
      .select(
        `*, business:businesses(*), branch:branches(*), reported_by_user:user_profiles!reported_by(full_name)`,
      )
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(10);
    if (!isExecutive && user?.business_id && isBusinessLevel) {
      q = q.eq('business_id', user.business_id);
    } else if (!isBusinessLevel && user?.branch_id) {
      q = q.eq('branch_id', user.branch_id);
    }
    return q;
  }, [isExecutive, isBusinessLevel, user]);

  const { data: issues, loading: loadingIssues } = useSupabaseQuery<Issue[]>(
    () => issuesQuery,
    [issuesQuery],
  );

  if (loadingBiz || loadingReports) {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (errorBiz || errorReports) {
    return (
      <ErrorState
        message="We couldn't load your dashboard data. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  const totalBusinesses = businesses?.length ?? 0;
  const totalBranches = branches?.length ?? 0;
  const submittedReports = weeklyReports?.filter((r) => r.status === 'submitted' || r.status === 'reviewed') ?? [];
  const draftReports = weeklyReports?.filter((r) => r.status === 'draft') ?? [];
  const totalSalesValue = weeklyReports?.reduce((sum, r) => sum + Number(r.total_sales_value), 0) ?? 0;
  const totalPurchaseValue = weeklyReports?.reduce((sum, r) => sum + Number(r.total_purchase_value), 0) ?? 0;
  const managementAttentionIssues = issues?.filter((i) => i.requires_management_attention) ?? [];
  const criticalIssues = issues?.filter((i) => i.priority === 'critical' || i.priority === 'high') ?? [];
  const overdueIssues = issues?.filter((i) => isOverdue(i.deadline)) ?? [];

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Welcome back, {user?.full_name?.split(' ')[0]}
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {isExecutive
            ? `Group overview across ${totalBusinesses} businesses and ${totalBranches} branches`
            : isBusinessLevel
              ? `Business-wide overview for ${user?.business?.name}`
              : `Branch overview for ${user?.branch?.name}`}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isExecutive && (
          <>
            <StatCard
              label="Active Businesses"
              value={totalBusinesses.toString()}
              icon={<Building2 size={20} />}
              accent="slate"
            />
            <StatCard
              label="Active Branches"
              value={totalBranches.toString()}
              icon={<Building2 size={20} />}
              accent="blue"
            />
          </>
        )}
        {!isExecutive && (
          <>
            <StatCard
              label="Reports This Week"
              value={(weeklyReports?.length ?? 0).toString()}
              icon={<ClipboardList size={20} />}
              accent="slate"
            />
            <StatCard
              label="Pending Submission"
              value={draftReports.length.toString()}
              icon={<Clock size={20} />}
              accent="amber"
            />
          </>
        )}
        <StatCard
          label="Total Sales (Week)"
          value={formatCurrency(totalSalesValue)}
          icon={<TrendingUp size={20} />}
          accent="emerald"
        />
        <StatCard
          label="Total Purchases (Week)"
          value={formatCurrency(totalPurchaseValue)}
          icon={<TrendingUp size={20} />}
          accent="blue"
        />
      </div>

      {/* Management attention alert */}
      {managementAttentionIssues.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-rose-600" />
            <h3 className="text-sm font-semibold text-rose-900">
              Requires Management Attention ({managementAttentionIssues.length})
            </h3>
          </div>
          <div className="space-y-2">
            {managementAttentionIssues.slice(0, 3).map((issue) => (
              <div
                key={issue.id}
                className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-rose-100"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge className={ISSUE_PRIORITY_STYLES[issue.priority]}>
                    {ISSUE_PRIORITY_LABELS[issue.priority]}
                  </Badge>
                  <span className="text-sm font-medium text-slate-900 truncate">
                    {issue.title}
                  </span>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap ml-3">
                  {issue.branch?.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout: reports + issues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Reports Summary */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">This Week's Reports</h3>
            <Badge className="bg-slate-100 text-slate-600 border-slate-200">
              {weeklyReports?.length ?? 0} total
            </Badge>
          </div>
          {weeklyReports && weeklyReports.length > 0 ? (
            <div className="space-y-2">
              {weeklyReports.slice(0, 6).map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {report.branch?.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {report.business?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    {report.status === 'draft' && <Clock size={14} className="text-slate-400" />}
                    {report.status === 'submitted' && <CheckCircle2 size={14} className="text-blue-500" />}
                    {report.status === 'reviewed' && <CheckCircle2 size={14} className="text-emerald-500" />}
                    <span className="text-xs font-medium text-slate-600 capitalize">
                      {report.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-6 text-center">
              No reports submitted for this week yet.
            </p>
          )}
        </div>

        {/* Active Issues */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Active Issues</h3>
            <Badge className="bg-amber-100 text-amber-700 border-amber-200">
              {issues?.length ?? 0} open
            </Badge>
          </div>
          {issues && issues.length > 0 ? (
            <div className="space-y-2">
              {issues.slice(0, 6).map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge className={ISSUE_STATUS_STYLES[issue.status]}>
                        {ISSUE_STATUS_LABELS[issue.status]}
                      </Badge>
                      <span className="text-sm font-medium text-slate-900 truncate">
                        {issue.title}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {issue.branch?.name}
                      {issue.deadline && (
                        <span className={isOverdue(issue.deadline) ? 'text-rose-500 ml-2' : 'ml-2'}>
                          Due {formatDate(issue.deadline)}
                        </span>
                      )}
                    </p>
                  </div>
                  <Badge className={`${ISSUE_PRIORITY_STYLES[issue.priority]} ml-2`}>
                    {ISSUE_PRIORITY_LABELS[issue.priority]}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-6 text-center">No active issues.</p>
          )}
        </div>
      </div>

      {/* Overdue issues row */}
      {overdueIssues.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={18} className="text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900">
              Overdue Items ({overdueIssues.length})
            </h3>
          </div>
          <div className="space-y-2">
            {overdueIssues.slice(0, 5).map((issue) => (
              <div
                key={issue.id}
                className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-amber-100"
              >
                <span className="text-sm font-medium text-slate-900 truncate">{issue.title}</span>
                <span className="text-xs text-rose-500 whitespace-nowrap ml-3">
                  {Math.abs(daysUntil(issue.deadline!))} days overdue
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type AccentColor = 'slate' | 'blue' | 'emerald' | 'amber' | 'rose';

const accentMap: Record<AccentColor, { bg: string; text: string; iconBg: string }> = {
  slate: { bg: 'bg-white', text: 'text-slate-900', iconBg: 'bg-slate-100 text-slate-600' },
  blue: { bg: 'bg-white', text: 'text-slate-900', iconBg: 'bg-blue-100 text-blue-600' },
  emerald: { bg: 'bg-white', text: 'text-slate-900', iconBg: 'bg-emerald-100 text-emerald-600' },
  amber: { bg: 'bg-white', text: 'text-slate-900', iconBg: 'bg-amber-100 text-amber-600' },
  rose: { bg: 'bg-white', text: 'text-slate-900', iconBg: 'bg-rose-100 text-rose-600' },
};

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: AccentColor;
}) {
  const a = accentMap[accent];
  return (
    <div className={`${a.bg} rounded-2xl border border-slate-200 p-5`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-xl ${a.iconBg}`}>{icon}</div>
      </div>
      <p className="text-2xl font-bold text-slate-900 tracking-tight">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{label}</p>
    </div>
  );
}
