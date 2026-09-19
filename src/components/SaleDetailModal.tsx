import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingState } from '@/components/ui/States';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import { SALE_STATUS_LABELS, SALE_STATUS_STYLES } from '@/lib/statusStyles';
import { useReceiptPDF } from '@/components/ReceiptPDF';
import { supabase, useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import type { DailySale } from '@/types/database';
import { useState } from 'react';

type SaleDetail = DailySale & {
  created_at?: string;
  payment_method?: string | null;
  business?: { name: string } | null;
  salesperson?: { full_name: string; email?: string | null; role?: { display_name: string } | null } | null;
};

export function SaleDetailModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { downloadReceipt, printReceipt } = useReceiptPDF();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: sale, loading, error, refetch } = useSupabaseQuery<SaleDetail>(
    () => supabase
      .from('daily_sales')
      .select('*, product:products(id,name), items:sale_items(id,quantity,unit,unit_price,discount_value,product:products(id,name)), branch:branches(id,name), business:businesses(id,name), salesperson:user_profiles!daily_sales_salesperson_id_fkey(full_name,email,role:roles(display_name))')
      .eq('id', saleId)
      .maybeSingle(),
    [saleId],
    { cacheKey: `sale:detail:${saleId}` },
  );

  const runReceipt = async (action: 'download' | 'print') => {
    setBusy(true);
    setActionError(null);
    try {
      if (action === 'download') await downloadReceipt(saleId);
      else await printReceipt(saleId);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Could not load the receipt.');
    }
    setBusy(false);
  };

  const items = sale?.items ?? [];
  const total = items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value || 0),
    0,
  );
  const paid = Number(sale?.amount_paid || 0);

  return (
    <Modal open onClose={onClose} title="Sale Details" size="lg">
      {loading && <LoadingState message="Loading sale..." />}
      {!loading && (error || !sale) && (
        <div className="space-y-4">
          <p className="text-sm text-rose-600">{error || 'Sale not found. It may be outside your assigned scope.'}</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button variant="ghost" onClick={() => refetch()}>Retry</Button>
          </div>
        </div>
      )}
      {!loading && sale && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Receipt</p>
              <p className="text-sm font-bold text-slate-900">#{sale.id.substring(0, 8).toUpperCase()}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Date / Time</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatDate(sale.sale_date)}{' '}
                {sale.created_at
                  ? new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Status</p>
              <p className="mt-0.5"><Badge className={SALE_STATUS_STYLES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge></p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Customer</p>
              <p className="text-sm font-semibold text-slate-900 truncate">{sale.customer_name || 'Walk-in'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Attendant</p>
              <p className="text-sm font-semibold text-slate-900 truncate">{sale.salesperson?.full_name || 'Staff'}</p>
              {sale.salesperson?.role?.display_name && (
                <p className="text-[11px] text-slate-400">{sale.salesperson.role.display_name}</p>
              )}
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Branch</p>
              <p className="text-sm font-semibold text-slate-900 truncate">{sale.branch?.name || '-'}</p>
              <p className="text-[11px] text-slate-400 truncate">{sale.business?.name || ''}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-left text-xs text-slate-500">
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5">Unit</th>
                    <th className="px-3 py-2.5 text-right">Price</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-sm text-slate-400">
                        {sale.product?.name || 'No line items recorded'}
                      </td>
                    </tr>
                  )}
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{item.product?.name || 'Item'}</td>
                      <td className="px-3 py-2.5 text-right">{item.quantity}</td>
                      <td className="px-3 py-2.5 text-slate-500">{item.unit || '-'}</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(Number(item.unit_price))}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">
                        {formatCurrency(Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-1">
            <div className="flex justify-between text-slate-600">
              <span>Total</span>
              <strong className="text-slate-900">{formatCurrency(total)}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Amount paid{sale.payment_method ? ` (${sale.payment_method})` : ''}</span>
              <span>{formatCurrency(paid)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Balance</span>
              <span>{formatCurrency(total - paid)}</span>
            </div>
            {sale.notes && <p className="pt-1 text-xs text-slate-500">Notes: {sale.notes}</p>}
          </div>

          {actionError && <p className="text-sm text-rose-600">{actionError}</p>}
          <div className="flex flex-col sm:flex-row justify-end gap-3">
            <Button variant="outline" onClick={() => runReceipt('download')} disabled={busy}>
              {busy ? 'Preparing...' : 'Download PDF'}
            </Button>
            <Button variant="outline" onClick={() => runReceipt('print')} disabled={busy}>Print</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
