/**
 * Template A: bulk creation of new products from a spreadsheet, keyed by master-data codes.
 *
 *  1. parseImportTable   pure: header matching and per-row validation. Category_Code and Color_Code are required.
 *  2. planImport         reads the database. Each code must match a master record exactly, or that row is rejected
 *                        with a clear message such as "Category Code 'CAT-01' not found".
 *  3. commitImport       writes the plan in batches (createMany) inside the caller's transaction.
 *
 * Commit re-plans inside the transaction, so nothing can change between preview and write.
 * The import is all-or-nothing: any issue blocks the whole file.
 */

import { cellText } from "@/lib/text-columns";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { randomStoreEan13 } from "@/lib/barcode";
import { BARCODE_RULE_MESSAGE, isValidBarcode } from "@/lib/barcode-rules";
import { bahtToSatang, PricingError, satangToDecimal } from "@/lib/pricing";
import { slugify } from "@/lib/slug";
import { ensureSizes } from "@/lib/catalog/sizes";
import { CODE_PATTERN, CODE_RULE_MESSAGE } from "@/lib/master-codes";

export const MAX_IMPORT_ROWS = 2000;

/** Column titles of Template A, in order. Category and colour are codes from the master-data sheet. */
export const TEMPLATE_HEADER = [
  "Barcode",
  "SKU",
  "Name_TH",
  "Name_EN",
  "Category_Code",
  "Color_Code",
  "Size",
  "Price",
  "Cost",
  "Initial_Stock",
  "Promo_Tag",
];

const EXAMPLE_PREFIX = "EXAMPLE-";

type Field =
  | "sku"
  | "name"
  | "nameTh"
  | "categoryCode"
  | "colorCode"
  | "size"
  | "price"
  | "cost"
  | "stock"
  | "barcode"
  | "promoTag"
  | "brand"
  | "description";

const HEADER_ALIASES: Record<string, Field> = {
  sku: "sku",
  barcode: "barcode",
  name: "name",
  nameen: "name",
  productname: "name",
  nameth: "nameTh",
  namethai: "nameTh",
  thainame: "nameTh",
  categorycode: "categoryCode",
  colorcode: "colorCode",
  size: "size",
  price: "price",
  unitprice: "price",
  cost: "cost",
  unitcost: "cost",
  stock: "stock",
  qty: "stock",
  quantity: "stock",
  initialstock: "stock",
  promotag: "promoTag",
  promo: "promoTag",
  brand: "brand",
  description: "description",
};

const REQUIRED_FIELDS: Field[] = ["sku", "name", "categoryCode", "colorCode", "size", "price"];
const FIELD_LABELS: Record<Field, string> = {
  sku: "SKU",
  name: "Name_EN",
  nameTh: "Name_TH",
  categoryCode: "Category_Code",
  colorCode: "Color_Code",
  size: "Size",
  price: "Price",
  cost: "Cost",
  stock: "Initial_Stock",
  barcode: "Barcode",
  promoTag: "Promo_Tag",
  brand: "Brand",
  description: "Description",
};

export interface ImportRow {
  /** Line number in the file. The header is line 1, so the first data row is line 2. */
  line: number;
  sku: string;
  name: string;
  nameTh: string | null;
  categoryCode: string;
  colorCode: string;
  size: string;
  priceSatang: number;
  /** Unit cost in satang, or null when blank. */
  costSatang: number | null;
  /** null when the Initial_Stock cell was blank. */
  stock: number | null;
  barcode: string | null;
  promoTag: string | null;
  brand: string | null;
  description: string | null;
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  issues: ImportIssue[];
  unknownColumns: string[];
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Validates the header and every row. Pure: no database access. */
export function parseImportTable(table: string[][]): ParsedImport {
  const issues: ImportIssue[] = [];
  if (table.length === 0) {
    return { rows: [], issues: [{ line: 1, message: "The file is empty." }], unknownColumns: [] };
  }

  const columnOf: Partial<Record<Field, number>> = {};
  const unknownColumns: string[] = [];
  table[0].forEach((cell, index) => {
    if (!cell.trim()) return;
    const field = HEADER_ALIASES[normalizeHeader(cell)];
    if (!field) unknownColumns.push(cell);
    else if (columnOf[field] === undefined) columnOf[field] = index;
  });

  const missing = REQUIRED_FIELDS.filter((field) => columnOf[field] === undefined);
  if (missing.length > 0) {
    return {
      rows: [],
      issues: missing.map((field) => ({ line: 1, message: `Required column "${FIELD_LABELS[field]}" is missing.` })),
      unknownColumns,
    };
  }

  const dataRows = table.slice(1);
  if (dataRows.length === 0) {
    return { rows: [], issues: [{ line: 1, message: "The file has a header but no product rows." }], unknownColumns };
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      issues: [{ line: 1, message: `The file has ${dataRows.length} rows. The limit is ${MAX_IMPORT_ROWS} per import.` }],
      unknownColumns,
    };
  }

