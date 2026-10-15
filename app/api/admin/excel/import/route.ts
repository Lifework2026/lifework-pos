import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { commitPriceChanges, parsePriceTable, planPriceChanges, summarizePrice } from "@/lib/catalog/price-import";
import { commitStockChanges, parseStockTable, planStockChanges, summarizeStock } from "@/lib/catalog/stock-import";
import {
  commitCategories,
  commitColors,
  parseMasterTable,
  planCategories,
  planColors,
  type MasterRow,
} from "@/lib/catalog/master-import";
import { commitMembers, parseMemberTable, planMembers } from "@/lib/members/import";
import { readUploadedTable } from "@/lib/upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISSUE_LIMIT = 200;

class ImportBlocked extends Error {
  constructor(public readonly issues: { line: number; message: string }[]) {
    super("The file has problems.");
  }
}

type Issue = { line: number; message: string };
type Tx = Prisma.TransactionClient;

/**
 * One spreadsheet type, described by how to read it, plan it against the database and write it. The same three steps
 * serve preview (read only) and commit (all or nothing, in a serializable transaction).
 */
interface Handler {
  parse: (table: string[][]) => { rows: unknown[]; issues: Issue[]; unknownColumns: string[] };
  plan: (tx: Tx, rows: never[]) => Promise<{ issues: Issue[]; summary: Record<string, number>; sample?: unknown[]; plan: unknown }>;
  commit: (tx: Tx, plan: never, userId: string, fileName: string) => Promise<void>;
}

const HANDLERS: Record<"B" | "C" | "D" | "E" | "F", Handler> = {
  B: {
    parse: (table) => parsePriceTable(table),
    plan: async (tx, rows) => {
      const plan = await planPriceChanges(tx, rows as never[]);
      return {
        plan,
        issues: plan.issues,
        summary: summarizePrice(plan),
        sample: plan.changes.slice(0, 20).map((c) => ({ line: c.line, sku: c.sku, barcode: c.barcode, price: c.priceAfterSatang === null ? null : [c.priceBeforeSatang, c.priceAfterSatang], promoTag: c.promoAfter === null ? null : [c.promoBefore, c.promoAfter] })),
      };
    },
    commit: async (tx, plan, userId, fileName) => {
      await commitPriceChanges(tx, plan as Awaited<ReturnType<typeof planPriceChanges>>, userId, fileName);
    },
  },
  C: {
    parse: (table) => parseStockTable(table),
    plan: async (tx, rows) => {
      const plan = await planStockChanges(tx, rows as never[]);
      return {
        plan,
        issues: plan.issues,
        summary: summarizeStock(plan),
        sample: plan.lines.slice(0, 20).map((l) => ({ line: l.line, sku: l.sku, barcode: l.barcode, change: l.quantityChange, reason: l.reason, stock: [l.stockBefore, l.stockAfter] })),
      };
    },
    commit: async (tx, plan, userId, fileName) => {
      await commitStockChanges(tx, plan as Awaited<ReturnType<typeof planStockChanges>>, userId, fileName);
    },
  },
  D: {
    parse: (table) => parseMasterTable(table, "category"),
    plan: async (tx, rows) => {
      const plan = await planCategories(tx, rows as MasterRow[]);
      return {
        plan,
        issues: plan.issues,
        summary: { created: plan.creates.length, renamed: plan.updates.length, unchanged: plan.unchanged },
        sample: [...plan.creates.map((c) => ({ line: c.line, code: c.code, name: c.name, action: "create" })), ...plan.updates.map((u) => ({ line: u.line, code: u.code, name: `${u.from} → ${u.to}`, action: "rename" }))].slice(0, 50),
      };
    },
    commit: async (tx, plan, userId, fileName) => {
      await commitCategories(tx, plan as Awaited<ReturnType<typeof planCategories>>, userId, fileName);
    },
  },
  E: {
    parse: (table) => parseMasterTable(table, "color"),
    plan: async (tx, rows) => {
      const plan = await planColors(tx, rows as MasterRow[]);
      return {
        plan,
        issues: plan.issues,
        summary: { created: plan.creates.length, renamed: plan.updates.length, unchanged: plan.unchanged },
        sample: [...plan.creates.map((c) => ({ line: c.line, code: c.code, name: c.name, action: "create" })), ...plan.updates.map((u) => ({ line: u.line, code: u.code, name: `${u.from} → ${u.to}`, action: "rename" }))].slice(0, 50),
      };
    },
    commit: async (tx, plan, userId, fileName) => {
      await commitColors(tx, plan as Awaited<ReturnType<typeof planColors>>, userId, fileName);
    },
  },
  F: {
    parse: (table) => parseMemberTable(table),
    plan: async (tx, rows) => {
      const plan = await planMembers(tx, rows as never[]);
      return {
        plan,
        issues: plan.issues,
        summary: { created: plan.creates.length, updated: plan.updates.length, unchanged: plan.unchanged },
        sample: [...plan.creates.map((m) => ({ line: m.line, phone: m.phone, name: m.name, action: "create" })), ...plan.updates.map((u) => ({ line: u.line, phone: u.phone, name: u.name, action: "update" }))].slice(0, 50),
      };
    },
    commit: async (tx, plan, userId, fileName) => {
      await commitMembers(tx, plan as Awaited<ReturnType<typeof planMembers>>, userId, fileName);
    },
  },
};

