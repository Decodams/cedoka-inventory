export type RoleName = 'super_admin' | 'admin' | 'manager' | 'sales_person';

export type ReportStatus = 'draft' | 'submitted' | 'reviewed' | 'amended';

export type IssueStatus = 'open' | 'assigned' | 'in_progress' | 'waiting' | 'resolved' | 'closed';

export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';

export type IssueSeverity = 'minor' | 'moderate' | 'major' | 'severe';

export type TransferStatus =
  | 'requested'
  | 'reviewed'
  | 'approved'
  | 'dispatched'
  | 'in_transit'
  | 'received'
  | 'completed'
  | 'rejected';

export type PurchaseStatus =
  | 'requested'
  | 'quoted'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type MovementType =
  | 'opening_balance'
  | 'purchase_receipt'
  | 'sale'
  | 'transfer_in'
  | 'transfer_out'
  | 'return_in'
  | 'return_out'
  | 'damage'
  | 'loss'
  | 'adjustment'
  | 'stock_issue'
  | 'physical_count'
  | 'production';

export type ActivityCategory =
  | 'meeting'
  | 'customer_event'
  | 'supplier_activity'
  | 'delivery'
  | 'maintenance'
  | 'staff'
  | 'incident'
  | 'follow_up'
  | 'other';

export interface Business {
  id: string;
  name: string;
  category: string | null;
  description: string;
  is_active: boolean;
  created_at: string;
}

export interface Branch {
  id: string;
  business_id: string;
  name: string;
  location: string;
  is_active: boolean;
  opening_date: string | null;
  manager_id: string | null;
  created_at: string;
  manager?: UserProfile;
}

export interface Role {
  id: string;
  name: RoleName;
  display_name: string;
  description: string;
  is_system: boolean;
}

export interface Permission {
  id: string;
  code: string;
  description: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role_id: string;
  business_id: string | null;
  branch_id: string | null;
  manager_id: string | null;  // NEW: for hierarchical visibility
  is_active: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_reason: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  role?: Role;
  business?: Business;
  branch?: Branch;
}

export interface Category {
  id: string;
  business_id: string;
  name: string;
  description: string;
  is_active: boolean;
}

export interface Supplier {
  id: string;
  business_id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
}

export type ProductType = 'simple' | 'serialized' | 'batch';

export interface Product {
  id: string;
  business_id: string;
  category_id: string | null;
  supplier_id: string | null;
  name: string;
  sku: string | null;
  brand: string | null;
  model: string | null;
  description: string;
  unit: string;
  cost_price: number;
  selling_price: number;
  min_stock_level: number;
  reorder_level: number;
  is_active: boolean;
  product_type: ProductType;
  warranty_months: number | null;
  expiry_tracking: boolean;
  category?: Category;
  supplier?: Supplier;
}

export interface InventoryBalance {
  id: string;
  product_id: string;
  branch_id: string;
  opening_stock: number;
  current_stock: number;
  min_stock_level: number;
  reorder_level: number;
  last_count_date: string | null;
  updated_at: string;
  product?: Product;
  branch?: Branch;
}

export interface InventoryTransaction {
  id: string;
  product_id: string;
  branch_id: string;
  movement_type: MovementType;
  quantity: number;
  quantity_before: number | null;
  quantity_after: number | null;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  actor_id: string | null;
  transaction_date: string;
  created_at: string;
  product?: Product;
  branch?: Branch;
  actor?: UserProfile;
}

export interface WeeklyReport {
  id: string;
  business_id: string;
  branch_id: string;
  week_start_date: string;
  week_end_date: string;
  opening_stock: number;
  stock_received: number;
  stock_sold: number;
  stock_damaged: number;
  closing_stock: number;
  closing_stock_is_manual: boolean;
  total_sales_value: number;
  total_purchase_value: number;
  pending_sales_value: number;
  pending_purchase_value: number;
  pending_procurement_value: number;
  activities_notes: string;
  challenges_notes: string;
  issues_notes: string;
  improvement_notes: string;
  status: ReportStatus;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  business?: Business;
  branch?: Branch;
  submitted_by_user?: UserProfile;
  reviewed_by_user?: UserProfile;
}

export interface ReportAmendment {
  id: string;
  weekly_report_id: string;
  amended_by: string;
  amended_at: string;
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reason: string;
  amended_by_user?: UserProfile;
}

export interface DailyActivity {
  id: string;
  business_id: string;
  branch_id: string;
  activity_date: string;
  category: ActivityCategory;
  title: string;
  description: string;
  requires_follow_up: boolean;
  follow_up_notes: string;
  recorded_by: string;
  created_at: string;
  branch?: Branch;
  recorded_by_user?: UserProfile;
}

export interface Issue {
  id: string;
  business_id: string;
  branch_id: string;
  title: string;
  description: string;
  category: string;
  priority: IssuePriority;
  severity: IssueSeverity;
  status: IssueStatus;
  requires_management_attention: boolean;
  reported_by: string;
  responsible_person: string | null;
  date_reported: string;
  deadline: string | null;
  resolution_notes: string;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  business?: Business;
  branch?: Branch;
  reported_by_user?: UserProfile;
  responsible_person_user?: UserProfile;
}

export interface StockTransfer {
  id: string;
  transfer_number: string | null;
  from_branch_id: string;
  to_branch_id: string;
  status: TransferStatus;
  reason: string | null;
  requested_by: string;
  reviewed_by: string | null;
  approved_by: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  from_branch?: Branch;
  to_branch?: Branch;
  items?: StockTransferItem[];
}

