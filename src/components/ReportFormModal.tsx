import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Coins,
  FileText,
  Package,
  RefreshCw,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/hooks/useSupabaseQuery';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  getSalesWeekEnd,
  getSalesWeekStart,
  toDateString,
} from '@/lib/dateUtils';
import { accessibleBusinessIds, fullAccessibleBranchIds } from '@/lib/rbac';
import { sanitizeMultiline } from '@/lib/sanitize';
import { fetchLiveReportSnapshot, type LiveReportSnapshot } from '@/lib/liveReportSnapshot';
import type { Business, Branch, ReportPriority, UserProfile, WeeklyReport } from '@/types/database';

type StockKey =
  | 'opening_stock'
  | 'stock_received'
  | 'stock_sold'
  | 'stock_damaged'
  | 'total_sales_value'
  | 'total_purchase_value';

interface ReportFormModalProps {
  report: WeeklyReport | null;
  businesses: Business[];
  branches: Branch[];
  currentUser: UserProfile | null;
  autoGen?: {
    activities_notes: string;
    challenges_notes: string;
    issues_notes: string;
    improvement_notes: string;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}

const ALL_OVERRIDDEN: Record<StockKey, boolean> = {
  opening_stock: true,
  stock_received: true,
  stock_sold: true,
  stock_damaged: true,
  total_sales_value: true,
  total_purchase_value: true,
};

/**
 * Professional weekly report composer.
 * Stock figures come from the live system (inventory balances + ledger) by
 * default; anything the user edits is flagged as a manual override and kept.
 */
export function ReportFormModal({
  report,
  businesses,
  branches,
  currentUser,
  autoGen,
  onClose,
  onSaved,
}: ReportFormModalProps) {
  const { user } = useAuth();
  const isExecutive = currentUser?.role?.name === 'super_admin';

  const accessibleBizIds = useMemo(() => accessibleBusinessIds(currentUser), [currentUser]);
  const userBranchScope = useMemo(() => fullAccessibleBranchIds(currentUser), [currentUser]);
  const availableBusinesses = isExecutive
    ? businesses
    : businesses.filter((b) => accessibleBizIds.includes(b.id));

  const [businessId, setBusinessId] = useState(
    report?.business_id ??
      (accessibleBizIds.length === 1 ? accessibleBizIds[0] : currentUser?.business_id ?? ''),
  );
  const [branchId, setBranchId] = useState(report?.branch_id ?? currentUser?.branch_id ?? '');
  const availableBranches = useMemo(() => {
    const scoped = isExecutive ? branches : branches.filter((b) => userBranchScope.includes(b.id));
    return businessId ? scoped.filter((b) => b.business_id === businessId) : scoped;
  }, [isExecutive, branches, userBranchScope, businessId]);

  const weekEnd = toDateString(getSalesWeekEnd(new Date()));
  const [weekEndDate, setWeekEndDate] = useState(report?.week_end_date ?? weekEnd);
  const [priority, setPriority] = useState<ReportPriority>(report?.priority ?? 'normal');

  useEffect(() => {
    if (report) return;
    if (!businessId && availableBusinesses.length === 1) setBusinessId(availableBusinesses[0].id);
  }, [report, businessId, availableBusinesses]);
  useEffect(() => {
    if (report) return;
    if (!branchId && availableBranches.length === 1) setBranchId(availableBranches[0].id);
  }, [report, branchId, availableBranches]);

  const [openingStock, setOpeningStock] = useState(report?.opening_stock?.toString() ?? '0');
  const [stockReceived, setStockReceived] = useState(report?.stock_received?.toString() ?? '0');
  const [stockSold, setStockSold] = useState(report?.stock_sold?.toString() ?? '0');
  const [stockDamaged, setStockDamaged] = useState(report?.stock_damaged?.toString() ?? '0');
  const [closingStock, setClosingStock] = useState(report?.closing_stock?.toString() ?? '0');
  const [closingStockIsManual, setClosingStockIsManual] = useState(
    report?.closing_stock_is_manual ?? false,
  );
  const [totalSalesValue, setTotalSalesValue] = useState(
    report?.total_sales_value?.toString() ?? '0',
  );
  const [totalPurchaseValue, setTotalPurchaseValue] = useState(
    report?.total_purchase_value?.toString() ?? '0',
  );
  const [pendingSalesValue, setPendingSalesValue] = useState(
    report?.pending_sales_value?.toString() ?? '0',
  );
  const [pendingPurchaseValue, setPendingPurchaseValue] = useState(
    report?.pending_purchase_value?.toString() ?? '0',
  );
  const [pendingProcurementValue, setPendingProcurementValue] = useState(
    report?.pending_procurement_value?.toString() ?? '0',
  );
  const [activitiesNotes, setActivitiesNotes] = useState(
    report?.activities_notes ?? autoGen?.activities_notes ?? '',
  );
  const [challengesNotes, setChallengesNotes] = useState(
    report?.challenges_notes ?? autoGen?.challenges_notes ?? '',
  );
  const [issuesNotes, setIssuesNotes] = useState(
    report?.issues_notes ?? autoGen?.issues_notes ?? '',
  );
  const [improvementNotes, setImprovementNotes] = useState(
    report?.improvement_notes ?? autoGen?.improvement_notes ?? '',
  );

  const [overridden, setOverridden] = useState<Record<StockKey, boolean>>(
    report ? { ...ALL_OVERRIDDEN } : ({} as Record<StockKey, boolean>),
  );
  const [snapshot, setSnapshot] = useState<LiveReportSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [showProductBreakdown, setShowProductBreakdown] = useState(false);
  const [tab, setTab] = useState<'stock' | 'money' | 'notes'>('stock');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncIsError, setSyncIsError] = useState(false);

