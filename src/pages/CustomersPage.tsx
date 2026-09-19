import { useState, useMemo, useEffect } from 'react';
import { Users, Plus, Pencil, Search, Power, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { hasRole, isAtLeast } from '@/lib/rbac';
import type { Customer, Business } from '@/types/database';

export function CustomersPage() {
  const { user } = useAuth();
  const canManage = isAtLeast(user, 'manager');
  const isExecutive = hasRole(user, 'super_admin');
  const [search, setSearch] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 30;

  useEffect(() => { setPage(1); }, [search, filterBusiness, user?.business_id]);

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );
  const { data: customers, loading, error, refetch } = useSupabaseQuery<Customer[]>(
    () => {
      const from = (page - 1) * pageSize;
      const to = page * pageSize - 1;
      let q = supabase
        .from('customers')
        .select(`*, business:businesses(id,name), branch:branches(id,name)`, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (!isExecutive && user?.business_id) q = q.eq('business_id', user.business_id);
      if (filterBusiness !== 'all') q = q.eq('business_id', filterBusiness);
      return q;
    },
    [filterBusiness, user?.business_id, isExecutive, page, pageSize],
  );

  const filtered = useMemo(() => {
    if (!customers) return [];
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone?.includes(q) ?? false) ||
        (c.address?.toLowerCase().includes(q) ?? false),
    );
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
          <input
            placeholder="Search by name, phone, or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition"
          />
        </div>
        {isExecutive && (
          <Select value={filterBusiness} onChange={(e) => setFilterBusiness(e.target.value)} className="lg:w-56">
            <option value="all">All Businesses</option>
            {businesses?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {filtered.length ? (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Name</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">Phone</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Location</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-semibold text-sm shrink-0">{c.name.charAt(0).toUpperCase()}</div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{c.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 hidden sm:table-cell text-sm text-slate-600">{c.phone ?? <span className="text-slate-400">-</span>}</td>
                      <td className="px-5 py-3 hidden md:table-cell text-sm text-slate-600 max-w-[220px]"><span className="block truncate">{c.address?.trim() ? c.address : '-'}</span></td>
                      <td className="px-5 py-3">
                        <Badge className={c.is_active ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                          {c.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canManage && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              onClick={() => {
                                setEditing(c);
                                setShowModal(true);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <Pencil size={14} />
                            </button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                await supabase
                                  .from('customers')
                                  .update({ is_active: !c.is_active })
                                  .eq('id', c.id);
                                refetch();
                              }}
                              className="text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <Power size={14} /> {c.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Delete ${c.name}?`)) {
                                  supabase
                                    .from('customers')
                                    .delete()
                                    .eq('id', c.id)
                                    .then(() => refetch());
                                }
                              }}
                              className="text-rose-500 hover:text-rose-700"
                            >
                              <Trash2 size={14} /> Delete
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-slate-100">
              <div className="flex justify-between items-center text-sm text-slate-500">
                <span>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} customers</span>
                <span>Page {page} of {Math.ceil(filtered.length / pageSize)}</span>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="ghost" onClick={() => {setPage(p => Math.max(1, p - 1));}} disabled={page === 1}>Prev</Button>
                <Button variant="ghost" onClick={() => {setPage(p => Math.min(Math.ceil(filtered.length / pageSize), p + 1));}} disabled={page >= Math.ceil(filtered.length / pageSize)}>Next</Button>
              </div>
            </div>
          </div>
          </>
        ) : (
          <EmptyState
            icon={<Users size={32} />}
            title="No customers yet"
            description="Add customers to link sales, receivables, and outstanding balances."
            action={<Button onClick={() => setShowModal(true)}><Plus size={18} /> New Customer</Button>}
          />
        )}
        {showModal && (
          <CustomerModal
            customer={editing}
            businesses={businesses ?? []}
            currentUser={user}
            onClose={() => {
              setShowModal(false);
              setEditing(null);
            }}
            onSaved={() => {
              refetch();
              setShowModal(false);
              setEditing(null);
            }}
          />
        )}
        </div>
  );
}

function CustomerModal({
  customer,
  businesses,
  currentUser,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  businesses: Business[];
  currentUser: {
    business_id: string | null;
    branch_id: string | null;
    role?: { name: string };
  } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isExecutive = currentUser?.role?.name === 'super_admin';
  const [businessId, setBusinessId] = useState(
    customer?.business_id ?? currentUser?.business_id ?? '',
  );
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const effectiveBusinessId = customer?.business_id ?? businessId ?? currentUser?.business_id ?? '';
    if (!name.trim()) {
      setError('Customer name is required');
      return;
    }
    if (!effectiveBusinessId) {
      setError('Your account has no business assigned. Ask an administrator to set your business first.');
      return;
    }
    if (!phone.trim()) {
      setError('Phone number is required');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      business_id: effectiveBusinessId,
      branch_id: customer?.branch_id ?? null,
      name: name.trim(),
      email: customer?.email ?? null,
      phone: phone.trim(),
      address: address.trim(),
    };
    const { error: e } = customer
      ? await supabase
          .from('customers')
          .update(payload)
          .eq('id', customer.id)
      : await supabase.from('customers').insert(payload);
    if (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={customer ? 'Edit Customer' : 'New Customer'} size="md">
      <div className="space-y-4">
        {isExecutive && !customer && (
          <Select
            label="Business Unit"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
          >
            <option value="">Select...</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          label="Customer Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. John Okafor, ABC Ltd"
          autoFocus
        />
        <Input
          label="Phone Number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+234..."
        />
        <Textarea
          label="Location"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Customer location / address"
        />
        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