  const rows: ImportRow[] = [];
  dataRows.forEach((cells, offset) => {
    const line = offset + 2;
    const get = (field: Field): string => {
      const index = columnOf[field];
      return index === undefined ? "" : cellText(cells[index]);
    };
    const problems: string[] = [];

    const sku = get("sku").toUpperCase();
    if (sku.startsWith(EXAMPLE_PREFIX)) problems.push("This is the example row from the template. Delete it, then upload again.");
    else if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku)) problems.push("SKU must be 1 to 40 letters, digits, dots, dashes or underscores.");

    const name = get("name");
    if (!name) problems.push("Name_EN is required.");
    else if (name.length > 150) problems.push("Name_EN is longer than 150 characters.");

    const categoryCode = get("categoryCode").toUpperCase();
    if (!categoryCode) problems.push("Category_Code is required.");
    else if (!CODE_PATTERN.test(categoryCode)) problems.push(`Category_Code '${categoryCode}': ${CODE_RULE_MESSAGE}`);

    const colorCode = get("colorCode").toUpperCase();
    if (!colorCode) problems.push("Color_Code is required.");
    else if (!CODE_PATTERN.test(colorCode)) problems.push(`Color_Code '${colorCode}': ${CODE_RULE_MESSAGE}`);

    const size = get("size");
    if (!size) problems.push("Size is required.");
    else if (size.length > 20) problems.push("Size is longer than 20 characters.");

    let priceSatang = 0;
    const priceText = get("price").replace(/[,฿\s]/g, "");
    if (!priceText) {
      problems.push("Price is required.");
    } else {
      try {
        priceSatang = bahtToSatang(priceText);
        if (priceSatang <= 0) problems.push("Price must be greater than zero.");
        else if (priceSatang > 100_000_000) problems.push("Price is too large.");
      } catch (err) {
        if (err instanceof PricingError) problems.push("Price must be a number with at most 2 decimals.");
        else throw err;
      }
    }

    let costSatang: number | null = null;
    const costText = get("cost").replace(/[,฿\s]/g, "");
    if (costText) {
      try {
        costSatang = bahtToSatang(costText);
        if (costSatang > 100_000_000) problems.push("Cost is too large.");
      } catch (err) {
        if (err instanceof PricingError) problems.push("Cost must be a number with at most 2 decimals.");
        else throw err;
      }
    }

    let stock: number | null = null;
    const stockText = get("stock");
    if (stockText !== "") {
      if (!/^\d+(\.0+)?$/.test(stockText)) problems.push("Initial_Stock must be a whole number of 0 or more.");
      else {
        stock = Math.trunc(Number(stockText));
        if (stock > 100_000) problems.push("Initial_Stock is too large (maximum 100000).");
      }
    }

    const barcodeText = get("barcode");
    let barcode: string | null = null;
    if (barcodeText) {
      if (!isValidBarcode(barcodeText)) problems.push(BARCODE_RULE_MESSAGE);
      else barcode = barcodeText;
    }

    const promoTag = get("promoTag") || null;
    if (promoTag && promoTag.length > 30) problems.push("Promo_Tag is longer than 30 characters.");

    const nameTh = get("nameTh") || null;
    if (nameTh && nameTh.length > 150) problems.push("Name_TH is longer than 150 characters.");
    const brand = get("brand") || null;
    if (brand && brand.length > 80) problems.push("Brand is longer than 80 characters.");
    const description = get("description") || null;
    if (description && description.length > 2000) problems.push("Description is longer than 2000 characters.");

    if (problems.length > 0) {
      for (const message of problems) issues.push({ line, message });
      return;
    }

