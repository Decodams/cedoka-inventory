import { useState, useMemo } from 'react';
import { CalendarDays, Plus, Search, Clock, CheckSquare } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/dateUtils';
import { isAtLeast } from '@/lib/rbac';
import { ACTIVITY_CATEGORY_LABELS } from '@/lib/statusStyles';
import type { DailyActivity, Branch, ActivityCategory } from '@/types/database';

export function ActivitiesPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const activitiesQuery = useMemo(() => {
    let q = supabase
      .from('daily_activities')
      .select(`*, branch:branches(*), recorded_by_user:user_profiles!recorded_by(full_name)`)
      .order('activity_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (!isBusinessLevel && user?.branch_id) q = q.eq('branch_id', user.branch_id);
    if (filterBranch !== 'all') q = q.eq('branch_id', filterBranch);
    return q;
  }, [isBusinessLevel, user, filterBranch]);

  const { data: activities, loading, error, refetch } = useSupabaseQuery<DailyActivity[]>(
    () => activitiesQuery,
    [activitiesQuery],
  );

  const filtered = useMemo(() => {
    if (!activities) return [];
    if (!search) return activities;
    const q = search.toLowerCase();
    return activities.filter((a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
  }, [activities, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load activities." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Daily Activities</h2>
          <p className="text-sm text-slate-500 mt-0.5">A log of what happens each day across branches.</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus size={18} /> Log Activity
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search activities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        {isBusinessLevel && (
          <Select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="sm:w-48">
            <option value="all">All Branches</option>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((a) => (
            <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                  <CalendarDays size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-slate-900">{a.title}</h3>
                    <Badge className="bg-slate-100 text-slate-600 border-slate-200">
                      {ACTIVITY_CATEGORY_LABELS[a.category as ActivityCategory] ?? a.category}
                    </Badge>
                    {a.requires_follow_up && (
                      <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                        <Clock size={10} className="mr-1" />Follow-up
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(a.activity_date)} · {a.branch?.name} · {a.recorded_by_user?.full_name}
                  </p>
                  {a.description && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{a.description}</p>}
                  {a.requires_follow_up && a.follow_up_notes && (
                    <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      <p className="text-xs font-medium text-amber-700">Follow-up needed:</p>
                      <p className="text-sm text-amber-600 mt-0.5">{a.follow_up_notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CalendarDays size={32} />}
          title="No activities logged"
          description="Start recording daily activities — meetings, deliveries, incidents, and more."
          action={<Button onClick={() => setShowModal(true)}><Plus size={18} /> Log Activity</Button>}
        />
      )}

      {showModal && (
        <ActivityModal
          branches={branches ?? []}
          currentUser={user}
          onClose={() => setShowModal(false)}
          onSaved={() => { refetch(); setShowModal(false); }}
        />
      )}
    </div>
  );
}

function ActivityModal({
  branches, currentUser, onClose, onSaved,
}: {
  branches: Branch[];
  currentUser: { id: string; role?: { name: string }; business_id: string | null; branch_id: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isManager = currentUser?.role?.name === 'manager' || currentUser?.role?.name === 'sales_person';
  const availableBranches = isManager ? branches.filter((b) => b.id === currentUser?.branch_id) : branches;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState(currentUser?.branch_id ?? '');
  const [businessId] = useState(currentUser?.business_id ?? '');
  const [activityDate, setActivityDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<ActivityCategory>('other');
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim() || !branchId) {
      setError('Title and branch are required');
      return;
    }
    setSaving(true);
    setError(null);

    const selectedBranch = branches.find((b) => b.id === branchId);
    const bizId = businessId || selectedBranch?.business_id;

    const { error: e } = await supabase.from('daily_activities').insert({
      title: title.trim(),
      description: description.trim(),
      business_id: bizId,
      branch_id: branchId,
      activity_date: activityDate,
      category,
      requires_follow_up: requiresFollowUp,
      follow_up_notes: followUpNotes.trim(),
      recorded_by: currentUser?.id,
    });

    if (e) { setError('Could not save the activity.'); setSaving(false); return; }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Log Daily Activity" size="md">
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What happened?" autoFocus />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Provide details about this activity..." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={isManager}>
            <option value="">Select...</option>
            {availableBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Input label="Date" type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory)}>
            {Object.entries(ACTIVITY_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={requiresFollowUp} onChange={(e) => setRequiresFollowUp(e.target.checked)} className="rounded border-slate-300" />
          <CheckSquare size={15} className="text-amber-500" />
          Requires follow-up
        </label>
        {requiresFollowUp && (
          <Textarea label="Follow-up Notes" value={followUpNotes} onChange={(e) => setFollowUpNotes(e.target.value)} placeholder="What needs to be done?" />
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
