import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Plus,
  Eye,
  Download,
  Printer,
  ArrowRightCircle,
  CheckCircle,
  Search,
  Trash2,
  Pencil,
  Send,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase, useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { ErrorState, EmptyState, ListSkeleton } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import { isAtLeast, fullAccessibleBranchIds } from '@/lib/rbac';
import { sanitizeMultiline, sanitizeText } from '@/lib/sanitize';
import { useQuotationPDF } from '@/components/QuotationPDF';
import { useReceiptPDF } from '@/components/ReceiptPDF';
import type {
  Branch,
  Business,
  Product,
  Quotation,
  QuotationItem,
  QuotationStatus,
  UserProfile,
} from '@/types/database';

const STATUS_STYLES: Record<QuotationStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  sent: 'bg-blue-100 text-blue-700 border-blue-200',
  accepted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
  expired: 'bg-amber-100 text-amber-700 border-amber-200',
  converted: 'bg-purple-100 text-purple-700 border-purple-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

const STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
  converted: 'Converted',
  cancelled: 'Cancelled',
};

/** Statuses that may still be turned into a sale. */
const CONVERTIBLE: QuotationStatus[] = ['draft', 'sent', 'accepted'];

interface DraftItem {
  id?: string;
  product_id: string | null;
  item_name: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

interface BranchBalance {
  product_id: string;
  current_stock: number;
}

const emptyItem = (): DraftItem => ({
  product_id: null,
  item_name: '',
  quantity: '1',
  unit: '',
  unit_price: '0',
});

export function QuotationsPage() {
  const { user } = useAuth();
  const canCreate = isAtLeast(user, 'manager');
  const [showCreate, setShowCreate] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quotation | null>(null);
  const [viewQuote, setViewQuote] = useState<Quotation | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | QuotationStatus>('all');
  const [converting, setConverting] = useState(false);
  const [convErr, setConvErr] = useState<string | null>(null);
  const [convertedSaleId, setConvertedSaleId] = useState<string | null>(null);
  const { downloadQuotation, printQuotation } = useQuotationPDF();
  const { downloadReceipt, printReceipt } = useReceiptPDF();

  const userBranchIds = useMemo(() => fullAccessibleBranchIds(user), [user]);
  const isExecutive = user?.role?.name === 'super_admin';

  const { data: businesses } = useSupabaseQuery<Business[]>(
    () => supabase.from('businesses').select('*').eq('is_active', true).order('name'),
    [user?.id],
    { cacheKey: `quotations:biz:${user?.id}`, ttlMs: 60000 },
  );
  const { data: branches } = useSupabaseQuery<Branch[]>(
    () => supabase.from('branches').select('*').eq('is_active', true).order('name'),
    [user?.id],
    { cacheKey: `quotations:branches:${user?.id}`, ttlMs: 60000 },
  );

  const quotesQuery = useMemo(() => {
    let query = supabase
      .from('quotations')
      .select('*, business:businesses(id,name), branch:branches(id,name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!isExecutive) {
      if (userBranchIds.length === 1) query = query.eq('branch_id', userBranchIds[0]);
      else if (userBranchIds.length > 1) query = query.in('branch_id', userBranchIds);
      else if (user?.branch_id) query = query.eq('branch_id', user.branch_id);
    }
    if (status !== 'all') query = query.eq('status', status);
    return query;
  }, [isExecutive, user, userBranchIds, status]);

  const { data: quotes, loading, error, refetch } = useSupabaseQuery<Quotation[]>(
    () => quotesQuery,
    [quotesQuery],
    { cacheKey: `quotations:list:${user?.id}:${status}:${isExecutive ? 'all' : userBranchIds.join(',')}`, ttlMs: 20000 },
  );

  const filtered = useMemo(() => {
    if (!quotes) return [];
    if (!search.trim()) return quotes;
    const term = search.trim().toLowerCase();
    return quotes.filter(
      (q) =>
        (q.quote_number ?? '').toLowerCase().includes(term) ||
        (q.customer_name ?? '').toLowerCase().includes(term) ||
        (q.prepared_for ?? '').toLowerCase().includes(term),
    );
  }, [quotes, search]);

  const loadItems = async (id: string): Promise<QuotationItem[]> => {
    const { data } = await supabase
      .from('quotation_items')
      .select('*, product:products(name)')
      .eq('quotation_id', id)
      .order('sort_order');
    return (data ?? []) as QuotationItem[];
  };

  const handlePrint = async (quote: Quotation) => {
    await printQuotation(quote, await loadItems(quote.id));
  };
  const handleDownload = async (quote: Quotation) => {
    await downloadQuotation(quote, await loadItems(quote.id));
  };

  const setQuoteStatus = async (quote: Quotation, next: QuotationStatus) => {
    const { error: updateError } = await supabase
      .from('quotations')
      .update({ status: next })
      .eq('id', quote.id);
    if (updateError) {
      setConvErr(updateError.message);
      return;
    }
    setViewQuote({ ...quote, status: next });
    refetch();
  };

  const convertToSale = async (quote: Quotation) => {
    if (!CONVERTIBLE.includes(quote.status)) return;
    setConverting(true);
    setConvErr(null);
    try {
      const { data: saleId, error: rpcError } = await supabase.rpc('create_sale_from_quotation', {
        p_quotation_id: quote.id,
      });
      if (rpcError) throw rpcError;
      if (!saleId) throw new Error('The sale could not be created. Please try again.');
      setViewQuote(null);
      setConvertedSaleId(saleId as string);
      refetch();
    } catch (err) {
      setConvErr(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  if (loading) return <ListSkeleton rows={6} />;
  if (error) return <ErrorState message="Could not load quotations." onRetry={refetch} />;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Quotations</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Draft, print or download quotations and convert them into receipts.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)} className="w-full sm:w-auto">
            <Plus size={18} /> New Quotation
          </Button>
        )}
      </div>

