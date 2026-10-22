import { useMemo, useState } from 'react';
import { X, Wand2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { fullAccessibleBranchIds } from '@/lib/rbac';
import { getSalesWeekEnd, getSalesWeekStart, toDateString, weekRangeString } from '@/lib/dateUtils';
import { buildWeeklyNotes, type GeneratedWeeklyNotes } from '@/lib/weeklyReportGenerator';
import type { Branch, Business, DailyActivity, Issue, UserProfile } from '@/types/database';

interface AutoGenerateWeeklyReportModalProps {
  open: boolean;
  onClose: () => void;
  businesses: Business[];
  branches: Branch[];
  currentUser: UserProfile | null;
  onGenerated: (notes: GeneratedWeeklyNotes) => void;
}

export function AutoGenerateWeeklyReportModal({
  open,
  onClose,
  businesses,
  branches,
  currentUser,
  onGenerated,
}: AutoGenerateWeeklyReportModalProps) {
  const userBranchIds = useMemo(() => fullAccessibleBranchIds(currentUser), [currentUser]);
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const scopedBranches = isExecutive ? branches : branches.filter((b) => userBranchIds.includes(b.id));
  const scopedBusinesses = isExecutive
    ? businesses
    : businesses.filter((b) => scopedBranches.some((br) => br.business_id === b.id));
  const defaultBranch =
    currentUser?.branch_id && scopedBranches.some((b) => b.id === currentUser.branch_id)
      ? currentUser.branch_id
      : (scopedBranches[0]?.id ?? '');
  const defaultBusiness =
    currentUser?.business_id ||
    scopedBranches.find((b) => b.id === defaultBranch)?.business_id ||
    scopedBusinesses[0]?.id ||
    '';

  const [businessId, setBusinessId] = useState(defaultBusiness);
  const [branchId, setBranchId] = useState(defaultBranch);
  const [weekEnd, setWeekEnd] = useState(toDateString(getSalesWeekEnd(new Date())));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof buildWeeklyNotes> | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const generate = async () => {
    if (!branchId) {
      setError('Select a branch first.');
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    setRange(null);
    const monday = getSalesWeekStart(new Date(`${weekEnd}T00:00:00`));
    const saturday = getSalesWeekEnd(new Date(`${weekEnd}T00:00:00`));
    const from = toDateString(monday);
    const to = toDateString(saturday);
    setRange({ from, to });
    try {
      const [activitiesResult, issuesResult] = await Promise.all([
        supabase
          .from('daily_activities')
          .select('*')
          .eq('branch_id', branchId)
          .gte('activity_date', from)
          .lte('activity_date', to)
          .order('activity_date'),
        supabase
          .from('issues')
          .select('*')
          .eq('branch_id', branchId)
          .gte('date_reported', from)
          .lte('date_reported', to)
          .order('date_reported'),
      ]);
      if (activitiesResult.error) throw activitiesResult.error;
      if (issuesResult.error) throw issuesResult.error;
      setPreview(
        buildWeeklyNotes(
          (activitiesResult.data ?? []) as DailyActivity[],
          (issuesResult.data ?? []) as Issue[],
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the report.');
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    onGenerated({
      activities_notes: preview.activities_notes,
      challenges_notes: preview.challenges_notes,
      issues_notes: preview.issues_notes,
      improvement_notes: preview.improvement_notes,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Auto-Generate Weekly Report from Daily Activities" size="xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Aggregates every Daily Activity and relevant Issue logged Monday to Saturday for the selected branch into an
          ordered weekly summary. You stay in control: review the preview and edit before saving.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label="Business Unit"
            value={businessId}
            onChange={(e) => {
              const next = e.target.value;
              setBusinessId(next);
              const match = scopedBranches.find((b) => b.business_id === next);
              if (match) setBranchId(match.id);
            }}
          >
            {scopedBusinesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {scopedBranches
              .filter((b) => !businessId || b.business_id === businessId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
          <Input
            label="Week Ending (Saturday)"
            type="date"
            value={weekEnd}
            onChange={(e) => setWeekEnd(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={generate} disabled={loading}>
            <Wand2 size={16} /> {loading ? 'Analysing...' : 'Auto-Generate'}
          </Button>
          {preview && (
            <Button variant="outline" onClick={apply}>
              Apply to Report
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            <X size={16} /> Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {preview && (
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-4 max-h-[50vh] overflow-y-auto">
            <p className="text-xs text-slate-500">
              {preview.count} daily activit{preview.count === 1 ? 'y' : 'ies'} found
              {range ? ` for ${weekRangeString(range.from, range.to)} (Monday to Saturday)` : ''}.
            </p>
            <div>
              <p className="text-sm font-semibold text-slate-800 mb-1">Activities</p>
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans">{preview.activities_notes}</pre>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 mb-1">Challenges</p>
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans">{preview.challenges_notes}</pre>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 mb-1">Issues Requiring Escalation</p>
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans">{preview.issues_notes}</pre>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 mb-1">Improvements / Actions</p>
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans">{preview.improvement_notes}</pre>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
