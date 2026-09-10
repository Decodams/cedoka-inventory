import { useState, useMemo } from 'react';
import { Building2, Plus, Pencil, Search, Users, Power, Layers } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/dateUtils';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Department, Business } from '@/types/database';

export function DepartmentsPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'admin');
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);

  const { data: businesses } = useSupabaseQuery<Business[]>(() => supabase.from('businesses').select('*').eq('is_active', true).order('name'), []);
  const { data: departments, loading, error, refetch } = useSupabaseQuery<Department[]>(
    () => {
      let q = supabase.from('departments').select(`*, business:businesses(*)`).order('created_at', { ascending: false });
      if (!isExecutive && user?.business_id) q = q.eq('business_id', user.business_id);
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [filterBusiness, user?.business_id, isExecutive]
  );

  const filtered = useMemo(() => {
    if (!departments) return [];
    if (!search) return departments;
    const q = search.toLowerCase();
    return departments.filter(d => d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q));
  }, [departments, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load departments." onRetry={refetch} />;

  const active = filtered.filter(d => d.is_active).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><Layers size={22} className="text-slate-900" /> Departments</h2>
          <p className="text-sm text-slate-500 mt-1">Organize your business into functional departments. Teams live inside departments.</p>
        </div>
        {canManage && <Button onClick={() => { setEditing(null); setShowModal(true); }} className="w-full sm:w-auto"><Plus size={18} /> New Department</Button>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-2xl font-bold text-slate-900">{filtered.length}</p><p className="text-xs text-slate-400 mt-1">Total</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-2xl font-bold text-emerald-600">{active}</p><p className="text-xs text-slate-400 mt-1">Active</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-2xl font-bold text-slate-500">{filtered.length - active}</p><p className="text-xs text-slate-400 mt-1">Inactive</p></div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search departments..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition" />
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
          {filtered.map(d => (
            <div key={d.id} className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0"><Building2 size={18} /></div>
                <div className="flex items-center gap-2">
                  <Badge className={d.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>{d.is_active ? 'Active' : 'Inactive'}</Badge>
                  {canManage && <button onClick={() => { setEditing(d); setShowModal(true); }} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition"><Pencil size={14} /></button>}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-3 truncate">{d.name}</h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 min-h-[32px]">{d.description || 'No description'}</p>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <span className="text-xs text-slate-400 flex items-center gap-1"><Users size={12} /> {d.business?.name ?? '—'}</span>
                <span className="text-xs text-slate-400">{formatDate(d.created_at)}</span>
              </div>
              {canManage && (
                <button onClick={async () => { await supabase.from('departments').update({ is_active: !d.is_active }).eq('id', d.id); refetch(); }} className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border border-slate-200 hover:bg-slate-50 transition">
                  <Power size={12} /> {d.is_active ? 'Deactivate' : 'Activate'}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Layers size={32} />} title="No departments yet" description="Create departments like Operations, Sales, Finance to structure your organization." action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Department</Button>} />
      )}

      {showModal && <DepartmentModal department={editing} businesses={businesses ?? []} currentUser={user} onClose={() => { setShowModal(false); setEditing(null); }} onSaved={() => { refetch(); setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

function DepartmentModal({ department, businesses, currentUser, onClose, onSaved }: { department: Department | null; businesses: Business[]; currentUser: { business_id: string | null; role?: { name: string } } | null; onClose: () => void; onSaved: () => void }) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(department?.business_id ?? currentUser?.business_id ?? '');
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !businessId) { setError('Name and business are required'); return; }
    setSaving(true); setError(null);
    const payload = { business_id: businessId, name: name.trim(), description: description.trim() };
    const { error: e } = department ? await supabase.from('departments').update(payload).eq('id', department.id) : await supabase.from('departments').insert(payload);
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={department ? 'Edit Department' : 'New Department'} size="md">
      <div className="space-y-4">
        <Select label="Business Unit" value={businessId} onChange={e => setBusinessId(e.target.value)} disabled={!!department || !isExecutive}>
          <option value="">Select...</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Department Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Operations, Finance, Logistics" autoFocus />
        <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this department do?" />
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
