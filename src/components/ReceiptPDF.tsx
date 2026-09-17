import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, formatDate } from '@/lib/dateUtils';

interface AutoTableApi { autoTable: (options: Record<string, unknown>) => void; lastAutoTable: { finalY: number }; }
type PdfWithAutoTable = jsPDF & AutoTableApi;
const COMPANY = 'CEDOKA GLOBAL LIMITED';
const CONTACT = '07045851131 | cedokamall@gmail.com | cedokamall.com';

// jsPDF's built-in helvetica font (WinAnsi) has no naira glyph, so amounts
// would render as blanks - use the NGN code instead for PDF output.
const pdfMoney = (value: number): string => formatCurrency(value).replace(/₦/g, 'NGN ');

export function useReceiptPDF() {
  const downloadReceipt = async (saleId: string) => {
    const { data: sale, error } = await supabase.from('daily_sales').select('*, product:products(id,name), items:sale_items(quantity,unit,unit_price,discount_value,product:products(name)), branch:branches(name), business:businesses(name)').eq('id', saleId).single();
    if (error || !sale) throw new Error('Sale not found. It may be outside your assigned scope.');
    const legacyItem = { product: sale.product, quantity: sale.quantity, unit_price: sale.unit_price, discount_value: sale.discount_value, unit: null };
    const items = sale.items?.length ? sale.items : [legacyItem];
    const total = items.reduce((sum: number, item: { quantity: number; unit_price: number; discount_value: number }) => sum + Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value || 0), 0);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' }) as PdfWithAutoTable;
    const width = pdf.internal.pageSize.getWidth(); const margin = 14; let y = 15;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.text(COMPANY, width / 2, y, { align: 'center' }); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text(CONTACT, width / 2, y, { align: 'center' }); y += 11;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text('SALES RECEIPT', width / 2, y, { align: 'center' }); y += 9;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    pdf.text(`Receipt #: ${sale.id.substring(0, 8).toUpperCase()}`, margin, y); pdf.text(`Date: ${formatDate(sale.sale_date)}`, width - margin, y, { align: 'right' }); y += 5;
    pdf.text(`Business: ${sale.business?.name || COMPANY}`, margin, y); y += 5;
    pdf.text(`Branch: ${sale.branch?.name || '-'}`, margin, y); y += 5;
    if (sale.customer_name) { pdf.text(`Customer: ${sale.customer_name}`, margin, y); y += 5; }
    pdf.autoTable({ startY: y + 3, head: [['Item', 'Qty', 'Unit', 'Unit price', 'Line total']], body: items.map((item: { product?: { name: string } | null; quantity: number; unit?: string | null; unit_price: number; discount_value: number }) => [item.product?.name || 'Sale item', String(item.quantity), item.unit || '-', pdfMoney(Number(item.unit_price)), pdfMoney(Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value || 0))]), margin: { left: margin, right: margin }, theme: 'grid', headStyles: { fillColor: [30, 41, 59], fontSize: 8 }, bodyStyles: { fontSize: 8 } });
    y = pdf.lastAutoTable.finalY + 8;
    const paid = Number(sale.amount_paid || 0); const balance = total - paid;
    pdf.setFontSize(9); pdf.text(`Subtotal: ${pdfMoney(total + Number(sale.discount_value || 0))}`, margin, y); y += 5;
    pdf.text(`Discount: ${pdfMoney(Number(sale.discount_value || 0))}`, margin, y); y += 5;
    pdf.setFont('helvetica', 'bold'); pdf.text(`Total: ${pdfMoney(total)}`, margin, y); y += 5;
    pdf.setFont('helvetica', 'normal'); pdf.text(`Amount paid: ${pdfMoney(paid)}`, margin, y); y += 5;
    pdf.text(`Balance: ${pdfMoney(balance)}`, margin, y); y += 10;
    if (sale.notes) { pdf.setFontSize(8); pdf.text(`Notes: ${sale.notes}`, margin, y); y += 8; }
    pdf.setDrawColor(180); pdf.line(margin, y, width - margin, y); y += 5;
    pdf.setFontSize(8); pdf.text('Thank you for your business.', width / 2, y, { align: 'center' });
    pdf.save(`cedoka-receipt-${sale.id.substring(0, 8)}.pdf`);
  };
  return { downloadReceipt };
}
