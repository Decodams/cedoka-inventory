import { useState, useMemo } from 'react';
import { Wrench, Plus, Pencil, Search, Power, Building2, Tag } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/dateUtils';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Service, Business } from '@/types/database';

export function ServicesPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);

  const { data: businesses } = useSupabaseQuery<Business[]>(() => supabase.from('businesses').select('*').eq('is_active', true).order('name'), [], { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 });
  const { data: services, loading, error, refetch } = useSupabaseQuery<Service[]>(
    () => {
      let q = supabase.from('services').select(`*, business:businesses(id,name)`).order('created_at', { ascending: false });
      if (!isExecutive && user?.business_id) q = q.eq('business_id', user.business_id);
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [filterBusiness, user?.business_id, isExecutive]
  );

  const filtered = useMemo(() => {
    if (!services) return [];
    if (!search) return services;
    const q = search.toLowerCase();
    return services.filter(s => s.name.toLowerCase().includes(q) || (s.sku?.toLowerCase().includes(q) ?? false) || (s.category?.toLowerCase().includes(q) ?? false));
  }, [services, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load services." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><Wrench size={22} className="text-slate-900" /> Services</h2>
          <p className="text-sm text-slate-500 mt-1">Manage service offerings — installations, repairs, logistics, and more.</p>
        </div>
        {canManage && <Button onClick={() => { setEditing(null); setShowModal(true); }} className="w-full sm:w-auto"><Plus size={18} /> New Service</Button>}
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search services..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition" />
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
          {filtered.map(s => (
            <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0"><Wrench size={18} /></div>
                <div className="flex items-center gap-2">
                  <Badge className={s.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                  {canManage && <button onClick={() => { setEditing(s); setShowModal(true); }} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Pencil size={14} /></button>}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-3 truncate">{s.name}</h3>
              {s.sku && <p className="text-xs text-slate-400">SKU: {s.sku}</p>}
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 min-h-[32px]">{s.description || 'No description'}</p>
              <div className="flex items-center gap-2 mt-3">
                {s.category && <Badge className="bg-slate-100 text-slate-600 border-slate-200"><Tag size={10} className="mr-1" />{s.category}</Badge>}
                <span className="text-sm font-semibold text-slate-900 ml-auto">{formatCurrency(Number(s.unit_price))}</span>
              </div>
              <p className="text-xs text-slate-400 mt-3 flex items-center gap-1"><Building2 size={12} /> {s.business?.name ?? '—'}</p>
              {canManage && <button onClick={async () => { await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id); refetch(); }} className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border border-slate-200 hover:bg-slate-50"><Power size={12} /> {s.is_active ? 'Deactivate' : 'Activate'}</button>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Wrench size={32} />} title="No services yet" description="Add services like installation, repair, or logistics offerings." action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Service</Button>} />
      )}

      {showModal && <ServiceModal service={editing} businesses={businesses ?? []} currentUser={user} onClose={() => { setShowModal(false); setEditing(null); }} onSaved={() => { refetch(); setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

function ServiceModal({ service, businesses, currentUser, onClose, onSaved }: { service: Service | null; businesses: Business[]; currentUser: { business_id: string | null; role?: { name: string } } | null; onClose: () => void; onSaved: () => void }) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(service?.business_id ?? currentUser?.business_id ?? '');
  const [name, setName] = useState(service?.name ?? '');
  const [sku, setSku] = useState(service?.sku ?? '');
  const [category, setCategory] = useState(service?.category ?? '');
  const [unitPrice, setUnitPrice] = useState(service?.unit_price?.toString() ?? '0');
  const [description, setDescription] = useState(service?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !businessId) { setError('Name and business are required'); return; }
    setSaving(true); setError(null);
    const payload = { business_id: businessId, name: name.trim(), sku: sku.trim() || null, category: category.trim() || null, unit_price: Number(unitPrice || 0), description: description.trim() };
    const { error: e } = service ? await supabase.from('services').update(payload).eq('id', service.id) : await supabase.from('services').insert(payload);
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={service ? 'Edit Service' : 'New Service'} size="md">
      <div className="space-y-4">
        <Select label="Business Unit" value={businessId} onChange={e => setBusinessId(e.target.value)} disabled={!!service || !isExecutive}>
          <option value="">Select...</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Service Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Solar Installation, Bike Repair" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="SKU" value={sku} onChange={e => setSku(e.target.value)} placeholder="Optional" />
          <Input label="Category" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Installation" />
        </div>
        <Input label="Unit Price" type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
        <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this service include?" />
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
