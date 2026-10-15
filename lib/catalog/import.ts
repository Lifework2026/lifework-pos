/**
 * Bulk product import from a table of strings (parsed from .xlsx or .csv).
 *
 *  1. parseImportTable   pure: header matching and per-row validation
 *  2. planImport         reads the database: decides what is new, updated, skipped or conflicting
 *  3. commitImport       writes the plan in batches (createMany) inside the caller's transaction
 *
 * Commit re-plans inside the transaction, so nothing can change between preview and write.
 * The import is all-or-nothing: any issue blocks the whole file.
 */

import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { randomStoreEan13 } from "@/lib/barcode";
import { BARCODE_RULE_MESSAGE, isValidBarcode } from "@/lib/barcode-rules";
import { bahtToSatang, PricingError, satangToDecimal } from "@/lib/pricing";
import { slugify } from "@/lib/slug";

export const MAX_IMPORT_ROWS = 2000;
export const DEFAULT_COLOR = "Standard";

/** Column titles written into the downloadable template. Order matters for the template only. */
export const TEMPLATE_HEADER = [
  "SKU",
  "Name",
  "Category",
  "Size",
  "Price",
  "Stock",
  "Color",
  "Barcode",
  "Brand",
  "Name (Thai)",
  "Category (Thai)",
  "Description",
];

export const TEMPLATE_EXAMPLE_ROWS: string[][] = [
  ["TEE-WHT-S", "Basic Cotton Tee", "Shirts", "S", "390", "10", "White", "", "Lifework", "เสื้อยืดคอตตอนเบสิก", "เสื้อ", "Soft everyday tee"],
  ["TEE-WHT-M", "Basic Cotton Tee", "Shirts", "M", "390", "15", "White", "", "Lifework", "เสื้อยืดคอตตอนเบสิก", "เสื้อ", ""],
  ["TEE-BLK-M", "Basic Cotton Tee", "Shirts", "M", "390", "12", "Black", "", "Lifework", "เสื้อยืดคอตตอนเบสิก", "เสื้อ", ""],
  ["PNT-KHK-30", "Straight Chino", "Pants", "30", "1190", "8", "Khaki", "", "Lifework", "กางเกงชิโนทรงตรง", "กางเกง", ""],
];

type Field =
  | "sku"
  | "name"
  | "nameTh"
  | "category"
  | "categoryTh"
  | "size"
  | "price"
  | "stock"
  | "color"
  | "barcode"
  | "brand"
  | "description"
  | "cost"
  | "promoTag";

const HEADER_ALIASES: Record<string, Field> = {
  sku: "sku",
  name: "name",
  productname: "name",
  namethai: "nameTh",
  nameth: "nameTh",
  thainame: "nameTh",
  category: "category",
  categoryname: "category",
  categorythai: "categoryTh",
  categoryth: "categoryTh",
  size: "size",
  price: "price",
  unitprice: "price",
  stock: "stock",
  qty: "stock",
  quantity: "stock",
  initialstock: "stock",
  nameen: "name",
  cost: "cost",
  unitcost: "cost",
  promotag: "promoTag",
  promo: "promoTag",
  color: "color",
  colour: "color",
  barcode: "barcode",
  brand: "brand",
  description: "description",
};

const REQUIRED_FIELDS: Field[] = ["sku", "name", "category", "size", "price"];
const FIELD_LABELS: Record<Field, string> = {
  sku: "SKU",
  name: "Name",
  nameTh: "Name (Thai)",
  category: "Category",
  categoryTh: "Category (Thai)",
  size: "Size",
  price: "Price",
  stock: "Stock",
  color: "Color",
  barcode: "Barcode",
  brand: "Brand",
  description: "Description",
  cost: "Cost",
  promoTag: "Promo_Tag",
};

export interface ImportRow {
  /** Line number in the file. The header is line 1, so the first data row is line 2. */
  line: number;
  sku: string;
  name: string;
  nameTh: string | null;
  category: string;
  categoryTh: string | null;
  size: string;
  color: string;
  priceSatang: number;
  /** null when the Stock cell was blank. */
  stock: number | null;
  barcode: string | null;
  brand: string | null;
  description: string | null;
  /** Unit cost in satang, or null when the Cost cell was blank. */
  costSatang: number | null;
  /** Short sales tag, or null when blank. */
  promoTag: string | null;
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

