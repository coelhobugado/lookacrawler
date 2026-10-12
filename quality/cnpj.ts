/**
 * CNPJ helpers for both the classic numeric format and the alphanumeric one
 * introduced by IN RFB 2.229/2024 (new registrations since July 2026).
 *
 * Layout: 12 characters in [0-9A-Z] (8 root + 4 branch) followed by 2 numeric
 * check digits. Each character is worth its ASCII code minus 48, so digits
 * keep their value and "A" = 17 ... "Z" = 42; the check digits use modulo 11
 * with weights 2..9 cycling from the right. For an all-numeric CNPJ this is
 * exactly the classic algorithm. Reference: Receita Federal, "Manual de
 * Cálculo do DV do CNPJ" and its reference code (codigos-cnpj.zip).
 */

const MASK_CHARS = /[./\-\s]/g;
const CNPJ_SHAPE = /^[0-9A-Z]{12}\d{2}$/;
const BASE_SHAPE = /^[0-9A-Z]{12}$/;
const WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Strip the mask (dots, slash, dash, spaces). Letters are kept as-is: the
 * official validator treats lowercase as invalid, so this does not uppercase.
 */
export function normalizeCnpj(raw: string | null | undefined): string {
  return (raw || "").replace(MASK_CHARS, "");
}

/**
 * The two check digits for a 12-character base (masked or not).
 * Throws on a base that is not 12 characters in [0-9A-Z].
 */
export function computeCnpjCheckDigits(base: string): string {
  const clean = normalizeCnpj(base);
  if (!BASE_SHAPE.test(clean) || /^0{12}$/.test(clean)) {
    throw new Error(`Invalid CNPJ base: ${base}`);
  }
  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < 12; i++) {
    const value = clean.charCodeAt(i) - 48;
    sum1 += value * WEIGHTS[i + 1];
    sum2 += value * WEIGHTS[i];
  }
  const dv1 = sum1 % 11 < 2 ? 0 : 11 - (sum1 % 11);
  sum2 += dv1 * WEIGHTS[12];
  const dv2 = sum2 % 11 < 2 ? 0 : 11 - (sum2 % 11);
  return `${dv1}${dv2}`;
}

/**
 * Validate a numeric or alphanumeric CNPJ, masked or not. All-zero and
 * single-repeated-character values are rejected (they pass the arithmetic but
 * are never issued and are a common filler in forms).
 */
export function isValidCnpj(raw: string | null | undefined): boolean {
  if (!raw || /[^0-9A-Za-z./\-\s]/.test(raw)) return false;
  const clean = normalizeCnpj(raw);
  if (!CNPJ_SHAPE.test(clean)) return false;
  if (/^(.)\1{13}$/.test(clean)) return false;
  return computeCnpjCheckDigits(clean.slice(0, 12)) === clean.slice(12);
}

export function isAlphanumericCnpj(raw: string): boolean {
  return /[A-Z]/.test(normalizeCnpj(raw).slice(0, 12));
}

/**
 * Format as XX.XXX.XXX/XXXX-XX. Returns the input untouched when it does not
 * have the 14-character shape.
 */
export function formatCnpj(raw: string): string {
  const clean = normalizeCnpj(raw);
  if (!CNPJ_SHAPE.test(clean)) return raw;
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12)}`;
}

// Masked or unmasked, with every separator optional. Fixed-width groups keep
// the scan linear. The boundaries stop it from starting inside a longer token.
const CNPJ_CANDIDATE_REGEX =
  /(?<![0-9A-Za-z])[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}(?![0-9A-Za-z])/g;

/**
 * Find CNPJs printed in page text (typically the footer) and return the
 * DV-valid ones, unmasked and deduplicated. A bare 14-character token with
 * letters is only accepted next to a "CNPJ" label, since random uppercase
 * ids pass the check digits one time in a hundred.
 */
export function extractCnpjs(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(CNPJ_CANDIDATE_REGEX)) {
    const token = match[0];
    if (!isValidCnpj(token)) continue;
    const masked = /[./-]/.test(token);
    if (!masked && isAlphanumericCnpj(token)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index).toUpperCase();
      if (!before.includes("CNPJ")) continue;
    }
    out.add(normalizeCnpj(token));
  }
  return Array.from(out);
}
