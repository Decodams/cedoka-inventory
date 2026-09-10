import { useState, useMemo } from 'react';
import {
  ClipboardList,
  Plus,
  Eye,
  CheckCircle,
  Pencil,
  AlertTriangle,
  TrendingUp,
  Package,
  FileText,
  History,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import {
  REPORT_STATUS_STYLES,
  REPORT_STATUS_LABELS,
} from '@/lib/statusStyles';
import {
  formatCurrency,
  formatNumber,
  formatDate,
  weekRangeString,
  getWeekStart,
  getWeekEnd,
  toDateString,
} from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import type { WeeklyReport, Business, Branch, ReportAmendment } from '@/types/database';

export function WeeklyReportsPage() {
  const { user } = useAuth();
  const [selectedReport, setSelectedReport] = useState<WeeklyReport | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingReport, setEditingReport] = useState<WeeklyReport | null>(null);
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:branches:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const reportsQuery = useMemo(() => {
    let q = supabase
      .from('weekly_reports')
      .select(
        `*, business:businesses(id,name), branch:branches(id,name), submitted_by_user:user_profiles!submitted_by(full_name, manager_id), reviewed_by_user:user_profiles!reviewed_by(full_name, manager_id)`,
      )
      .order('week_end_date', { ascending: false })
      .order('created_at', { ascending: false });

    // Filter by user's own data + reportees if manager or above
    if (isExecutive) {
      // see all
    } else if (isBusinessLevel && user?.business_id) {
      q = q.eq('business_id', user.business_id);
      // TODO: add reportees filter when manager_id is populated
    }

    if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);

    return q.limit(50);
  }, [isExecutive, isBusinessLevel, user, filterBusiness, filterStatus]);

  const { data: reports, loading, error, refetch } = useSupabaseQuery<WeeklyReport[]>(
    () => reportsQuery,
    [reportsQuery],
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load weekly reports." onRetry={refetch} />;

  if (viewMode === 'detail' && selectedReport) {
    return (
      <ReportDetailView
        report={selectedReport}
        onBack={() => {
          setViewMode('list');
          setSelectedReport(null);
        }}
        onEdit={() => {
          setEditingReport(selectedReport);
          setShowFormModal(true);
        }}
        onRefresh={refetch}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Weekly Reports</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Sunday–Saturday reporting cycle. One report per branch per week.
          </p>
        </div>
        <Button onClick={() => { setEditingReport(null); setShowFormModal(true); }}>
          <Plus size={18} /> New Report
        </Button>
      </div>

      {/* Filters */}
      {isBusinessLevel && (
        <div className="flex gap-3">
          <Select value={filterBusiness} onChange={(e) => setFilterBusiness(e.target.value)} className="w-56">
            <option value="all">All Businesses</option>
            {businesses?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-44">
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="reviewed">Reviewed</option>
            <option value="amended">Amended</option>
          </Select>
        </div>
      )}

      {reports && reports.length > 0 ? (
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 transition-colors cursor-pointer"
              onClick={() => { setSelectedReport(report); setViewMode('detail'); }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                    <ClipboardList size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {report.branch?.name}
                      </h3>
<Badge className={REPORT_STATUS_STYLES[report.status]}>
                    {REPORT_STATUS_LABELS[report.status]}
                  </Badge>
                  {report.status === 'submitted' && (
                    <Badge
                      className="bg-gray-100 text-gray-500 border-gray-200 text-xs"
                    >
                      <AlertTriangle size={10} /> Locked
                    </Badge>
                  )}
                      {report.closing_stock_is_manual && (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                          Manual Closing
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {report.business?.name} · {weekRangeString(report.week_start_date, report.week_end_date)}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <TrendingUp size={13} className="text-emerald-500" />
                        {formatCurrency(Number(report.total_sales_value))}
                      </span>
                      <span className="flex items-center gap-1">
                        <Package size={13} className="text-blue-500" />
                        Sold: {formatNumber(report.stock_sold)}
                      </span>
                      {report.submitted_by_user && (
                        <span className="text-slate-400">
                          By {report.submitted_by_user.full_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Eye size={18} className="text-slate-300 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title="No weekly reports yet"
          description="Create your first weekly report to start tracking stock, sales, and operations."
          action={<Button onClick={() => setShowFormModal(true)}><Plus size={18} /> New Report</Button>}
        />
      )}

      {showFormModal && (
        <ReportFormModal
          report={editingReport}
          businesses={businesses ?? []}
          branches={branches ?? []}
          currentUser={user}
          onClose={() => { setShowFormModal(false); setEditingReport(null); }}
          onSaved={() => {
            refetch();
            setShowFormModal(false);
            setEditingReport(null);
          }}
        />
      )}
    </div>
  );
}

function ReportFormModal({
  report,
  businesses,
  branches,
  currentUser,
  onClose,
  onSaved,
}: {
  report: WeeklyReport | null;
  businesses: Business[];
  branches: Branch[];
  currentUser: { id: string; business_id: string | null; branch_id: string | null; role?: { name: string } } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const isBusinessLevel = currentUser?.role?.name === 'admin';

  const availableBusinesses = isExecutive ? businesses : businesses.filter((b) => b.id === currentUser?.business_id);
  const availableBranches = isExecutive
    ? branches
    : isBusinessLevel
      ? branches
      : branches.filter((b) => b.id === currentUser?.branch_id);

  const [businessId, setBusinessId] = useState(report?.business_id ?? currentUser?.business_id ?? '');
  const [branchId, setBranchId] = useState(report?.branch_id ?? currentUser?.branch_id ?? '');
  const weekEnd = toDateString(getWeekEnd(new Date()));
  const [weekEndDate, setWeekEndDate] = useState(report?.week_end_date ?? weekEnd);

  const [openingStock, setOpeningStock] = useState(report?.opening_stock?.toString() ?? '0');
  const [stockReceived, setStockReceived] = useState(report?.stock_received?.toString() ?? '0');
  const [stockSold, setStockSold] = useState(report?.stock_sold?.toString() ?? '0');
  const [stockDamaged, setStockDamaged] = useState(report?.stock_damaged?.toString() ?? '0');
  const [closingStock, setClosingStock] = useState(report?.closing_stock?.toString() ?? '0');
  const [closingStockIsManual, setClosingStockIsManual] = useState(report?.closing_stock_is_manual ?? false);
  const [openingDerived, setOpeningDerived] = useState(false);

  const [totalSalesValue, setTotalSalesValue] = useState(report?.total_sales_value?.toString() ?? '0');
  const [totalPurchaseValue, setTotalPurchaseValue] = useState(report?.total_purchase_value?.toString() ?? '0');
  const [pendingSalesValue, setPendingSalesValue] = useState(report?.pending_sales_value?.toString() ?? '0');
  const [pendingPurchaseValue, setPendingPurchaseValue] = useState(report?.pending_purchase_value?.toString() ?? '0');
  const [pendingProcurementValue, setPendingProcurementValue] = useState(report?.pending_procurement_value?.toString() ?? '0');

  const [activitiesNotes, setActivitiesNotes] = useState(report?.activities_notes ?? '');
  const [challengesNotes, setChallengesNotes] = useState(report?.challenges_notes ?? '');
  const [issuesNotes, setIssuesNotes] = useState(report?.issues_notes ?? '');
  const [improvementNotes, setImprovementNotes] = useState(report?.improvement_notes ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculatedClosing = Number(openingStock || 0) + Number(stockReceived || 0) - Number(stockSold || 0) - Number(stockDamaged || 0);
  const expectedClosing = closingStockIsManual ? Number(closingStock || 0) : calculatedClosing;
  const variance = Number(closingStock || 0) - calculatedClosing;

  // Auto-derive opening stock from prior approved period's closing stock (spec §10)
  const deriveOpening = async (bId: string, wEnd: string) => {
    if (report) return;
    if (!bId || !wEnd) return;
    const ws = toDateString(getWeekStart(new Date(wEnd)));
    // find most recent report before this week for same branch
    const { data } = await supabase
      .from('weekly_reports')
      .select('closing_stock')
      .eq('branch_id', bId)
      .lt('week_end_date', ws)
      .order('week_end_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setOpeningStock(String(data.closing_stock));
      setOpeningDerived(true);
      setTimeout(() => setOpeningDerived(false), 4000);
    }
  };

  const handleSave = async (submit: boolean = false) => {
    if (!businessId || !branchId) {
      setError('Please select a business and branch');
      return;
    }
    setSaving(true);
    setError(null);

    const ws = toDateString(getWeekStart(new Date(weekEndDate)));
    const data = {
      business_id: businessId,
      branch_id: branchId,
      week_start_date: ws,
      week_end_date: weekEndDate,
      opening_stock: Number(openingStock || 0),
      stock_received: Number(stockReceived || 0),
      stock_sold: Number(stockSold || 0),
      stock_damaged: Number(stockDamaged || 0),
      closing_stock: expectedClosing,
      closing_stock_is_manual: closingStockIsManual,
      total_sales_value: Number(totalSalesValue || 0),
      total_purchase_value: Number(totalPurchaseValue || 0),
      pending_sales_value: Number(pendingSalesValue || 0),
      pending_purchase_value: Number(pendingPurchaseValue || 0),
      pending_procurement_value: Number(pendingProcurementValue || 0),
      activities_notes: activitiesNotes,
      challenges_notes: challengesNotes,
      issues_notes: issuesNotes,
      improvement_notes: improvementNotes,
      status: submit ? 'submitted' : (report?.status ?? 'draft'),
      submitted_by: submit ? currentUser?.id : (report?.submitted_by ?? null),
      submitted_at: submit ? new Date().toISOString() : (report?.submitted_at ?? null),
      created_by: report?.created_by ?? currentUser?.id,
    };

    if (report) {
      const { error: updateError } = await supabase
        .from('weekly_reports')
        .update(data)
        .eq('id', report.id);
      if (updateError) {
        setError('Could not save the report. Please try again.');
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('weekly_reports')
        .insert(data);
      if (insertError) {
        setError('Could not create the report. Please try again.');
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={report ? 'Edit Weekly Report' : 'New Weekly Report'} size="xl">
      <div className="space-y-6">
        {/* Header: Business, Branch, Week */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select label="Business Unit" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setBranchId(''); }} disabled={!!report}>
            <option value="">Select...</option>
            {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Branch" value={branchId} onChange={(e) => { setBranchId(e.target.value); if (e.target.value) deriveOpening(e.target.value, weekEndDate); }} disabled={!!report}>
            <option value="">Select...</option>
            {availableBranches.filter((b) => !businessId || b.business_id === businessId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Input label="Week Ending (Saturday)" type="date" value={weekEndDate} onChange={(e) => { setWeekEndDate(e.target.value); if (branchId) deriveOpening(branchId, e.target.value); }} disabled={!!report} />
        </div>

        {/* Stock Position */}
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Package size={16} /> Stock Position
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Input label="Opening Stock" type="number" value={openingStock} onChange={(e) => { setOpeningStock(e.target.value); setOpeningDerived(false); }} />
              {openingDerived && <p className="text-[11px] text-emerald-600 mt-1">Auto-filled from prior closing stock</p>}
            </div>
            <Input label="Stock Received" type="number" value={stockReceived} onChange={(e) => setStockReceived(e.target.value)} />
            <Input label="Stock Sold" type="number" value={stockSold} onChange={(e) => setStockSold(e.target.value)} />
            <Input label="Stock Damaged" type="number" value={stockDamaged} onChange={(e) => setStockDamaged(e.target.value)} />
          </div>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4 items-end">
            <div>
              <Input
                label="Closing Stock (Actual)"
                type="number"
                value={closingStockIsManual ? closingStock : calculatedClosing.toString()}
                onChange={(e) => { setClosingStock(e.target.value); setClosingStockIsManual(true); }}
                disabled={!closingStockIsManual}
              />
              <label className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={closingStockIsManual}
                  onChange={(e) => setClosingStockIsManual(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Override auto-calculated closing stock (discrepancies will be flagged)
              </label>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Expected Closing:</span>
                <span className="font-medium text-slate-900">{formatNumber(calculatedClosing)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Actual Closing:</span>
                <span className="font-medium text-slate-900">{formatNumber(closingStockIsManual ? Number(closingStock || 0) : calculatedClosing)}</span>
              </div>
              {closingStockIsManual && variance !== 0 && (
                <div className="flex justify-between text-sm pt-1.5 border-t border-slate-200">
                  <span className="text-amber-600 font-medium">Variance:</span>
                  <span className={`font-semibold ${variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {variance > 0 ? '+' : ''}{formatNumber(variance)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Financial Summary */}
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <TrendingUp size={16} /> Financial Summary (NGN)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Input label="Total Sales Value" type="number" value={totalSalesValue} onChange={(e) => setTotalSalesValue(e.target.value)} />
            <Input label="Total Purchase Value" type="number" value={totalPurchaseValue} onChange={(e) => setTotalPurchaseValue(e.target.value)} />
            <Input label="Pending Sales (Owed to Us)" type="number" value={pendingSalesValue} onChange={(e) => setPendingSalesValue(e.target.value)} />
            <Input label="Pending Purchases (Owed to Suppliers)" type="number" value={pendingPurchaseValue} onChange={(e) => setPendingPurchaseValue(e.target.value)} />
            <Input label="Pending Procurement (Ordered, Not Received)" type="number" value={pendingProcurementValue} onChange={(e) => setPendingProcurementValue(e.target.value)} />
          </div>
        </div>

        {/* Narrative */}
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <FileText size={16} /> Narrative & Notes
          </h3>
          <div className="space-y-3">
            <Textarea label="Activities This Week" value={activitiesNotes} onChange={(e) => setActivitiesNotes(e.target.value)} placeholder="What happened this week? Key events, activities, operations..." />
            <Textarea label="Challenges Encountered" value={challengesNotes} onChange={(e) => setChallengesNotes(e.target.value)} placeholder="Difficulties faced, obstacles, problems..." />
            <Textarea label="Issues Needing Escalation" value={issuesNotes} onChange={(e) => setIssuesNotes(e.target.value)} placeholder="Matters that require management attention..." />
            <Textarea label="Improvements Made or Suggested" value={improvementNotes} onChange={(e) => setImprovementNotes(e.target.value)} placeholder="What went well, what can be better..." />
          </div>
        </div>

        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? 'Saving...' : 'Save as Draft'}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving}>
            {saving ? 'Saving...' : 'Save & Submit'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReportDetailView({
  report,
  onBack,
  onEdit,
  onRefresh,
}: {
  report: WeeklyReport;
  onBack: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const { user } = useAuth();
  const [showAmendModal, setShowAmendModal] = useState(false);
  const [amendReason, setAmendReason] = useState('');
  const [reviewNotes, setReviewNotes] = useState(report.review_notes ?? '');
  const [saving, setSaving] = useState(false);

  const { data: amendments } = useSupabaseQuery<ReportAmendment[]>(
    () =>
      supabase
        .from('report_amendments')
        .select(`*, amended_by_user:user_profiles!amended_by(full_name)`)
        .eq('weekly_report_id', report.id)
        .order('amended_at', { ascending: false }),
    [report.id],
  );

  const canEdit = report.status === 'draft' || isAtLeast(user, 'admin');
  const canReview = isAtLeast(user, 'admin') && report.status === 'submitted';
  const canAmend = isAtLeast(user, 'admin') && (report.status === 'submitted' || report.status === 'reviewed');

  const expectedClosing = report.opening_stock + report.stock_received - report.stock_sold - report.stock_damaged;
  const variance = report.closing_stock - expectedClosing;

  const handleReview = async (approve: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from('weekly_reports')
      .update({
        status: approve ? 'reviewed' : 'amended',
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
      })
      .eq('id', report.id);
    setSaving(false);
    if (error) return;
    onRefresh();
    onBack();
  };

  const handleAmend = async () => {
    if (!amendReason.trim()) return;
    setSaving(true);

    const previousValues = {
      opening_stock: report.opening_stock,
      stock_received: report.stock_received,
      stock_sold: report.stock_sold,
      stock_damaged: report.stock_damaged,
      closing_stock: report.closing_stock,
      total_sales_value: report.total_sales_value,
      total_purchase_value: report.total_purchase_value,
      activities_notes: report.activities_notes,
      challenges_notes: report.challenges_notes,
      issues_notes: report.issues_notes,
      improvement_notes: report.improvement_notes,
    };

    const { error: amendError } = await supabase.from('report_amendments').insert({
      weekly_report_id: report.id,
      amended_by: user?.id,
      previous_values: previousValues,
      new_values: {},
      reason: amendReason,
    });

    if (amendError) {
      setSaving(false);
      return;
    }

    await supabase
      .from('weekly_reports')
      .update({ status: 'amended' })
      .eq('id', report.id);

    setSaving(false);
    setShowAmendModal(false);
    setAmendReason('');
    onRefresh();
    onEdit();
  };

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
        ← Back to Reports
      </button>

      {/* Report header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-slate-900">{report.branch?.name}</h2>
              <Badge className={REPORT_STATUS_STYLES[report.status]}>
                {REPORT_STATUS_LABELS[report.status]}
              </Badge>
            </div>
            <p className="text-sm text-slate-500">
              {report.business?.name} · {weekRangeString(report.week_start_date, report.week_end_date)}
            </p>
            {report.submitted_by_user && (
              <p className="text-xs text-slate-400 mt-1">
                Submitted by {report.submitted_by_user.full_name}
                {report.submitted_at && ` on ${formatDate(report.submitted_at)}`}
              </p>
            )}
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil size={14} /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* Stock Reconciliation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Package size={16} /> Stock Reconciliation
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StockMetric label="Opening Stock" value={report.opening_stock} />
          <StockMetric label="Stock Received" value={report.stock_received} positive />
          <StockMetric label="Stock Sold" value={report.stock_sold} />
          <StockMetric label="Stock Damaged" value={report.stock_damaged} negative />
        </div>
        <div className="mt-4 bg-slate-50 rounded-xl p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex justify-between sm:block">
              <span className="text-sm text-slate-500">Expected Closing:</span>
              <span className="text-lg font-bold text-slate-900 sm:block">{formatNumber(expectedClosing)}</span>
            </div>
            <div className="flex justify-between sm:block">
              <span className="text-sm text-slate-500">Actual Closing:</span>
              <span className="text-lg font-bold text-slate-900 sm:block">{formatNumber(report.closing_stock)}</span>
              {report.closing_stock_is_manual && (
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 mt-1">Manual Override</Badge>
              )}
            </div>
            <div className="flex justify-between sm:block">
              <span className="text-sm text-slate-500">Variance:</span>
              <span className={`text-lg font-bold sm:block ${variance === 0 ? 'text-slate-900' : variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {variance > 0 ? '+' : ''}{formatNumber(variance)}
              </span>
              {variance !== 0 && (
                <Badge className="bg-rose-100 text-rose-700 border-rose-200 mt-1">Discrepancy</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <TrendingUp size={16} /> Financial Summary
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FinanceMetric label="Total Sales" value={formatCurrency(Number(report.total_sales_value))} positive />
          <FinanceMetric label="Total Purchases" value={formatCurrency(Number(report.total_purchase_value))} />
          <FinanceMetric label="Pending Sales (Receivable)" value={formatCurrency(Number(report.pending_sales_value))} />
          <FinanceMetric label="Pending Purchases (Payable)" value={formatCurrency(Number(report.pending_purchase_value))} />
          <FinanceMetric label="Pending Procurement" value={formatCurrency(Number(report.pending_procurement_value))} />
        </div>
      </div>

      {/* Narrative */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <FileText size={16} /> Narrative
        </h3>
        {report.activities_notes && <NarrativeSection label="Activities" content={report.activities_notes} />}
        {report.challenges_notes && <NarrativeSection label="Challenges" content={report.challenges_notes} />}
        {report.issues_notes && <NarrativeSection label="Issues Requiring Escalation" content={report.issues_notes} />}
        {report.improvement_notes && <NarrativeSection label="Improvements" content={report.improvement_notes} />}
        {!report.activities_notes && !report.challenges_notes && !report.issues_notes && !report.improvement_notes && (
          <p className="text-sm text-slate-400">No narrative provided.</p>
        )}
      </div>

      {/* Amendments history */}
      {amendments && amendments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <History size={16} /> Amendment History
          </h3>
          <div className="space-y-3">
            {amendments.map((a) => (
              <div key={a.id} className="border-l-2 border-amber-300 pl-4 py-1">
                <p className="text-sm text-slate-700">{a.reason}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {a.amended_by_user?.full_name} · {formatDate(a.amended_at)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review actions */}
      {canReview && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Review Report</h3>
          <Textarea
            label="Review Notes"
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Add review comments..."
          />
          <div className="flex gap-3 mt-4">
            <Button onClick={() => handleReview(true)} disabled={saving}>
              <CheckCircle size={16} /> Approve & Mark Reviewed
            </Button>
            <Button variant="danger" onClick={() => handleReview(false)} disabled={saving}>
              <AlertTriangle size={16} /> Flag for Amendment
            </Button>
          </div>
        </div>
      )}

      {/* Amend action */}
      {canAmend && !canReview && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setShowAmendModal(true)}>
            <History size={16} /> Amend Report
          </Button>
        </div>
      )}

      {showAmendModal && (
        <Modal open onClose={() => setShowAmendModal(false)} title="Amend Report" size="md">
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Amending this report will record the current values and your reason in the audit trail.
              You will then be able to edit the report.
            </p>
            <Textarea
              label="Reason for Amendment"
              value={amendReason}
              onChange={(e) => setAmendReason(e.target.value)}
              placeholder="Explain why this report needs amendment..."
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAmendModal(false)}>Cancel</Button>
              <Button onClick={handleAmend} disabled={saving || !amendReason.trim()}>
                {saving ? 'Processing...' : 'Proceed to Amend'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StockMetric({ label, value, positive, negative }: { label: string; value: number; positive?: boolean; negative?: boolean }) {
  const color = negative ? 'text-rose-600' : positive ? 'text-emerald-600' : 'text-slate-900';
  return (
    <div className="bg-slate-50 rounded-xl p-3.5">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{formatNumber(value)}</p>
    </div>
  );
}

function FinanceMetric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3.5">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${positive ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function NarrativeSection({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{content}</p>
    </div>
  );
}
