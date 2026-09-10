import { useState, useMemo } from 'react';
import { Users, Plus, Pencil, Search, Power, UserCheck, Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Team, Business, Branch, Department } from '@/types/database';

export function TeamsPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'admin');
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);

  const { data: businesses } = useSupabaseQuery<Business[]>(() => supabase.from('businesses').select('*').eq('is_active', true).order('name'), []);
  const { data: branches } = useSupabaseQuery<Branch[]>(() => supabase.from('branches').select('*').eq('is_active', true).order('name'), []);
  const { data: departments } = useSupabaseQuery<Department[]>(() => supabase.from('departments').select('*').eq('is_active', true).order('name'), []);
  const { data: teams, loading, error, refetch } = useSupabaseQuery<Team[]>(
    () => {
      let q = supabase.from('teams').select(`*, business:businesses(*), department:departments(*), branch:branches(*)`).order('created_at', { ascending: false });
      if (!isExecutive && user?.business_id) q = q.eq('business_id', user.business_id);
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [filterBusiness, user?.business_id, isExecutive]
  );

  const filtered = useMemo(() => {
    if (!teams) return [];
    if (!search) return teams;
    const q = search.toLowerCase();
    return teams.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }, [teams, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load teams." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><Users size={22} className="text-slate-900" /> Teams</h2>
          <p className="text-sm text-slate-500 mt-1">Cross-functional teams within departments and branches.</p>
        </div>
        {canManage && <Button onClick={() => { setEditing(null); setShowModal(true); }} className="w-full sm:w-auto"><Plus size={18} /> New Team</Button>}
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search teams..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition" />
        </div>
        {isExecutive && (
          <Select value={filterBusiness} onChange={e => setFilterBusiness(e.target.value)} className="lg:w-56">
            <option value="all">All Businesses</option>
            {businesses?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0"><Users size={18} /></div>
                <div className="flex items-center gap-2">
                  <Badge className={t.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
                  {canManage && <button onClick={() => { setEditing(t); setShowModal(true); }} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Pencil size={14} /></button>}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-3">{t.name}</h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 min-h-[32px]">{t.description || 'No description'}</p>
              <div className="mt-3 space-y-1.5">
                <p className="text-xs text-slate-400 flex items-center gap-1.5"><Building2 size={12} /> {t.business?.name ?? '—'} {t.branch?.name ? `· ${t.branch.name}` : ''}</p>
                {t.department?.name && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Users size={12} /> Dept: {t.department.name}</p>}
                {t.lead_user?.full_name && <p className="text-xs text-slate-500 flex items-center gap-1.5"><UserCheck size={12} /> Lead: {t.lead_user.full_name}</p>}
              </div>
              {canManage && <button onClick={async () => { await supabase.from('teams').update({ is_active: !t.is_active }).eq('id', t.id); refetch(); }} className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border border-slate-200 hover:bg-slate-50"><Power size={12} /> {t.is_active ? 'Deactivate' : 'Activate'}</button>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Users size={32} />} title="No teams yet" description="Create teams to organize people within departments and branches." action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Team</Button>} />
      )}

      {showModal && <TeamModal team={editing} businesses={businesses ?? []} branches={branches ?? []} departments={departments ?? []} currentUser={user} onClose={() => { setShowModal(false); setEditing(null); }} onSaved={() => { refetch(); setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

function TeamModal({ team, businesses, branches, departments, currentUser, onClose, onSaved }: { team: Team | null; businesses: Business[]; branches: Branch[]; departments: Department[]; currentUser: { business_id: string | null; role?: { name: string } } | null; onClose: () => void; onSaved: () => void }) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(team?.business_id ?? currentUser?.business_id ?? '');
  const [departmentId, setDepartmentId] = useState(team?.department_id ?? '');
  const [branchId, setBranchId] = useState(team?.branch_id ?? '');
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !businessId) { setError('Name and business are required'); return; }
    setSaving(true); setError(null);
    const payload = { business_id: businessId, department_id: departmentId || null, branch_id: branchId || null, name: name.trim(), description: description.trim() };
    const { error: e } = team ? await supabase.from('teams').update(payload).eq('id', team.id) : await supabase.from('teams').insert(payload);
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  const filteredDepts = departments.filter(d => d.business_id === businessId);
  const filteredBranches = branches.filter(b => b.business_id === businessId);

  return (
    <Modal open onClose={onClose} title={team ? 'Edit Team' : 'New Team'} size="md">
      <div className="space-y-4">
        <Select label="Business Unit" value={businessId} onChange={e => { setBusinessId(e.target.value); setDepartmentId(''); setBranchId(''); }} disabled={!!team || !isExecutive}>
          <option value="">Select...</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Team Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Awka Sales Squad, Warehouse Crew" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Department" value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
            <option value="">None</option>
            {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select label="Branch" value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="">None</option>
            {filteredBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this team do?" />
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