  const loadSnapshot = async () => {
    if (!branchId || !weekEndDate) return;
    setLoadingSnapshot(true);
    setSnapshotError(null);
    try {
      const snap = await fetchLiveReportSnapshot(branchId, weekEndDate);
      setSnapshot(snap);
      if (!report) {
        if (!overridden.opening_stock) setOpeningStock(String(snap.opening_stock));
        if (!overridden.stock_received) setStockReceived(String(snap.received));
        if (!overridden.stock_sold) setStockSold(String(snap.sold));
        if (!overridden.stock_damaged) setStockDamaged(String(snap.damaged));
        if (!overridden.total_sales_value) setTotalSalesValue(String(Math.round(snap.sales_value)));
        if (!overridden.total_purchase_value) {
          setTotalPurchaseValue(String(Math.round(snap.purchase_value)));
        }
      }
    } catch {
      setSnapshotError('Live figures could not be loaded. You can still enter values manually.');
    } finally {
      setLoadingSnapshot(false);
    }
  };

  useEffect(() => {
    setSnapshot(null);
    setSyncMessage(null);
    if (report) {
      // Keep saved values; still load the per-product breakdown for context.
      if (branchId && weekEndDate) void fetchLiveReportSnapshot(branchId, weekEndDate).then(setSnapshot).catch(() => undefined);
      return;
    }
    if (branchId && weekEndDate) void loadSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, weekEndDate, report?.id]);

  const edit = (key: StockKey, value: string, setter: (v: string) => void) => {
    setter(value);
    setOverridden((prev) => ({ ...prev, [key]: true }));
  };

  const calculatedClosing =
    Number(openingStock || 0) +
    Number(stockReceived || 0) -
    Number(stockSold || 0) -
    Number(stockDamaged || 0);
  const expectedClosing = closingStockIsManual ? Number(closingStock || 0) : calculatedClosing;
  const variance = Number(closingStock || 0) - calculatedClosing;

