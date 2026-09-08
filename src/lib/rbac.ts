import type { RoleName, UserProfile } from '@/types/database';

export const ROLE_HIERARCHY: Record<RoleName, number> = {
  super_admin: 4,
  admin: 3,
  manager: 2,
  sales_person: 1,
};

export const ROLE_DISPLAY: Record<RoleName, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  sales_person: 'Sales Person',
};

export const ROLE_COLORS: Record<RoleName, string> = {
  super_admin: 'bg-rose-100 text-rose-700 border-rose-200',
  admin: 'bg-blue-100 text-blue-700 border-blue-200',
  manager: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  sales_person: 'bg-amber-100 text-amber-700 border-amber-200',
};

export function getRoleName(user: UserProfile | null): RoleName | null {
  if (!user?.role) return null;
  return user.role.name;
}

export function hasRole(user: UserProfile | null, ...roles: RoleName[]): boolean {
  const roleName = getRoleName(user);
  if (!roleName) return false;
  return roles.includes(roleName);
}

export function isAtLeast(user: UserProfile | null, minRole: RoleName): boolean {
  const roleName = getRoleName(user);
  if (!roleName) return false;
  return ROLE_HIERARCHY[roleName] >= ROLE_HIERARCHY[minRole];
}

export function canAccessBusiness(user: UserProfile | null, businessId: string): boolean {
  if (!user) return false;
  if (hasRole(user, 'super_admin')) return true;
  if (hasRole(user, 'admin')) return user.business_id === businessId;
  if (hasRole(user, 'manager', 'sales_person')) return user.business_id === businessId;
  return false;
}

export function canAccessBranch(user: UserProfile | null, branchId: string): boolean {
  if (!user) return false;
  if (hasRole(user, 'super_admin')) return true;
  if (hasRole(user, 'admin')) return true; // admin can access all branches in their business
  if (hasRole(user, 'manager', 'sales_person')) return user.branch_id === branchId;
  return false;
}

export function canCreateRole(actor: UserProfile | null, targetRole: RoleName): boolean {
  if (!actor) return false;
  const actorRole = getRoleName(actor);
  if (!actorRole) return false;

  if (actorRole === 'super_admin') return true;
  if (actorRole === 'admin') return targetRole === 'manager' || targetRole === 'sales_person';
  if (actorRole === 'manager') return targetRole === 'sales_person';
  return false;
}

export function canManageUsers(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

export function canManageBusinesses(actor: UserProfile | null): boolean {
  return hasRole(actor, 'super_admin');
}

export function canManageBranches(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'admin');
}

export function canReviewReports(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'admin');
}

export function canViewAllReports(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'admin');
}

export function canManageProducts(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

export function canManageInventory(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

export function canManageTransfers(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

export function canManageProcurement(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

export function canViewExecutiveDashboard(actor: UserProfile | null): boolean {
  return hasRole(actor, 'super_admin');
}

export function canViewBusinessDashboard(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'admin');
}

export function canViewBranchDashboard(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}