  const headerCells = table[0];
  const columnOf: Partial<Record<Field, number>> = {};
  const unknownColumns: string[] = [];
  headerCells.forEach((cell, index) => {
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
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    const problems: string[] = [];

    const sku = get("sku").toUpperCase();
    // The sample row in the downloaded template starts with EXAMPLE-. It must be deleted, never imported.
    if (sku.startsWith("EXAMPLE-")) problems.push("This is the example row from the template. Delete it, then upload again.");
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku)) problems.push("SKU must be 1 to 40 letters, digits, dots, dashes or underscores.");

    const name = get("name");
    if (!name) problems.push("Name is required.");
    else if (name.length > 150) problems.push("Name is longer than 150 characters.");

    const category = get("category");
    if (!category) problems.push("Category is required.");
    else if (category.length > 80) problems.push("Category is longer than 80 characters.");

    const size = get("size");
    if (!size) problems.push("Size is required.");
    else if (size.length > 20) problems.push("Size is longer than 20 characters.");

    const color = get("color") || DEFAULT_COLOR;
    if (color.length > 40) problems.push("Color is longer than 40 characters.");

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

    let stock: number | null = null;
    const stockText = get("stock");
    if (stockText !== "") {
      if (!/^\d+(\.0+)?$/.test(stockText)) problems.push("Stock must be a whole number of 0 or more.");
      else {
        stock = Math.trunc(Number(stockText));
        if (stock > 100_000) problems.push("Stock is too large (maximum 100000).");
      }
    }

    const barcodeText = get("barcode");
    let barcode: string | null = null;
    if (barcodeText) {
      if (!isValidBarcode(barcodeText)) problems.push(BARCODE_RULE_MESSAGE);
      else barcode = barcodeText;
    }

    let costSatang: number | null = null;
    const costText = get("cost").replace(/[,฿s]/g, "");
    if (costText) {
      try {
        costSatang = bahtToSatang(costText);
        if (costSatang > 100_000_000) problems.push("Cost is too large.");
      } catch (err) {
        if (err instanceof PricingError) problems.push("Cost must be a number with at most 2 decimals.");
        else throw err;
      }
    }

    const promoTag = get("promoTag") || null;
    if (promoTag && promoTag.length > 30) problems.push("Promo_Tag is longer than 30 characters.");

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
      nameTh: get("nameTh") || null,
      category,
      categoryTh: get("categoryTh") || null,
      size,
      color,
      priceSatang,
      stock,
      barcode,
      brand,
      description,
      costSatang,
      promoTag,
    });
  });

  // Duplicates inside the file.
  const skuLine = new Map<string, number>();
  const barcodeLine = new Map<string, number>();
  const variantLine = new Map<string, number>();
  const productCategory = new Map<string, { category: string; line: number }>();
  for (const row of rows) {
    const firstSku = skuLine.get(row.sku);
    if (firstSku !== undefined) issues.push({ line: row.line, message: `SKU ${row.sku} already appears on line ${firstSku}.` });
    else skuLine.set(row.sku, row.line);

    if (row.barcode) {
      const firstBarcode = barcodeLine.get(row.barcode);
      if (firstBarcode !== undefined) issues.push({ line: row.line, message: `Barcode ${row.barcode} already appears on line ${firstBarcode}.` });
      else barcodeLine.set(row.barcode, row.line);
    }

    const productKey = slugify(row.name);
    const variantKey = `${productKey}|${row.size.toLowerCase()}|${row.color.toLowerCase()}`;
    const firstVariant = variantLine.get(variantKey);
    if (firstVariant !== undefined) {
      issues.push({ line: row.line, message: `${row.name} in size ${row.size} / ${row.color} already appears on line ${firstVariant}.` });
    } else {
      variantLine.set(variantKey, row.line);
    }

    const seen = productCategory.get(productKey);
    if (seen && seen.category.toLowerCase() !== row.category.toLowerCase()) {
      issues.push({ line: row.line, message: `${row.name} is listed under "${seen.category}" on line ${seen.line} and "${row.category}" here.` });
    } else if (!seen) {
      productCategory.set(productKey, { category: row.category, line: row.line });
    }
  }

  issues.sort((a, b) => a.line - b.line);
  return { rows, issues, unknownColumns };
}

export interface ImportOptions {
  /** What to do when a SKU already exists. */
  onExisting: "skip" | "update";
  /** For existing SKUs, set stock to the file's Stock value (written to the ledger as an adjustment). */
  applyStock: boolean;
}

