import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { supabase } from '@/lib/supabaseClient';
import { formatDate, formatCurrency } from '@/lib/dateUtils';

interface AutoTableApi {
  autoTable: (options: Record<string, unknown>) => void;
  lastAutoTable: { finalY: number };
}
type PdfWithAutoTable = jsPDF & AutoTableApi;

 // Exact company details for Cedoka (from system configuration)
 const COMPANY_PHONES = '07045851131, +234 912 881 7136, +234 907 419 0070';
 const COMPANY_WEBSITE = 'cedokamall.com';
 const COMPANY_EMAIL = 'cedokamall@gmail.com';

export function useReceiptPDF() {
  const downloadReceipt = async (saleId: string) => {
    const { data: sale, error } = await supabase
      .from('daily_sales')
      .select(`
        *,
        product:products(id,name,sku,description),
        branch:branches(id,name),
        salesperson:user_profiles!salesperson_id(full_name)
      `)
      .eq('id', saleId)
      .single();

    if (error || !sale) {
      throw new Error('Sale not found');
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('name, address, phone, email, tax_id, logo_url')
      .eq('id', sale.business_id)
      .single();

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a5',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 15;

    // Helper to add header line
    const addHeaderLine = (pdf: jsPDF, text: string, y: number, bold = false) => {
      pdf.setFontSize(8);
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.text(text, margin, y);
    };

    // Helper to add section divider
    const addDivider = (pdf: jsPDF, y: number) => {
      pdf.setDrawColor(180, 180, 180);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, pageWidth - margin, y);
    };

    // ========== HEADER: Company Logo/Branding ==========
    let y = margin;

    if (business?.logo_url) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const imgWidth = 30;
          const imgHeight = (img.height / img.width) * imgWidth;
          pdf.addImage(img, 'PNG', margin, y, imgWidth, imgHeight);
          y += imgHeight + 5;
        };
        img.src = business.logo_url;
      } catch {
        // ignore image load errors
      }
    }

    // Company name
    addHeaderLine(pdf, business?.name || 'Cedoka Inventory', y, true);
    y += 8;

    // Exact company contact details (from system config)
    addHeaderLine(pdf, `Phone: ${COMPANY_PHONES}`, y);
    y += 5;
    addHeaderLine(pdf, `Website: ${COMPANY_WEBSITE}`, y);
    y += 5;
    addHeaderLine(pdf, `Email: ${COMPANY_EMAIL}`, y);
    y += 5;

    // ========== RECEIPT TITLE ==========
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('SALES RECEIPT', pageWidth / 2, y, { align: 'center' });
    y += 12;

    // ========== RECEIPT METADATA ==========
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Receipt #: ${sale.id.substring(0, 8).toUpperCase()}`, margin, y);
    y += 5;
    pdf.text(`Date: ${formatDate(sale.sale_date)}`, margin, y);
    y += 5;
    pdf.text(`Salesperson: ${sale.salesperson?.full_name || '—'}`, margin, y);
    y += 5;
    pdf.text(`Branch: ${sale.branch?.name || '—'}`, margin, y);
    y += 15;

    // ========== ITEMIZED TABLE ==========
    const tableData = [[
      { content: 'Product', columnClass: 'tableHeader' },
      { content: 'Qty', columnClass: 'tableHeader' },
      { content: 'Unit Price', columnClass: 'tableHeader' },
      { content: 'Total', columnClass: 'tableHeader' },
    ]];

    const product = sale.product as { id: string; name: string; sku?: string } | null;
    const itemName = product?.name || sale.customer_name || 'Sale Item';
    const unitPrice = Number(sale.unit_price || 0);
    const quantity = Number(sale.quantity || 1);
    const total = unitPrice * quantity - Number(sale.discount_value || 0);

    tableData.push([
      itemName,
      quantity.toString(),
      formatCurrency(unitPrice),
      formatCurrency(total),
    ]);

    (pdf as PdfWithAutoTable).autoTable({
      startY: y,
      head: tableData.map(row => row.map(cell => cell.content)),
      body: [tableData[1].map(cell => cell.content)],
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: {
        fill: [['234, 179, 88']],
        textColor: 255,
        fontStyle: 'bold',
        cellWidth: 'auto',
      },
      bodyStyles: {
        fontSize: 9,
        cellWidth: 'auto',
      },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 25 },
        2: { cellWidth: 50 },
        3: { cellWidth: 50 },
      },
    });

    y = (pdf as PdfWithAutoTable).lastAutoTable.finalY + 10;

    // ========== PAYMENT SUMMARY ==========
    const amountPaid = Number(sale.amount_paid || 0);
    const balance = total - amountPaid;

    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Subtotal: ${formatCurrency(total)}`, margin, y); y += 5;
    pdf.text(`Discount: ${formatCurrency(Number(sale.discount_value || 0))}`, margin, y); y += 5;
    pdf.text(`Total: ${formatCurrency(total)}`, margin, y, { align: 'right' }); y += 5;
    pdf.text(`Paid: ${formatCurrency(amountPaid)}`, margin, y); y += 5;
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Balance: ${formatCurrency(balance)}`, margin, y); y += 10;

    // ========== NOTES ==========
    if (sale.notes?.trim()) {
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'italic');
      pdf.text(`Notes: ${sale.notes}`, margin, y);
      y += 8;
    }

    // ========== FOOTER ==========
    addDivider(pdf, y);
    y += 5;
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.text(`Thank you for your business!`, pageWidth / 2, y, { align: 'center' });
    y += 5;
    pdf.text(`Generated on ${new Date().toLocaleDateString()}`, pageWidth / 2, y, { align: 'center' });

    // ========== DOWNLOAD ==========
    pdf.save(`receipt-${sale.id}.pdf`);
  };

  return { downloadReceipt };
}