      {convertedSaleId && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-emerald-800 min-w-0">
            <CheckCircle size={18} className="shrink-0" />
            <span>Quotation converted to a sale. Stock has been updated.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadReceipt(convertedSaleId)}>
              <Download size={14} /> Receipt PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => printReceipt(convertedSaleId)}>
              <Printer size={14} /> Print Receipt
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConvertedSaleId(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quote no, customer or prepared for..."
            className="pl-9"
            aria-label="Search quotations"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | QuotationStatus)}
          className="w-40"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {(['draft', 'sent', 'accepted', 'converted', 'rejected', 'cancelled'] as QuotationStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} />}
          title={quotes && quotes.length > 0 ? 'No quotations match your search' : 'No quotations yet'}
          description={
            quotes && quotes.length > 0
              ? 'Try a different quote number, customer name or status filter.'
              : 'Create a professional quotation for a customer, then convert it to a receipt when the deal closes.'
          }
          action={
            canCreate && (!quotes || quotes.length === 0) ? (
              <Button onClick={() => setShowCreate(true)}>
                <Plus size={18} /> New Quotation
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((quote) => (
            <div
              key={quote.id}
              className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <FileText size={18} className="text-slate-500" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900">
                      {quote.quote_number || quote.id.slice(0, 8).toUpperCase()}
                    </p>
                    <Badge className={STATUS_STYLES[quote.status]}>{STATUS_LABELS[quote.status]}</Badge>
                  </div>
                  <p className="text-sm text-slate-500 truncate">
                    Prepared for: {quote.prepared_for || quote.customer_name || '-'} | {quote.branch?.name ?? '-'} |{' '}
                    {formatDate(quote.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap sm:justify-end">
                <span className="text-sm font-semibold text-slate-900 mr-1">
                  {formatCurrency(Number(quote.total_amount ?? 0))}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setViewQuote(quote)}>
                  <Eye size={14} /> View
                </Button>
                {canCreate && quote.status === 'draft' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingQuote(quote);
                      setShowCreate(true);
                    }}
                  >
                    <Pencil size={14} /> Edit
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => handleDownload(quote)}>
                  <Download size={14} /> PDF
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handlePrint(quote)}>
                  <Printer size={14} /> Print
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <QuotationFormModal
          businesses={businesses ?? []}
          branches={branches ?? []}
          user={user}
          quote={editingQuote}
          onClose={() => {
            setShowCreate(false);
            setEditingQuote(null);
          }}
          onSaved={() => {
            setShowCreate(false);
            setEditingQuote(null);
            refetch();
          }}
        />
      )}
      {viewQuote && (
        <QuotationViewModal
          quote={viewQuote}
          canManage={canCreate}
          onClose={() => {
            setViewQuote(null);
            setConvErr(null);
          }}
          onPrint={() => handlePrint(viewQuote)}
          onDownload={() => handleDownload(viewQuote)}
          onConvert={() => convertToSale(viewQuote)}
          onEdit={() => {
            setEditingQuote(viewQuote);
            setViewQuote(null);
            setShowCreate(true);
          }}
          onStatusChange={(next) => setQuoteStatus(viewQuote, next)}
          converting={converting}
          error={convErr}
        />
      )}
    </div>
  );
}

