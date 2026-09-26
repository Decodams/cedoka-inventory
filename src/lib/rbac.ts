import type { UserProfile } from '@/types/database';

export function hasRole(user: UserProfile | null, ...roles: string[]): boolean {
  if (!user?.role) return false;
  const userRoleName = user.role.name;
  return roles.some((r) => r === userRoleName);
}

// NEW ROLE NAMES (added to the type in database.ts)
export type ExtendedRoleName = 
  | 'super_admin'
  | 'admin' 
  | 'manager'
  | 'sales_person'
  | 'supervisor'
  | 'accountant'
  | 'inventory_officer'
  | 'transport_officer'
  | 'auditor'
  | 'farm_operations_officer';

export const ROLE_HIERARCHY: Record<ExtendedRoleName, number> = {
  super_admin: 5,
  admin: 4,
  manager: 3,
  supervisor: 2,
  sales_person: 1,
  accountant: 1,
  inventory_officer: 1,
  transport_officer: 1,
  auditor: 0,
  farm_operations_officer: 1,
};

export const ROLE_DISPLAY: Record<ExtendedRoleName, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  sales_person: 'Sales Person',
  supervisor: 'Supervisor',
  accountant: 'Accountant / Finance Officer',
  inventory_officer: 'Inventory / Store Officer',
  transport_officer: 'Transport / Fleet Officer',
  auditor: 'Auditor',
  farm_operations_officer: 'Farm Operations Officer',
};

export const ROLE_COLORS: Record<ExtendedRoleName, string> = {
  super_admin: 'bg-rose-100 text-rose-700 border-rose-200',
  admin: 'bg-blue-100 text-blue-700 border-blue-200',
  manager: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  sales_person: 'bg-amber-100 text-amber-700 border-amber-200',
  supervisor: 'bg-lime-100 text-lime-700 border-lime-200',
  accountant: 'bg-amber-100 text-amber-700 border-amber-200',
  inventory_officer: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  transport_officer: 'bg-slate-100 text-slate-700 border-slate-200',
  auditor: 'bg-slate-100 text-slate-600 border-slate-200',
  farm_operations_officer: 'bg-lime-100 text-lime-700 border-lime-200',
};

export function getRoleName(user: UserProfile | null): ExtendedRoleName | null {
  if (!user?.role) return null;
  return user.role.name as ExtendedRoleName | null;
}

export function getReportees(user: UserProfile | null): string[] {
  if (!user?.id) return [];
  const result = [user.id];
  // placeholder: real implementation would recurse via manager_id
  return result;
}

// CHECK IF ACTOR CAN VIEW TARGET'S DATA BASED ON ROLE HIERARCHY
export function hierarchicalCanView(actor: UserProfile | null, target: UserProfile | null): boolean {
  if (!actor || !target) return false;
  if (hasRole(actor, 'super_admin')) return true;
  if (!actor.role || !target.role) return false;
  // actor must be at least one role level above target
  const actorLevel = ROLE_HIERARCHY[actor.role.name as ExtendedRoleName];
  const targetLevel = ROLE_HIERARCHY[target.role.name as ExtendedRoleName];
  return actorLevel > targetLevel;
}

// CHECK IF USER IS AT OR ABOVE A MINIMUM ROLE
export function isAtLeast(user: UserProfile | null, minRole: ExtendedRoleName): boolean {
  const roleName = getRoleName(user);
  if (!roleName) return false;
  return ROLE_HIERARCHY[roleName] >= ROLE_HIERARCHY[minRole];
}

// CHECK IF ACTOR CAN ACCESS BUSINESS
export function canAccessBusiness(user: UserProfile | null, businessId: string): boolean {
  if (!user) return false;
  if (hasRole(user, 'super_admin')) return true;
  return accessibleBusinessIds(user).includes(businessId);
}

/**
 * Every business the user oversees: their primary business plus every explicit
 * assignment row. This is what lets one Admin be added to several businesses.
 */
export function accessibleBusinessIds(user: UserProfile | null): string[] {
  if (!user) return [];
  const ids = new Set<string>();
  if (user.business_id) ids.add(user.business_id);
  for (const id of user.business_assignment_ids ?? []) if (id) ids.add(id);
  return [...ids];
}

/** Every branch the user explicitly oversees (primary branch + assignments). */
export function accessibleBranchIds(user: UserProfile | null): string[] {
  if (!user) return [];
  const ids = new Set<string>();
  if (user.branch_id) ids.add(user.branch_id);
  for (const id of user.branch_assignment_ids ?? []) if (id) ids.add(id);
  return [...ids];
}

