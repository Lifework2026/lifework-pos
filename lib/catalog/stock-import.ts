import { cellText } from "@/lib/text-columns";
import { Prisma, type MovementType, type StockReason } from "@prisma/client";
import { isValidBarcode, BARCODE_RULE_MESSAGE } from "@/lib/barcode-rules";

/**
 * Template C: bulk stock movements, keyed by barcode.
 *   Restock  Quantity_Change must be above 0. Written as a received shipment (STOCK_IN).
 *   Damage   Quantity_Change must be below 0. Written as an adjustment with reason DAMAGED.
 *   Count    Quantity_Change is any non-zero number. Written as an adjustment with reason COUNT_CORRECTION.
 * Every row is written to the inventory ledger with its reason. The file is all or nothing: a row that would take
 * stock below zero stops the whole import.
 */

export const STOCK_TEMPLATE_HEADER = ["Barcode", "Quantity_Change", "Reason"];
export const MAX_STOCK_ROWS = 2000;
const EXAMPLE_PREFIX = "EXAMPLE-";

export type StockReasonName = "Restock" | "Damage" | "Count";
const REASONS: Record<string, StockReasonName> = {
  restock: "Restock",
  damage: "Damage",
  damaged: "Damage",
  count: "Count",
  countcorrection: "Count",
};

/** How each reason is written to the ledger. */
export function movementFor(reason: StockReasonName): { type: MovementType; reasonCode: StockReason | null } {
  if (reason === "Restock") return { type: "STOCK_IN", reasonCode: null };
  if (reason === "Damage") return { type: "ADJUSTMENT", reasonCode: "DAMAGED" };
  return { type: "ADJUSTMENT", reasonCode: "COUNT_CORRECTION" };
}

export interface StockRow {
  line: number;
  barcode: string;
  quantityChange: number;
  reason: StockReasonName;
}

