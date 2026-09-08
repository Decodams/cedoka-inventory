import { useState, useMemo } from 'react';
import { UserPlus, Users, Pencil, Power, Mail, MapPin } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { ROLE_COLORS, hasRole, isAtLeast, canCreateRole } from '@/lib/rbac';
import type { UserProfile, Business, Branch, Role, RoleName } from '@/types/database';

export function UserManagementPage() {
  const { user, roles } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');

  const { data: profiles, loading, error, refetch } = useSupabaseQuery<UserProfile[]>(
    () =>
      supabase
        .from('user_profiles')
        .select(`*, role:roles(*), business:businesses(*), branch:branches(*)`)
        .order('created_at', { ascending: false }),
    [],
  );

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [],
  );

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [],
  );

  const filteredProfiles = useMemo(() => {
    if (!profiles) return [];
    return profiles.filter((p) => {
      if (filterRole !== 'all' && p.role?.name !== filterRole) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          p.full_name.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          (p.branch?.name?.toLowerCase().includes(q) ?? false) ||
          (p.business?.name?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [profiles, search, filterRole]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load users." onRetry={refetch} />;

  const roleName = user?.role?.name ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Create and manage user accounts. Role permissions are scoped automatically.
          </p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <UserPlus size={18} /> Add User
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search by name, email, or branch..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="sm:w-48"
        >
          <option value="all">All Roles</option>
          {roles.map((r) => (
            <option key={r.id} value={r.name}>
              {r.display_name}
            </option>
          ))}
        </Select>
      </div>

      {filteredProfiles.length > 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">
                    Name
                  </th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">
                    Role
                  </th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">
                    Business
                  </th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 hidden md:table-cell">
                    Branch
                  </th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">
                    Status
                  </th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredProfiles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                          {p.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{p.full_name}</p>
                          <p className="text-xs text-slate-400 truncate flex items-center gap-1">
                            <Mail size={11} /> {p.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {p.role && (
                        <Badge className={ROLE_COLORS[p.role.name as RoleName]}>
                          {p.role.display_name}
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 hidden sm:table-cell">
                      <span className="text-sm text-slate-600">{p.business?.name ?? '—'}</span>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="text-sm text-slate-600 flex items-center gap-1">
                        {p.branch ? (
                          <>
                            <MapPin size={13} className="text-slate-300" />
                            {p.branch.name}
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        className={
                          p.is_active
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-gray-100 text-gray-500 border-gray-200'
                        }
                      >
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isAtLeast(user, 'admin') && p.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await supabase.rpc(p.is_active ? 'deactivate_user' : 'activate_user', { p_user_id: p.id });
                            refetch();
                          }}
                        >
                          <Power size={14} /> {p.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Users size={32} />}
          title="No users found"
          description="Create a user account to give someone access to the platform."
          action={<Button onClick={() => setShowModal(true)}><UserPlus size={18} /> Add User</Button>}
        />
      )}

      {showModal && (
        <CreateUserModal
          roles={roles}
          businesses={businesses ?? []}
          branches={branches ?? []}
          currentUser={user}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            refetch();
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  roles,
  businesses,
  branches,
  currentUser,
  onClose,
  onSaved,
}: {
  roles: Role[];
  businesses: Business[];
  branches: Branch[];
  currentUser: UserProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableRoles = roles.filter((r) =>
    canCreateRole(currentUser, r.name as RoleName),
  );

  const availableBusinesses = useMemo(() => {
    if (hasRole(currentUser, 'super_admin')) return businesses;
    return businesses.filter((b) => b.id === currentUser?.business_id);
  }, [businesses, currentUser]);

  const availableBranches = useMemo(() => {
    if (!businessId) return [];
    if (hasRole(currentUser, 'super_admin')) return branches.filter((b) => b.business_id === businessId);
    if (hasRole(currentUser, 'admin')) return branches.filter((b) => b.business_id === businessId);
    if (hasRole(currentUser, 'manager')) return branches.filter((b) => b.id === currentUser?.branch_id);
    return [];
  }, [branches, businessId, currentUser]);

  const selectedRole = roles.find((r) => r.id === roleId);
  const needsBusiness = selectedRole && selectedRole.name !== 'super_admin';
  const needsBranch = selectedRole && (selectedRole.name === 'manager' || selectedRole.name === 'sales_person');

  const handleSave = async () => {
    if (!email.trim() || !password.trim() || !fullName.trim() || !roleId) {
      setError('All fields are required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSaving(true);
    setError(null);

    const selectedRoleName = roles.find((r) => r.id === roleId)?.name;
    if (!selectedRoleName) {
      setError('Invalid role selected');
      setSaving(false);
      return;
    }

    const { error: rpcError } = await supabase.rpc('create_user_account', {
      p_email: email.trim(),
      p_password: password,
      p_full_name: fullName.trim(),
      p_role_name: selectedRoleName,
      p_business_id: needsBusiness ? businessId || null : null,
      p_branch_id: needsBranch ? branchId || null : null,
    });

    if (rpcError) {
      setError('Could not create the user account. Please try again.');
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Add New User" size="md">
      <div className="space-y-4">
        <Input
          label="Full Name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="John Doe"
          autoFocus
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="john@cedoka.com"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimum 6 characters"
        />
        <Select
          label="Role"
          value={roleId}
          onChange={(e) => {
            setRoleId(e.target.value);
            setBusinessId('');
            setBranchId('');
          }}
        >
          <option value="">Select a role...</option>
          {availableRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.display_name}
            </option>
          ))}
        </Select>
        {needsBusiness && (
          <Select
            label="Business Unit"
            value={businessId}
            onChange={(e) => {
              setBusinessId(e.target.value);
              setBranchId('');
            }}
          >
            <option value="">Select a business...</option>
            {availableBusinesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {needsBranch && businessId && (
          <Select
            label="Branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Select a branch...</option>
            {availableBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Creating...' : 'Create User'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
