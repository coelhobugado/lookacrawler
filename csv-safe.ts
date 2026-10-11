/**
 * LookaCrawler CSV Safety Module
 * Neutralizes CSV Formula Injection (DDE) vectors to protect spreadsheets (Excel, Calc, Google Sheets).
 */

const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Sanitizes a single cell value. If the string starts with a formula trigger,
 * it prefixes it with a single quote (') to force Excel/Calc to treat it as plain text.
 */
export function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  // A number cannot carry a formula, and prefixing it turns coordinates such as
  // -16.68 into text in Excel/Sheets.
  if (typeof value === "number") {
    return String(value);
  }

  const str = String(value);
  if (str.length === 0) {
    return str;
  }

  const firstRaw = str[0];
  if (firstRaw === "\t" || firstRaw === "\r") {
    return `'${str}`;
  }

  const trimmed = str.trimStart();
  if (trimmed.length === 0) {
    return str;
  }

  if (FORMULA_PREFIXES.has(trimmed[0])) {
    return `'${str}`;
  }

  return str;
}

/**
 * Sanitizes an array of cell values forming a CSV row.
 */
export function sanitizeCsvRow(row: (string | number | boolean | null | undefined)[]): string[] {
  return row.map(sanitizeCsvCell);
}

export interface SafeCsvOptions {
  /** Prepend a UTF-8 BOM so Excel detects the encoding (accents in pt-BR). */
  bom?: boolean;
  /** Field delimiter. Excel in pt-BR and most of Europe expects ";". */
  delimiter?: "," | ";";
  /** Decimal separator for numeric cells. Excel pt-BR reads "-16,68" as a number. */
  decimalSeparator?: "." | ",";
}

// Written as a char code so the invisible character never sits in the source.
const UTF8_BOM = String.fromCharCode(0xfeff);

/** Preset for Excel with a Brazilian (or other comma-decimal) locale. */
export const EXCEL_PT_BR: SafeCsvOptions = { bom: true, delimiter: ";", decimalSeparator: "," };

/**
 * Converts headers and row data into a RFC 4180-compliant, formula-injection-safe CSV string.
 */
export function toSafeCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
  options: SafeCsvOptions = {}
): string {
  const { bom = false, delimiter = ",", decimalSeparator = "." } = options;

  function escapeField(field: string | number | boolean | null | undefined): string {
    let sanitized = sanitizeCsvCell(field);
    if (typeof field === "number" && decimalSeparator === ",") {
      sanitized = sanitized.replace(".", ",");
    }
    if (
      sanitized.includes(delimiter) ||
      sanitized.includes('"') ||
      sanitized.includes("\n") ||
      sanitized.includes("\r")
    ) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
  }

  const headerLine = headers.map(escapeField).join(delimiter);
  const rowLines = rows.map((row) => row.map((val) => escapeField(val)).join(delimiter));

  return (bom ? UTF8_BOM : "") + [headerLine, ...rowLines].join("\r\n");
}
