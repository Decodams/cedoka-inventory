import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate } from '@/lib/dateUtils';
import {
  addressLine1,
  addressLine2,
  bankLine1,
  bankLine2,
  bankLine3,
  bankLine4,
  companyEmail,
  companyName,
  contactOnline,
  contactPhones,
  loadLogoDataUrl,
  pdfMoney,
} from '@/lib/pdfCommon';
import type { Quotation, QuotationItem } from '@/types/database';

/**
 * Quotation PDF. Deliberately omits any staff / salesperson / attendant name:
 * the customer-facing document only shows company, recipient, location, dates,
 * line items, totals, terms and payment instructions.
 */
export async function buildQuotationPdf(
  quotation: Quotation,
  items: QuotationItem[],
): Promise<{ pdf: jsPDF; quoteNo: string }> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const margin = 14;
  let y = 14;

  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      pdf.addImage(logo, 'JPEG', margin, y, 18, 18, undefined, 'FAST');
    } catch {
      // unreadable logo - fall through to the text header
    }
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(companyName, margin + 24, y + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(addressLine1, margin + 24, y + 11);
  pdf.text(addressLine2, margin + 24, y + 15);
  pdf.text(`${contactPhones}  |  ${contactOnline}`, margin + 24, y + 19);
  pdf.text(companyEmail, margin + 24, y + 23);

  y += 30;
  pdf.setDrawColor(30, 41, 59);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y, width - margin, y);
  y += 10;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text('QUOTATION', width - margin, y, { align: 'right' });
  y += 10;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const quoteNo = quotation.quote_number || quotation.id.substring(0, 8).toUpperCase();
  pdf.text(`Quote No.: ${quoteNo}`, width - margin, y, { align: 'right' });
  y += 5;
  pdf.text(`Date: ${formatDate(quotation.created_at)}`, width - margin, y, { align: 'right' });
  y += 5;
  if (quotation.valid_until) {
    pdf.text(`Valid Until: ${formatDate(quotation.valid_until)}`, width - margin, y, { align: 'right' });
  }
  y += 8;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('Prepared For:', margin, y);
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(quotation.prepared_for || quotation.customer_name || '-', margin, y);
  y += 4;
  if (quotation.prepared_for_contact || quotation.customer_contact) {
    pdf.text(quotation.prepared_for_contact || quotation.customer_contact, margin, y);
    y += 4;
  }
  if (quotation.location_address) {
    const locLines = pdf.splitTextToSize(quotation.location_address, width / 2);
    pdf.text(locLines, margin, y);
    y += locLines.length * 4;
  }
  if (quotation.branch?.name) {
    pdf.text(`Location/Branch: ${quotation.branch.name}`, margin, y);
    y += 4;
  }
  y += 4;

  const body = items
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => [
      item.item_name || item.product?.name || '-',
      String(Number(item.quantity)),
      item.unit || '-',
      pdfMoney(Number(item.unit_price)),
      pdfMoney(Number(item.quantity) * Number(item.unit_price) - Number(item.discount_value || 0)),
    ]);

  autoTable(pdf, {
    startY: y,
    head: [['Item/Description', 'Qty', 'Unit', 'Unit Price', 'Line Total']],
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [16, 28, 39], fontSize: 8, textColor: 255 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right' },
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
  });

  let finalY = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  finalY += 8;

  const subtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const lineDisc = items.reduce((s, i) => s + Number(i.discount_value || 0), 0);
  const disc = Number(quotation.discount_value || 0) + lineDisc;
  const tax = Number(quotation.tax_value || 0);
  const total = Number(quotation.total_amount || subtotal - disc + tax);

  pdf.setFontSize(9);
  pdf.text(`Subtotal: ${pdfMoney(subtotal)}`, width - margin - 55, finalY);
  pdf.text(`${pdfMoney(subtotal)}`, width - margin, finalY, { align: 'right' });
  finalY += 5;
  pdf.text(`Discount: ${pdfMoney(disc)}`, width - margin - 55, finalY);
  pdf.text(`${pdfMoney(disc)}`, width - margin, finalY, { align: 'right' });
  finalY += 5;
  pdf.text(`VAT/Other: ${pdfMoney(tax)}`, width - margin - 55, finalY);
  pdf.text(`${pdfMoney(tax)}`, width - margin, finalY, { align: 'right' });
  finalY += 6;
  pdf.setDrawColor(180);
  pdf.line(width - margin - 60, finalY, width - margin, finalY);
  finalY += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('TOTAL:', width - margin - 55, finalY);
  pdf.text(`${pdfMoney(total)}`, width - margin, finalY, { align: 'right' });
  finalY += 12;

  if (quotation.notes) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('Notes:', margin, finalY);
    finalY += 4;
    pdf.setFont('helvetica', 'normal');
    const noteLines = pdf.splitTextToSize(quotation.notes, width - margin * 2);
    pdf.text(noteLines, margin, finalY);
    finalY += noteLines.length * 4 + 4;
  }
  if (quotation.terms_conditions) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('Terms & Conditions:', margin, finalY);
    finalY += 4;
    pdf.setFont('helvetica', 'normal');
    const termLines = pdf.splitTextToSize(quotation.terms_conditions, width - margin * 2);
    pdf.text(termLines, margin, finalY);
    finalY += termLines.length * 4 + 6;
  }

  pdf.setDrawColor(200);
  pdf.line(margin, finalY, width - margin, finalY);
  finalY += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('PAYMENT DETAILS', margin, finalY);
  finalY += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(companyEmail, margin, finalY);
  finalY += 4;
  pdf.text(bankLine1, margin, finalY);
  finalY += 4;
  pdf.text(bankLine2, margin, finalY);
  finalY += 4;
  pdf.text(`${bankLine3}   ${bankLine4}`, margin, finalY);
  finalY += 8;
  pdf.setFontSize(8);
  pdf.setTextColor(100);
  pdf.text('This is a quotation, not a receipt. Prices are valid until the stated expiry date.', margin, finalY);

  return { pdf, quoteNo };
}

export function useQuotationPDF() {
  const downloadQuotation = async (quotation: Quotation, items: QuotationItem[]) => {
    const { pdf, quoteNo } = await buildQuotationPdf(quotation, items);
    pdf.save(`cedoka-quotation-${quoteNo}.pdf`);
  };
  const printQuotation = async (quotation: Quotation, items: QuotationItem[]) => {
    const { pdf } = await buildQuotationPdf(quotation, items);
    pdf.autoPrint();
    const blobUrl = pdf.output('bloburl') as unknown as string;
    window.open(blobUrl, '_blank', 'noopener');
  };
  return { downloadQuotation, printQuotation };
}
