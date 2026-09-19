import { useState, useEffect } from 'react';
import { Building2, Plus, MapPin, Pencil, ChevronRight, Calendar, Users, Tag, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { hasRole, isAtLeast, ROLE_COLORS } from '@/lib/rbac';
import type { Business, Branch, UserProfile, Category, RoleName, Unit } from '@/types/database';

type StaffWithRole = Pick<UserProfile, 'id' | 'full_name' | 'business_id' | 'branch_id'> & {
  role: { name: RoleName; display_name: string } | null;
};

export function BusinessBranchPage() {
  const { user } = useAuth();
  const canManageBusinesses = hasRole(user, 'super_admin', 'admin');
  const canManageBranches = hasRole(user, 'super_admin', 'admin');
  const canManageCategories = hasRole(user, 'super_admin', 'admin') || isAtLeast(user, 'manager');
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [showBizModal, setShowBizModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [unitModalBiz, setUnitModalBiz] = useState<Business | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [categoryModalBiz, setCategoryModalBiz] = useState<Business | null>(null);
  const [editingBiz, setEditingBiz] = useState<Business | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  const { data: businesses, loading, error, refetch } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').order('name'),
    [],
    { cacheKey: `org:businesses:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').order('name'),
    [],
    { cacheKey: `org:branches:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: categories, refetch: refetchCategories } = useSupabaseQuery<Category[]>(
    () => supabase.from('categories').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `ref:categories:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: orgUnits, refetch: refetchUnits } = useSupabaseQuery<Unit[]>(
    () => supabase.from('units').select('*').eq('is_active', true).order('name'),
    [],
    { cacheKey: `org:units:${user?.id ?? 'anon'}`, ttlMs: 60_000 },
  );

  const { data: staff } = useSupabaseQuery<StaffWithRole[]>(    () =>
      supabase
        .from('user_profiles')
        .select('id, full_name, business_id, branch_id, role:roles(name, display_name)')
        .eq('is_active', true)
        .order('full_name') as unknown as Promise<{ data: StaffWithRole[] | null; error: { message: string } | null }>,
    [],
    { cacheKey: `org:staff:${user?.id ?? 'anon'}` },
  );

  const branchesForBusiness = (bizId: string) => branches?.filter((b) => b.business_id === bizId) ?? [];
  const categoriesForBusiness = (bizId: string) =>
    categories?.filter((c) => c.business_id === bizId) ?? [];
  const unitsForBusiness = (bizId: string) => orgUnits?.filter((u) => u.business_id === bizId) ?? [];
  const staffForBusiness = (bizId: string) => staff?.filter((s) => s.business_id === bizId) ?? [];
  const staffForBranch = (branchId: string) => staff?.filter((s) => s.branch_id === branchId) ?? [];

  const roleBreakdown = (members: StaffWithRole[]) => {
    const counts = new Map<string, { display: string; count: number }>();
    for (const m of members) {
      const key = m.role?.name ?? 'unassigned';
      const display = m.role?.display_name ?? 'Unassigned';
      const prev = counts.get(key);
      counts.set(key, { display, count: (prev?.count ?? 0) + 1 });
    }
    return [...counts.entries()];
  };

  const handleDeleteUnit = async (u: Unit) => {
    if (!window.confirm(`Permanently delete unit "${u.name}"? Staff assignments to it are removed (accounts are kept). This cannot be undone.`)) return;
    const { error: fnError } = await supabase.functions.invoke('delete-organization', {
      body: { p_entity: 'unit', p_id: u.id },
    });
    if (fnError) {
      window.alert(fnError.message.includes('Failed to send a request')
        ? 'Delete service is unreachable. Ask an administrator to deploy the delete-organization function.'
        : fnError.message);
      return;
    }
    refetchUnits();
  };

  const handleDeleteCategory = async (cat: Category) => {    const confirmed = window.confirm(`Delete category "${cat.name}"?`);
    if (!confirmed) return;
    const { data: prods } = await supabase.from('products').select('id').eq('category_id', cat.id).limit(1);
    if (prods && prods.length > 0) {
      window.alert(`Cannot delete category "${cat.name}" because it is currently assigned to products. Please reassign or delete those products first.`);
      return;
    }
    const { error: fnError } = await supabase.functions.invoke('manage-category', {
      body: { p_business_id: cat.business_id, p_category_id: cat.id, p_action: 'delete' },
    });
    if (fnError) {
      const { error: directError } = await supabase.from('categories').delete().eq('id', cat.id);
      if (directError) {
        window.alert('Could not delete category: ' + directError.message);
        return;
      }
    }
    refetchCategories();
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message="Could not load businesses." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Businesses & Branches</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage your organizational structure — businesses, branches, and locations.
          </p>
        </div>
        {canManageBusinesses && (
          <Button
            onClick={() => {
              setEditingBiz(null);
              setShowBizModal(true);
            }}
          >
            <Plus size={18} /> Add Business
          </Button>
        )}
      </div>

      {businesses && businesses.length > 0 ? (
        <div className="space-y-4">
          {businesses.map((biz) => (
            <div key={biz.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setSelectedBusiness(selectedBusiness?.id === biz.id ? null : biz)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{biz.name}</h3>
                      {!biz.is_active && (
                        <Badge className="bg-gray-100 text-gray-500 border-gray-200">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {biz.category ?? 'Uncategorized'} · {branchesForBusiness(biz.id).length} branches ·{' '}
                      {categoriesForBusiness(biz.id).length} categories · {staffForBusiness(biz.id).length} staff
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManageBusinesses && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingBiz(biz);
                        setShowBizModal(true);
                      }}
                    >
                      <Pencil size={14} /> Edit
                    </Button>
                  )}
                  <ChevronRight
                    size={20}
                    className={`text-slate-300 transition-transform ${
                      selectedBusiness?.id === biz.id ? 'rotate-90' : ''
                    }`}
                  />
                </div>
              </div>

              {selectedBusiness?.id === biz.id && (
                <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50 space-y-5">
                  {biz.description && (
                    <p className="text-sm text-slate-600">{biz.description}</p>
                  )}

                  {/* Categories scoped to this business */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Tag size={13} className="text-slate-400" />
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Categories · {categoriesForBusiness(biz.id).length}
                        </h4>
                      </div>
                      {canManageCategories && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCategoryModalBiz(biz);
                            setEditingCategory(null);
                            setShowCategoryModal(true);
                          }}
                        >
                          <Plus size={14} /> Add Category
                        </Button>
                      )}
                    </div>
                    {categoriesForBusiness(biz.id).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {categoriesForBusiness(biz.id).map((c) => (
                          <div
                            key={c.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 shadow-xs group"
                          >
                            <span className="font-medium">{c.name}</span>
                            {canManageCategories && (
                              <div className="flex items-center gap-1 ml-1 opacity-70 group-hover:opacity-100">
                                <button
                                  type="button"
                                  title="Edit category"
                                  onClick={() => {
                                    setCategoryModalBiz(biz);
                                    setEditingCategory(c);
                                    setShowCategoryModal(true);
                                  }}
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  <Pencil size={11} />
                                </button>
                                <button
                                  type="button"
                                  title="Delete category"
                                  onClick={() => handleDeleteCategory(c)}
                                  className="text-slate-400 hover:text-rose-600"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        No categories yet for this business.{' '}
                        {canManageCategories && 'Click "+ Add Category" to create one.'}
                      </p>
                    )}
                  </div>

                  {/* Units / departments scoped to this business */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Users size={13} className="text-slate-400" />
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Units · {unitsForBusiness(biz.id).length}
                        </h4>
                      </div>
                      {canManageCategories && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setUnitModalBiz(biz);
                            setEditingUnit(null);
                            setShowUnitModal(true);
                          }}
                        >
                          <Plus size={14} /> Add Unit
                        </Button>
                      )}
                    </div>
                    {unitsForBusiness(biz.id).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {unitsForBusiness(biz.id).map((u) => (
                          <div
                            key={u.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 shadow-xs group"
                          >
                            <span className="font-medium">{u.name}</span>
                            {u.branch_id && (
                              <span className="text-slate-400">· {branchesForBusiness(biz.id).find((b) => b.id === u.branch_id)?.name ?? 'Branch'}</span>
                            )}
                            {canManageCategories && (
                              <div className="flex items-center gap-1 ml-1 opacity-70 group-hover:opacity-100">
                                <button
                                  type="button"
                                  title="Edit unit"
                                  onClick={() => {
                                    setUnitModalBiz(biz);
                                    setEditingUnit(u);
                                    setShowUnitModal(true);
                                  }}
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  <Pencil size={11} />
                                </button>
                                {hasRole(user, 'super_admin') && (
                                  <button
                                    type="button"
                                    title="Delete unit"
                                    onClick={() => handleDeleteUnit(u)}
                                    className="text-slate-400 hover:text-rose-600"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        No units yet for this business.{' '}
                        {canManageCategories && 'Click "+ Add Unit" to create one.'}
                      </p>
                    )}
                  </div>

                  {/* Roles scoped to this business — same role names can repeat per branch */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users size={13} className="text-slate-400" />
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Staff roles · {staffForBusiness(biz.id).length} active
                      </h4>
                    </div>
                    {staffForBusiness(biz.id).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {roleBreakdown(staffForBusiness(biz.id)).map(([roleName, info]) => (
                          <Badge
                            key={roleName}
                            className={ROLE_COLORS[roleName as RoleName] ?? 'bg-slate-100 text-slate-600 border-slate-200'}
                          >
                            {info.display} · {info.count}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">No active staff assigned to this business yet.</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Branches · {branchesForBusiness(biz.id).length}
                    </h4>
                    {canManageBranches && <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingBranch(null);
                        setShowBranchModal(true);
                      }}
                    >
                      <Plus size={14} /> Add Branch
                    </Button>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {branchesForBusiness(biz.id).map((branch) => {
                      const members = staffForBranch(branch.id);
                      return (
                      <div
                        key={branch.id}
                        className="bg-white rounded-xl border border-slate-200 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <MapPin size={16} className="text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">
                                {branch.name}
                              </p>
                              {branch.location && (
                                <p className="text-xs text-slate-400 truncate">{branch.location}</p>
                              )}
                              {branch.opening_date && (
                                <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><Calendar size={10}/>Since {branch.opening_date}</p>
                              )}
                            </div>
                          </div>
                          {canManageBranches && <button
                            onClick={() => {
                              setEditingBranch(branch);
                              setShowBranchModal(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
                          >
                            <Pencil size={14} />
                          </button>}
                          {canManageBranches && <button
                            aria-label={`Delete ${branch.name}`}
                            title="Delete branch"
                            onClick={async () => {
                              const confirmed = window.confirm(`Delete ${branch.name}? If this branch has staff, stock, sales, or other records, the database will protect those records and the branch cannot be deleted.`);
                              if (!confirmed) return;
                              const { error: deleteError } = await supabase.from('branches').delete().eq('id', branch.id);
                              if (deleteError) window.alert(`Branch was not deleted: ${deleteError.message}`);
                              else refetch();
                            }}
                            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 shrink-0"
                          ><Trash2 size={14} /></button>}
                        </div>
                        <div className="mt-2.5 pt-2.5 border-t border-slate-100">
                          {members.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {roleBreakdown(members).map(([roleName, info]) => (
                                <Badge
                                  key={roleName}
                                  className={ROLE_COLORS[roleName as RoleName] ?? 'bg-slate-100 text-slate-600 border-slate-200'}
                                >
                                  {info.display} · {info.count}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-400">No staff assigned to this branch.</p>
                          )}
                        </div>
                      </div>
                      );
                    })}
                    {branchesForBusiness(biz.id).length === 0 && (
                      <p className="text-sm text-slate-400 col-span-full py-4 text-center">
                        No branches yet. Click "Add Branch" to create one.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Building2 size={32} />}
          title="No businesses yet"
          description="Create your first business unit to start managing branches and reports."
          action={
            canManageBusinesses && (
              <Button onClick={() => setShowBizModal(true)}>
                <Plus size={18} /> Add Business
              </Button>
            )
          }
        />
      )}

      {showBizModal && (
        <BusinessFormModal
          business={editingBiz}
          isSuperAdmin={canManageBusinesses && hasRole(user, 'super_admin')}
          onClose={() => {
            setShowBizModal(false);
            setEditingBiz(null);
          }}
          onSaved={() => {
            refetch();
            setShowBizModal(false);
            setEditingBiz(null);
          }}
        />
      )}

      {showBranchModal && selectedBusiness && (
        <BranchFormModal
          branch={editingBranch}
          business={selectedBusiness}
          isSuperAdmin={hasRole(user, 'super_admin')}
          onClose={() => {
            setShowBranchModal(false);
            setEditingBranch(null);
          }}
          onSaved={() => {
            refetch();
            setShowBranchModal(false);
            setEditingBranch(null);
          }}
        />
      )}

      {showCategoryModal && categoryModalBiz && (
        <CategoryFormModal
          business={categoryModalBiz}
          category={editingCategory}
          onClose={() => {
            setShowCategoryModal(false);
            setEditingCategory(null);
            setCategoryModalBiz(null);
          }}
          onSaved={() => {
            refetchCategories();
            setShowCategoryModal(false);
            setEditingCategory(null);
            setCategoryModalBiz(null);
          }}
        />
      )}
      {showUnitModal && unitModalBiz && (
        <UnitFormModal
          business={unitModalBiz}
          branches={branchesForBusiness(unitModalBiz.id)}
          unit={editingUnit}
          onClose={() => {
            setShowUnitModal(false);
            setEditingUnit(null);
            setUnitModalBiz(null);
          }}
          onSaved={() => {
            refetchUnits();
            setShowUnitModal(false);
            setEditingUnit(null);
            setUnitModalBiz(null);
          }}
        />
      )}
    </div>
  );
}

function BusinessFormModal({
  business,
  isSuperAdmin,
  onClose,
  onSaved,
}: {
  business: Business | null;
  isSuperAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(business?.name ?? '');
  const [category, setCategory] = useState(business?.category ?? '');
  const [description, setDescription] = useState(business?.description ?? '');
  const [isActive, setIsActive] = useState(business?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Business name is required');
      return;
    }
    setSaving(true);
    setError(null);

    if (business) {
      const { error: updateError } = await supabase
        .from('businesses')
        .update({ name: name.trim(), category: category.trim() || null, description: description.trim(), is_active: isActive })
        .eq('id', business.id);
      if (updateError) {
        setError(`Could not save changes: ${updateError.message}`);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('businesses')
        .insert({ name: name.trim(), category: category.trim() || null, description: description.trim() });
      if (insertError) {
        setError(`Could not create the business: ${insertError.message}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onSaved();
  };

  const handleDelete = async () => {
    if (!business) return;
    if (isSuperAdmin) {
      if (!window.confirm(`Permanently delete business "${business.name}" and everything under it? Staff accounts are kept and moved to Default for reassignment. Sales history is preserved under Default. This cannot be undone.`)) return;
      setSaving(true);
      setError(null);
      const { error: fnError } = await supabase.functions.invoke('delete-organization', {
        body: { p_entity: 'business', p_id: business.id },
      });
      if (fnError) {
        setError(fnError.message.includes('Failed to send a request')
          ? 'Delete service is unreachable. Ask an administrator to deploy the delete-organization function.'
          : fnError.message);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved();
      return;
    }
    if (!window.confirm(`Delete business "${business.name}"? Businesses with branches, products or staff cannot be deleted — they will be deactivated instead.`)) return;
    setSaving(true);
    setError(null);
    const [{ count: branchCount }, { count: productCount }, { count: staffCount }] = await Promise.all([
      supabase.from('branches').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
      supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    ]);
    if ((branchCount ?? 0) > 0 || (productCount ?? 0) > 0 || (staffCount ?? 0) > 0) {
      const { error: deactError } = await supabase.from('businesses').update({ is_active: false }).eq('id', business.id);
      if (deactError) { setError(`Could not deactivate business: ${deactError.message}`); setSaving(false); return; }
      setSaving(false);
      onSaved();
      return;
    }
    const { error: deleteError } = await supabase.from('businesses').delete().eq('id', business.id);
    if (deleteError) {
      const { error: deactError } = await supabase.from('businesses').update({ is_active: false }).eq('id', business.id);
      if (deactError) { setError(`Could not delete business: ${deleteError.message}`); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={business ? 'Edit Business' : 'Add Business'}>
      <div className="space-y-4">
        <Input
          label="Business Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Electronics Retail"
          autoFocus
        />
        <Input
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Retail, Agriculture, Logistics"
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of this business unit"
        />
        {business && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-slate-300" />
            Active
          </label>
        )}
        {error && (
          <p className="text-sm text-rose-600 px-1">{error}</p>
        )}
        <div className="flex justify-between gap-3 pt-2">
          <div>
            {business && (
              <Button variant="ghost" onClick={handleDelete} disabled={saving} className="text-rose-600 hover:text-rose-700">
                <Trash2 size={16} /> Delete
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BranchFormModal({
  branch,
  business,
  isSuperAdmin,
  onClose,
  onSaved,
}: {
  branch: Branch | null;
  business: Business;
  isSuperAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(branch?.name ?? '');
  const [location, setLocation] = useState(branch?.location ?? '');
  const [openingDate, setOpeningDate] = useState(branch?.opening_date ?? '');
  const [managerId, setManagerId] = useState(branch?.manager_id ?? '');
  const [managers, setManagers] = useState<UserProfile[]>([]);
  const [isActive, setIsActive] = useState(branch?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load managers for this business
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('user_profiles')
      .select('id, full_name, branch_id')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .then(({ data }) => {
        if (!cancelled && data) setManagers(data as unknown as UserProfile[]);
      });
    return () => {
      cancelled = true;
    };
  }, [business.id]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Branch name is required');
      return;
    }
    setSaving(true);
    setError(null);

    if (branch) {
      const { error: updateError } = await supabase
        .from('branches')
        .update({ name: name.trim(), location: location.trim(), opening_date: openingDate || null, manager_id: managerId || null, is_active: isActive })
        .eq('id', branch.id);
      if (updateError) {
        setError(`Could not save changes: ${updateError.message}`);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('branches')
        .insert({ business_id: business.id, name: name.trim(), location: location.trim(), opening_date: openingDate || null, manager_id: managerId || null });
      if (insertError) {
        setError(`Could not create the branch: ${insertError.message}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onSaved();
  };

  const handleDeleteBranch = async () => {
    if (!branch) return;
    if (isSuperAdmin) {
      if (!window.confirm(`Permanently delete branch "${branch.name}" and everything under it? Staff accounts are kept (branch cleared). Sales history is preserved under Default. This cannot be undone.`)) return;
      setSaving(true);
      setError(null);
      const { error: fnError } = await supabase.functions.invoke('delete-organization', {
        body: { p_entity: 'branch', p_id: branch.id },
      });
      if (fnError) {
        setError(fnError.message.includes('Failed to send a request')
          ? 'Delete service is unreachable. Ask an administrator to deploy the delete-organization function.'
          : fnError.message);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved();
      return;
    }
    if (!window.confirm(`Delete branch "${branch.name}"? Branches with activity cannot be deleted — they will be deactivated instead.`)) return;
    setSaving(true);
    setError(null);
    const { error: deleteError } = await supabase.from('branches').delete().eq('id', branch.id);
    if (deleteError) {
      const { error: deactError } = await supabase.from('branches').update({ is_active: false }).eq('id', branch.id);
      if (deactError) { setError(`Could not delete branch: ${deleteError.message}`); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={branch ? 'Edit Branch' : `Add Branch to ${business.name}`}>
      <div className="space-y-4">
        <Input
          label="Branch Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Awka, Lagos, Ibadan"
          autoFocus
        />
        <Input
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. 123 Main Street, Awka, Anambra"
        />
        <Input label="Opening Date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        <Select label="Branch Manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">Unassigned</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </Select>
        {branch && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-slate-300" />
            Active
          </label>
        )}
        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-between gap-3 pt-2">
          <div>
            {branch && (
              <Button variant="ghost" onClick={handleDeleteBranch} disabled={saving} className="text-rose-600 hover:text-rose-700">
                <Trash2 size={16} /> Delete
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CategoryFormModal({
  business,
  category,
  onClose,
  onSaved,
}: {
  business: Business;
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Category name is required');
      return;
    }
    setSaving(true);
    setError(null);

    const action = category ? 'update' : 'create';
    const payload = {
      p_business_id: business.id,
      p_name: name.trim(),
      p_description: description.trim(),
      ...(category ? { p_category_id: category.id } : {}),
      p_action: action,
    };

    const { error: fnError } = await supabase.functions.invoke('manage-category', { body: payload });
    if (fnError) {
      // Direct supabase table fallback
      let directError;
      if (category) {
        const res = await supabase
          .from('categories')
          .update({ name: name.trim(), description: description.trim() })
          .eq('id', category.id);
        directError = res.error;
      } else {
        const res = await supabase
          .from('categories')
          .insert({
            business_id: business.id,
            name: name.trim(),
            description: description.trim(),
            is_active: true,
          });
        directError = res.error;
      }
      if (directError) {
        setError(directError.message || fnError.message || 'Could not save category.');
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={category ? 'Edit Category' : `Add Category to ${business.name}`}>
      <div className="space-y-4">
        <Input
          label="Category Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Grains, Solar Inverters, Accessories"
          autoFocus
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description of this category..."
        />
        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Category'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function UnitFormModal({
  business,
  branches,
  unit,
  onClose,
  onSaved,
}: {
  business: Business;
  branches: Branch[];
  unit: Unit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(unit?.name ?? '');
  const [branchId, setBranchId] = useState(unit?.branch_id ?? '');
  const [description, setDescription] = useState(unit?.description ?? '');
  const [isActive, setIsActive] = useState(unit?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Unit name is required');
      return;
    }
    setSaving(true);
    setError(null);
    if (unit) {
      const { error: updateErr } = await supabase.from('units').update({
        name: name.trim(), branch_id: branchId || null,
        description: description.trim(), is_active: isActive,
      }).eq('id', unit.id);
      if (updateErr) { setError(`Could not save changes: ${updateErr.message}`); setSaving(false); return; }
    } else {
      const { error: insertErr } = await supabase.from('units').insert({
        business_id: business.id, name: name.trim(), branch_id: branchId || null,
        description: description.trim(), is_active: true,
      });
      if (insertErr) {
        const msg = insertErr.message.includes('duplicate') || insertErr.code === '23505'
          ? 'This unit already exists.'
          : `Could not create unit: ${insertErr.message}. If this persists, check that migration 202609150006 is applied.`;
        setError(msg); setSaving(false); return;
      }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={unit ? 'Edit Unit' : `Add Unit to ${business.name}`} size="md">
      <div className="space-y-4">
        <Input label="Unit name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Produce Section, Bakery" autoFocus />
        <Select label="Branch (optional — leave empty for all branches)" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
        {unit && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-slate-300" />
            Active
          </label>
        )}
        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : unit ? 'Save Changes' : 'Add Unit'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
