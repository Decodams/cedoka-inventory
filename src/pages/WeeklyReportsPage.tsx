import { useState, useMemo, useEffect } from 'react';
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
  Flag,
  Wand2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { ErrorState, EmptyState, ListSkeleton } from '@/components/ui/States';
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
  getSalesWeekStart,
  getSalesWeekEnd,
  toDateString,
} from '@/lib/dateUtils';
import { isAtLeast, hasRole, accessibleBusinessIds, fullAccessibleBranchIds } from '@/lib/rbac';
import { sanitizeMultiline } from '@/lib/sanitize';
import { AutoGenerateWeeklyReportModal } from '@/components/AutoGenerateWeeklyReport';
import { ReportFormModal } from '@/components/ReportFormModal';
import type { WeeklyReport, Business, Branch, ReportAmendment, UserProfile, ReportPriority } from '@/types/database';

const REPORT_PRIORITY_LABELS: Record<ReportPriority, string> = {
  normal: 'Normal',
  priority: 'Priority',
  urgent: 'Urgent',
};

const REPORT_PRIORITY_STYLES: Record<ReportPriority, string> = {
  normal: 'bg-slate-100 text-slate-600 border-slate-200',
  priority: 'bg-amber-100 text-amber-700 border-amber-200',
  urgent: 'bg-rose-100 text-rose-700 border-rose-200',
};

export function WeeklyReportsPage() {
  const { user } = useAuth();
  const [selectedReport, setSelectedReport] = useState<WeeklyReport | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingReport, setEditingReport] = useState<WeeklyReport | null>(null);
  const [autoGenOpen, setAutoGenOpen] = useState(false);
  const [autoGenData, setAutoGenData] = useState<{activities_notes:string;challenges_notes:string;issues_notes:string;improvement_notes:string}|null>(null);
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

    if (isExecutive) {
      // see all
    } else {
      // Everyone below Super Admin only lists reports from their own scope:
      // primary business + explicit assignments, and branches my_branch_ids()
      // returns (assignments, managed, and business oversight for Admins).
      const bizIds = accessibleBusinessIds(user);
      if (bizIds.length === 1) q = q.eq('business_id', bizIds[0]);
      else if (bizIds.length > 1) q = q.in('business_id', bizIds);
      const branchIds = fullAccessibleBranchIds(user);
      if (branchIds.length > 0) q = q.in('branch_id', branchIds);
    }

    if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);

    return q.limit(50);
  }, [isExecutive, user, filterBusiness, filterStatus]);

  const { data: reports, loading, error, refetch } = useSupabaseQuery<WeeklyReport[]>(
    () => reportsQuery,
    [reportsQuery],
  );

  if (loading) return <ListSkeleton rows={5} />;
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Weekly Reports</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Monday–Saturday reporting cycle. One report per branch per week.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={() => { setAutoGenData(null); setAutoGenOpen(true); }} className="w-full sm:w-auto">
            <Wand2 size={18} /> Auto-Generate
          </Button>
          <Button onClick={() => { setEditingReport(null); setAutoGenData(null); setShowFormModal(true); }} className="w-full sm:w-auto">
            <Plus size={18} /> New Report
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {isBusinessLevel && (
          <Select value={filterBusiness} onChange={(e) => setFilterBusiness(e.target.value)} className="w-full sm:w-56">
            <option value="all">All Businesses</option>
            {businesses?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        )}
        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full sm:w-44">
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="reviewed">Reviewed</option>
          <option value="amended">Amended</option>
        </Select>
      </div>

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
                  {report.priority !== 'normal' && (
                    <Badge className={REPORT_PRIORITY_STYLES[report.priority]}>
                      {REPORT_PRIORITY_LABELS[report.priority]}
                    </Badge>
                  )}
                  {report.escalated && (
                    <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                      <Flag size={10} /> Escalated
                    </Badge>
                  )}
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
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
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
          autoGen={autoGenData}
          onClose={() => { setShowFormModal(false); setEditingReport(null); setAutoGenData(null); }}
          onSaved={() => {
            refetch();
            setShowFormModal(false);
            setEditingReport(null);
            setAutoGenData(null);
          }}
        />
      )}
      <AutoGenerateWeeklyReportModal
        open={autoGenOpen}
        onClose={() => setAutoGenOpen(false)}
        businesses={businesses ?? []}
        branches={branches ?? []}
        currentUser={user}
        onGenerated={(n) => { setAutoGenData(n); setEditingReport(null); setShowFormModal(true); setAutoGenOpen(false); }}
      />
    </div>
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(report.escalated ?? false);
  const [escalatedAt, setEscalatedAt] = useState(report.escalated_at ?? null);

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
  const canEscalate = !escalated && isAtLeast(user, 'admin');

  const expectedClosing = report.opening_stock + report.stock_received - report.stock_sold - report.stock_damaged;
  const variance = report.closing_stock - expectedClosing;

  const handleEscalate = async () => {
    setSaving(true);
    setActionError(null);
    const { error } = await supabase
      .from('weekly_reports')
      .update({
        escalated: true,
        escalated_at: new Date().toISOString(),
        escalated_by: user?.id,
      })
      .eq('id', report.id);
    setSaving(false);
    if (error) {
      setActionError('Could not escalate this report. Please try again.');
      return;
    }
    setEscalated(true);
    setEscalatedAt(new Date().toISOString());
    onRefresh();
  };

  const handleReview = async (approve: boolean) => {
    setSaving(true);
    setActionError(null);
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
    if (error) {
      setActionError('Could not save the review. Please try again.');
      return;
    }
    onRefresh();
    onBack();
  };

  const handleAmend = async () => {
    if (!amendReason.trim()) return;
    setSaving(true);
    setActionError(null);

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
      setActionError('Could not amend this report. Please try again.');
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
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900">{report.branch?.name}</h2>
              <Badge className={REPORT_STATUS_STYLES[report.status]}>
                {REPORT_STATUS_LABELS[report.status]}
              </Badge>
              {report.priority !== 'normal' && (
                <Badge className={REPORT_PRIORITY_STYLES[report.priority]}>
                  {REPORT_PRIORITY_LABELS[report.priority]}
                </Badge>
              )}
              {escalated && (
                <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                  <Flag size={10} /> Escalated
                </Badge>
              )}
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
            {escalated && escalatedAt && (
              <p className="text-xs text-rose-500 mt-1">Escalated on {formatDate(escalatedAt)}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canEscalate && (
              <Button variant="outline" size="sm" className="text-rose-600 border-rose-200 hover:bg-rose-50" onClick={handleEscalate} disabled={saving}>
                <Flag size={14} /> Escalate
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil size={14} /> Edit
              </Button>
            )}
          </div>
        </div>
        {actionError && (
          <p role="alert" className="mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {actionError}
          </p>
        )}
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
          {actionError && (
            <p role="alert" className="mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {actionError}
            </p>
          )}
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
            {actionError && (
              <p role="alert" className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {actionError}
              </p>
            )}
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
