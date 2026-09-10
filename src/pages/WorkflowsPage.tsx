import { useState, useMemo } from 'react';
import { GitBranch, Plus, Pencil, Search, Power, Trash2, GripVertical, Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Workflow, Business } from '@/types/database';

export function WorkflowsPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'admin');
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);

  const { data: businesses } = useSupabaseQuery<Business[]>(() => supabase.from('businesses').select('*').eq('is_active', true).order('name'), [], { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 });
  const { data: workflows, loading, error, refetch } = useSupabaseQuery<Workflow[]>(
    () => {
      let q = supabase.from('workflows').select(`*, business:businesses(id,name)`).order('created_at', { ascending: false });
      if (!isExecutive && user?.business_id) q = q.or(`business_id.is.null,business_id.eq.${user.business_id}`);
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [filterBusiness, user?.business_id, isExecutive]
  );

  const filtered = useMemo(() => {
    if (!workflows) return [];
    if (!search) return workflows;
    const q = search.toLowerCase();
    return workflows.filter(w => w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q));
  }, [workflows, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load workflows." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><GitBranch size={22} className="text-slate-900" /> Workflows</h2>
          <p className="text-sm text-slate-500 mt-1">Configurable business processes — approve, dispatch, receive, and more.</p>
        </div>
        {canManage && <Button onClick={() => { setEditing(null); setShowModal(true); }} className="w-full sm:w-auto"><Plus size={18} /> New Workflow</Button>}
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search workflows..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition" />
        </div>
        {isExecutive && (
          <Select value={filterBusiness} onChange={e => setFilterBusiness(e.target.value)} className="lg:w-56">
            <option value="all">All Businesses</option>
            <option value="null">Global</option>
            {businesses?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(w => (
            <div key={w.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0"><GitBranch size={18} /></div>
                <div className="flex items-center gap-2">
                  <Badge className={w.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>{w.is_active ? 'Active' : 'Inactive'}</Badge>
                  {w.business_id === null && <Badge className="bg-slate-900 text-white border-slate-900">Global</Badge>}
                  {canManage && <button onClick={() => { setEditing(w); setShowModal(true); }} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Pencil size={14} /></button>}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-3">{w.name}</h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 min-h-[32px]">{w.description || 'No description'}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {w.steps.map((step, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs font-medium bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                    {step}
                  </span>
                ))}
                {w.steps.length === 0 && <span className="text-xs text-slate-400">No steps defined</span>}
              </div>
              <p className="text-xs text-slate-400 mt-3 flex items-center gap-1"><Building2 size={12} /> {w.business?.name ?? 'Global'}</p>
              {canManage && <button onClick={async () => { await supabase.from('workflows').update({ is_active: !w.is_active }).eq('id', w.id); refetch(); }} className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border border-slate-200 hover:bg-slate-50"><Power size={12} /> {w.is_active ? 'Deactivate' : 'Activate'}</button>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<GitBranch size={32} />} title="No workflows yet" description="Define workflows like Stock Transfer, Procurement, or Issue Resolution with ordered steps." action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Workflow</Button>} />
      )}

      {showModal && <WorkflowModal workflow={editing} businesses={businesses ?? []} currentUser={user} onClose={() => { setShowModal(false); setEditing(null); }} onSaved={() => { refetch(); setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

function WorkflowModal({ workflow, businesses, currentUser, onClose, onSaved }: { workflow: Workflow | null; businesses: Business[]; currentUser: { business_id: string | null; role?: { name: string } } | null; onClose: () => void; onSaved: () => void }) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(workflow?.business_id ?? currentUser?.business_id ?? '');
  const [isGlobal, setIsGlobal] = useState(workflow?.business_id === null);
  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [steps, setSteps] = useState<string[]>(workflow?.steps ?? ['Requested', 'Approved', 'Completed']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    const cleanSteps = steps.map(s => s.trim()).filter(Boolean);
    if (cleanSteps.length === 0) { setError('Add at least one step'); return; }
    setSaving(true); setError(null);
    const payload = { business_id: isGlobal ? null : (businessId || null), name: name.trim(), description: description.trim(), steps: cleanSteps };
    const { error: e } = workflow ? await supabase.from('workflows').update(payload).eq('id', workflow.id) : await supabase.from('workflows').insert(payload);
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={workflow ? 'Edit Workflow' : 'New Workflow'} size="lg">
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={isGlobal} onChange={e => setIsGlobal(e.target.checked)} className="rounded border-slate-300" />
          Global workflow (applies to all businesses)
        </label>
        {!isGlobal && (
          <Select label="Business Unit" value={businessId} onChange={e => setBusinessId(e.target.value)} disabled={!!workflow || !isExecutive}>
            <option value="">Select...</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <Input label="Workflow Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Procurement Approval, Leave Request" autoFocus />
        <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="When is this workflow used?" />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Steps (in order)</label>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex gap-2 items-center">
                <GripVertical size={14} className="text-slate-300" />
                <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                <Input value={step} onChange={e => { const c = [...steps]; c[i] = e.target.value; setSteps(c); }} placeholder={`Step ${i + 1}`} className="flex-1" />
                <button onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} className="p-2 rounded-xl text-rose-400 hover:bg-rose-50"><Trash2 size={16} /></button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setSteps([...steps, ''])}><Plus size={14} /> Add Step</Button>
          </div>
        </div>
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
