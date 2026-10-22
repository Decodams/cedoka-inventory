import { formatCurrency } from '@/lib/dateUtils';
import logoUrl from '@/logo.jpeg';

export const companyName = 'CEDOKA GLOBAL LIMITED';
export const addressLine1 = '35, Ailegun Road, Ejigbo, Lagos';
export const addressLine2 = 'Top Mak Plaza, Awka';
export const contactPhones = '07045851131 | 09128817136 | 09074190070';
export const contactOnline = 'cedokamall@gmail.com | cedokamall.com';
export const companyEmail = 'info@cedokaglobal.com';

export const bankLine1 = 'All payments must be made to:';
export const bankLine2 = 'Cedoka Global Limited';
export const bankLine3 = 'Fidelity Bank';
export const bankLine4 = '5080201438';

/** jsPDF's built-in helvetica font (WinAnsi) has no naira glyph. */
export const pdfMoney = (value: number): string => formatCurrency(value).replace(/₦/g, 'NGN ');

let cachedLogo: string | null = null;

export async function loadLogoDataUrl(): Promise<string | null> {
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
