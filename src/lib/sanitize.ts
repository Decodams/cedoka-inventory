// Input hygiene helpers. React auto-escapes rendered text, so these guards
// exist to (a) strip control characters and embedded nulls that can corrupt
// storage/PDF output, and (b) normalise whitespace so search and receipts
// stay clean. No HTML is ever rendered from user content.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Normalise a single-line value: strip control chars, collapse whitespace. */
export function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
}

/** Normalise multi-line value (notes): strip control chars only, keep the layout. */
export function sanitizeMultiline(value: string): string {
  return value.replace(CONTROL_CHARS, '').replace(/\r?\n/g, '\n').trim();
}