export interface StockIssue {
  line: number;
  message: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Pure: checks the file shape and each row. Stock levels are checked later against the database. */
export function parseStockTable(table: string[][]): { rows: StockRow[]; issues: StockIssue[]; unknownColumns: string[] } {
  if (table.length === 0) return { rows: [], issues: [{ line: 1, message: "The file is empty." }], unknownColumns: [] };
  const columns: Partial<Record<"barcode" | "quantity" | "reason", number>> = {};
  const unknownColumns: string[] = [];
  table[0].forEach((cell, index) => {
    if (!cell.trim()) return;
    const key = normalize(cell);
    const field = key === "barcode" ? "barcode" : ["quantitychange", "quantity", "qty"].includes(key) ? "quantity" : key === "reason" ? "reason" : null;
    if (!field) unknownColumns.push(cell);
    else if (columns[field] === undefined) columns[field] = index;
  });

  const issues: StockIssue[] = [];
  for (const [field, label] of [["barcode", "Barcode"], ["quantity", "Quantity_Change"], ["reason", "Reason"]] as const) {
    if (columns[field] === undefined) issues.push({ line: 1, message: `Required column "${label}" is missing.` });
  }
  if (issues.length > 0) return { rows: [], issues, unknownColumns };

  const dataRows = table.slice(1);
  if (dataRows.length === 0) return { rows: [], issues: [{ line: 1, message: "The file has a header but no rows." }], unknownColumns };
  if (dataRows.length > MAX_STOCK_ROWS) {
    return { rows: [], issues: [{ line: 1, message: `The file has ${dataRows.length} rows. The limit is ${MAX_STOCK_ROWS}.` }], unknownColumns };
  }

  const rows: StockRow[] = [];
  dataRows.forEach((cells, offset) => {
    const line = offset + 2;
    const get = (field: "barcode" | "quantity" | "reason") => {
      const index = columns[field];
      return index === undefined ? "" : cellText(cells[index]);
    };
    const problems: string[] = [];
    const barcode = get("barcode");
    if (!barcode) problems.push("Barcode is required.");
    else if (barcode.startsWith(EXAMPLE_PREFIX)) problems.push("This is the example row from the template. Delete it, then upload again.");
    else if (!isValidBarcode(barcode)) problems.push(BARCODE_RULE_MESSAGE);

    const quantityText = get("quantity").replace(/\s/g, "");
    let quantity = 0;
    let quantityValid = false;
    if (!/^[+-]?\d+$/.test(quantityText)) problems.push("Quantity_Change must be a whole number, for example 5 or -2.");
    else if (Math.abs(Number(quantityText)) > 100_000) problems.push("Quantity_Change is too large (maximum 100000).");
    else {
      quantity = Number(quantityText);
      quantityValid = true;
    }

    const reason = REASONS[normalize(get("reason"))];
    if (!reason) problems.push("Reason must be Restock, Damage or Count.");
    else if (quantityValid) {
      if (reason === "Restock" && quantity <= 0) problems.push("Restock must add units (Quantity_Change above 0).");
      if (reason === "Damage" && quantity >= 0) problems.push("Damage must remove units (Quantity_Change below 0).");
      if (reason === "Count" && quantity === 0) problems.push("Count must not be zero.");
    }

    if (problems.length > 0) {
      for (const message of problems) issues.push({ line, message });
      return;
    }
    rows.push({ line, barcode, quantityChange: quantity, reason: reason! });
  });
  return { rows, issues, unknownColumns };
}

export interface StockPlanLine {
  line: number;
  variantId: string;
  sku: string;
  barcode: string;
  quantityChange: number;
  reason: StockReasonName;
  stockBefore: number;
  stockAfter: number;
}

export interface StockPlan {
  lines: StockPlanLine[];
  issues: StockIssue[];
}

/**
 * Looks up each barcode and walks the rows in order, so two rows for the same product are checked against the
 * stock left after the first. Reads only.
 */
export async function planStockChanges(db: Prisma.TransactionClient, rows: StockRow[]): Promise<StockPlan> {
  const variants = await db.productVariant.findMany({
    where: { barcode: { in: rows.map((row) => row.barcode) } },
    select: { id: true, sku: true, barcode: true, isActive: true, stockQuantity: true, product: { select: { isActive: true } } },
  });
  const byBarcode = new Map(variants.map((variant) => [variant.barcode, variant]));
  const running = new Map(variants.map((variant) => [variant.id, variant.stockQuantity]));
  const issues: StockIssue[] = [];
  const lines: StockPlanLine[] = [];

  for (const row of rows) {
    const variant = byBarcode.get(row.barcode);
    if (!variant) {
      issues.push({ line: row.line, message: `No product has barcode ${row.barcode}.` });
      continue;
    }
    if (!variant.isActive || !variant.product.isActive) {
      issues.push({ line: row.line, message: `${variant.sku} is inactive and cannot be stocked.` });
      continue;
    }
    const before = running.get(variant.id) ?? 0;
    const after = before + row.quantityChange;
    if (after < 0) {
      issues.push({ line: row.line, message: `Not enough stock of ${variant.sku}: ${before} on hand, ${-row.quantityChange} requested.` });
      continue;
    }
    running.set(variant.id, after);
    lines.push({
      line: row.line,
      variantId: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      quantityChange: row.quantityChange,
      reason: row.reason,
      stockBefore: before,
      stockAfter: after,
    });
  }
  return { lines, issues };
}

/** Writes each movement with its reason, in file order. Call inside a serializable transaction. */
export async function commitStockChanges(tx: Prisma.TransactionClient, plan: StockPlan, userId: string, fileName: string): Promise<void> {
  const reference = `import:${fileName}`.slice(0, 100);
  for (const line of plan.lines) {
    const result = await tx.productVariant.updateMany({
      where: { id: line.variantId, stockQuantity: { gte: Math.max(0, -line.quantityChange) } },
      data: { stockQuantity: { increment: line.quantityChange } },
    });
    if (result.count !== 1) {
      throw new Error(`Stock of ${line.sku} changed during the import. Nothing was saved.`);
    }
    const { type, reasonCode } = movementFor(line.reason);
    await tx.inventoryMovement.create({
      data: {
        variantId: line.variantId,
        type,
        reasonCode,
        quantityChange: line.quantityChange,
        stockBefore: line.stockBefore,
        stockAfter: line.stockAfter,
        reference,
        note: `Bulk import: ${line.reason} (line ${line.line})`,
        userId,
      },
    });
  }
}

export function summarizeStock(plan: StockPlan) {
  const byReason = { Restock: 0, Damage: 0, Count: 0 } as Record<StockReasonName, number>;
  for (const line of plan.lines) byReason[line.reason] += 1;
  return {
    rows: plan.lines.length,
    units: plan.lines.reduce((sum, line) => sum + line.quantityChange, 0),
    ...byReason,
  };
}
