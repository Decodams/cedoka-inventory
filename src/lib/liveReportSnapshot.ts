import { supabase } from '@/hooks/useSupabaseQuery';
import { getSalesWeekStart, toDateString } from '@/lib/dateUtils';

export interface LiveProductBalance {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  opening: number;
  current: number;
}

export interface LiveReportSnapshot {
  /** Start-of-week stock derived from the live inventory balance and the
   *  week's ledger movements — no manual re-entry and no double counting. */
  opening_stock: number;
  received: number;
  sold: number;
  damaged: number;
  transfers_in: number;
  transfers_out: number;
  returns: number;
  adjustments: number;
  sales_value: number;
  purchase_value: number;
  products: LiveProductBalance[];
  loadedAt: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type LedgerRow = { movement_type: string; quantity: number | string; quantity_before?: number | string | null; quantity_after?: number | string | null };
const afterOf = (r: LedgerRow) => r.quantity_after;
const beforeOf = (r: LedgerRow) => r.quantity_before;

const dayAfter = (dateStr: string): string => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return toDateString(d);
};

/**
 * Pull a Mon–Sat week's live figures from the system of record:
 * inventory_balances (opening), inventory_transactions (movements),
 * daily_sales (sales value) and GRNs (purchase value).
 * Everything is computed from the ledger so the report never drifts from
 * the stock balance shown elsewhere in the app.
 */
export async function fetchLiveReportSnapshot(
  branchId: string,
  weekEndDate: string,
): Promise<LiveReportSnapshot> {
  const weekStart = toDateString(getSalesWeekStart(new Date(`${weekEndDate}T12:00:00`)));
  const nextDay = dayAfter(weekEndDate);

  const [balanceRes, txnRes, saleRes, grnRes] = await Promise.all([
    supabase
      .from('inventory_balances')
      .select('product_id,opening_stock,current_stock,product:products(id,name,sku,unit)')
      .eq('branch_id', branchId),
    supabase
      .from('inventory_transactions')
      .select('movement_type,quantity,quantity_before,quantity_after')
      .eq('branch_id', branchId)
      .gte('transaction_date', `${weekStart}T00:00:00`)
      .lt('transaction_date', `${nextDay}T00:00:00`),
    supabase
      .from('daily_sales')
      .select('unit_price,quantity,discount_value,status')
      .eq('branch_id', branchId)
      .gte('sale_date', weekStart)
      .lte('sale_date', weekEndDate),
    supabase
      .from('goods_received_notes')
      .select('received_date, items:goods_received_items(quantity_received, product:products(cost_price))')
      .eq('branch_id', branchId)
      .gte('received_date', weekStart)
      .lte('received_date', weekEndDate),
  ]);

  type BalanceRow = {
    product_id: string;
    opening_stock: number | string;
    current_stock: number | string;
    product: { id: string; name: string; sku: string | null; unit: string } | null;
  };
  const balances = (balanceRes.data ?? []) as unknown as BalanceRow[];

  const products: LiveProductBalance[] = balances.map((b) => {
    // PostgREST returns a to-one relation as an array in some versions.
    const rel = Array.isArray(b.product) ? (b.product as unknown as BalanceRow['product'][])?.[0] : b.product;
    return {
      id: b.product_id,
      name: rel?.name ?? b.product_id.slice(0, 8),
      sku: rel?.sku ?? null,
      unit: rel?.unit ?? 'pcs',
      opening: num(b.opening_stock),
      current: num(b.current_stock),
    };
  });

  const currentStock = products.reduce((sum, p) => sum + p.current, 0);

  let received = 0;
  let sold = 0;
  let damaged = 0;
  let transfers_in = 0;
  let transfers_out = 0;
  let returns_in = 0;
  let returns_out = 0;
  let adjustments = 0;
  for (const row of (txnRes.data ?? []) as LedgerRow[]) {
    const q = Math.abs(num(row.quantity));
    switch (row.movement_type) {
      case 'purchase_receipt':
      case 'production':
        received += q;
        break;
      case 'sale':
      case 'stock_issue':
        sold += q;
        break;
      case 'damage':
      case 'loss':
        damaged += q;
        break;
      case 'transfer_in':
        transfers_in += q;
        break;
      case 'transfer_out':
        transfers_out += q;
        break;
      case 'return_in':
        returns_in += q;
        break;
      case 'return_out':
        returns_out += q;
        break;
      case 'physical_count':
      case 'adjustment': {
        // Ledger stores the signed delta in (quantity_after - quantity_before).
        const delta = num(afterOf(row)) - num(beforeOf(row));
        adjustments += delta || num(row.quantity);
        break;
      }
      default:
        break;
    }
  }

  // Current balance already contains this week's movements. Derive the true
  // start-of-week stock from the live balance + ledger so the report never
  // double-counts sales/receipts when it is produced at week end.
  const netThisWeek =
    received +
    transfers_in +
    returns_in +
    adjustments -
    sold -
    damaged -
    transfers_out -
    returns_out;
  const opening_stock = Math.max(0, Math.round((currentStock - netThisWeek) * 100) / 100);

  const sales_value = ((saleRes.data ?? []) as Array<{
    unit_price: number | string;
    quantity: number | string;
    discount_value: number | string;
    status: string;
  }>)
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + num(s.unit_price) * num(s.quantity) - num(s.discount_value), 0);

  const purchase_value = ((grnRes.data ?? []) as unknown as Array<{
    items: Array<{ quantity_received: number | string; product: { cost_price: number | string } | null }> | null;
  }>).reduce((sum, grn) => {
    for (const item of grn.items ?? []) {
      sum += num(item.quantity_received) * num(item.product?.cost_price);
    }
    return sum;
  }, 0);

  return {
    opening_stock,
    received,
    sold,
    damaged,
    transfers_in,
    transfers_out,
    returns: returns_in + returns_out,
    adjustments,
    sales_value,
    purchase_value,
    products,
    loadedAt: new Date().toISOString(),
  };
}