interface QuotationFormModalProps {
  businesses: Business[];
  branches: Branch[];
  user: UserProfile | null;
  quote: Quotation | null;
  onClose: () => void;
  onSaved: () => void;
}

function QuotationFormModal({ businesses, branches, user, quote, onClose, onSaved }: QuotationFormModalProps) {
  const isEditing = !!quote;
  const userBranchIds = useMemo(() => fullAccessibleBranchIds(user), [user]);
  const isExecutive = user?.role?.name === 'super_admin';
  const scopedBranches = isExecutive ? branches : branches.filter((b) => userBranchIds.includes(b.id));
  const defaultBranch =
    quote?.branch_id ??
    scopedBranches.find((b) => b.id === user?.branch_id)?.id ??
    scopedBranches[0]?.id ??
    '';
  const defaultBusiness =
    quote?.business_id ??
    user?.business_id ??
    scopedBranches.find((b) => b.id === defaultBranch)?.business_id ??
    businesses[0]?.id ??
    '';

  const [businessId, setBusinessId] = useState(defaultBusiness);
  const [branchId, setBranchId] = useState(defaultBranch);
  const [preparedFor, setPreparedFor] = useState(quote?.prepared_for ?? '');
  const [preparedForContact, setPreparedForContact] = useState(quote?.prepared_for_contact ?? '');
  const [locationAddress, setLocationAddress] = useState(quote?.location_address ?? '');
  const [customerName, setCustomerName] = useState(quote?.customer_name ?? '');
  const [customerContact, setCustomerContact] = useState(quote?.customer_contact ?? '');
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? '');
  const [discount, setDiscount] = useState(String(Number(quote?.discount_value ?? 0)));
  const [notes, setNotes] = useState(
    quote?.notes ?? 'Thank you for your inquiry. We look forward to doing business with you.',
  );
  const [terms, setTerms] = useState(
    quote?.terms_conditions ??
      'Prices are valid for the stated period. Payment terms as stated above. Goods and services are subject to our standard terms.',
  );
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(isEditing);
  const existingItemIds = useRef<string[]>([]);

  // Products stocked at the selected branch only, so the picker can never
  // offer an item this branch cannot deliver.
  const productQuery = useMemo(() => {
    if (!branchId) return null;
    return () =>
      supabase
        .from('products')
        .select('*')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .order('name')
        .limit(500);
  }, [branchId]);
  const { data: branchProducts } = useSupabaseQuery<Product[]>(productQuery, [branchId, user?.id], {
    cacheKey: `quotations:branch-products:${branchId}:${user?.id}`,
    ttlMs: 60000,
  });

  const balanceQuery = useMemo(() => {
    if (!branchId) return null;
    return () =>
      supabase.from('inventory_balances').select('product_id,current_stock').eq('branch_id', branchId);
  }, [branchId]);
  const { data: balances } = useSupabaseQuery<BranchBalance[]>(balanceQuery, [branchId, user?.id], {
    cacheKey: `quotations:balances:${branchId}:${user?.id}`,
    ttlMs: 60000,
  });

  const stockByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    (balances ?? []).forEach((b) => {
      map[b.product_id] = Number(b.current_stock);
    });
    return map;
  }, [balances]);

  useEffect(() => {
    if (!isEditing) return;
    let mounted = true;
    supabase
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', quote.id)
      .order('sort_order')
      .then(({ data }) => {
        if (!mounted) return;
        const rows = (data ?? []) as QuotationItem[];
        existingItemIds.current = rows.map((row) => row.id);
        if (rows.length > 0) {
          setItems(
            rows.map((row) => ({
              id: row.id,
              product_id: row.product_id,
              item_name: row.item_name,
              quantity: String(Number(row.quantity)),
              unit: row.unit ?? '',
              unit_price: String(Number(row.unit_price)),
            })),
          );
        }
        setLoadingItems(false);
      });
    return () => {
      mounted = false;
    };
  }, [isEditing, quote]);

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const pickProduct = (index: number, productId: string) => {
    const product = (branchProducts ?? []).find((p) => p.id === productId);
    if (!product) {
      updateItem(index, { product_id: null });
      return;
    }
    updateItem(index, {
      product_id: product.id,
      item_name: product.name,
      unit: product.unit ?? '',
      unit_price: String(product.selling_price ?? 0),
    });
  };

  const subtotal = items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
  const headerDiscount = Number(discount || 0);
  const total = subtotal - headerDiscount;

  const save = async () => {
    if (!branchId) {
      setError('Please choose the branch this quotation is for.');
      return;
    }
    const usable = items.filter((it) => it.item_name.trim().length > 0);
    if (usable.length === 0) {
      setError('Add at least one item to the quotation.');
      return;
    }
    if (headerDiscount < 0 || headerDiscount > subtotal) {
      setError('The discount must be between zero and the subtotal.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        business_id: businessId,
        branch_id: branchId,
        prepared_for: sanitizeText(preparedFor),
        prepared_for_contact: sanitizeText(preparedForContact),
        location_address: sanitizeText(locationAddress),
        customer_name: sanitizeText(customerName),
        customer_contact: sanitizeText(customerContact),
        valid_until: validUntil || null,
        notes: sanitizeMultiline(notes),
        terms_conditions: sanitizeMultiline(terms),
        discount_value: headerDiscount,
        subtotal,
        total_amount: total,
      };

      let quotationId = quote?.id;
      if (isEditing && quotationId) {
        const { error: updateError } = await supabase
          .from('quotations')
          .update(payload)
          .eq('id', quotationId);
        if (updateError) throw updateError;
      } else {
        const { data: quoteNumber, error: numberError } = await supabase.rpc('generate_quote_number');
        if (numberError) throw numberError;
        const { data: created, error: quoteError } = await supabase
          .from('quotations')
          .insert({ ...payload, quote_number: (quoteNumber as string) ?? undefined, status: 'draft', created_by: user?.id ?? null })
          .select('id')
          .single();
        if (quoteError) throw quoteError;
        quotationId = created.id;
      }

      // Items are updated in place where possible so a failed save can never
      // leave the quotation empty.
      const keptIds = usable.map((it) => it.id).filter((id): id is string => !!id);
      const existingIds = existingItemIds.current;
      const removedIds = existingIds.filter((id) => !keptIds.includes(id));
      if (removedIds.length > 0) {
        const { error: deleteError } = await supabase.from('quotation_items').delete().in('id', removedIds);
        if (deleteError) throw deleteError;
      }

      const newRows = usable
        .filter((it) => !it.id)
        .map((it, index) => ({
          quotation_id: quotationId as string,
          product_id: it.product_id,
          item_name: sanitizeText(it.item_name),
          description: '',
          quantity: Number(it.quantity || 1),
          unit: sanitizeText(it.unit),
          unit_price: Number(it.unit_price || 0),
          discount_value: 0,
          line_total: Number(it.quantity || 1) * Number(it.unit_price || 0),
          sort_order: index,
        }));
      if (newRows.length > 0) {
        const { error: insertError } = await supabase.from('quotation_items').insert(newRows);
        if (insertError) throw insertError;
      }

      const changedRows = usable
        .filter((it) => it.id)
        .map((it, index) => ({
          id: it.id as string,
          product_id: it.product_id,
          item_name: sanitizeText(it.item_name),
          description: '',
          quantity: Number(it.quantity || 1),
          unit: sanitizeText(it.unit),
          unit_price: Number(it.unit_price || 0),
          discount_value: 0,
          line_total: Number(it.quantity || 1) * Number(it.unit_price || 0),
          sort_order: index,
        }));
      for (const row of changedRows) {
        const { error: rowError } = await supabase.from('quotation_items').update(row).eq('id', row.id);
        if (rowError) throw rowError;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the quotation.');
    } finally {
      setSaving(false);
    }
  };

  const branchOptions = scopedBranches.filter((b) => !businessId || b.business_id === businessId);

  return (
    <Modal open onClose={onClose} title={isEditing ? 'Edit Quotation' : 'New Quotation'} size="xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Business"
            value={businessId}
            onChange={(e) => {
              const next = e.target.value;
              setBusinessId(next);
              const match = scopedBranches.find((b) => b.business_id === next);
              if (match) setBranchId(match.id);
            }}
            disabled={isEditing}
          >
            <option value="">Select business</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select label="Branch / Location" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={isEditing}>
            <option value="">Select branch</option>
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Prepared For (Company / Person)"
            value={preparedFor}
            onChange={(e) => setPreparedFor(e.target.value)}
            placeholder="e.g. ABC Trading Ltd"
          />
          <Input
            label="Prepared For Contact"
            value={preparedForContact}
            onChange={(e) => setPreparedForContact(e.target.value)}
            placeholder="Phone or email"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Customer Name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Optional"
          />
          <Input
            label="Customer Contact"
            value={customerContact}
            onChange={(e) => setCustomerContact(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Location / Address"
            value={locationAddress}
            onChange={(e) => setLocationAddress(e.target.value)}
            placeholder="Full address shown on the quotation"
          />
          <Input label="Valid Until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">Items</p>
            <Button size="sm" variant="outline" onClick={() => setItems((cur) => [...cur, emptyItem()])}>
              <Plus size={14} /> Add Item
            </Button>
          </div>
          {loadingItems ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading items...</p>
          ) : (
            items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-end border border-slate-200 rounded-xl p-2 sm:p-3">
                <div className="col-span-12 sm:col-span-3">
                  <Select
                    label={index === 0 ? 'Product' : ''}
                    value={item.product_id ?? ''}
                    onChange={(e) => pickProduct(index, e.target.value)}
                  >
                    <option value="">Custom item</option>
                    {(branchProducts ?? []).map((p) => {
                      const stock = stockByProduct[p.id];
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {stock !== undefined ? ` (${stock} in stock)` : ''}
                        </option>
                      );
                    })}
                  </Select>
                </div>
                <div className="col-span-12 sm:col-span-3">
                  <Input
                    label={index === 0 ? 'Item / Description' : ''}
                    value={item.item_name}
                    onChange={(e) => updateItem(index, { item_name: e.target.value })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Input
                    label={index === 0 ? 'Qty' : ''}
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, { quantity: e.target.value })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <Input
                    label={index === 0 ? 'Unit' : ''}
                    value={item.unit}
                    onChange={(e) => updateItem(index, { unit: e.target.value })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Input
                    label={index === 0 ? 'Price' : ''}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={item.unit_price}
                    onChange={(e) => updateItem(index, { unit_price: e.target.value })}
                  />
                </div>
                <div className="col-span-12 sm:col-span-1 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setItems((cur) => cur.filter((_, i) => i !== index))}
                    aria-label={`Remove item ${index + 1}`}
                    title="Remove item"
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            ))
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 sm:gap-6 pt-1 text-sm">
            <div className="flex items-center gap-2">
              <label htmlFor="quotation-discount" className="text-slate-600 shrink-0">
                Discount
              </label>
              <Input
                id="quotation-discount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-28 text-right"
              />
            </div>
            <div className="text-slate-600">
              Subtotal: <span className="text-slate-900">{formatCurrency(subtotal)}</span>
            </div>
            <div className="text-slate-900 font-semibold">
              Total: {formatCurrency(total)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <Textarea label="Terms & Conditions" value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loadingItems}>
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Save Draft'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface QuotationViewModalProps {
  quote: Quotation;
  canManage: boolean;
  onClose: () => void;
  onPrint: () => void;
  onDownload: () => void;
  onConvert: () => void;
  onEdit: () => void;
  onStatusChange: (status: QuotationStatus) => void;
  converting: boolean;
  error: string | null;
}

function QuotationViewModal({
  quote,
  canManage,
  onClose,
  onPrint,
  onDownload,
  onConvert,
  onEdit,
  onStatusChange,
  converting,
  error,
}: QuotationViewModalProps) {
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase
      .from('quotation_items')
      .select('*, product:products(name)')
      .eq('quotation_id', quote.id)
      .order('sort_order')
      .then(({ data }) => {
        if (!mounted) return;
        setItems((data ?? []) as QuotationItem[]);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [quote.id]);

  const lineDiscount = items.reduce((sum, i) => sum + Number(i.discount_value || 0), 0);
  const totalDiscount = Number(quote.discount_value ?? 0) + lineDiscount;
  const canConvert = CONVERTIBLE.includes(quote.status);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Quotation ${quote.quote_number || quote.id.slice(0, 8).toUpperCase()}`}
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={STATUS_STYLES[quote.status]}>{STATUS_LABELS[quote.status]}</Badge>
          {quote.valid_until && (
            <span className="text-xs text-slate-500">Valid until {formatDate(quote.valid_until)}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onDownload}>
            <Download size={14} /> Download PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onPrint}>
            <Printer size={14} /> Print
          </Button>
          {canManage && quote.status === 'draft' && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil size={14} /> Edit
            </Button>
          )}
          {canConvert && (
            <Button size="sm" onClick={onConvert} disabled={converting}>
              <ArrowRightCircle size={14} /> {converting ? 'Converting...' : 'Create Receipt from Quotation'}
            </Button>
          )}
        </div>

        {canManage && (quote.status === 'draft' || quote.status === 'sent') && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-500">Move to:</span>
            {quote.status === 'draft' && (
              <Button size="sm" variant="ghost" onClick={() => onStatusChange('sent')}>
                <Send size={14} /> Sent
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onStatusChange('accepted')}>
              <ThumbsUp size={14} /> Accepted
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onStatusChange('rejected')} className="text-rose-600">
              <XCircle size={14} /> Rejected
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <p className="text-slate-500">Prepared For</p>
            <p className="font-medium break-words">{quote.prepared_for || '-'}</p>
          </div>
          <div className="min-w-0">
            <p className="text-slate-500">Location / Address</p>
            <p className="font-medium break-words">{quote.location_address || '-'}</p>
          </div>
          <div>
            <p className="text-slate-500">Branch</p>
            <p className="font-medium">{quote.branch?.name ?? '-'}</p>
          </div>
          <div>
            <p className="text-slate-500">Date</p>
            <p className="font-medium">{formatDate(quote.created_at)}</p>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-2 font-medium text-slate-500">Item</th>
                <th className="text-right p-2 font-medium text-slate-500">Qty</th>
                <th className="text-right p-2 font-medium text-slate-500">Price</th>
                <th className="text-right p-2 font-medium text-slate-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-sm text-slate-400">
                    Loading items...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-sm text-slate-400">
                    No items on this quotation.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-2">{item.item_name}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">{formatCurrency(Number(item.unit_price))}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {formatCurrency(Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value ?? 0))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="text-right space-y-1 text-sm">
          <p className="text-slate-600">Subtotal: {formatCurrency(Number(quote.subtotal ?? 0))}</p>
          <p className="text-slate-600">Discount: {formatCurrency(totalDiscount)}</p>
          <p className="text-base font-semibold text-slate-900">Total: {formatCurrency(Number(quote.total_amount ?? 0))}</p>
        </div>

        {quote.notes && (
          <div>
            <p className="text-sm font-medium">Notes</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap break-words">{quote.notes}</p>
          </div>
        )}
        {quote.terms_conditions && (
          <div>
            <p className="text-sm font-medium">Terms &amp; Conditions</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap break-words">{quote.terms_conditions}</p>
          </div>
        )}
        <div className="border-t pt-3 text-xs text-slate-600 space-y-0.5">
          <p className="font-medium text-slate-700">info@cedokaglobal.com</p>
          <p>All payments must be made to:</p>
          <p>Cedoka Global Limited</p>
          <p>Fidelity Bank</p>
          <p>5080201438</p>
        </div>
      </div>
    </Modal>
  );
}