function blocked(issues: Issue[], mode: "preview" | "commit", extra: Record<string, unknown> = {}) {
  const body = { ok: false, issueCount: issues.length, issues: issues.slice(0, ISSUE_LIMIT), ...extra };
  if (mode === "commit") {
    return Response.json({ error: "IMPORT_HAS_ISSUES", message: "Fix the problems in the file and try again.", ...body }, { status: 422 });
  }
  return Response.json(body);
}

/**
 * POST /api/admin/excel/import (multipart: file, type=B|C|D|E|F, mode=preview|commit)
 *
 * B: price and promo update by barcode. C: stock by barcode with a reason. D: categories by code. E: colours by code.
 * F: members by phone (points set, not added). Preview reads only. Commit re-checks everything inside one serializable
 * transaction and writes all or nothing. Template A is imported from /api/admin/products/import. Managers only.
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
  if (type !== "B" && type !== "C" && type !== "D" && type !== "E" && type !== "F") {
    return apiError(400, "INVALID_TYPE", "Choose template B, C, D, E or F.");
  }
  const handler = HANDLERS[type];
  const mode: "preview" | "commit" = form.get("mode") === "commit" ? "commit" : "preview";

  const read = await readUploadedTable(file);
  if ("response" in read) return read.response;

  const parsed = handler.parse(read.table);
  if (parsed.issues.length > 0) return blocked(parsed.issues, mode, { unknownColumns: parsed.unknownColumns });

  try {
    if (mode === "preview") {
      const result = await handler.plan(prisma as unknown as Tx, parsed.rows as never[]);
      return Response.json({
        ok: result.issues.length === 0,
        issueCount: result.issues.length,
        issues: result.issues.slice(0, ISSUE_LIMIT),
        unknownColumns: parsed.unknownColumns,
        summary: result.summary,
        sample: result.sample ?? [],
      });
    }

    const summary = await prisma.$transaction(
      async (tx) => {
        const result = await handler.plan(tx, parsed.rows as never[]);
        if (result.issues.length > 0) throw new ImportBlocked(result.issues);
        await handler.commit(tx, result.plan as never, auth.user.id, file.name);
        return result.summary;
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
      return apiError(409, "CONFLICT", "Someone changed the data at the same time. Nothing was imported. Please try again.");
    }
    console.error("[POST /api/admin/excel/import]", err);
    return apiError(500, "INTERNAL_ERROR", "The import failed. Nothing was saved.");
  }
}