export interface StockTransferItem {
  id: string;
  transfer_id: string;
  product_id: string;
  quantity: number;
  received_quantity: number;
  notes: string;
  product?: Product;
}

export interface PurchaseRequest {
  id: string;
  request_number: string | null;
  business_id: string;
  branch_id: string;
  supplier_id: string | null;
  status: PurchaseStatus;
  estimated_cost: number;
  actual_cost: number;
  requested_by: string;
  approved_by: string | null;
  ordered_at: string | null;
  expected_delivery_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  business?: Business;
  branch?: Branch;
  supplier?: Supplier;
  items?: PurchaseRequestItem[];
}

export interface PurchaseRequestItem {
  id: string;
  purchase_request_id: string;
  product_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number;
  notes: string;
  product?: Product;
}

export interface GoodsReceivedNote {
  id: string;
  grn_number: string | null;
  purchase_request_id: string | null;
  branch_id: string;
  supplier_id: string | null;
  received_by: string;
  received_date: string;
  delivery_note_number: string | null;
  is_partial: boolean;
  notes: string;
  created_at: string;
  purchase_request?: PurchaseRequest;
  branch?: Branch;
  supplier?: Supplier;
  items?: GoodsReceivedItem[];
}

export interface GoodsReceivedItem {
  id: string;
  grn_id: string;
  product_id: string;
  quantity_ordered: number;
  quantity_received: number;
  quantity_damaged: number;
  quantity_rejected: number;
  quantity_short: number;
  notes: string;
  product?: Product;
}

export type InventoryPeriodStatus = 'open' | 'submitted' | 'approved' | 'amended';
export type VarianceApprovalStatus = 'pending' | 'approved' | 'rejected';
export type DailySaleStatus = 'pending' | 'completed' | 'returned' | 'refunded';
export type ExpenseStatus = 'recorded' | 'approved' | 'rejected';
export type ExpenseCategory =
  | 'logistics'
  | 'repairs'
  | 'petty_cash'
  | 'operational'
  | 'utilities'
  | 'rent'
  | 'other';

export interface InventoryPeriod {
  id: string;
  business_id: string;
  branch_id: string;
  period_start: string;
  period_end: string;
  status: InventoryPeriodStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  business?: Business;
  branch?: Branch;
}

export interface InventoryPeriodLine {
  id: string;
  period_id: string;
  product_id: string;
  opening_quantity: number;
  received_quantity: number;
  transfer_in_quantity: number;
  authorized_additions_quantity: number;
  sales_issues_quantity: number;
  transfer_out_quantity: number;
  damage_quantity: number;
  returns_deductions_quantity: number;
  adjustment_quantity: number;
  expected_closing_quantity: number;
  physical_closing_quantity: number | null;
  counted_by: string | null;
  counted_at: string | null;
  product?: Product;
  period?: InventoryPeriod;
}

export interface StockVariance {
  id: string;
  period_line_id: string;
  branch_id: string;
  product_id: string;
  variance_quantity: number;
  possible_reason: string | null;
  explanation: string | null;
  supporting_evidence: string | null;
  responsible_person: string | null;
  approval_status: VarianceApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  requires_management_attention: boolean;
  created_by: string | null;
  created_at: string;
  product?: Product;
  branch?: Branch;
  responsible_person_user?: UserProfile;
}

export interface DailySale {
  id: string;
  business_id: string;
  branch_id: string;
  product_id: string | null;
  salesperson_id: string | null;
  customer_name: string | null;
  sale_date: string;
  quantity: number;
  unit_price: number;
  discount_value: number;
  amount_paid: number;
  status: DailySaleStatus;
  notes: string | null;
  created_at: string;
  product?: Product;
  branch?: Branch;
  salesperson?: UserProfile;
}

export interface OperationalExpense {
  id: string;
  business_id: string;
  branch_id: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  status: ExpenseStatus;
  recorded_by: string | null;
  approved_by: string | null;
  created_at: string;
  branch?: Branch;
  business?: Business;
}

export interface Department {
  id: string;
  business_id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  business?: Business;
}

export interface Team {
  id: string;
  business_id: string;
  department_id: string | null;
  branch_id: string | null;
  name: string;
  description: string;
  lead_user_id: string | null;
  is_active: boolean;
  created_at: string;
  business?: Business;
  department?: Department;
  branch?: Branch;
  lead_user?: UserProfile;
}

export interface Customer {
  id: string;
  business_id: string;
  branch_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string;
  is_active: boolean;
  created_at: string;
  business?: Business;
  branch?: Branch;
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  description: string;
  category: string | null;
  unit_price: number;
  is_active: boolean;
  created_at: string;
  business?: Business;
}

export interface Location {
  id: string;
  business_id: string;
  branch_id: string | null;
  name: string;
  address: string;
  location_type: 'warehouse' | 'store' | 'office' | 'branch' | 'inventory' | 'other';
  is_active: boolean;
  created_at: string;
  business?: Business;
  branch?: Branch;
}

export interface Workflow {
  id: string;
  business_id: string | null;
  name: string;
  description: string;
  steps: string[];
  is_active: boolean;
  created_at: string;
  business?: Business;
}

export interface ReportType {
  id: string;
  business_id: string | null;
  name: string;
  description: string;
  fields: string[];
  is_active: boolean;
  created_at: string;
  business?: Business;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  action: string;
  target_table: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: UserProfile;
}