    rows.push({
      line,
      sku,
      name,
      nameTh,
      categoryCode,
      colorCode,
      size,
      priceSatang,
      costSatang,
      stock,
      barcode,
      promoTag,
      brand,
      description,
    });
  });

  // Duplicates inside the file. A product is identified by its name, so its rows must agree on the category.
  const skuLine = new Map<string, number>();
  const barcodeLine = new Map<string, number>();
  const variantLine = new Map<string, number>();
  const productCategory = new Map<string, { code: string; line: number }>();
  for (const row of rows) {
    const firstSku = skuLine.get(row.sku);
    if (firstSku !== undefined) issues.push({ line: row.line, message: `SKU ${row.sku} is already on line ${firstSku}.` });
    else skuLine.set(row.sku, row.line);

    if (row.barcode) {
      const firstBarcode = barcodeLine.get(row.barcode);
      if (firstBarcode !== undefined) issues.push({ line: row.line, message: `Barcode ${row.barcode} already appears on line ${firstBarcode}.` });
      else barcodeLine.set(row.barcode, row.line);
    }

    const variantKey = `${slugify(row.name)}|${row.size.toLowerCase()}|${row.colorCode}`;
    const firstVariant = variantLine.get(variantKey);
    if (firstVariant !== undefined) issues.push({ line: row.line, message: `${row.name} in size ${row.size} / ${row.colorCode} is already on line ${firstVariant}.` });
    else variantLine.set(variantKey, row.line);

    const slug = slugify(row.name);
    const claimed = productCategory.get(slug);
    if (claimed && claimed.code !== row.categoryCode) {
      issues.push({ line: row.line, message: `${row.name} is listed under ${claimed.code} on line ${claimed.line} and under ${row.categoryCode} here. Use one category.` });
    } else if (!claimed) {
      productCategory.set(slug, { code: row.categoryCode, line: row.line });
    }
  }

  return { rows, issues, unknownColumns };
}

export interface ImportOptions {
  /** What to do when a SKU already exists: keep it, or update its price, cost, promo tag and photo details. */
  onExisting: "skip" | "update";
  /** For existing SKUs, set stock to the file's Initial_Stock value (written to the ledger as an adjustment). */
  applyStock: boolean;
}

export interface PlannedProduct {
  id: string;
  slug: string;
  name: string;
  nameTh: string | null;
  brand: string | null;
  description: string | null;
  categoryId: string;
  promoTag: string | null;
}

export interface PlannedVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string;
  size: string;
  colorId: string;
  colorName: string;
  priceSatang: number;
  costSatang: number | null;
  stock: number;
  line: number;
}

export interface PlannedUpdate {
  line: number;
  variantId: string;
  productId: string;
  sku: string;
  priceBeforeSatang: number;
  priceAfterSatang: number;
  /** null leaves the cost unchanged. */
  costAfterSatang: number | null;
  barcode: string | null;
  productPatch: { nameTh?: string; brand?: string; description?: string; promoTag?: string };
  stockChange: { before: number; after: number } | null;
}

export interface ImportSummary {
  rows: number;
  newProducts: number;
  newVariants: number;
  updatedVariants: number;
  skippedVariants: number;
  stockMovements: number;
  newSizes: number;
}

export interface ImportPlan {
  summary: ImportSummary;
  issues: ImportIssue[];
  products: PlannedProduct[];
  variants: PlannedVariant[];
  updates: PlannedUpdate[];
  sizes: string[];
  skipped: { line: number; sku: string }[];
}

/**
 * Compares every row with the database. Each Category_Code and Color_Code must match a master record exactly;
 * a row that does not is rejected with the code in the message. Read-only.
 */