// CHECK IF ACTOR CAN ACCESS BRANCH
// Strict scope: Super Admin is global, everyone else only reaches their
// primary branch plus explicit assignments (mirrors can_access_branch()).
export function canAccessBranch(user: UserProfile | null, branchId: string): boolean {
  if (!user) return false;
  if (hasRole(user, 'super_admin')) return true;
  return accessibleBranchIds(user).includes(branchId);
}

// CHECK IF ACTOR CAN CREATE ROLE
export function canCreateRole(actor: UserProfile | null, targetRole: ExtendedRoleName): boolean {
  if (!actor) return false;
  const actorRole = getRoleName(actor);
  if (!actorRole) return false;

  if (actorRole === 'super_admin') return true;
  if (actorRole === 'admin') return targetRole === 'manager' || targetRole === 'sales_person' || targetRole === 'supervisor' || targetRole === 'farm_operations_officer';
  if (actorRole === 'manager') return targetRole === 'sales_person' || targetRole === 'supervisor' || targetRole === 'farm_operations_officer';
  if (actorRole === 'supervisor') return targetRole === 'sales_person';
  return false;
}

// CHECK IF ACTOR CAN MANAGE USERS
export function canManageUsers(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

// CHECK IF ACTOR CAN MANAGE BUSINESSES
export function canManageBusinesses(actor: UserProfile | null): boolean {
  return hasRole(actor, 'super_admin');
}

// CHECK IF ACTOR CAN MANAGE (CREATE/EDIT) BRANCH RECORDS
// The branch registry is Super Admin's org structure (spec sections 4, 5);
// Admins manage operations inside their branch, they do not reshape it.
export function canManageBranches(actor: UserProfile | null): boolean {
  return hasRole(actor, 'super_admin');
}

// CHECK IF ACTOR CAN REVIEW REPORTS
export function canReviewReports(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'admin');
}

// CHECK IF ACTOR CAN VIEW ALL REPORTS
export function canViewAllReports(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'admin');
}

// CHECK IF ACTOR CAN MANAGE PRODUCTS
export function canManageProducts(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

// CHECK IF ACTOR CAN MANAGE INVENTORY
export function canManageInventory(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

export function canAdjustStock(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'inventory_officer') || isAtLeast(actor, 'manager') || isAtLeast(actor, 'farm_operations_officer');
}

// CHECK IF ACTOR CAN MANAGE TRANSFERS
export function canManageTransfers(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

// CHECK IF ACTOR CAN MANAGE PROCUREMENT
export function canManageProcurement(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

// CHECK IF ACTOR CAN VIEW EXECUTIVE DASHBOARD
export function canViewExecutiveDashboard(actor: UserProfile | null): boolean {
  return hasRole(actor, 'super_admin');
}

// CHECK IF ACTOR CAN VIEW BUSINESS DASHBOARD
export function canViewBusinessDashboard(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'admin');
}

// CHECK IF ACTOR CAN VIEW BRANCH DASHBOARD
export function canViewBranchDashboard(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'manager');
}

// CHECK IF ACTOR CAN VIEW INVENTORY DASHBOARDS
export function canViewInventoryDashboards(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'inventory_officer') || isAtLeast(actor, 'manager') || isAtLeast(actor, 'farm_operations_officer') || isAtLeast(actor, 'admin') || isAtLeast(actor, 'super_admin');
}

// CHECK IF ACTOR CAN VIEW FINANCIAL REPORTS
export function canViewFinancialReports(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'accountant') || isAtLeast(actor, 'admin') || isAtLeast(actor, 'super_admin');
}

// CHECK IF ACTOR CAN MANAGE TRANSPORTS
export function canManageTransports(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'transport_officer') || isAtLeast(actor, 'manager') || isAtLeast(actor, 'admin') || isAtLeast(actor, 'super_admin');
}

// CHECK IF ACTOR CAN VIEW TRANSPORT DASHBOARDS
export function canViewTransportDashboards(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'transport_officer') || isAtLeast(actor, 'manager') || isAtLeast(actor, 'admin') || isAtLeast(actor, 'super_admin');
}

// CHECK IF ACTOR CAN VIEW FARM DASHBOARDS
export function canViewFarmDashboards(actor: UserProfile | null): boolean {
  return isAtLeast(actor, 'farm_operations_officer') || isAtLeast(actor, 'manager') || isAtLeast(actor, 'admin') || isAtLeast(actor, 'super_admin');
}

// CHECK IF ACTOR CAN VIEW READ-ONLY MODULES
export function canViewReadOnlyModules(actor: UserProfile | null): boolean {
  const roleName = getRoleName(actor);
  if (!roleName) return false;
  // Viewer/Auditor can view selected modules read-only
  if (roleName === 'auditor') return true;
  return false;
}