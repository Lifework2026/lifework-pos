import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import {
  commitImport,
  parseImportTable,
  planImport,
  type ImportIssue,
  type ImportOptions,
  type ImportPlan,
  type ImportRow,
} from "@/lib/catalog/import";
import { parseCsv, parseXlsx } from "@/lib/tabular";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel rejects request bodies over 4.5 MB, so stay a little under it. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ISSUE_LIMIT = 200;

class ImportBlocked extends Error {
  constructor(public readonly issues: ImportIssue[]) {
    super("The file has problems.");
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function readTable(file: File): Promise<{ table: string[][] } | { response: Response }> {
  const name = file.name.toLowerCase();
  if (file.size === 0) return { response: apiError(400, "FILE_EMPTY", "The file is empty.") };
  if (file.size > MAX_FILE_BYTES) {
    return { response: apiError(413, "FILE_TOO_LARGE", "The file is larger than 4 MB. Split it into smaller imports.") };
  }
  if (name.endsWith(".xls")) {
    return { response: apiError(415, "UNSUPPORTED_TYPE", "Old .xls files are not supported. Save the sheet as .xlsx or .csv.") };
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  try {
    if (name.endsWith(".xlsx") || isZip(bytes)) {
      if (!isZip(bytes)) return { response: apiError(415, "UNSUPPORTED_TYPE", "That does not look like a real .xlsx file.") };
      return { table: await parseXlsx(buffer) };
    }
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return { table: parseCsv(new TextDecoder("utf-8").decode(bytes)) };
    }
  } catch {
    return { response: apiError(422, "UNREADABLE_FILE", "The file could not be read. Check that it is a valid .xlsx or .csv file.") };
  }
  return { response: apiError(415, "UNSUPPORTED_TYPE", "Upload an .xlsx or .csv file.") };
}

function describe(plan: ImportPlan, rows: ImportRow[]) {
  const nameBySku = new Map(rows.map((row) => [row.sku, row.name]));
  return {
    summary: plan.summary,
    newCategories: plan.categories.map((c) => c.name).slice(0, 30),
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

/**
 * POST /api/admin/products/import (multipart: file, mode, onExisting, applyStock)
 *
 * mode=preview checks the file and reports what would happen, without writing anything.
 * mode=commit writes it, all or nothing. Managers only (enforced by middleware).
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser();
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

  const read = await readTable(file);
  if ("response" in read) return read.response;

  const parsed = parseImportTable(read.table);
  if (parsed.issues.length > 0) {
    const body = {
      ok: false,
      issueCount: parsed.issues.length,
      issues: parsed.issues.slice(0, ISSUE_LIMIT),
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
      });
    }

    const summary = await prisma.$transaction(
      async (tx) => {
        // Plan again inside the transaction, so the write matches the database at this moment.
        const plan = await planImport(tx, parsed.rows, options);
        if (plan.issues.length > 0) throw new ImportBlocked(plan.issues);
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) {
      return apiError(409, "CONFLICT", "Someone changed the catalogue at the same time. Nothing was imported. Please try again.");
    }
    console.error("[POST /api/admin/products/import]", err);
    return apiError(500, "INTERNAL_ERROR", "The import failed. Nothing was saved.");
  }
}