interface PlannedCategory {
  id: string;
  name: string;
  nameTh: string | null;
  slug: string;
}

interface PlannedProduct {
  id: string;
  slug: string;
  name: string;
  nameTh: string | null;
  brand: string | null;
  description: string | null;
  categoryId: string;
  promoTag: string | null;
}

interface PlannedVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  priceSatang: number;
  costSatang: number | null;
  stock: number;
  line: number;
}

interface PlannedUpdate {
  line: number;
  variantId: string;
  productId: string;
  sku: string;
  priceBeforeSatang: number;
  priceAfterSatang: number;
  barcode: string | null;
  /** null leaves the cost unchanged. */
  costAfterSatang: number | null;
  productPatch: { nameTh?: string; brand?: string; description?: string; promoTag?: string };
  stockChange: { before: number; after: number } | null;
}

export interface ImportSummary {
  rows: number;
  newCategories: number;
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
  categories: PlannedCategory[];
  products: PlannedProduct[];
  variants: PlannedVariant[];
  updates: PlannedUpdate[];
  sizes: string[];
  skipped: { line: number; sku: string }[];
}

/** Compares against the database and decides what the import would do. Read-only. */
export async function planImport(db: Prisma.TransactionClient, rows: ImportRow[], options: ImportOptions): Promise<ImportPlan> {
  const issues: ImportIssue[] = [];
  const skus = Array.from(new Set(rows.map((row) => row.sku)));
  const productSlugs = Array.from(new Set(rows.map((row) => slugify(row.name))));
  const fileBarcodes = rows.map((row) => row.barcode).filter((value): value is string => value !== null);

  const [existingVariants, categories, sizes, existingProducts, barcodeOwners] = await Promise.all([
    db.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true, size: true, color: true, price: true, stockQuantity: true, productId: true },
    }),
    db.category.findMany({ select: { id: true, name: true, slug: true } }),
    db.size.findMany({ select: { name: true } }),
    db.product.findMany({
      where: { slug: { in: productSlugs } },
      select: { id: true, slug: true, categoryId: true, variants: { select: { sku: true, size: true, color: true } } },
    }),
    fileBarcodes.length > 0
      ? db.productVariant.findMany({ where: { barcode: { in: fileBarcodes } }, select: { sku: true, barcode: true } })
      : Promise.resolve([] as { sku: string; barcode: string }[]),
  ]);

  const variantBySku = new Map(existingVariants.map((variant) => [variant.sku, variant]));
  const barcodeOwner = new Map(barcodeOwners.map((entry) => [entry.barcode, entry.sku]));
  const productBySlug = new Map(existingProducts.map((product) => [product.slug, product]));
  const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const knownSizes = new Set(sizes.map((size) => size.name.toLowerCase()));

  const newCategories = new Map<string, PlannedCategory>();
  const newProducts = new Map<string, PlannedProduct>();
  const variants: PlannedVariant[] = [];
  const updates: PlannedUpdate[] = [];
  const skipped: { line: number; sku: string }[] = [];
  const newSizes = new Map<string, string>();
  const usedBarcodes = new Set<string>(barcodeOwners.map((entry) => entry.barcode));
  for (const code of fileBarcodes) usedBarcodes.add(code);
  const needsBarcode: PlannedVariant[] = [];

  const resolveCategory = (row: ImportRow): { id: string; created: boolean } => {
    const key = row.category.toLowerCase();
    const found = categoryByName.get(key) ?? categoryBySlug.get(slugify(row.category));
    if (found) return { id: found.id, created: false };
    let planned = newCategories.get(key);
    if (!planned) {
      planned = { id: randomUUID(), name: row.category, nameTh: row.categoryTh, slug: slugify(row.category) };
      newCategories.set(key, planned);
    }
    return { id: planned.id, created: true };
  };

  for (const row of rows) {
    if (!knownSizes.has(row.size.toLowerCase()) && !newSizes.has(row.size.toLowerCase())) {
      newSizes.set(row.size.toLowerCase(), row.size);
    }

    const existing = variantBySku.get(row.sku);
    if (existing) {
      if (options.onExisting === "skip") {
        skipped.push({ line: row.line, sku: row.sku });
        continue;
      }
      if (row.barcode && barcodeOwner.has(row.barcode) && barcodeOwner.get(row.barcode) !== row.sku) {
        issues.push({ line: row.line, message: `Barcode ${row.barcode} already belongs to SKU ${barcodeOwner.get(row.barcode)}.` });
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
        barcode: row.barcode,
        costAfterSatang: row.costSatang,
        productPatch: {
          ...(row.nameTh ? { nameTh: row.nameTh } : {}),
          ...(row.brand ? { brand: row.brand } : {}),
          ...(row.description ? { description: row.description } : {}),
          ...(row.promoTag ? { promoTag: row.promoTag } : {}),
        },
        stockChange:
          options.applyStock && row.stock !== null && row.stock !== currentStock ? { before: currentStock, after: row.stock } : null,
      });
      continue;
    }

    // A new SKU. Its barcode must not belong to another variant.
    if (row.barcode && barcodeOwner.has(row.barcode)) {
      issues.push({ line: row.line, message: `Barcode ${row.barcode} already belongs to SKU ${barcodeOwner.get(row.barcode)}.` });
      continue;
    }

    const slug = slugify(row.name);
    const category = resolveCategory(row);
    const existingProduct = productBySlug.get(slug);
    let productId: string;

    if (existingProduct) {
      if (!category.created && existingProduct.categoryId !== category.id) {
        issues.push({ line: row.line, message: `${row.name} already exists in a different category. Use that category or rename the product.` });
        continue;
      }
      if (category.created) {
        issues.push({ line: row.line, message: `${row.name} already exists in another category, not "${row.category}".` });
        continue;
      }
      const clash = existingProduct.variants.find(
        (variant) => variant.size.toLowerCase() === row.size.toLowerCase() && variant.color.toLowerCase() === row.color.toLowerCase(),
      );
      if (clash) {
        issues.push({ line: row.line, message: `${row.name} in size ${row.size} / ${row.color} already exists as SKU ${clash.sku}.` });
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

    const planned: PlannedVariant = {
      id: randomUUID(),
      productId,
      sku: row.sku,
      barcode: row.barcode ?? "",
      size: row.size,
      color: row.color,
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

  const stockMovements =
    variants.filter((variant) => variant.stock > 0).length + updates.filter((update) => update.stockChange !== null).length;

  return {
    summary: {
      rows: rows.length,
      newCategories: newCategories.size,
      newProducts: newProducts.size,
      newVariants: variants.length,
      updatedVariants: updates.length,
      skippedVariants: skipped.length,
      stockMovements,
      newSizes: newSizes.size,
    },
    issues: issues.sort((a, b) => a.line - b.line),
    categories: Array.from(newCategories.values()),
    products: Array.from(newProducts.values()),
    variants,
    updates,
    sizes: Array.from(newSizes.values()),
    skipped,
  };
}

/** Writes a clean plan. Batches with createMany, so a 2000-row file is a handful of statements. */
export async function commitImport(tx: Prisma.TransactionClient, plan: ImportPlan, userId: string, fileName: string): Promise<void> {
  if (plan.issues.length > 0) throw new Error("Cannot commit an import that has issues.");

  if (plan.sizes.length > 0) {
    const last = await tx.size.aggregate({ _max: { sortOrder: true } });
    const start = (last._max.sortOrder ?? 0) + 1;
    await tx.size.createMany({
      data: plan.sizes.map((name, index) => ({ name, sortOrder: start + index })),
      skipDuplicates: true,
    });
  }
  if (plan.categories.length > 0) {
    await tx.category.createMany({ data: plan.categories.map((c) => ({ id: c.id, name: c.name, nameTh: c.nameTh, slug: c.slug })) });
  }
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
        color: v.color,
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
        quantityChange: update.stockChange.after - update.stockChange.before,
        stockBefore: update.stockChange.before,
        stockAfter: update.stockChange.after,
        reference,
        note: "Bulk import stock count",
        userId,
      });
    }
  }

  if (movements.length > 0) await tx.inventoryMovement.createMany({ data: movements });

  const priceChanges = plan.updates
    .filter((update) => update.priceBeforeSatang !== update.priceAfterSatang)
    .map((update) => ({
      sku: update.sku,
      from: satangToDecimal(update.priceBeforeSatang),
      to: satangToDecimal(update.priceAfterSatang),
    }));

  await tx.auditLog.create({
    data: {
      action: "CATALOG_IMPORT",
      entityType: "Catalog",
      entityId: fileName.slice(0, 100),
      userId,
      details: { summary: { ...plan.summary }, priceChanges: priceChanges.slice(0, 200) },
    },
  });
}
