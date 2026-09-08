import type { ReportStatus, IssueStatus, IssuePriority, IssueSeverity, TransferStatus, PurchaseStatus, MovementType, ActivityCategory } from '@/types/database';

export const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  reviewed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  amended: 'bg-amber-100 text-amber-700 border-amber-200',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  amended: 'Amended',
};

export const ISSUE_STATUS_STYLES: Record<IssueStatus, string> = {
  open: 'bg-rose-100 text-rose-700 border-rose-200',
  assigned: 'bg-blue-100 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  waiting: 'bg-purple-100 text-purple-700 border-purple-200',
  resolved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  closed: 'bg-gray-100 text-gray-600 border-gray-200',
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const ISSUE_PRIORITY_STYLES: Record<IssuePriority, string> = {
  low: 'bg-gray-100 text-gray-600 border-gray-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-rose-100 text-rose-700 border-rose-200',
};

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const ISSUE_SEVERITY_LABELS: Record<IssueSeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  major: 'Major',
  severe: 'Severe',
};

export const TRANSFER_STATUS_STYLES: Record<TransferStatus, string> = {
  requested: 'bg-gray-100 text-gray-600 border-gray-200',
  reviewed: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-teal-100 text-teal-700 border-teal-200',
  dispatched: 'bg-amber-100 text-amber-700 border-amber-200',
  in_transit: 'bg-orange-100 text-orange-700 border-orange-200',
  received: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  completed: 'bg-emerald-600 text-white border-emerald-700',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
};

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  requested: 'Requested',
  reviewed: 'Reviewed',
  approved: 'Approved',
  dispatched: 'Dispatched',
  in_transit: 'In Transit',
  received: 'Received',
  completed: 'Completed',
  rejected: 'Rejected',
};

export const PURCHASE_STATUS_STYLES: Record<PurchaseStatus, string> = {
  requested: 'bg-gray-100 text-gray-600 border-gray-200',
  quoted: 'bg-blue-100 text-blue-700 border-blue-200',
  ordered: 'bg-teal-100 text-teal-700 border-teal-200',
  partially_received: 'bg-amber-100 text-amber-700 border-amber-200',
  received: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  completed: 'bg-emerald-600 text-white border-emerald-700',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
  cancelled: 'bg-gray-200 text-gray-500 border-gray-300',
};

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  requested: 'Requested',
  quoted: 'Quoted',
  ordered: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const MOVEMENT_TYPE_STYLES: Record<MovementType, string> = {
  opening_balance: 'bg-gray-100 text-gray-600 border-gray-200',
  purchase_receipt: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  sale: 'bg-blue-100 text-blue-700 border-blue-200',
  transfer_in: 'bg-teal-100 text-teal-700 border-teal-200',
  transfer_out: 'bg-orange-100 text-orange-700 border-orange-200',
  return_in: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  return_out: 'bg-amber-100 text-amber-700 border-amber-200',
  damage: 'bg-rose-100 text-rose-700 border-rose-200',
  loss: 'bg-red-100 text-red-700 border-red-200',
  adjustment: 'bg-purple-100 text-purple-700 border-purple-200',
  stock_issue: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  physical_count: 'bg-slate-100 text-slate-700 border-slate-200',
  production: 'bg-green-100 text-green-700 border-green-200',
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  opening_balance: 'Opening Balance',
  purchase_receipt: 'Purchase Receipt',
  sale: 'Sale',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  return_in: 'Return In',
  return_out: 'Return Out',
  damage: 'Damage',
  loss: 'Loss',
  adjustment: 'Adjustment',
  stock_issue: 'Stock Issue',
  physical_count: 'Physical Count',
  production: 'Production',
};

export const MOVEMENT_TYPE_SIGNS: Record<MovementType, number> = {
  opening_balance: 1,
  purchase_receipt: 1,
  sale: -1,
  transfer_in: 1,
  transfer_out: -1,
  return_in: 1,
  return_out: -1,
  damage: -1,
  loss: -1,
  adjustment: 0,
  stock_issue: -1,
  physical_count: 0,
  production: 1,
};

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  meeting: 'Meeting',
  customer_event: 'Customer Event',
  supplier_activity: 'Supplier Activity',
  delivery: 'Delivery',
  maintenance: 'Maintenance',
  staff: 'Staff',
  incident: 'Incident',
  follow_up: 'Follow-up',
  other: 'Other',
};

export const ACTIVITY_CATEGORY_ICONS: Record<ActivityCategory, string> = {
  meeting: 'Users',
  customer_event: 'Handshake',
  supplier_activity: 'Truck',
  delivery: 'Package',
  maintenance: 'Wrench',
  staff: 'UserCog',
  incident: 'AlertTriangle',
  follow_up: 'Clock',
  other: 'Circle',
};

export const VARIANCE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
};

export const SALE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  returned: 'bg-orange-100 text-orange-700 border-orange-200',
  refunded: 'bg-rose-100 text-rose-700 border-rose-200',
};

export const SALE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  completed: 'Completed',
  returned: 'Returned',
  refunded: 'Refunded',
};

export const EXPENSE_STATUS_STYLES: Record<string, string> = {
  recorded: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
};

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  recorded: 'Recorded',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const PERIOD_STATUS_STYLES: Record<string, string> = {
  open: 'bg-gray-100 text-gray-600 border-gray-200',
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  amended: 'bg-amber-100 text-amber-700 border-amber-200',
};

export const PERIOD_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  submitted: 'Submitted',
  approved: 'Approved',
  amended: 'Amended',
};
