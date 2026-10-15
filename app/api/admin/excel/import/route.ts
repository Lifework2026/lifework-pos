import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { commitPriceChanges, parsePriceTable, planPriceChanges, summarizePrice, type PriceIssue } from "@/lib/catalog/price-import";
import { commitStockChanges, parseStockTable, planStockChanges, summarizeStock, type StockIssue } from "@/lib/catalog/stock-import";
import { readUploadedTable } from "@/lib/upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISSUE_LIMIT = 200;

class ImportBlocked extends Error {
  constructor(public readonly issues: { line: number; message: string }[]) {
    super("The file has problems.");
  }
}

function blocked(issues: { line: number; message: string }[], mode: "preview" | "commit", extra: Record<string, unknown> = {}) {
  const body = { ok: false, issueCount: issues.length, issues: issues.slice(0, ISSUE_LIMIT), ...extra };
  if (mode === "commit") {
    return Response.json({ error: "IMPORT_HAS_ISSUES", message: "Fix the problems in the file and try again.", ...body }, { status: 422 });
  }
  return Response.json(body);
}

/**
 * POST /api/admin/excel/import (multipart: file, type=B|C, mode=preview|commit)
 *
 * B: bulk price and promo-tag update by barcode. C: bulk stock in and out by barcode, each row with its reason.
 * Preview reads only. Commit re-checks everything inside one serializable transaction, and writes all or nothing.
 * Template A (new products) uses /api/admin/products/import. Managers only.
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
  const type = form.get("type");
  if (type === "A") return apiError(400, "USE_PRODUCT_IMPORT", "Template A is imported from the products page.");
  if (type !== "B" && type !== "C") return apiError(400, "INVALID_TYPE", "Choose template B or C.");
  const mode: "preview" | "commit" = form.get("mode") === "commit" ? "commit" : "preview";

  const read = await readUploadedTable(file);
  if ("response" in read) return read.response;

  try {
    if (type === "B") {
      const parsed = parsePriceTable(read.table);
      if (parsed.issues.length > 0) return blocked(parsed.issues as PriceIssue[], mode, { unknownColumns: parsed.unknownColumns });

      if (mode === "preview") {
        const plan = await planPriceChanges(prisma, parsed.rows);
        return Response.json({
          ok: plan.issues.length === 0,
          issueCount: plan.issues.length,
          issues: plan.issues.slice(0, ISSUE_LIMIT),
          unknownColumns: parsed.unknownColumns,
          summary: summarizePrice(plan),
          sample: plan.changes.slice(0, 20).map((c) => ({
            line: c.line,
            sku: c.sku,
            barcode: c.barcode,
            price: c.priceAfterSatang === null ? null : [c.priceBeforeSatang, c.priceAfterSatang],
            promoTag: c.promoAfter === null ? null : [c.promoBefore, c.promoAfter],
          })),
        });
      }

      const summary = await prisma.$transaction(
        async (tx) => {
          const plan = await planPriceChanges(tx, parsed.rows);
          if (plan.issues.length > 0) throw new ImportBlocked(plan.issues);
          await commitPriceChanges(tx, plan, auth.user.id, file.name);
          return summarizePrice(plan);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 },
      );
      return Response.json({ ok: true, summary }, { status: 201 });
    }

    // Template C: stock movements.
    const parsed = parseStockTable(read.table);
    if (parsed.issues.length > 0) return blocked(parsed.issues as StockIssue[], mode, { unknownColumns: parsed.unknownColumns });

    if (mode === "preview") {
      const plan = await planStockChanges(prisma, parsed.rows);
      return Response.json({
        ok: plan.issues.length === 0,
        issueCount: plan.issues.length,
        issues: plan.issues.slice(0, ISSUE_LIMIT),
        unknownColumns: parsed.unknownColumns,
        summary: summarizeStock(plan),
        sample: plan.lines.slice(0, 20).map((l) => ({
          line: l.line,
          sku: l.sku,
          barcode: l.barcode,
          change: l.quantityChange,
          reason: l.reason,
          stock: [l.stockBefore, l.stockAfter],
        })),
      });
    }

    const summary = await prisma.$transaction(
      async (tx) => {
        const plan = await planStockChanges(tx, parsed.rows);
        if (plan.issues.length > 0) throw new ImportBlocked(plan.issues);
        await commitStockChanges(tx, plan, auth.user.id, file.name);
        return summarizeStock(plan);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 },
    );
    return Response.json({ ok: true, summary }, { status: 201 });
  } catch (err) {
    if (err instanceof ImportBlocked) {
      return Response.json(
        { error: "IMPORT_HAS_ISSUES", message: "The stock changed while importing. Review the problems and try again.", ok: false, issueCount: err.issues.length, issues: err.issues.slice(0, ISSUE_LIMIT) },
        { status: 422 },
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) {
      return apiError(409, "CONFLICT", "Someone changed the stock at the same time. Nothing was imported. Please try again.");
    }
    console.error("[POST /api/admin/excel/import]", err);
    return apiError(500, "INTERNAL_ERROR", "The import failed. Nothing was saved.");
  }
}