  const handleSave = async (submit: boolean) => {
    if (!businessId || !branchId) {
      setError('Please select a business and branch');
      setTab('stock');
      return;
    }
    const isFinalised = report && (report.status === 'reviewed' || report.status === 'amended');
    if (
      report &&
      (report.status === 'submitted' || report.status === 'reviewed' || report.status === 'amended') &&
      !window.confirm(
        `This report is already ${report.status}. Saving will overwrite its current content. Continue?`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setSyncMessage(null);
    setSyncIsError(false);

    const ws = toDateString(getSalesWeekStart(new Date(`${weekEndDate}T12:00:00`)));
    const data = {
      business_id: businessId,
      branch_id: branchId,
      week_start_date: ws,
      week_end_date: weekEndDate,
      priority,
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
      activities_notes: sanitizeMultiline(activitiesNotes),
      challenges_notes: sanitizeMultiline(challengesNotes),
      issues_notes: sanitizeMultiline(issuesNotes),
      improvement_notes: sanitizeMultiline(improvementNotes),
      // A reviewed/amended report keeps its outcome; re-submitting only applies
      // to drafts/submitted reports, and never rewrites the original submitter.
      status: isFinalised
        ? report!.status
        : submit
          ? 'submitted'
          : report?.status ?? 'draft',
      submitted_by: report?.submitted_by ?? (submit ? currentUser?.id : null),
      submitted_at: report?.submitted_at ?? (submit ? new Date().toISOString() : null),
      created_by: report?.created_by ?? currentUser?.id,
    };

    let savedId = report?.id;
    if (report) {
      const { error: updateError } = await supabase
        .from('weekly_reports')
        .update(data)
        .eq('id', report.id);
      if (updateError) {
        setError(updateError.message || 'Could not save the report.');
        setSaving(false);
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('weekly_reports')
        .insert(data)
        .select('id')
        .single();
      if (insertError || !inserted) {
        setError(
          insertError?.code === '23505'
            ? 'A report already exists for this branch and week. Edit that report instead.'
            : insertError?.message ?? 'Could not create the report.',
        );
        setSaving(false);
        return;
      }
      savedId = (inserted as { id: string }).id;
    }

    // Make the live stock balance match the report's closing stock (audited).
    if (submit && savedId) {
      const { data: syncResult, error: syncError } = await supabase.rpc(
        'sync_weekly_report_stock',
        {
          p_report_id: savedId,
          p_closing_stock: expectedClosing,
          p_reason: `Weekly report closing stock — week ending ${weekEndDate}`,
        },
      );
      if (syncError) {
        setSyncIsError(true);
        setSyncMessage(`Report saved, but stock sync failed: ${syncError.message}`);
      } else {
        const result = syncResult as {
          applied?: boolean;
          reason?: string;
          difference?: number;
          lines_adjusted?: number;
        } | null;
        if (result?.applied) {
          setSyncIsError(false);
          setSyncMessage(
            `Stock balance synced — ${result.lines_adjusted} product line(s) adjusted by ${formatNumber(result.difference ?? 0)}.`,
          );
        } else {
          setSyncIsError(true);
          setSyncMessage(
            `Report saved. Stock was NOT changed (${result?.reason ?? 'no adjustment applied'}). Review the variance and correct stock via Inventory → Record Movement.`,
          );
        }
      }
    }

    setSaving(false);
    onSaved();
  };

  const weekLabel = `${formatDate(`${weekEndDate}T12:00:00`)} week ending`;
  const productRows = snapshot?.products ?? [];

  return (
    <Modal open onClose={onClose} title={report ? 'Edit Weekly Report' : 'New Weekly Report'} size="xl">
      <div className="space-y-4">
        {autoGen && !report && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <Sparkles size={16} /> Narrative auto-generated from daily activities. Review and edit before saving.
          </div>
        )}
        {syncMessage && (
          <div role={syncIsError ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${syncIsError ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {syncIsError ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />} {syncMessage}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {/* Context bar */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Business unit" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setBranchId(''); }} disabled={!!report}>
              <option value="">Select...</option>
              {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!!report}>
              <option value="">Select...</option>
              {availableBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Input label="Week ending (Saturday)" type="date" value={weekEndDate} onChange={(e) => setWeekEndDate(e.target.value)} disabled={!!report} />
            <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as ReportPriority)}>
              <option value="normal">Normal</option>
              <option value="priority">Priority</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
            <ClipboardList size={13} /> {weekLabel} · Monday–Saturday cycle · one report per branch
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
          {([
            { key: 'stock', label: 'Stock position', icon: Package },
            { key: 'money', label: 'Money', icon: Wallet },
            { key: 'notes', label: 'Notes & narrative', icon: FileText },
          ] as const).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                  tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'stock' && (
          <div className="space-y-4">
            {/* Live sync banner */}
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-sm text-emerald-800">
                {loadingSnapshot ? (
                  <RefreshCw size={16} className="mt-0.5 animate-spin" />
                ) : (
                  <Activity size={16} className="mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {report ? 'Saved report · live balance shown for reference' : 'Live figures pulled from the system'}
                  </p>
                  <p className="text-xs text-emerald-600">
                    {snapshot
                      ? `Opening stock derived from live balances + this week's ledger · as of ${formatDateTime(snapshot.loadedAt)}`
                      : 'Opening stock is derived from the stock held at this branch.'}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadSnapshot()} disabled={loadingSnapshot || !branchId} className="shrink-0">
                <RefreshCw size={13} className={loadingSnapshot ? 'animate-spin' : ''} /> Refresh
              </Button>
            </div>
            {snapshotError && <p className="text-xs text-amber-600">{snapshotError}</p>}

            {/* Reconciliation flow */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Package size={16} /> Stock reconciliation
              </h3>
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-center">
                <FlowChip label="Opening" value={openingStock} tone="slate" />
                <ArrowRight size={14} className="hidden text-slate-300 sm:block" />
                <FlowChip label="Received" value={stockReceived} tone="emerald" />
                <span className="text-sm font-semibold text-slate-400">−</span>
                <FlowChip label="Sold" value={stockSold} tone="rose" />
                <span className="text-sm font-semibold text-slate-400">−</span>
                <FlowChip label="Damaged" value={stockDamaged} tone="rose" />
                <ArrowRight size={14} className="hidden text-slate-300 sm:block" />
                <FlowChip label="Expected closing" value={calculatedClosing} tone="dark" />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <LiveField label="Opening stock" value={openingStock} live={!overridden.opening_stock} onChange={(v) => edit('opening_stock', v, setOpeningStock)} />
                <LiveField label="Stock received" value={stockReceived} live={!overridden.stock_received} onChange={(v) => edit('stock_received', v, setStockReceived)} />
                <LiveField label="Stock sold" value={stockSold} live={!overridden.stock_sold} onChange={(v) => edit('stock_sold', v, setStockSold)} />
                <LiveField label="Stock damaged" value={stockDamaged} live={!overridden.stock_damaged} onChange={(v) => edit('stock_damaged', v, setStockDamaged)} />
              </div>

              {snapshot && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <MiniStat label="Transfers in" value={snapshot.transfers_in} />
                  <MiniStat label="Transfers out" value={snapshot.transfers_out} />
                  <MiniStat label="Returns" value={snapshot.returns} />
                  <MiniStat label="Adjustments" value={snapshot.adjustments} />
                </div>
              )}

              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <div>
                  <Input
                    label="Physical closing count"
                    type="number"
                    value={closingStockIsManual ? closingStock : String(calculatedClosing)}
                    onChange={(e) => { setClosingStock(e.target.value); setClosingStockIsManual(true); }}
                    disabled={!closingStockIsManual}
                  />
                  <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <input type="checkbox" checked={closingStockIsManual} onChange={(e) => setClosingStockIsManual(e.target.checked)} className="rounded border-slate-300" />
                    Override with a physical count (variance is flagged, not hidden)
                  </label>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Expected closing</span><span className="font-semibold">{formatNumber(calculatedClosing)}</span></div>
                  <div className="mt-1 flex justify-between"><span className="text-slate-500">Reported closing</span><span className="font-semibold">{formatNumber(expectedClosing)}</span></div>
                  {closingStockIsManual && variance !== 0 && (
                    <div className="mt-2 flex justify-between border-t border-slate-200 pt-2">
                      <span className="font-medium text-amber-600">Variance</span>
                      <span className={`font-bold ${variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{variance > 0 ? '+' : ''}{formatNumber(variance)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Per-product live balances */}
            {productRows.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white">
                <button onClick={() => setShowProductBreakdown((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800">
                  <span className="flex items-center gap-2"><Coins size={15} /> {productRows.length} product balance(s) at this branch</span>
                  <ChevronDown size={16} className={`text-slate-400 transition ${showProductBreakdown ? 'rotate-180' : ''}`} />
                </button>
                {showProductBreakdown && (
                  <div className="max-h-56 overflow-y-auto border-t border-slate-100">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">Opening</th><th className="px-4 py-2 text-right">Current</th></tr></thead>
                      <tbody className="divide-y divide-slate-50">
                        {productRows.map((p) => (
                          <tr key={p.id}>
                            <td className="px-4 py-2"><span className="font-medium text-slate-800">{p.name}</span>{p.sku && <span className="block text-xs text-slate-400">{p.sku}</span>}</td>
                            <td className="px-4 py-2 text-right text-slate-500">{formatNumber(p.opening)}</td>
                            <td className="px-4 py-2 text-right font-semibold text-slate-900">{formatNumber(p.current)} {p.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'money' && (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-xs text-slate-500"><Coins size={14} /> Amounts in NGN. Sales and purchase values are pulled from the week's transactions and can be adjusted.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <LiveField label="Total sales value" value={totalSalesValue} live={!overridden.total_sales_value} onChange={(v) => edit('total_sales_value', v, setTotalSalesValue)} prefix="₦" />
              <LiveField label="Total purchases / procurement" value={totalPurchaseValue} live={!overridden.total_purchase_value} onChange={(v) => edit('total_purchase_value', v, setTotalPurchaseValue)} prefix="₦" />
              <Input label="Pending sales (owed to us)" type="number" value={pendingSalesValue} onChange={(e) => setPendingSalesValue(e.target.value)} />
              <Input label="Pending purchases (owed to suppliers)" type="number" value={pendingPurchaseValue} onChange={(e) => setPendingPurchaseValue(e.target.value)} />
              <Input label="Pending procurement (ordered, not received)" type="number" value={pendingProcurementValue} onChange={(e) => setPendingProcurementValue(e.target.value)} className="sm:col-span-2" />
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Net position (sales − purchases)</span><span className="font-bold text-slate-900">{formatCurrency(Number(totalSalesValue || 0) - Number(totalPurchaseValue || 0))}</span></div>
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Use the Auto-Generate button on the reports list to fill these from the week's daily activities and issues.</p>
            <Textarea label="Activities this week" value={activitiesNotes} onChange={(e) => setActivitiesNotes(e.target.value)} placeholder="Key events and operations..." />
            <Textarea label="Challenges encountered" value={challengesNotes} onChange={(e) => setChallengesNotes(e.target.value)} placeholder="Obstacles and problems..." />
            <Textarea label="Issues needing escalation" value={issuesNotes} onChange={(e) => setIssuesNotes(e.target.value)} placeholder="Matters that need management attention..." />
            <Textarea label="Improvements made or suggested" value={improvementNotes} onChange={(e) => setImprovementNotes(e.target.value)} placeholder="What went well and what to improve..." />
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Closing <strong className="text-slate-900">{formatNumber(expectedClosing)}</strong> · Sales{' '}
            <strong className="text-emerald-600">{formatCurrency(Number(totalSalesValue || 0))}</strong>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="outline" onClick={() => void handleSave(false)} disabled={saving}>Save as draft</Button>
            <Button onClick={() => void handleSave(true)} disabled={saving}>
              <CheckCircle2 size={15} /> {saving ? 'Saving...' : 'Save & submit'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function FlowChip({ label, value, tone }: { label: string; value: string | number; tone: 'slate' | 'emerald' | 'rose' | 'dark' }) {
  const tones = {
    slate: 'bg-white text-slate-700 border-slate-200',
    emerald: 'bg-white text-emerald-700 border-emerald-200',
    rose: 'bg-white text-rose-700 border-rose-200',
    dark: 'bg-slate-900 text-white border-slate-900',
  } as const;
  return (
    <div className={`min-w-[88px] rounded-xl border px-3 py-2 ${tones[tone]}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-sm font-bold">{formatNumber(Number(value || 0))}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
      {label}: <strong className="text-slate-900">{formatNumber(value)}</strong>
    </span>
  );
}

function LiveField({
  label,
  value,
  live,
  onChange,
  prefix,
}: {
  label: string;
  value: string;
  live: boolean;
  onChange: (value: string) => void;
  prefix?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${live ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {live ? <Activity size={9} /> : <AlertTriangle size={9} />}
          {live ? 'Live' : 'Manual'}
        </span>
      </div>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{prefix}</span>}
        <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={prefix ? 'pl-7' : ''} />
      </div>
    </div>
  );
}
