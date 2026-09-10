import { useState, useMemo } from 'react';
import { MapPin, Plus, Pencil, Search, Power, Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Location, Business, Branch } from '@/types/database';

const TYPE_LABELS: Record<string, string> = { warehouse: 'Warehouse', store: 'Store', office: 'Office', branch: 'Branch', inventory: 'Inventory', other: 'Other' };
const TYPE_COLORS: Record<string, string> = { warehouse: 'bg-amber-50 text-amber-700 border-amber-200', store: 'bg-blue-50 text-blue-700 border-blue-200', office: 'bg-slate-100 text-slate-600 border-slate-200', inventory: 'bg-emerald-50 text-emerald-700 border-emerald-200', branch: 'bg-indigo-50 text-indigo-700 border-indigo-200', other: 'bg-slate-100 text-slate-600 border-slate-200' };

export function LocationsPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'admin');
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);

  const { data: businesses } = useSupabaseQuery<Business[]>(() => supabase.from('businesses').select('*').eq('is_active', true).order('name'), []);
  const { data: branches } = useSupabaseQuery<Branch[]>(() => supabase.from('branches').select('*').eq('is_active', true).order('name'), []);
  const { data: locations, loading, error, refetch } = useSupabaseQuery<Location[]>(
    () => {
      let q = supabase.from('locations').select(`*, business:businesses(*), branch:branches(*)`).order('created_at', { ascending: false });
      if (!isExecutive && user?.business_id) q = q.eq('business_id', user.business_id);
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [filterBusiness, user?.business_id, isExecutive]
  );

  const filtered = useMemo(() => {
    if (!locations) return [];
    if (!search) return locations;
    const q = search.toLowerCase();
    return locations.filter(l => l.name.toLowerCase().includes(q) || l.address.toLowerCase().includes(q));
  }, [locations, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load locations." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><MapPin size={22} className="text-slate-900" /> Locations</h2>
          <p className="text-sm text-slate-500 mt-1">Warehouses, stores, inventory locations, and branch addresses.</p>
        </div>
        {canManage && <Button onClick={() => { setEditing(null); setShowModal(true); }} className="w-full sm:w-auto"><Plus size={18} /> New Location</Button>}
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search locations..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition" />
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
          {filtered.map(l => (
            <div key={l.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0"><MapPin size={18} /></div>
                <div className="flex items-center gap-2">
                  <Badge className={TYPE_COLORS[l.location_type] ?? TYPE_COLORS.other}>{TYPE_LABELS[l.location_type] ?? l.location_type}</Badge>
                  {canManage && <button onClick={() => { setEditing(l); setShowModal(true); }} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Pencil size={14} /></button>}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-3 truncate">{l.name}</h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 min-h-[32px]">{l.address || 'No address'}</p>
              <p className="text-xs text-slate-400 mt-3 flex items-center gap-1"><Building2 size={12} /> {l.business?.name ?? '—'} {l.branch?.name ? `· ${l.branch.name}` : ''}</p>
              <div className="flex items-center gap-2 mt-3">
                <Badge className={l.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>{l.is_active ? 'Active' : 'Inactive'}</Badge>
                {canManage && <button onClick={async () => { await supabase.from('locations').update({ is_active: !l.is_active }).eq('id', l.id); refetch(); }} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1"><Power size={12} /> {l.is_active ? 'Deactivate' : 'Activate'}</button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<MapPin size={32} />} title="No locations yet" description="Add warehouses, stores, and inventory locations to track where stock lives." action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Location</Button>} />
      )}

      {showModal && <LocationModal location={editing} businesses={businesses ?? []} branches={branches ?? []} currentUser={user} onClose={() => { setShowModal(false); setEditing(null); }} onSaved={() => { refetch(); setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

function LocationModal({ location, businesses, branches, currentUser, onClose, onSaved }: { location: Location | null; businesses: Business[]; branches: Branch[]; currentUser: { business_id: string | null; role?: { name: string } } | null; onClose: () => void; onSaved: () => void }) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(location?.business_id ?? currentUser?.business_id ?? '');
  const [branchId, setBranchId] = useState(location?.branch_id ?? '');
  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [locationType, setLocationType] = useState<Location['location_type']>(location?.location_type ?? 'warehouse');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !businessId) { setError('Name and business are required'); return; }
    setSaving(true); setError(null);
    const payload = { business_id: businessId, branch_id: branchId || null, name: name.trim(), address: address.trim(), location_type: locationType };
    const { error: e } = location ? await supabase.from('locations').update(payload).eq('id', location.id) : await supabase.from('locations').insert(payload);
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={location ? 'Edit Location' : 'New Location'} size="md">
      <div className="space-y-4">
        <Select label="Business Unit" value={businessId} onChange={e => { setBusinessId(e.target.value); setBranchId(''); }} disabled={!!location || !isExecutive}>
          <option value="">Select...</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select label="Branch" value={branchId} onChange={e => setBranchId(e.target.value)}>
          <option value="">None (business-wide)</option>
          {branches.filter(b => b.business_id === businessId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Location Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Warehouse, Lagos Store" autoFocus />
        <Select label="Type" value={locationType} onChange={e => setLocationType(e.target.value as Location['location_type'])}>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Textarea label="Address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Full address" />
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
