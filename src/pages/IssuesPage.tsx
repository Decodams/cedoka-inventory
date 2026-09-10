import { useState, useMemo } from 'react';
import { AlertTriangle, Plus, Pencil, Search, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatDate, daysUntil, isOverdue } from '@/lib/dateUtils';
import { isAtLeast, hasRole } from '@/lib/rbac';
import {
  ISSUE_STATUS_STYLES, ISSUE_STATUS_LABELS,
  ISSUE_PRIORITY_STYLES, ISSUE_PRIORITY_LABELS,
  ISSUE_SEVERITY_LABELS,
} from '@/lib/statusStyles';
import type { Issue, Business, Branch, IssueStatus, IssuePriority, IssueSeverity } from '@/types/database';

export function IssuesPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Issue | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [showManagementOnly, setShowManagementOnly] = useState(false);

  const isExecutive = hasRole(user, 'super_admin');
  const isBusinessLevel = isAtLeast(user, 'admin');

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
  );

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const issuesQuery = useMemo(() => {
    let q = supabase
      .from('issues')
      .select(`*, business:businesses(*), branch:branches(*), reported_by_user:user_profiles!reported_by(full_name), responsible_person_user:user_profiles!responsible_person(full_name)`)
      .order('created_at', { ascending: false });
    if (!isExecutive && isBusinessLevel && user?.business_id) {
      q = q.eq('business_id', user.business_id);
    } else if (!isBusinessLevel && user?.branch_id) {
      q = q.eq('branch_id', user.branch_id);
    }
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    if (filterPriority !== 'all') q = q.eq('priority', filterPriority);
    if (showManagementOnly) q = q.eq('requires_management_attention', true);
    return q.limit(80);
  }, [isExecutive, isBusinessLevel, user, filterStatus, filterPriority, showManagementOnly]);

  const { data: issues, loading, error, refetch } = useSupabaseQuery<Issue[]>(() => issuesQuery, [issuesQuery]);

  const filtered = useMemo(() => {
    if (!issues) return [];
    if (!search) return issues;
    const q = search.toLowerCase();
    return issues.filter((i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }, [issues, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load issues." onRetry={refetch} />;

  const managementCount = issues?.filter((i) => i.requires_management_attention && i.status !== 'closed').length ?? 0;
  const overdueCount = issues?.filter((i) => isOverdue(i.deadline) && i.status !== 'closed').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Issues & Challenges</h2>
          <p className="text-sm text-slate-500 mt-0.5">Track and resolve operational problems across branches.</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowModal(true); }}>
          <Plus size={18} /> New Issue
        </Button>
      </div>

      {/* Alert banners */}
      <div className="flex flex-wrap gap-3">
        {managementCount > 0 && (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
            <AlertTriangle size={16} className="text-rose-600" />
            <span className="text-sm font-medium text-rose-700">{managementCount} require management attention</span>
          </div>
        )}
        {overdueCount > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            <Clock size={16} className="text-amber-600" />
            <span className="text-sm font-medium text-amber-700">{overdueCount} overdue</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="sm:w-40">
          <option value="all">All Status</option>
          {Object.entries(ISSUE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="sm:w-40">
          <option value="all">All Priority</option>
          {Object.entries(ISSUE_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer px-3 py-2.5 border border-slate-300 rounded-lg hover:bg-slate-50">
          <input type="checkbox" checked={showManagementOnly} onChange={(e) => setShowManagementOnly(e.target.checked)} className="rounded border-slate-300" />
          Management Attention
        </label>
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((issue) => (
            <div
              key={issue.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 transition-colors cursor-pointer"
              onClick={() => { setEditing(issue); setShowModal(true); }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    issue.priority === 'critical' ? 'bg-rose-100 text-rose-600' :
                    issue.priority === 'high' ? 'bg-orange-100 text-orange-600' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    <AlertTriangle size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900 truncate">{issue.title}</h3>
                      {issue.requires_management_attention && (
                        <Badge className="bg-rose-100 text-rose-700 border-rose-200">Management Attention</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {issue.branch?.name} · {issue.business?.name}
                    </p>
                    {issue.description && (
                      <p className="text-sm text-slate-500 mt-1.5 line-clamp-2">{issue.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge className={ISSUE_STATUS_STYLES[issue.status]}>{ISSUE_STATUS_LABELS[issue.status]}</Badge>
                      <Badge className={ISSUE_PRIORITY_STYLES[issue.priority]}>{ISSUE_PRIORITY_LABELS[issue.priority]}</Badge>
                      <Badge className="bg-slate-100 text-slate-500 border-slate-200">{ISSUE_SEVERITY_LABELS[issue.severity]}</Badge>
                      {issue.deadline && (
                        <span className={`text-xs flex items-center gap-1 ${isOverdue(issue.deadline) && issue.status !== 'closed' ? 'text-rose-500' : 'text-slate-400'}`}>
                          <Clock size={12} />
                          {isOverdue(issue.deadline) && issue.status !== 'closed' ? `${Math.abs(daysUntil(issue.deadline))}d overdue` : `Due ${formatDate(issue.deadline)}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isAtLeast(user, 'manager') && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing(issue); setShowModal(true); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<AlertTriangle size={32} />}
          title="No issues found"
          description="Create an issue to track a challenge, problem, or matter needing attention."
          action={<Button onClick={() => setShowModal(true)}><Plus size={18} /> New Issue</Button>}
        />
      )}

      {showModal && (
        <IssueFormModal
          issue={editing}
          businesses={businesses ?? []}
          branches={branches ?? []}
          currentUser={user}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={() => { refetch(); setShowModal(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function IssueFormModal({
  issue, businesses, branches, currentUser, onClose, onSaved,
}: {
  issue: Issue | null;
  businesses: Business[];
  branches: Branch[];
  currentUser: { id: string; role?: { name: string }; business_id: string | null; branch_id: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const isBusinessLevel = currentUser?.role?.name === 'admin';
  const isManager = currentUser?.role?.name === 'manager';

  const availableBusinesses = isExecutive ? businesses : businesses.filter((b) => b.id === currentUser?.business_id);
  const availableBranches = isExecutive
    ? branches
    : isBusinessLevel
      ? branches
      : branches.filter((b) => b.id === currentUser?.branch_id);

  const [title, setTitle] = useState(issue?.title ?? '');
  const [description, setDescription] = useState(issue?.description ?? '');
  const [businessId, setBusinessId] = useState(issue?.business_id ?? currentUser?.business_id ?? '');
  const [branchId, setBranchId] = useState(issue?.branch_id ?? currentUser?.branch_id ?? '');
  const [category, setCategory] = useState(issue?.category ?? 'operational');
  const [priority, setPriority] = useState<IssuePriority>(issue?.priority ?? 'medium');
  const [severity, setSeverity] = useState<IssueSeverity>(issue?.severity ?? 'minor');
  const [status, setStatus] = useState<IssueStatus>(issue?.status ?? 'open');
  const [requiresAttention, setRequiresAttention] = useState(issue?.requires_management_attention ?? false);
  const [deadline, setDeadline] = useState(issue?.deadline ?? '');
  const [resolutionNotes, setResolutionNotes] = useState(issue?.resolution_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canChangeStatus = isManager || isBusinessLevel || isExecutive;

  const handleSave = async () => {
    if (!title.trim() || !businessId || !branchId) {
      setError('Title, business, and branch are required');
      return;
    }
    setSaving(true);
    setError(null);

    const data = {
      title: title.trim(),
      description: description.trim(),
      business_id: businessId,
      branch_id: branchId,
      category,
      priority,
      severity,
      status,
      requires_management_attention: requiresAttention,
      deadline: deadline || null,
      resolution_notes: resolutionNotes.trim(),
      reported_by: issue?.reported_by ?? currentUser?.id,
      resolved_at: status === 'resolved' || status === 'closed' ? (issue?.resolved_at ?? new Date().toISOString()) : null,
      closed_at: status === 'closed' ? (issue?.closed_at ?? new Date().toISOString()) : null,
    };

    if (issue) {
      const { error: e } = await supabase.from('issues').update(data).eq('id', issue.id);
      if (e) { setError('Could not save changes.'); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('issues').insert({ ...data, date_reported: new Date().toISOString().split('T')[0] });
      if (e) { setError('Could not create the issue.'); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={issue ? 'Edit Issue' : 'New Issue'} size="lg">
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brief summary of the issue" autoFocus />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened? Provide details..." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Business Unit" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setBranchId(''); }} disabled={!!issue}>
            <option value="">Select...</option>
            {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!!issue}>
            <option value="">Select...</option>
            {availableBranches.filter((b) => !businessId || b.business_id === businessId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {['operational', 'stock', 'financial', 'staff', 'customer', 'supplier', 'equipment', 'infrastructure', 'safety', 'compliance', 'other'].map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </Select>
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}>
            {Object.entries(ISSUE_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as IssueSeverity)}>
            {Object.entries(ISSUE_SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {canChangeStatus && (
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)}>
              {Object.entries(ISSUE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
          <Input label="Deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={requiresAttention} onChange={(e) => setRequiresAttention(e.target.checked)} className="rounded border-slate-300" />
          <AlertTriangle size={15} className="text-rose-500" />
          Requires Management Attention
        </label>
        {(status === 'resolved' || status === 'closed') && (
          <Textarea label="Resolution Notes" value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="How was this resolved?" />
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
