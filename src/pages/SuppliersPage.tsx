import { useMemo, useState } from 'react';
import { Truck, Plus, Pencil, Search, Power, Mail, Phone, MapPin, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase, useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/dateUtils';
import { accessibleBusinessIds, canManageProcurement, hasRole } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import type { Supplier, Business } from '@/types/database';

export function SuppliersPage() {
  const { user } = useAuth();
  const canManage = canManageProcurement(user);
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `suppliers-biz:${user?.id}`, ttlMs: 60_000 },
  );

  const { data: suppliers, loading, error, refetch } = useSupabaseQuery<Supplier[]>(
    () => {
      let q = supabase.from('suppliers').select(`*, business:businesses(id,name)`).order('created_at', { ascending: false });
      if (!isExecutive) {
        const ids = accessibleBusinessIds(user);
        if (ids.length) q = q.in('business_id', ids);
      }
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [isExecutive, user, filterBusiness],
    { cacheKey: `suppliers:${user?.id}:${filterBusiness}`, ttlMs: 60_000 },
  );

  const filtered = useMemo(() => {
    if (!suppliers) return [];
    if (!search) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter((s) => s.name.toLowerCase().includes(q) || (s.contact_person?.toLowerCase().includes(q) ?? false) || (s.email?.toLowerCase().includes(q) ?? false));
  }, [suppliers, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load suppliers." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Suppliers</h2>
          <p className="text-sm text-slate-500 mt-0.5">Vendors and suppliers for procurement, deliveries and payables.</p>
        </div>
        {canManage && <Button onClick={() => { setEditing(null); setShowModal(true); }} className="w-full sm:w-auto"><Plus size={18} /> New Supplier</Button>}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, contact, email..." className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-xl outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
        </div>
        <select value={filterBusiness} onChange={(e) => setFilterBusiness(e.target.value)} className="w-full sm:w-56 px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl bg-white outline-none focus:border-slate-900">
          <option value="all">All Businesses</option>
          {(isExecutive ? businesses ?? [] : (businesses ?? []).filter((b) => accessibleBusinessIds(user).includes(b.id))).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0"><Truck size={18} /></div>
                <div className="flex items-center gap-2">
                  <Badge className={s.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                  {canManage && <button onClick={() => { setEditing(s); setShowModal(true); }} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100" aria-label="Edit supplier"><Pencil size={14} /></button>}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-3 truncate">{s.name}</h3>
              <div className="mt-2 space-y-1">
                {s.contact_person && <p className="text-xs text-slate-500 flex items-center gap-1.5"><User size={12} /> {s.contact_person}</p>}
                {s.email && <p className="text-xs text-slate-500 flex items-center gap-1.5 truncate"><Mail size={12} /> {s.email}</p>}
                {s.phone && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Phone size={12} /> {s.phone}</p>}
                {s.address && <p className="text-xs text-slate-400 flex items-start gap-1.5 line-clamp-2"><MapPin size={12} className="mt-0.5 shrink-0" /> {s.address}</p>}
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <span className="text-xs text-slate-400">{(s as unknown as { business?: { name: string } }).business?.name ?? '—'}</span>
                <span className="text-xs text-slate-400">{formatDate((s as unknown as { created_at?: string }).created_at ?? new Date().toISOString())}</span>
              </div>
              {canManage && (
                <button onClick={async () => {
                  await supabase.from('suppliers').update({ is_active: !s.is_active }).eq('id', s.id);
                  await logAudit('supplier.status_changed', 'suppliers', s.id, { is_active: !s.is_active });
                  refetch();
                }} className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border border-slate-200 hover:bg-slate-50">
                  <Power size={12} /> {s.is_active ? 'Deactivate' : 'Activate'}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Truck size={32} />} title="No suppliers yet" description="Add suppliers to support procurement, delivery tracking and payables." action={canManage && <Button onClick={() => setShowModal(true)}><Plus size={18} /> New Supplier</Button>} />
      )}

      {showModal && <SupplierModal supplier={editing} businesses={businesses ?? []} currentUser={user} onClose={() => { setShowModal(false); setEditing(null); }} onSaved={() => { refetch(); setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

function SupplierModal({ supplier, businesses, currentUser, onClose, onSaved }: { supplier: Supplier | null; businesses: Business[]; currentUser: { business_id: string | null; role?: { name: string } } | null; onClose: () => void; onSaved: () => void }) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(supplier?.business_id ?? currentUser?.business_id ?? '');
  const [name, setName] = useState(supplier?.name ?? '');
  const [contactPerson, setContactPerson] = useState(supplier?.contact_person ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !businessId) { setError('Name and business are required'); return; }
    setSaving(true); setError(null);
    const payload = { business_id: businessId, name: name.trim(), contact_person: contactPerson.trim() || null, email: email.trim() || null, phone: phone.trim() || null, address: address.trim() };
    const { error: e } = supplier
      ? await supabase.from('suppliers').update(payload).eq('id', supplier.id)
      : await supabase.from('suppliers').insert(payload);
    if (e) { setError(e.message); setSaving(false); return; }
    await logAudit(supplier ? 'supplier.updated' : 'supplier.created', 'suppliers', supplier?.id ?? null, { name: name.trim() });
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={supplier ? 'Edit Supplier' : 'New Supplier'} size="md">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Business Unit</label>
          <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} disabled={!!supplier || !isExecutive} className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white outline-none focus:border-slate-900 disabled:bg-slate-50">
            <option value="">Select...</option>
            {(isExecutive ? businesses : businesses.filter((b) => (currentUser?.business_id ? [currentUser.business_id] : []).includes(b.id))).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <Input label="Supplier Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lagos Electricals Ltd" autoFocus />
        <Input label="Contact Person" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Optional" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Textarea label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
        {error && <p role="alert" className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
