/** BRL text-field helpers. All editing is performed in integer cents. */
export const MAX_MONEY_CENTS = Number.MAX_SAFE_INTEGER;
const MAX_CENTS_DIGITS = String(MAX_MONEY_CENTS).length;

export function normalizeMoneyDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_CENTS_DIGITS || (digits.length === MAX_CENTS_DIGITS && Number(digits) > MAX_MONEY_CENTS)) return null;
  return digits;
}

/** No floating-point arithmetic while typing or grouping thousands. */
export function formatMoneyDigits(digits: string): string {
  if (!digits) return "";
  const padded = digits.padStart(3, "0");
  const integer = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return integer + "," + padded.slice(-2);
}

/** Domain models retain number values in reais; only input editing uses cents. */
export function moneyDigitsFromValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "";
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? String(cents) : "";
}
export function moneyValueFromDigits(digits: string): number | null {
  return digits ? Number(digits) / 100 : null;
}

/** Pasted formatted amounts use their decimal separator; digit-only paste uses cents. */
export function moneyDigitsFromPaste(text: string): string | null {
  const cleaned = text.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  const separator = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  if (separator === -1) return normalizeMoneyDigits(cleaned);
  const decimals = cleaned.slice(separator + 1);
  const whole = cleaned.slice(0, separator).replace(/[.,]/g, "");
  if (!whole || !/^\d+$/.test(whole) || !/^\d*$/.test(decimals)) return null;
  // One or two digits after a separator represent fractional reais; three
  // represent a thousands group (e.g. "1.234"). Refuse ambiguous 4+ digits.
  if (decimals.length > 3) return null;
  const cents = decimals.length === 3
    ? whole + decimals + "00"
    : whole + decimals.padEnd(2, "0");
  return normalizeMoneyDigits(cents);
}