export async function planImport(db: Prisma.TransactionClient, rows: ImportRow[], options: ImportOptions): Promise<ImportPlan> {
  const issues: ImportIssue[] = [];
  const skus = Array.from(new Set(rows.map((row) => row.sku)));
  const productSlugs = Array.from(new Set(rows.map((row) => slugify(row.name))));
  const fileBarcodes = rows.map((row) => row.barcode).filter((value): value is string => value !== null);

  const [existingVariants, categories, colors, sizes, existingProducts, barcodeOwners] = await Promise.all([
    db.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true, size: true, colorId: true, colorRef: { select: { name: true } }, price: true, stockQuantity: true, productId: true },
    }),
    db.category.findMany({ select: { id: true, code: true, name: true } }),
    db.color.findMany({ select: { id: true, code: true, name: true } }),
    db.size.findMany({ select: { name: true } }),
    db.product.findMany({
      where: { slug: { in: productSlugs } },
      select: {
        id: true,
        slug: true,
        categoryId: true,
        variants: { select: { sku: true, size: true, colorId: true } },
      },
    }),
    fileBarcodes.length > 0
      ? db.productVariant.findMany({ where: { barcode: { in: fileBarcodes } }, select: { sku: true, barcode: true } })
      : Promise.resolve([] as { sku: string; barcode: string }[]),
  ]);

  const variantBySku = new Map(existingVariants.map((variant) => [variant.sku, variant]));
  const barcodeOwner = new Map(barcodeOwners.map((entry) => [entry.barcode, entry.sku]));
  const productBySlug = new Map(existingProducts.map((product) => [product.slug, product]));
  const categoryByCode = new Map(categories.map((category) => [category.code, category]));
  const colorByCode = new Map(colors.map((color) => [color.code, color]));
  const knownSizes = new Set(sizes.map((size) => size.name.toLowerCase()));

  const newProducts = new Map<string, PlannedProduct>();
  const variants: PlannedVariant[] = [];
  const updates: PlannedUpdate[] = [];
  const skipped: { line: number; sku: string }[] = [];
  const newSizes = new Map<string, string>();
  const usedBarcodes = new Set<string>(barcodeOwners.map((entry) => entry.barcode));
  for (const code of fileBarcodes) usedBarcodes.add(code);
  const needsBarcode: PlannedVariant[] = [];

  for (const row of rows) {
    const category = categoryByCode.get(row.categoryCode);
    if (!category) {
      issues.push({ line: row.line, message: `Category Code '${row.categoryCode}' not found. Check the Master_Data_Codes sheet.` });
      continue;
    }
    const color = colorByCode.get(row.colorCode);
    if (!color) {
      issues.push({ line: row.line, message: `Color Code '${row.colorCode}' not found. Check the Master_Data_Codes sheet.` });
      continue;
    }

    const existing = variantBySku.get(row.sku);
    if (existing) {
      if (existing.colorId !== color.id) {
        issues.push({ line: row.line, message: `SKU ${row.sku} already exists in colour ${existing.colorRef.name}, not ${color.name}. Change the colour on the product page.` });
        continue;
      }
      if (options.onExisting === "skip") {
        skipped.push({ line: row.line, sku: row.sku });
        continue;
      }
      const currentStock = existing.stockQuantity;
      updates.push({
        line: row.line,
        variantId: existing.id,
        productId: existing.productId,
        sku: row.sku,
        priceBeforeSatang: Math.round(Number(existing.price) * 100),
        priceAfterSatang: row.priceSatang,
        costAfterSatang: row.costSatang,
        barcode: row.barcode,
        productPatch: {
          ...(row.nameTh ? { nameTh: row.nameTh } : {}),
          ...(row.brand ? { brand: row.brand } : {}),
          ...(row.description ? { description: row.description } : {}),
          ...(row.promoTag ? { promoTag: row.promoTag } : {}),
        },
        stockChange: options.applyStock && row.stock !== null && row.stock !== currentStock ? { before: currentStock, after: row.stock } : null,
      });
      continue;
    }

    // A new SKU. Its barcode must not belong to another variant.
    if (row.barcode && barcodeOwner.has(row.barcode)) {
      issues.push({ line: row.line, message: `Barcode ${row.barcode} already belongs to SKU ${barcodeOwner.get(row.barcode)}.` });
      continue;
    }

    const slug = slugify(row.name);
    const existingProduct = productBySlug.get(slug);
    let productId: string;

    if (existingProduct) {
      if (existingProduct.categoryId !== category.id) {
        issues.push({ line: row.line, message: `${row.name} already exists in a different category. Use its current Category_Code.` });
        continue;
      }
      const clash = existingProduct.variants.find(
        (variant) => variant.size.toLowerCase() === row.size.toLowerCase() && variant.colorId === color.id,
      );
      if (clash) {
        issues.push({ line: row.line, message: `${row.name} in size ${row.size} / ${color.name} already exists as SKU ${clash.sku}.` });
        continue;
      }
      productId = existingProduct.id;
    } else {
      let planned = newProducts.get(slug);
      if (!planned) {
        planned = {
          id: randomUUID(),
          slug,
          name: row.name,
          nameTh: row.nameTh,
          brand: row.brand,
          description: row.description,
          categoryId: category.id,
          promoTag: row.promoTag,
        };
        newProducts.set(slug, planned);
      } else if (row.promoTag && !planned.promoTag) {
        planned.promoTag = row.promoTag;
      }
      productId = planned.id;
    }

    if (!knownSizes.has(row.size.toLowerCase()) && !newSizes.has(row.size.toLowerCase())) newSizes.set(row.size.toLowerCase(), row.size);

    const planned: PlannedVariant = {
      id: randomUUID(),
      productId,
      sku: row.sku,
      barcode: row.barcode ?? "",
      size: row.size,
      colorId: color.id,
      colorName: color.name,
      priceSatang: row.priceSatang,
      costSatang: row.costSatang,
      stock: row.stock ?? 0,
      line: row.line,
    };
    variants.push(planned);
    if (!row.barcode) needsBarcode.push(planned);
  }

  // Give blank barcodes a unique store-issued EAN-13, checking against the database too.
  for (let round = 0; round < 4 && needsBarcode.some((variant) => variant.barcode === ""); round += 1) {
    const pending = needsBarcode.filter((variant) => variant.barcode === "");
    const candidates = pending.map(() => {
      let code = randomStoreEan13();
      while (usedBarcodes.has(code)) code = randomStoreEan13();
      usedBarcodes.add(code);
      return code;
    });
    const taken = await db.productVariant.findMany({ where: { barcode: { in: candidates } }, select: { barcode: true } });
    const takenSet = new Set(taken.map((entry) => entry.barcode));
    pending.forEach((variant, index) => {
      if (!takenSet.has(candidates[index])) variant.barcode = candidates[index];
    });
  }
  for (const variant of needsBarcode) {
    if (variant.barcode === "") issues.push({ line: variant.line, message: "Could not generate a unique barcode. Try again." });
  }

  const sizeNames = Array.from(newSizes.values());
  const summary: ImportSummary = {
    rows: rows.length,
    newProducts: newProducts.size,
    newVariants: variants.length,
    updatedVariants: updates.length,
    skippedVariants: skipped.length,
    stockMovements:
      variants.filter((variant) => variant.stock > 0).length + updates.filter((update) => update.stockChange !== null).length,
    newSizes: sizeNames.length,
  };

  return {
    summary,
    issues: issues.sort((a, b) => a.line - b.line),
    products: Array.from(newProducts.values()),
    variants,
    updates,
    sizes: sizeNames,
    skipped,
  };
}

