import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import {
  commitImport,
  parseImportTable,
  planImport,
  TEMPLATE_HEADER,
  type ImportIssue,
  type ImportOptions,
  type ImportPlan,
  type ImportRow,
} from "@/lib/catalog/import";
import { buildProductPreview, describeColumns } from "@/lib/catalog/import-preview";
import { numericTextIssues } from "@/lib/text-columns";
import { readUploadedTable } from "@/lib/upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISSUE_LIMIT = 200;

class ImportBlocked extends Error {
  constructor(public readonly issues: ImportIssue[]) {
    super("The file has problems.");
  }
}

/** The commit found a different number of new rows from the check the user reviewed. Nothing is written. */
class PreviewChanged extends Error {
  constructor() {
    super("The catalogue changed after the check.");
  }
}

function describe(plan: ImportPlan, rows: ImportRow[]) {
  const nameBySku = new Map(rows.map((row) => [row.sku, row.name]));
  return {
    summary: plan.summary,
    newProducts: plan.products.map((p) => p.name).slice(0, 30),
    newSizes: plan.sizes.slice(0, 30),
    skipped: plan.skipped.slice(0, 20),
    updates: plan.updates.slice(0, 20).map((u) => ({
      line: u.line,
      sku: u.sku,
      name: nameBySku.get(u.sku) ?? "",
      priceBefore: (u.priceBeforeSatang / 100).toFixed(2),
      priceAfter: (u.priceAfterSatang / 100).toFixed(2),
      stockBefore: u.stockChange?.before ?? null,
      stockAfter: u.stockChange?.after ?? null,
    })),
  };
}

/** Reads the master names the preview shows next to each code. Read only. */
async function previewFor(table: string[][], rows: ImportRow[], plan: ImportPlan) {
  const described = describeColumns(table, TEMPLATE_HEADER);
  const [categories, colors] = await Promise.all([
    prisma.category.findMany({
      where: { code: { in: Array.from(new Set(rows.map((row) => row.categoryCode))) } },
      select: { code: true, name: true, nameTh: true },
    }),
    prisma.color.findMany({
      where: { code: { in: Array.from(new Set(rows.map((row) => row.colorCode))) } },
      select: { code: true, name: true, nameTh: true },
    }),
  ]);
  return buildProductPreview({
    rows,
    plan,
    headers: described.headers,
    missingColumns: described.missingColumns,
    categories,
    colors,
  });
}

/**
 * POST /api/admin/products/import (multipart: file, mode, onExisting, applyStock, expectedNewVariants)
 *
 * mode=preview checks the file and returns what would happen plus the rows for the visual preview. Nothing is written.
 * mode=commit writes it, all or nothing. When expectedNewVariants is sent, the commit writes only if the database still
 * matches the check the user reviewed; otherwise the transaction rolls back. Managers only (enforced by middleware).
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "INVALID_FORM", "Send the file as multipart form data.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "FILE_REQUIRED", "Choose a file to import.");
  const mode = form.get("mode") === "commit" ? "commit" : "preview";
  const options: ImportOptions = {
    onExisting: form.get("onExisting") === "update" ? "update" : "skip",
    applyStock: form.get("applyStock") === "true",
  };
  const expectedRaw = form.get("expectedNewVariants");
  const expectedNew = typeof expectedRaw === "string" && expectedRaw.trim() !== "" ? Number(expectedRaw) : null;

  const read = await readUploadedTable(file);
  if ("response" in read) return read.response;

  const parsed = parseImportTable(read.table);
  // Numbers in code, barcode or SKU cells are refused first: their leading zeros may already be gone.
  const issues = [...numericTextIssues(read.table, read.numeric), ...parsed.issues];
  if (issues.length > 0) {
    const body = {
      ok: false,
      issueCount: issues.length,
      issues: issues.slice(0, ISSUE_LIMIT),
      unknownColumns: parsed.unknownColumns,
    };
    return mode === "commit" ? Response.json({ error: "IMPORT_HAS_ISSUES", message: "Fix the problems in the file and try again.", ...body }, { status: 422 }) : Response.json(body);
  }

  try {
    if (mode === "preview") {
      const plan = await planImport(prisma, parsed.rows, options);
      return Response.json({
        ok: plan.issues.length === 0,
        issueCount: plan.issues.length,
        issues: plan.issues.slice(0, ISSUE_LIMIT),
        unknownColumns: parsed.unknownColumns,
        ...describe(plan, parsed.rows),
        preview: await previewFor(read.table, parsed.rows, plan),
      });
    }

    const summary = await prisma.$transaction(
      async (tx) => {
        // Plan again inside the transaction, so the write matches the database at this moment.
        const plan = await planImport(tx, parsed.rows, options);
        if (plan.issues.length > 0) throw new ImportBlocked(plan.issues);
        if (expectedNew !== null && expectedNew !== plan.summary.newVariants) throw new PreviewChanged();
        await commitImport(tx, plan, auth.user.id, file.name);
        return plan.summary;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 },
    );
    return Response.json({ ok: true, summary }, { status: 201 });
  } catch (err) {
    if (err instanceof ImportBlocked) {
      return Response.json(
        { error: "IMPORT_HAS_ISSUES", message: "The data changed while importing. Review the problems and try again.", ok: false, issueCount: err.issues.length, issues: err.issues.slice(0, ISSUE_LIMIT) },
        { status: 422 },
      );
    }
    if (err instanceof PreviewChanged) {
      return Response.json(
        { error: "PREVIEW_CHANGED", message: "The catalogue changed after the check. Nothing was imported. Check the file again.", ok: false },
        { status: 409 },
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) {
      return apiError(409, "CONFLICT", "Someone changed the catalogue at the same time. Nothing was imported. Please try again.");
    }
    console.error("[POST /api/admin/products/import]", err);
    return apiError(500, "INTERNAL_ERROR", "The import failed. Nothing was saved.");
  }
}
