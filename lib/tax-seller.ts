import { isValidBranchNo, isValidThaiTaxId } from "@/lib/tax-rules";

/**
 * The store's legal details, printed on every tax invoice. Read from the environment, never hard-coded,
 * so the real company details are set on the host and not committed to the repository.
 *
 *   STORE_LEGAL_NAME    registered company name
 *   STORE_TAX_ID        13-digit tax ID of the company
 *   STORE_BRANCH_NO     5 digits, 00000 for head office (default 00000)
 *   STORE_ADDRESS       full registered address
 */
export interface SellerInfo {
  name: string;
  taxId: string;
  branch: string;
  address: string;
}

/** Returns the seller details, or null if they are missing or invalid. Issuing refuses to run without them. */
export function getSellerInfo(env: Record<string, string | undefined> = process.env): SellerInfo | null {
  const name = (env.STORE_LEGAL_NAME ?? "").trim();
  const taxId = (env.STORE_TAX_ID ?? "").trim();
  const branch = (env.STORE_BRANCH_NO ?? "00000").trim() || "00000";
  const address = (env.STORE_ADDRESS ?? "").trim();
  if (!name || !address || !isValidThaiTaxId(taxId) || !isValidBranchNo(branch)) return null;
  return { name, taxId, branch, address };
}
