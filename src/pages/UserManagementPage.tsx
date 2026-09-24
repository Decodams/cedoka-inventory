import { useState, useMemo, useEffect } from 'react';
import { UserPlus, Users, Power, Mail, MapPin, Check, XCircle, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { ROLE_COLORS, hasRole, isAtLeast, canCreateRole } from '@/lib/rbac';
import { edgeErrorMessage } from '@/lib/edge';
import type { UserProfile, Business, Branch, Role, RoleName, Unit } from '@/types/database';

const ROLE_RANK: Record<string, number> = {
  super_admin: 5, admin: 4, manager: 3, supervisor: 2,
  sales_person: 1, accountant: 1, inventory_officer: 1,
  transport_officer: 1, auditor: 0, farm_operations_officer: 1,
};

export function UserManagementPage() {
  const { user, roles } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [success, setSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [showRoles, setShowRoles] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [search, filterRole]);

  const handleUserStatus = async (userId: string, action: 'approve' | 'reject' | 'activate' | 'deactivate') => {
    setActionError(null);
    const { error: statusError } = await supabase.functions.invoke('update-user-status', { body: { p_user_id: userId, p_action: action } });
    if (statusError) { setActionError(statusError.message || 'Could not update the user status.'); return; }
    setSuccess(`User ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'activate' ? 'activated' : 'deactivated'} successfully.`);
    refetch();
  };

  const handleDelete = async (target: UserProfile) => {
    setUpdating(true); setDeleteError(null);
    const { error: err } = await supabase.functions.invoke('delete-user', { body: { p_user_id: target.id } });
    setUpdating(false);
    if (err) { setDeleteError(err.message || 'Could not delete the user.'); return; }
    setSuccess('User deleted successfully.');
    setDeletingUser(null); refetch();
  };

  const { data: profiles, loading, error, refetch } = useSupabaseQuery<UserProfile[]>(
    () => { const from = (page - 1) * pageSize; const to = page * pageSize - 1; return supabase.from('user_profiles').select(`*, role:roles(id,name,display_name), business:businesses!user_profiles_business_id_fkey(id,name), branch:branches!user_profiles_branch_id_fkey(id,name)`, { count: 'exact' }).order('created_at', { ascending: false }).range(from, to); },
    [page, pageSize], { cacheKey: `users:list:${user?.id ?? 'anon'}:${page}:${pageSize}` }
  );
  const { data: businesses } = useSupabaseQuery<Business[]>(() => supabase.from('businesses').select('*').eq('is_active', true).order('name'), [], { cacheKey: `ref:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 });
  const { data: branches } = useSupabaseQuery<Branch[]>(() => supabase.from('branches').select('*').eq('is_active', true).order('name'), [], { cacheKey: `ref:branches:${user?.id ?? 'anon'}`, ttlMs: 60_000 });
  const { data: orgUnits } = useSupabaseQuery<Unit[]>(() => supabase.from('units').select('*').eq('is_active', true).order('name'), [], { cacheKey: `ref:units:${user?.id ?? 'anon'}`, ttlMs: 60_000 });

  const filteredProfiles = useMemo(() => {
    if (!profiles) return [];
    return profiles.filter((p) => {
      if (filterRole !== 'all' && p.role?.name !== filterRole) return false;
      if (search) { const q = search.toLowerCase(); return p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (p.branch?.name?.toLowerCase().includes(q) ?? false) || (p.business?.name?.toLowerCase().includes(q) ?? false); }
      return true;
    });
  }, [profiles, search, filterRole]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load users." onRetry={refetch} />;

  const canEdit = (target: UserProfile) => {
    if (!user || !target) return false;
    const targetRole = (target.role as { name?: string } | null)?.name;
    if (targetRole === 'super_admin') return false;
    if (target.id === user.id) return false;
    const actorRank = ROLE_RANK[(user.role?.name ?? '')] ?? -1;
    const targetRank = ROLE_RANK[targetRole ?? ''] ?? -1;
    if (actorRank <= targetRank) return false;
    if (hasRole(user, 'admin')) { const actorBiz = (user as { business_id?: string | null }).business_id ?? null; if (target.business_id && actorBiz && target.business_id !== actorBiz) return false; }
    if (hasRole(user, 'manager')) { const actorBranch = (user as { branch_id?: string | null }).branch_id ?? null; if (target.branch_id && actorBranch && target.branch_id !== actorBranch) return false; }
    return true;
  };

  const canDelete = (target: UserProfile) => {
    if (!user || !target) return false;
    const targetRole = (target.role as { name?: string } | null)?.name;
    if (targetRole === 'super_admin') return false;
    if (target.id === user.id) return false;
    const actorRank = ROLE_RANK[(user.role?.name ?? '')] ?? -1;
    const targetRank = ROLE_RANK[targetRole ?? ''] ?? -1;
    if (actorRank <= targetRank) return false;
    if (hasRole(user, 'admin')) { const actorBiz = (user as { business_id?: string | null }).business_id ?? null; if (target.business_id && actorBiz && target.business_id !== actorBiz) return false; }
    if (hasRole(user, 'manager')) { const actorBranch = (user as { branch_id?: string | null }).branch_id ?? null; if (target.branch_id && actorBranch && target.branch_id !== actorBranch) return false; }
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
          <p className="text-sm text-slate-500 mt-0.5">Create and manage user accounts. Role permissions are scoped automatically.</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {(hasRole(user, 'super_admin') || hasRole(user, 'admin')) && (
            <Button variant="outline" onClick={() => setShowRoles(true)}>
              <ShieldCheck size={18} /> Roles
            </Button>
          )}
          <Button onClick={() => { setSuccess(null); setShowModal(true); }} disabled={hasRole(user, 'super_admin') && (profiles?.filter((p) => p.role?.name === 'super_admin').length ?? 0) >= 2}>
            <UserPlus size={18} /> Add User
          </Button>
        </div>
      </div>
      {success && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{actionError}</p>}
      {deleteError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{deleteError}</p>}
      <div className="flex flex-col sm:flex-row gap-3">
        <Input placeholder="Search by name, email, or branch..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
        <Select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="sm:w-48">
          <option value="all">All Roles</option>
          {roles.map((r) => <option key={r.id} value={r.name}>{r.display_name}</option>)}
        </Select>
      </div>
      {filteredProfiles.length > 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Name</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Role</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">Business</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Branch</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredProfiles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-semibold shrink-0">{p.full_name.charAt(0).toUpperCase()}</div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{p.full_name}</p>
                          <p className="text-xs text-slate-400 truncate flex items-center gap-1"><Mail size={11} /> {p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">{p.role && <Badge className={ROLE_COLORS[p.role.name as RoleName]}>{p.role.display_name}</Badge>}</td>
                    <td className="px-5 py-3 hidden sm:table-cell"><span className="text-sm text-slate-600">{p.business?.name ?? '—'}</span></td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="text-sm text-slate-600 flex items-center gap-1">{p.branch ? <><MapPin size={13} className="text-slate-300" />{p.branch.name}</> : '—'}</span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge className={p.approval_status === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-200' : p.approval_status === 'rejected' ? 'bg-rose-100 text-rose-700 border-rose-200' : p.is_active ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>
                        {p.approval_status === 'pending' ? 'Awaiting approval' : p.approval_status === 'rejected' ? 'Rejected' : p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {(isAtLeast(user, 'admin') && p.id !== user?.id && canEdit(p) && p.approval_status === 'pending') ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="primary" size="sm" onClick={() => handleUserStatus(p.id, 'approve')}><Check size={14} /> Approve</Button>
                          <Button variant="danger" size="sm" onClick={() => handleUserStatus(p.id, 'reject')}><XCircle size={14} /> Reject</Button>
                        </div>
                      ) : isAtLeast(user, 'admin') && p.id !== user?.id && canEdit(p) ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          {canEdit(p) && <Button variant="ghost" size="sm" onClick={() => setEditingUser(p)}><Pencil size={14} /> Edit</Button>}
                          <Button variant="ghost" size="sm" onClick={() => handleUserStatus(p.id, p.is_active ? 'deactivate' : 'activate')}><Power size={14} /> {p.is_active ? 'Deactivate' : 'Activate'}</Button>
                          {canDelete(p) && <Button variant="ghost" size="sm" onClick={() => setDeletingUser(p)} className="text-rose-600 hover:text-rose-700"><Trash2 size={14} /> Delete</Button>}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-100">
            <div className="flex justify-between items-center text-sm text-slate-500">
              <span>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredProfiles.length)} of {filteredProfiles.length} users</span>
              <span>Page {page} of {Math.ceil(filteredProfiles.length / pageSize)}</span>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <Button variant="ghost" onClick={() => setPage(p => Math.min(Math.ceil(filteredProfiles.length / pageSize), p + 1))} disabled={page >= Math.ceil(filteredProfiles.length / pageSize)}>Next</Button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState icon={<Users size={32} />} title="No users found" description="Create a user account to give someone access to the platform." action={<Button onClick={() => setShowModal(true)}><UserPlus size={18} /> Add User</Button>} />
      )}
      {showModal && (
        <CreateUserModal roles={roles} businesses={businesses ?? []} branches={branches ?? []} currentUser={user} superAdminCount={profiles?.filter((p) => p.role?.name === 'super_admin').length ?? 0} onClose={() => setShowModal(false)} onSaved={() => { refetch(); setShowModal(false); setSuccess('User account created successfully.'); }} />
      )}
      {editingUser && (
        <EditUserModal user={editingUser} roles={roles} businesses={businesses ?? []} branches={branches ?? []} orgUnits={orgUnits ?? []} currentUser={user} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); refetch(); setSuccess('User role and scope updated successfully.'); }} />
      )}
      {deletingUser && (
        <Modal open onClose={() => setDeletingUser(null)} title="Delete User" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Delete <strong>{deletingUser.full_name}</strong> ({deletingUser.email})? This permanently removes their account and cannot be undone. Super Admin accounts are locked and cannot be deleted.</p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeletingUser(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => handleDelete(deletingUser)} disabled={updating}>{updating ? 'Deleting...' : 'Delete User'}</Button>
            </div>
          </div>
        </Modal>
      )}
      {showRoles && (
        <RolesManagerModal onClose={() => setShowRoles(false)} />
      )}
    </div>
  );
}

function EditUserModal({
  user, roles, businesses, branches, orgUnits, currentUser, onClose, onSaved,
}: {
  user: UserProfile; roles: Role[]; businesses: Business[]; branches: Branch[]; orgUnits: Unit[]; currentUser: UserProfile | null; onClose: () => void; onSaved: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRoleId(user.role_id);
    setBusinessId(user.business_id ?? '');
    setBranchIds(user.branch_id ? [user.branch_id] : []);
    supabase.from('user_unit_assignments').select('unit_id').eq('user_id', user.id).then(({ data }) => {
      if (data) setUnitIds((data as Array<{ unit_id: string }>).map((r) => r.unit_id));
    });
  }, [user]);

  const availableRoles = roles.filter((r) => {
    if (hasRole(currentUser, 'super_admin')) return true;
    if (hasRole(currentUser, 'admin')) return r.name !== 'super_admin';
    if (hasRole(currentUser, 'manager')) return !['super_admin', 'admin', 'manager'].includes(r.name);
    return canCreateRole(currentUser, r.name as RoleName);
  }).filter((r) => r.is_active !== false);

  const autoRoleId = useMemo(() => {
    const rn = (user.role as { name?: string } | null)?.name;
    return roles.find((r) => r.name === rn)?.id ?? '';
  }, [user, roles]);
  void autoRoleId;

  const autoBusinessId = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return '';
    return user.business_id || '';
  }, [currentUser, user]);
  void autoBusinessId;

  const availableBranches = useMemo(() => {
    if (!businessId) return [];
    if (hasRole(currentUser, 'super_admin') || hasRole(currentUser, 'admin')) return branches.filter((b) => b.business_id === businessId);
    return [];
  }, [branches, businessId, currentUser]);

  const canManageUnits = hasRole(currentUser, 'super_admin') || hasRole(currentUser, 'admin');
  const availableUnits = useMemo(() => {
    if (!businessId) return [];
    return orgUnits.filter((u) => u.business_id === businessId && (branchIds.length === 0 || !u.branch_id || branchIds.includes(u.branch_id)));
  }, [orgUnits, businessId, branchIds]);

  const myBusinessIds = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return businesses.map((b) => b.id);
    const ids = new Set<string>();
    if (currentUser?.business_id) ids.add(currentUser.business_id);
    // Include assigned businesses for multi-business admins
    const assignments = (currentUser as unknown as { business_assignments?: Array<{ business_id: string }> })?.business_assignments;
    if (Array.isArray(assignments)) for (const a of assignments) if (a.business_id) ids.add(a.business_id);
    return [...ids];
  }, [businesses, currentUser]);

  const availableBusinesses = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return businesses;
    if (myBusinessIds.length === 0) return [];
    return businesses.filter((b) => myBusinessIds.includes(b.id));
  }, [businesses, myBusinessIds]);

  const needsBusiness = true;
  const needsBranch = true;

  const handleSave = async () => {
    if (!roleId) { setError('Role is required'); return; }
    setError(null); setSaving(true);
    const selectedRoleName = roles.find((r) => r.id === roleId)?.name;
    const payload = { p_user_id: user.id, p_role_name: selectedRoleName, p_business_id: businessId || null, p_branch_id: branchIds[0] ?? null };
    const { error: err } = await supabase.functions.invoke('update-user-role', { body: payload });
    if (err && !String(err.message || '').includes('Failed to send a request')) {
      setError(await edgeErrorMessage(err, 'Could not update the user.'));
      setSaving(false);
      return;
    }
    if (err) {
      // Edge Function is unreachable (not deployed / offline): fall back to a
      // direct update, which succeeds for Super Admin and Admin under RLS.
      const { error: directErr } = await supabase.from('user_profiles').update({
        role_id: roleId, business_id: businessId || null, branch_id: branchIds[0] ?? null,
      }).eq('id', user.id);
      if (directErr) {
        setError(`User service is unreachable and direct update failed: ${directErr.message}. Ask an administrator to deploy the update-user-role function.`);
        setSaving(false);
        return;
      }
    }
    // Persist multi-branch oversight (Admins may oversee more than one branch).
    const { error: clearErr } = await supabase.from('user_branch_assignments').delete().eq('user_id', user.id);
    if (!clearErr && branchIds.length > 0) {
      const { error: assignErr } = await supabase.from('user_branch_assignments')
        .insert(branchIds.map((branch_id) => ({ user_id: user.id, branch_id })));
      if (assignErr) {
        setError(`Role saved, but branch assignments failed: ${assignErr.message}`);
        setSaving(false);
        return;
      }
    }
    // Persist unit/department assignments (stale selections from another business are dropped).
    const validUnitIds = unitIds.filter((id) => availableUnits.some((u) => u.id === id));
    const { error: clearUnitErr } = await supabase.from('user_unit_assignments').delete().eq('user_id', user.id);
    if (!clearUnitErr && validUnitIds.length > 0) {
      const { error: unitAssignErr } = await supabase.from('user_unit_assignments')
        .insert(validUnitIds.map((unit_id) => ({ user_id: user.id, unit_id })));
      if (unitAssignErr) {
        setError(`Role saved, but unit assignments failed: ${unitAssignErr.message}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Edit User Role & Scope" size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Editing <strong>{user.full_name}</strong> ({user.email}). Super Admin accounts are locked.</p>
        <Select label="Role" value={roleId} onChange={(e) => { setRoleId(e.target.value); setBusinessId(''); setBranchIds([]); }}>
          <option value="">Select a role...</option>
          {availableRoles.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
        </Select>
        {needsBusiness && (
          <Select label="Business Unit" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setBranchIds([]); }}>
            <option value="">Select a business...</option>
            {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        {needsBranch && businessId && (
          <div className="space-y-2">
            <span className="flex items-center gap-1 text-sm text-slate-600"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><line x1="1" y1="8" x2="22" y2="8"></line><line x1="1" y1="12" x2="22" y2="12"></line><line x1="1" y1="16" x2="22" y2="16"></line><polyline points="8 21 12 16 16 21"></polyline></svg>Branch</span>
            <div className="flex flex-wrap gap-2">
              {availableBranches.map((b) => (
                <div key={b.id} className={`selected-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${branchIds.includes(b.id) ? 'bg-rose-100 text-rose-600' : 'border border-rose-300 text-rose-700 hover:bg-rose-50'}`} onClick={() => { setBranchIds((prev) => (branchIds.includes(b.id) ? prev.filter((id) => id !== b.id) : [...prev, b.id])); }}>
                  {b.name}
                </div>
              ))}
            </div>
          </div>
        )}
        {canManageUnits && businessId && (
          <div className="space-y-2">
            <span className="text-sm text-slate-600">Units / Departments (select all that apply)</span>
            <div className="flex flex-wrap gap-2">
              {availableUnits.length === 0 && <span className="text-xs text-slate-400">No units defined for this business yet.</span>}
              {availableUnits.map((u) => (
                <div key={u.id} className={`selected-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${unitIds.includes(u.id) ? 'bg-emerald-100 text-emerald-700' : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`} onClick={() => { setUnitIds((prev) => (unitIds.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id])); }}>
                  {u.name}
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Updating...' : 'Save Changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateUserModal({
  roles, businesses, branches, currentUser, superAdminCount, onClose, onSaved,
}: {
  roles: Role[]; businesses: Business[]; branches: Branch[]; currentUser: UserProfile | null; superAdminCount: number; onClose: () => void; onSaved: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableRoles = roles.filter((r) => {
    if (hasRole(currentUser, 'super_admin')) return true;
    if (hasRole(currentUser, 'admin')) return r.name !== 'super_admin';
    if (hasRole(currentUser, 'manager')) return !['super_admin', 'admin', 'manager'].includes(r.name);
    return canCreateRole(currentUser, r.name as RoleName);
  }).filter((r) => r.is_active !== false);

  const autoDetectedRoleId = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return roles.find((r) => r.name === 'super_admin')?.id;
    if (hasRole(currentUser, 'admin')) return roles.find((r) => r.name === 'admin')?.id;
    if (hasRole(currentUser, 'manager')) return roles.find((r) => r.name === 'sales_person')?.id;
    return '';
  }, [currentUser, roles]);
  void autoDetectedRoleId;

  const autoDetectedBusinessId = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return '';
    return currentUser?.business_id || '';
  }, [currentUser]);
  void autoDetectedBusinessId;

  const availableBranches = useMemo(() => {
    if (!businessId) return [];
    if (hasRole(currentUser, 'super_admin')) return branches.filter((b) => b.business_id === businessId);
    if (hasRole(currentUser, 'admin')) return branches.filter((b) => b.business_id === businessId);
    if (hasRole(currentUser, 'manager')) return branches.filter((b) => b.id === currentUser?.branch_id);
    return [];
  }, [branches, businessId, currentUser]);

  const myBusinessIdsCreate = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return businesses.map((b) => b.id);
    const ids = new Set<string>();
    if (currentUser?.business_id) ids.add(currentUser.business_id);
    const assignments = (currentUser as unknown as { business_assignments?: Array<{ business_id: string }> })?.business_assignments;
    if (Array.isArray(assignments)) for (const a of assignments) if (a.business_id) ids.add(a.business_id);
    return [...ids];
  }, [businesses, currentUser]);

  const availableBusinesses = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return businesses;
    if (myBusinessIdsCreate.length === 0) return [];
    return businesses.filter((b) => myBusinessIdsCreate.includes(b.id));
  }, [businesses, myBusinessIdsCreate]);

  const selectedRole = roles.find((r) => r.id === roleId);
  const needsBusiness = selectedRole && selectedRole.name !== 'super_admin';
  const needsBranch = selectedRole && (selectedRole.name === 'manager' || selectedRole.name === 'sales_person');

  const handleSave = async () => {
    if (!email.trim() || !password.trim() || !fullName.trim() || !roleId) { setError('All fields are required'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    const selectedRoleName = roles.find((r) => r.id === roleId)?.name;
    if (!selectedRoleName) { setError('Invalid role selected'); setSaving(false); return; }
    if (hasRole(currentUser, 'super_admin') && selectedRoleName !== 'super_admin') { setError('Super Admin can only create another Super Admin account.'); setSaving(false); return; }
    setSaving(true); setError(null);
    const { error: createError } = await supabase.functions.invoke('create-user-account', {
      body: { p_email: email.trim(), p_password: password, p_full_name: fullName.trim(), p_role_name: selectedRoleName, p_business_id: needsBusiness ? businessId || null : null, p_branch_ids: needsBranch ? branchIds.length > 0 ? branchIds : [] : [], },
    });
    if (createError) { setError(await edgeErrorMessage(createError, 'Could not create the user account.')); setSaving(false); return; }
    setSaving(false); onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Add New User" size="md">
      <div className="space-y-4">
        <Input label="Full Name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" autoFocus />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@cedoka.com" />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 6 characters" />
        <Select label="Role" value={roleId} onChange={(e) => { setRoleId(e.target.value); setBusinessId(''); setBranchIds([]); }}>
          <option value="">{hasRole(currentUser, 'super_admin') && superAdminCount >= 2 ? 'Super Admin limit reached' : 'Select a role...'}</option>
          {availableRoles.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
        </Select>
        {needsBusiness && (
          <Select label="Business Unit" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setBranchIds([]); }}>
            <option value="">Select a business...</option>
            {availableBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        {needsBranch && businessId && (
          <div className="space-y-2">
            <span className="cursor-pointer select-none"><span className="flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><line x1="1" y1="8" x2="22" y2="8"></line><line x1="1" y1="12" x2="22" y2="12"></line><line x1="1" y1="16" x2="22" y2="16"></line><polyline points="8 21 12 16 16 21"></polyline></svg>Branches</span></span>
            <div className="flex flex-wrap gap-2">
              {availableBranches.map((b) => (
                <div key={b.id} className={`selected-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${branchIds.includes(b.id) ? 'bg-rose-100 text-rose-600' : 'border border-rose-300 text-rose-700 hover:bg-rose-50'}`} onClick={() => { setBranchIds((prev) => (branchIds.includes(b.id) ? prev.filter((id) => id !== b.id) : [...prev, b.id])); }}>
                  {b.name}
                </div>
              ))}
              {branchIds.length > 0 && (<div className="selected-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-200 text-rose-700" onClick={() => setBranchIds([])}>Clear all</div>)}
            </div>
          </div>
        )}
        {needsBranch && businessId && (<input type="hidden" name="branch_ids" value={JSON.stringify(branchIds)} id="branch_ids_hidden" />)}
        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating...' : 'Create User'}</Button>
        </div>
      </div>
    </Modal>
  );
}

const LOCKED_ROLES = new Set(['super_admin', 'admin']);

function RolesManagerModal({ onClose }: { onClose: () => void }) {
  const { user: actor } = useAuth();
  const isSuperAdmin = hasRole(actor, 'super_admin');
  const [list, setList] = useState<Role[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDisplay, setEditDisplay] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permsByRole, setPermsByRole] = useState<Record<string, string[]>>({});

  const load = async () => {
    setLoadingRoles(true);
    const { data } = await supabase.from('roles').select('*').order('name');
    setList(((data ?? []) as Role[]).slice().sort((a, b) => a.display_name.localeCompare(b.display_name)));
    const { data: grants } = await supabase.from('role_permissions').select('role_id, permission:permissions(code)');
    if (grants) {
      const map: Record<string, string[]> = {};
      const rows = (grants as unknown) as Array<{ role_id: string; permission: Array<{ code: string }> | { code: string } | null }>;
      for (const g of rows) {
        const list = Array.isArray(g.permission) ? g.permission : g.permission ? [g.permission] : [];
        for (const p of list) {
          if (!p.code) continue;
          if (!map[g.role_id]) map[g.role_id] = [];
          if (!map[g.role_id].includes(p.code)) map[g.role_id].push(p.code);
        }
      }
      for (const k of Object.keys(map)) map[k].sort();
      setPermsByRole(map);
    }
    setLoadingRoles(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    const key = name.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) { setError('Role key must start with a letter and contain only lowercase letters, numbers and underscores (e.g. store_keeper).'); return; }
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    setBusy(true); setError(null);
    const { error: createErr } = await supabase.from('roles').insert({
      name: key, display_name: displayName.trim(), description: description.trim(), is_system: false,
    });
    if (createErr) {
      setError(createErr.message.includes('duplicate') || createErr.code === '23505' ? 'This role already exists.' : `Could not create role: ${createErr.message}`);
      setBusy(false);
      return;
    }
    setName(''); setDisplayName(''); setDescription('');
    await load(); setBusy(false);
  };

  const startEdit = (r: Role) => { setEditingId(r.id); setEditDisplay(r.display_name); setEditDescription(r.description ?? ''); setError(null); };

  const handleUpdate = async (r: Role) => {
    if (!editDisplay.trim()) { setError('Display name is required.'); return; }
    setBusy(true); setError(null);
    const { error: updateErr } = await supabase.from('roles').update({
      display_name: editDisplay.trim(), description: editDescription.trim(),
    }).eq('id', r.id);
    if (updateErr) { setError(`Could not update role: ${updateErr.message}`); setBusy(false); return; }
    setEditingId(null); await load(); setBusy(false);
  };

  const handleToggleActive = async (r: Role) => {
    if (LOCKED_ROLES.has(r.name)) { setError('Super Admin and Admin roles are locked.'); return; }
    setBusy(true); setError(null);
    const { error: toggleErr } = await supabase.from('roles').update({ is_active: !r.is_active }).eq('id', r.id);
    if (toggleErr) { setError(`Could not update role: ${toggleErr.message}`); setBusy(false); return; }
    await load(); setBusy(false);
  };

  const handleDelete = async (r: Role) => {    if (LOCKED_ROLES.has(r.name)) { setError('Super Admin and Admin roles are locked and cannot be deleted.'); return; }
    if (isSuperAdmin) {
      if (!window.confirm(`Permanently delete role "${r.display_name}"? Users holding it keep their accounts and fall back to Salesperson for reassignment. This cannot be undone.`)) return;
      setBusy(true); setError(null);
      const { error: fnError } = await supabase.functions.invoke('delete-organization', {
        body: { p_entity: 'role', p_id: r.id },
      });
      if (fnError) {
        setError(fnError.message.includes('Failed to send a request')
          ? 'Delete service is unreachable. Ask an administrator to deploy the delete-organization function.'
          : fnError.message);
        setBusy(false);
        return;
      }
      await load(); setBusy(false);
      return;
    }
    const { count } = await supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('role_id', r.id);
    if ((count ?? 0) > 0) { setError(`Cannot delete "${r.display_name}" — ${count} user${count === 1 ? '' : 's'} still ${count === 1 ? 'has' : 'have'} this role. Reassign them first.`); return; }
    if (!window.confirm(`Delete role "${r.display_name}"? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    const { error: deleteErr } = await supabase.from('roles').delete().eq('id', r.id);
    if (deleteErr) { setError(`Could not delete role: ${deleteErr.message}`); setBusy(false); return; }
    await load(); setBusy(false);
  };

  return (
    <Modal open onClose={onClose} title="Manage Roles" size="md">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">Roles defined here are the roles that exist in the system. Role keys are permanent once created. Super Admin and Admin are locked and cannot be deleted.</p>
        <div className="rounded-xl border border-slate-200 divide-y max-h-72 overflow-y-auto">
          {loadingRoles && <p className="p-4 text-sm text-slate-400">Loading roles...</p>}
          {!loadingRoles && list.map((r) => (
            <div key={r.id} className="flex items-center gap-2 p-3">
              {editingId === r.id ? (
                <>
                  <div className="flex-1 space-y-2">
                    <input value={editDisplay} onChange={(e) => setEditDisplay(e.target.value)} className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900" autoFocus />
                    <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description" className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-slate-900" />
                  </div>
                  <Button size="sm" onClick={() => handleUpdate(r)} disabled={busy}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{r.display_name}</p>
                    <p className="text-xs text-slate-400 truncate">{r.name}{r.description ? ` · ${r.description}` : ''}</p>
                    {(permsByRole[r.id] ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(permsByRole[r.id] ?? []).slice(0, 8).map((code) => (
                          <span key={code} className="inline-flex px-1.5 py-px rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">{code}</span>
                        ))}
                        {(permsByRole[r.id] ?? []).length > 8 && (
                          <span className="inline-flex px-1.5 py-px rounded text-[10px] font-medium bg-slate-900 text-white">+{(permsByRole[r.id] ?? []).length - 8} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  {LOCKED_ROLES.has(r.name)
                    ? <Badge className="bg-slate-100 text-slate-500 border-slate-200 shrink-0">Locked</Badge>
                    : (
                      <>
                        {!r.is_active && <Badge className="bg-gray-100 text-gray-500 border-gray-200 shrink-0">Inactive</Badge>}
                        <button onClick={() => handleToggleActive(r)} className="px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 shrink-0" title={r.is_active ? 'Deactivate role' : 'Reactivate role'}>
                          {r.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button onClick={() => startEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0" title="Edit role">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(r)} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 shrink-0" title="Delete role">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Add role</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Role key" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. store_keeper" />
            <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Store Keeper" />
          </div>
          <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role does" />
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={busy}>{busy ? 'Saving...' : 'Add Role'}</Button>
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
