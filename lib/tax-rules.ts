/**
 * Thai tax rules: VAT and tax ID checks. Client-safe, pure functions, all money in satang.
 *
 * ASSUMPTION: shelf prices are VAT-inclusive (the usual practice for Thai retail). VAT is extracted from
 * the total as total x 7 / 107. The accountant must confirm this before the figures are filed.
 */

export const VAT_PERCENT = 7;

/** VAT contained in a VAT-inclusive amount, rounded to the nearest satang. */
export function vatFromInclusiveSatang(amountSatang: number): number {
  return Math.round((amountSatang * VAT_PERCENT) / (100 + VAT_PERCENT));
}

/**
 * Splits a VAT-inclusive total into the amount before VAT and the VAT inside it, in satang.
 *   vat = total x 7 / 107, rounded to the satang. net = total - vat.
 * The net is the total minus the VAT, not rounded on its own, so net + vat equals the total exactly.
 */
export function splitInclusiveVat(totalSatang: number): { netSatang: number; vatSatang: number } {
  const vatSatang = vatFromInclusiveSatang(totalSatang);
  return { netSatang: totalSatang - vatSatang, vatSatang };
}

/**
 * Checks a 13-digit Thai tax ID, including its check digit. Limit: a single wrong digit in the third position is not
 * detectable, since that digit's weight (11) is 0 mod 11. Staff should compare the ID with the buyer's card.
 * Weights are 13 down to 2 on the first 12 digits;
 * the check digit is (11 - sum mod 11) mod 10.
 */
export function isValidThaiTaxId(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(value[index]) * (13 - index);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(value[12]);
}

/** Head office is branch 00000. Other branches use their 5-digit number. */
export function isValidBranchNo(value: string): boolean {
  return /^\d{5}$/.test(value);
}

export function branchLabel(branch: string | null | undefined): string {
  if (!branch || branch === "00000") return "สำนักงานใหญ่";
  return `สาขาที่ ${branch}`;
}

/** Tax invoice number: TI-YYYYMM-NNNNN, numbered from 1 each month. */
export function taxInvoicePrefix(yearMonth: string): string {
  return `TI-${yearMonth.replace("-", "")}-`;
}

export function formatTaxInvoiceNumber(yearMonth: string, sequence: number): string {
  return `${taxInvoicePrefix(yearMonth)}${String(sequence).padStart(5, "0")}`;
}
