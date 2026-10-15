import { Prisma } from "@prisma/client";
import { bahtToSatang, PricingError, satangToDecimal } from "@/lib/pricing";
import { isValidBarcode, BARCODE_RULE_MESSAGE } from "@/lib/barcode-rules";

/**
 * Template B: bulk price and promo-tag update, keyed by barcode.
 * A blank New_Price or Promo_Tag cell keeps the current value. The file is checked first and written all or nothing.
 */

export const PRICE_TEMPLATE_HEADER = ["Barcode", "New_Price", "Promo_Tag"];
export const MAX_PRICE_ROWS = 2000;
const EXAMPLE_PREFIX = "EXAMPLE-";

type Field = "barcode" | "newPrice" | "promoTag";
const ALIASES: Record<string, Field> = {
  barcode: "barcode",
  newprice: "newPrice",
  price: "newPrice",
  promotag: "promoTag",
  promo: "promoTag",
};

export interface PriceRow {
  line: number;
  barcode: string;
  /** null keeps the current price. */
  priceSatang: number | null;
  /** null keeps the current tag. */
  promoTag: string | null;
}

export interface PriceIssue {
  line: number;
  message: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parsePriceTable(table: string[][]): { rows: PriceRow[]; issues: PriceIssue[]; unknownColumns: string[] } {
  if (table.length === 0) return { rows: [], issues: [{ line: 1, message: "The file is empty." }], unknownColumns: [] };
  const columnOf: Partial<Record<Field, number>> = {};
  const unknownColumns: string[] = [];
  table[0].forEach((cell, index) => {
    if (!cell.trim()) return;
    const field = ALIASES[normalize(cell)];
    if (!field) unknownColumns.push(cell);
    else if (columnOf[field] === undefined) columnOf[field] = index;
  });

  const issues: PriceIssue[] = [];
  if (columnOf.barcode === undefined) issues.push({ line: 1, message: 'Required column "Barcode" is missing.' });
  if (columnOf.newPrice === undefined && columnOf.promoTag === undefined) {
    issues.push({ line: 1, message: 'Add a "New_Price" or "Promo_Tag" column.' });
  }
  if (issues.length > 0) return { rows: [], issues, unknownColumns };

  const dataRows = table.slice(1);
  if (dataRows.length === 0) return { rows: [], issues: [{ line: 1, message: "The file has a header but no rows." }], unknownColumns };
  if (dataRows.length > MAX_PRICE_ROWS) {
    return { rows: [], issues: [{ line: 1, message: `The file has ${dataRows.length} rows. The limit is ${MAX_PRICE_ROWS}.` }], unknownColumns };
  }

  const rows: PriceRow[] = [];
  dataRows.forEach((cells, offset) => {
    const line = offset + 2;
    const get = (field: Field) => {
      const index = columnOf[field];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    const problems: string[] = [];
    const barcode = get("barcode");
    if (!barcode) problems.push("Barcode is required.");
    else if (barcode.startsWith(EXAMPLE_PREFIX)) problems.push("This is the example row from the template. Delete it, then upload again.");
    else if (!isValidBarcode(barcode)) problems.push(BARCODE_RULE_MESSAGE);

    let priceSatang: number | null = null;
    const priceText = get("newPrice").replace(/[,฿\s]/g, "");
    if (priceText) {
      try {
        priceSatang = bahtToSatang(priceText);
        if (priceSatang <= 0) problems.push("New_Price must be greater than zero.");
        else if (priceSatang > 100_000_000) problems.push("New_Price is too large.");
      } catch (err) {
        if (err instanceof PricingError) problems.push("New_Price must be a number with at most 2 decimals.");
        else throw err;
      }
    }

    const promoTag = get("promoTag") || null;
    if (promoTag && promoTag.length > 30) problems.push("Promo_Tag is longer than 30 characters.");
    if (priceSatang === null && promoTag === null && problems.length === 0) problems.push("Nothing to change on this row. Fill New_Price or Promo_Tag.");

    if (problems.length > 0) {
      for (const message of problems) issues.push({ line, message });
      return;
    }
    rows.push({ line, barcode, priceSatang, promoTag });
  });

  const seen = new Map<string, number>();
  for (const row of rows) {
    const first = seen.get(row.barcode);
    if (first !== undefined) issues.push({ line: row.line, message: `Barcode ${row.barcode} is already on line ${first}.` });
    else seen.set(row.barcode, row.line);
  }
  return { rows, issues, unknownColumns };
}

export interface PriceChange {
  line: number;
  variantId: string;
  productId: string;
  sku: string;
  barcode: string;
  priceBeforeSatang: number;
  /** null when the price is unchanged or blank. */
  priceAfterSatang: number | null;
  promoBefore: string | null;
  /** null when the tag is blank or unchanged. */
  promoAfter: string | null;
}

export interface PricePlan {
  changes: PriceChange[];
  unchanged: number;
  issues: PriceIssue[];
}

/** Looks up each barcode and works out what would change. Reads only. */
export async function planPriceChanges(db: Prisma.TransactionClient, rows: PriceRow[]): Promise<PricePlan> {
  const variants = await db.productVariant.findMany({
    where: { barcode: { in: rows.map((row) => row.barcode) } },
    select: {
      id: true,
      sku: true,
      barcode: true,
      price: true,
      isActive: true,
      productId: true,
      product: { select: { promoTag: true, isActive: true } },
    },
  });
  const byBarcode = new Map(variants.map((variant) => [variant.barcode, variant]));
  const issues: PriceIssue[] = [];
  const changes: PriceChange[] = [];
  const tagByProduct = new Map<string, { tag: string; line: number }>();
  let unchanged = 0;

  for (const row of rows) {
    const variant = byBarcode.get(row.barcode);
    if (!variant) {
      issues.push({ line: row.line, message: `No product has barcode ${row.barcode}. Add it with the New Products template first.` });
      continue;
    }
    const before = Math.round(Number(variant.price) * 100);
    const priceAfter = row.priceSatang !== null && row.priceSatang !== before ? row.priceSatang : null;
    if (row.promoTag !== null) {
      const claimed = tagByProduct.get(variant.productId);
      if (claimed && claimed.tag !== row.promoTag) {
        issues.push({ line: row.line, message: `${variant.sku} shares a product with line ${claimed.line}, which sets a different Promo_Tag.` });
        continue;
      }
      tagByProduct.set(variant.productId, { tag: row.promoTag, line: row.line });
    }
    const promoAfter = row.promoTag !== null && row.promoTag !== variant.product.promoTag ? row.promoTag : null;
    if (priceAfter === null && promoAfter === null) {
      unchanged += 1;
      continue;
    }
    changes.push({
      line: row.line,
      variantId: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      barcode: variant.barcode,
      priceBeforeSatang: before,
      priceAfterSatang: priceAfter,
      promoBefore: variant.product.promoTag,
      promoAfter,
    });
  }
  return { changes, unchanged, issues };
}

/** Writes the price and tag changes and one audit entry. Call inside a serializable transaction. */
export async function commitPriceChanges(tx: Prisma.TransactionClient, plan: PricePlan, userId: string, fileName: string): Promise<void> {
  for (const change of plan.changes) {
    if (change.priceAfterSatang !== null) {
      await tx.productVariant.update({ where: { id: change.variantId }, data: { price: satangToDecimal(change.priceAfterSatang) } });
    }
    if (change.promoAfter !== null) {
      await tx.product.update({ where: { id: change.productId }, data: { promoTag: change.promoAfter } });
    }
  }
  await tx.auditLog.create({
    data: {
      action: "PRICE_PROMO_IMPORT",
      entityType: "ProductVariant",
      entityId: fileName.slice(0, 100),
      userId,
      reason: `${plan.changes.length} changed, ${plan.unchanged} unchanged`,
      details: {
        fileName,
        changes: plan.changes.slice(0, 500).map((c) => ({
          sku: c.sku,
          barcode: c.barcode,
          price: c.priceAfterSatang === null ? null : [satangToDecimal(c.priceBeforeSatang), satangToDecimal(c.priceAfterSatang)],
          promoTag: c.promoAfter === null ? null : [c.promoBefore, c.promoAfter],
        })),
      },
    },
  });
}

export function summarizePrice(plan: PricePlan) {
  return {
    changed: plan.changes.length,
    priceChanges: plan.changes.filter((c) => c.priceAfterSatang !== null).length,
    tagChanges: plan.changes.filter((c) => c.promoAfter !== null).length,
    unchanged: plan.unchanged,
  };
}
