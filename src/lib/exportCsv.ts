/**
 * Lightweight client-side CSV export. No dependency — works offline and on
 * any screen size. Produces UTF-8 with BOM so Excel opens Nigerian currency
 * and names correctly.
 */
export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Prevent CSV formula injection from user-entered text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
): void {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCell(c.value(r))).join(',')).join('\r\n');
  const csv = `\uFEFF${header}\r\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const dateFileName = (prefix: string): string =>
  `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
