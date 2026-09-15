export interface FarmBusinessLike {
  name?: string | null;
  category?: string | null;
}

export function isFarmBusiness(business?: FarmBusinessLike | null): boolean {
  if (!business) return false;
  const hay = `${business.name ?? ''} ${business.category ?? ''}`.toLowerCase();
  return hay.includes('farm') || hay.includes('agric');
}

export const FARM_UNITS = [
  'bag',
  'crate',
  'basket',
  'kilo',
  'kg',
  'unit',
  'pcs',
  'bundle',
  'tuber',
  'dozen',
  'pack',
  'sack',
] as const;

export const RETAIL_UNITS = [
  'pcs',
  'box',
  'carton',
  'pack',
  'set',
  'pair',
  'kg',
  'litre',
  'meter',
] as const;

export function unitOptionsFor(isFarm: boolean): string[] {
  return [...(isFarm ? FARM_UNITS : RETAIL_UNITS)];
}

export function formatUnitQuantity(quantity: number, unit?: string | null): string {
  const u = (unit ?? '').trim();
  if (!u) return String(quantity);
  const plural = quantity === 1 ? u : u.endsWith('s') ? u : `${u}s`;
  return `${quantity} ${plural}`;
}