/** Writes a clean plan. Batches with createMany, so a 2000-row file is a handful of statements. */
export async function commitImport(tx: Prisma.TransactionClient, plan: ImportPlan, userId: string, fileName: string): Promise<void> {
  await ensureSizes(tx, plan.sizes);
  if (plan.products.length > 0) {
    await tx.product.createMany({
      data: plan.products.map((p) => ({
        id: p.id,
        name: p.name,
        nameTh: p.nameTh,
        slug: p.slug,
        brand: p.brand,
        description: p.description,
        categoryId: p.categoryId,
        promoTag: p.promoTag,
      })),
    });
  }
  if (plan.variants.length > 0) {
    await tx.productVariant.createMany({
      data: plan.variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        size: v.size,
        color: v.colorName,
        colorId: v.colorId,
        sku: v.sku,
        barcode: v.barcode,
        price: satangToDecimal(v.priceSatang),
        cost: v.costSatang === null ? null : satangToDecimal(v.costSatang),
        stockQuantity: v.stock,
      })),
    });
  }

  const reference = `import:${fileName}`.slice(0, 100);
  const movements: Prisma.InventoryMovementCreateManyInput[] = [];
  for (const variant of plan.variants) {
    if (variant.stock > 0) {
      movements.push({
        variantId: variant.id,
        type: "STOCK_IN",
        quantityChange: variant.stock,
        stockBefore: 0,
        stockAfter: variant.stock,
        reference,
        note: "Bulk import",
        userId,
      });
    }
  }

  for (const update of plan.updates) {
    await tx.productVariant.update({
      where: { id: update.variantId },
      data: {
        price: satangToDecimal(update.priceAfterSatang),
        ...(update.costAfterSatang !== null ? { cost: satangToDecimal(update.costAfterSatang) } : {}),
        ...(update.barcode ? { barcode: update.barcode } : {}),
        ...(update.stockChange ? { stockQuantity: update.stockChange.after } : {}),
      },
    });
    if (Object.keys(update.productPatch).length > 0) {
      await tx.product.update({ where: { id: update.productId }, data: update.productPatch });
    }
    if (update.stockChange) {
      movements.push({
        variantId: update.variantId,
        type: "ADJUSTMENT",
        reasonCode: "COUNT_CORRECTION",
        quantityChange: update.stockChange.after - update.stockChange.before,
        stockBefore: update.stockChange.before,
        stockAfter: update.stockChange.after,
        reference,
        note: "Bulk import stock count",
        userId,
      });
    }
  }

  for (let start = 0; start < movements.length; start += 500) {
    await tx.inventoryMovement.createMany({ data: movements.slice(start, start + 500) });
  }

  await tx.auditLog.create({
    data: {
      action: "CATALOG_IMPORT",
      entityType: "Catalog",
      entityId: reference,
      userId,
      details: { ...plan.summary, fileName },
    },
  });
}
