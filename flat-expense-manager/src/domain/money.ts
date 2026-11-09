/**
 * All money in the app is stored and computed as integer paisa (1 Rs. = 100 paisa)
 * to avoid floating point rounding errors in financial calculations.
 */

/** Hard upper bound for a single entry: Rs. 10,000,000. Guards against typos. */
export const MAX_ENTRY_PAISA = 10_000_000 * 100;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats paisa as Pakistani Rupees, e.g. 123450 -> "Rs. 1,234.50", 100000 -> "Rs. 1,000".
 * Decimals are only shown when the amount has a fractional part.
 */
export function formatPKR(paisa: number, options: { signed?: boolean } = {}): string {
  const value = Math.round(paisa);
  const negative = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  let body = `Rs. ${groupThousands(String(rupees))}`;
  if (fraction !== 0) body += `.${String(fraction).padStart(2, '0')}`;
  if (negative) return `-${body}`;
  if (options.signed && value > 0) return `+${body}`;
  return body;
}

/**
 * Parses user input like "1,250", "1250.5" or "Rs. 99.99" into paisa.
 * Returns null for anything that is not a valid non-negative amount with at most 2 decimals.
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/rs\.?/i, '').replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const paisa = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(paisa) ? paisa : null;
}

/** Converts paisa to a plain editable string for a text input: 125000 -> "1250", 125050 -> "1250.50". */
export function paisaToInput(paisa: number): string {
  const rupees = Math.floor(paisa / 100);
  const fraction = paisa % 100;
  return fraction === 0 ? String(rupees) : `${rupees}.${String(fraction).padStart(2, '0')}`;
}

export function sumPaisa(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
