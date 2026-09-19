import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, formatDate } from '@/lib/dateUtils';
import logoUrl from '@/logo.jpeg';

const COMPANY = 'CEDOKA GLOBAL MALL';
const ADDRESS_1 = '35, Ailegun Road, Ejigbo, Lagos';
const ADDRESS_2 = 'Top Mak Plaza, Awka';
const CONTACT = '07045851131 | cedokamall@gmail.com | cedokamall.com';

interface ReceiptItem {
  quantity: number;
  unit?: string | null;
  unit_price: number;
  discount_value: number;
  product?: { name: string } | null;
}

interface ReceiptSale {
  id: string;
  sale_date: string;
  created_at: string;
  customer_name: string | null;
  amount_paid: number | null;
  discount_value: number | null;
  notes: string | null;
  product?: { name: string } | null;
  branch?: { name: string } | null;
  business?: { name: string } | null;
  salesperson?: { full_name: string } | null;
  items?: ReceiptItem[] | null;
}

// jsPDF's built-in helvetica font (WinAnsi) has no naira glyph, so amounts
// would render as blanks - use the NGN code instead for PDF output.
const pdfMoney = (value: number): string => formatCurrency(value).replace(/₦/g, 'NGN ');

let cachedLogo: string | null = null;
async function loadLogoDataUrl(): Promise<string | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const response = await fetch(logoUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('logo read failed'));
      reader.readAsDataURL(blob);
    });
    cachedLogo = dataUrl;
    return dataUrl;
  } catch {
    return null;
  }
}

async function buildReceiptPdf(saleId: string): Promise<{ pdf: jsPDF; receiptNo: string }> {
  const { data, error } = await supabase.from('daily_sales').select('*, product:products(id,name), items:sale_items(quantity,unit,unit_price,discount_value,product:products(name)), branch:branches(name), business:businesses(name), salesperson:user_profiles!daily_sales_salesperson_id_fkey(full_name)').eq('id', saleId).single();
  if (error || !data) throw new Error('Sale not found. It may be outside your assigned scope.');
  const sale = data as unknown as ReceiptSale;
  const legacyItem: ReceiptItem = { product: sale.product ?? null, quantity: 1, unit: null, unit_price: 0, discount_value: 0 };
  const items: ReceiptItem[] = sale.items?.length ? sale.items : [legacyItem];
  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value || 0), 0);

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const width = pdf.internal.pageSize.getWidth();
  const margin = 12;
  let y = 12;

  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      pdf.addImage(logo, 'JPEG', width / 2 - 12, y, 24, 24, undefined, 'FAST');
      y += 27;
    } catch {
      // logo unreadable - fall through to text header
    }
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(COMPANY, width / 2, y, { align: 'center' });
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(`1: ${ADDRESS_1}`, width / 2, y, { align: 'center' });
  y += 4;
  pdf.text(`2: ${ADDRESS_2}`, width / 2, y, { align: 'center' });
  y += 4;
  pdf.text(CONTACT, width / 2, y, { align: 'center' });
  y += 7;
  pdf.setDrawColor(180);
  pdf.line(margin, y, width - margin, y);
  y += 6;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('SALES RECEIPT', width / 2, y, { align: 'center' });
  y += 7;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const receiptNo = sale.id.substring(0, 8).toUpperCase();
  const time = new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  pdf.text(`Receipt #: ${receiptNo}`, margin, y);
  pdf.text(`Date: ${formatDate(sale.sale_date)} ${time}`, width - margin, y, { align: 'right' });
  y += 5;
  pdf.text(`Branch: ${sale.branch?.name || '-'}`, margin, y);
  y += 5;
  pdf.text(`Customer: ${sale.customer_name || 'Walk-in'}`, margin, y);
  y += 5;
  pdf.text(`Attendant: ${sale.salesperson?.full_name || 'Staff'}`, margin, y);
  y += 4;

  autoTable(pdf, {
    startY: y,
    head: [['Item', 'Qty', 'Unit', 'Unit price', 'Line total']],
    body: items.map((item) => [
      item.product?.name || 'Sale item',
      String(item.quantity),
      item.unit || '-',
      pdfMoney(Number(item.unit_price)),
      pdfMoney(Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value || 0)),
    ]),
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  });
  const finalY = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  y = finalY + 8;

  const paid = Number(sale.amount_paid || 0);
  const balance = total - paid;
  pdf.setFontSize(9);
  pdf.text(`Subtotal: ${pdfMoney(total + Number(sale.discount_value || 0))}`, margin, y);
  y += 5;
  pdf.text(`Discount: ${pdfMoney(Number(sale.discount_value || 0))}`, margin, y);
  y += 5;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Total: ${pdfMoney(total)}`, margin, y);
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Amount paid: ${pdfMoney(paid)}`, margin, y);
  y += 5;
  pdf.text(`Balance: ${pdfMoney(balance)}`, margin, y);
  y += 8;
  if (sale.notes) {
    pdf.setFontSize(8);
    pdf.text(`Notes: ${sale.notes}`, margin, y);
    y += 6;
  }
  pdf.setDrawColor(180);
  pdf.line(margin, y, width - margin, y);
  y += 5;
  pdf.setFontSize(8);
  pdf.text('Thank you for your business.', width / 2, y, { align: 'center' });

  return { pdf, receiptNo };
}

export function useReceiptPDF() {
  const downloadReceipt = async (saleId: string) => {
    const { pdf, receiptNo } = await buildReceiptPdf(saleId);
    pdf.save(`cedoka-receipt-${receiptNo}.pdf`);
  };
  const printReceipt = async (saleId: string) => {
    const { pdf } = await buildReceiptPdf(saleId);
    pdf.autoPrint();
    const blobUrl = pdf.output('bloburl') as unknown as string;
    window.open(blobUrl, '_blank', 'noopener');
  };
  return { downloadReceipt, printReceipt };
}
