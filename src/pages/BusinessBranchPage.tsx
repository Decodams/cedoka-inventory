import { useState, useCallback } from 'react';
import { Building2, Plus, MapPin, Pencil, Power, ChevronRight, Calendar } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSupabaseQuery, supabase } from '@/hooks/useSupabaseQuery';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { hasRole } from '@/lib/rbac';
import type { Business, Branch, UserProfile } from '@/types/database';

export function BusinessBranchPage() {
  const { user } = useAuth();
  const canManageBusinesses = hasRole(user, 'super_admin');
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [showBizModal, setShowBizModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBiz, setEditingBiz] = useState<Business | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  const { data: businesses, loading, error, refetch } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').order('name'),
    [],
  );

  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').order('name'),
    [],
  );

  const branchesForBusiness = (bizId: string) => branches?.filter((b) => b.business_id === bizId) ?? [];

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
                      {biz.category ?? 'Uncategorized'} · {branchesForBusiness(biz.id).length} branches
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
                <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
                  {biz.description && (
                    <p className="text-sm text-slate-600 mb-3">{biz.description}</p>
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Branches
                    </h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingBranch(null);
                        setShowBranchModal(true);
                      }}
                    >
                      <Plus size={14} /> Add Branch
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {branchesForBusiness(biz.id).map((branch) => (
                      <div
                        key={branch.id}
                        className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3"
                      >
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
                        <button
                          onClick={() => {
                            setEditingBranch(branch);
                            setShowBranchModal(true);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    ))}
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
    </div>
  );
}

function BusinessFormModal({
  business,
  onClose,
  onSaved,
}: {
  business: Business | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(business?.name ?? '');
  const [category, setCategory] = useState(business?.category ?? '');
  const [description, setDescription] = useState(business?.description ?? '');
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
        .update({ name: name.trim(), category: category.trim() || null, description: description.trim() })
        .eq('id', business.id);
      if (updateError) {
        setError('Could not save changes. Please try again.');
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('businesses')
        .insert({ name: name.trim(), category: category.trim() || null, description: description.trim() });
      if (insertError) {
        setError('Could not create the business. Please try again.');
        setSaving(false);
        return;
      }
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
        {error && (
          <p className="text-sm text-rose-600 px-1">{error}</p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BranchFormModal({
  branch,
  business,
  onClose,
  onSaved,
}: {
  branch: Branch | null;
  business: Business;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(branch?.name ?? '');
  const [location, setLocation] = useState(branch?.location ?? '');
  const [openingDate, setOpeningDate] = useState(branch?.opening_date ?? '');
  const [managerId, setManagerId] = useState(branch?.manager_id ?? '');
  const [managers, setManagers] = useState<UserProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load managers for this business
  if (managers.length === 0) {
    supabase.from('user_profiles').select('id, full_name, branch_id').eq('business_id', business.id).eq('is_active', true).then(({ data }) => {
      if (data) setManagers(data as unknown as UserProfile[]);
    });
  }

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
        .update({ name: name.trim(), location: location.trim(), opening_date: openingDate || null, manager_id: managerId || null })
        .eq('id', branch.id);
      if (updateError) {
        setError('Could not save changes. Please try again.');
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('branches')
        .insert({ business_id: business.id, name: name.trim(), location: location.trim(), opening_date: openingDate || null, manager_id: managerId || null });
      if (insertError) {
        setError('Could not create the branch. Please try again.');
        setSaving(false);
        return;
      }
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
        {error && <p className="text-sm text-rose-600 px-1">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
