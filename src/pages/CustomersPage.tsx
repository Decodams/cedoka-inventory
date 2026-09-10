import { useState, useMemo } from 'react';
import { Users, Plus, Pencil, Search, Power, Mail, Phone, MapPin, Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Customer, Business, Branch } from '@/types/database';

export function CustomersPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  const { data: businesses } = useSupabaseQuery<Business[]>(() => supabase.from('businesses').select('*').eq('is_active', true).order('name'), [], { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 });
  const { data: branches } = useSupabaseQuery<Branch[]>(() => supabase.from('branches').select('*').eq('is_active', true).order('name'), [], { cacheKey: `ref:branches:${user?.id ?? 'anon'}`, ttlMs: 60_000 });
  const { data: customers, loading, error, refetch } = useSupabaseQuery<Customer[]>(
    () => {
      let q = supabase.from('customers').select(`*, business:businesses(id,name), branch:branches(id,name)`).order('created_at', { ascending: false });
      if (!isExecutive && user?.business_id) q = q.eq('business_id', user.business_id);
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [filterBusiness, user?.business_id, isExecutive]
  );

  const filtered = useMemo(() => {
    if (!customers) return [];
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(c => c.name.toLowerCase().includes(q) || (c.email?.toLowerCase().includes(q) ?? false) || (c.phone?.includes(q) ?? false));
  }, [customers, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load customers." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><Users size={22} className="text-slate-900" /> Customers</h2>
          <p className="text-sm text-slate-500 mt-1">Manage customer records tied to sales and receivables.</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowModal(true); }} className="w-full sm:w-auto"><Plus size={18} /> New Customer</Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search by name, email, or phone..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition" />
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
          {filtered.map(c => (
            <div key={c.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-semibold text-sm shrink-0">{c.name.charAt(0).toUpperCase()}</div>
                <div className="flex items-center gap-2">
                  <Badge className={c.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>{c.is_active ? 'Active' : 'Inactive'}</Badge>
                  {canManage && <button onClick={() => { setEditing(c); setShowModal(true); }} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Pencil size={14} /></button>}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-3 truncate">{c.name}</h3>
              <div className="mt-2 space-y-1">
                {c.email && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Mail size={12} /> {c.email}</p>}
                {c.phone && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Phone size={12} /> {c.phone}</p>}
                {c.address && <p className="text-xs text-slate-400 flex items-center gap-1.5 line-clamp-1"><MapPin size={12} /> {c.address}</p>}
              </div>
              <p className="text-xs text-slate-400 mt-3 flex items-center gap-1"><Building2 size={12} /> {c.business?.name ?? '—'} {c.branch?.name ? `· ${c.branch.name}` : ''}</p>
              {canManage && <button onClick={async () => { await supabase.from('customers').update({ is_active: !c.is_active }).eq('id', c.id); refetch(); }} className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border border-slate-200 hover:bg-slate-50"><Power size={12} /> {c.is_active ? 'Deactivate' : 'Activate'}</button>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Users size={32} />} title="No customers yet" description="Add customers to link sales, receivables, and outstanding balances." action={<Button onClick={() => setShowModal(true)}><Plus size={18} /> New Customer</Button>} />
      )}

      {showModal && <CustomerModal customer={editing} businesses={businesses ?? []} branches={branches ?? []} currentUser={user} onClose={() => { setShowModal(false); setEditing(null); }} onSaved={() => { refetch(); setShowModal(false); setEditing(null); }} />}
    </div>
  );
}

function CustomerModal({ customer, businesses, branches, currentUser, onClose, onSaved }: { customer: Customer | null; businesses: Business[]; branches: Branch[]; currentUser: { business_id: string | null; branch_id: string | null; role?: { name: string } } | null; onClose: () => void; onSaved: () => void }) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(customer?.business_id ?? currentUser?.business_id ?? '');
  const [branchId, setBranchId] = useState(customer?.branch_id ?? currentUser?.branch_id ?? '');
  const [name, setName] = useState(customer?.name ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !businessId) { setError('Name and business are required'); return; }
    setSaving(true); setError(null);
    const payload = { business_id: businessId, branch_id: branchId || null, name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, address: address.trim() };
    const { error: e } = customer ? await supabase.from('customers').update(payload).eq('id', customer.id) : await supabase.from('customers').insert(payload);
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={customer ? 'Edit Customer' : 'New Customer'} size="md">
      <div className="space-y-4">
        <Select label="Business Unit" value={businessId} onChange={e => { setBusinessId(e.target.value); setBranchId(''); }} disabled={!!customer || !isExecutive}>
          <option value="">Select...</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select label="Branch" value={branchId} onChange={e => setBranchId(e.target.value)}>
          <option value="">All branches</option>
          {branches.filter(b => b.business_id === businessId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Customer Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. John Okafor, ABC Ltd" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" />
          <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+234..." />
        </div>
        <Textarea label="Address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Delivery / billing address" />
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
