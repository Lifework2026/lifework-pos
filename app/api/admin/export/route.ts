import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { requireManager } from "@/lib/api-helpers";
import { bangkokYmd, isYmd } from "@/lib/bangkok";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-labels";
import { prisma } from "@/lib/prisma";
import { buildSummary, customRange, loadPayments, loadRefunds, loadVoids, bangkokTime, thb } from "@/lib/reports";
import { buildXlsx, toCsv } from "@/lib/tabular";
import { buildLedgerWhere, parseMovementType, parseStockReason } from "@/lib/ledger";
import { buildEod, eodExport } from "@/lib/eod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KINDS = ["payments", "refunds", "voids", "summary", "inventory", "movements", "members", "shifts", "eod", "categories", "colors"] as const;
type Kind = (typeof KINDS)[number];

/** Kinds that depend on a date range. Inventory and members are snapshots of right now. */
const RANGED: Kind[] = ["payments", "refunds", "voids", "summary", "movements", "shifts", "eod"];
const MOVEMENT_ROW_LIMIT = 50_000;

interface Dataset {
  header: string[];
  rows: (string | number | null)[][];
  /** Zero-based columns Excel should keep as text (barcodes, SKUs, phone numbers). */
  textColumns: number[];
}

async function buildDataset(kind: Kind, from: string, to: string, params: URLSearchParams): Promise<Dataset> {
  if (kind === "eod") {
    // Z-report for one day, so only the start date is used.
    return eodExport(await buildEod(from));
  }
  const range = customRange(from, to);

  if (kind === "payments") {
    const rows = await loadPayments(range);
    return {
      header: [
        "Date", "Time", "Receipt No", "Order status", "Payment channel", "Amount (THB)", "Tendered (THB)",
        "Change (THB)", "Reference", "Card transaction ref", "Approval code", "Card", "Cashier", "Member phone",
      ],
      rows: rows.map((r) => [
        bangkokYmd(r.paidAt), bangkokTime(r.paidAt), r.receiptNo, r.orderStatus,
        PAYMENT_METHOD_LABELS[r.method] ?? r.method, thb(r.amount),
        r.tendered === null ? null : thb(r.tendered), r.changeGiven === null ? null : thb(r.changeGiven),
        r.reference, r.transactionRef, r.approvalCode, r.cardMask, r.cashier, r.memberPhone,
      ]),
      textColumns: [2, 8, 9, 10, 13],
    };
  }

  if (kind === "refunds") {
    const rows = await loadRefunds(range);
    return {
      header: ["Date", "Time", "Receipt No", "Refund ID", "Refund channel", "Amount (THB)", "Reference", "Reason", "Items", "Staff"],
      rows: rows.map((r) => [
        bangkokYmd(r.refundedAt), bangkokTime(r.refundedAt), r.receiptNo, r.refundId,
        PAYMENT_METHOD_LABELS[r.method] ?? r.method, thb(r.amount), r.reference, r.reason, r.items, r.staff,
      ]),
      textColumns: [2, 3, 6],
    };
  }

  if (kind === "voids") {
    const rows = await loadVoids(range);
    return {
      header: ["Date", "Time", "Receipt No", "Voided amount (THB)", "Original payment channels", "Reason", "Staff"],
      rows: rows.map((r) => [bangkokYmd(r.voidedAt), bangkokTime(r.voidedAt), r.receiptNo, thb(r.amount), r.channels, r.reason, r.staff]),
      textColumns: [2],
    };
  }

  if (kind === "summary") {
    const summary = await buildSummary(range);
    return {
      header: ["Payment channel", "Sales count", "Sales (THB)", "Refunds (THB)", "Net (THB)"],
      rows: [
        ...summary.channels.map((c) => [c.label, c.salesCount, thb(c.sales), thb(c.refunds), thb(c.net)]),
        ["TOTAL", summary.totals.saleCount, thb(summary.totals.sales), thb(summary.totals.refunds), thb(summary.totals.net)],
      ],
      textColumns: [],
    };
  }

  if (kind === "inventory") {
    const variants = await prisma.productVariant.findMany({
      orderBy: [{ product: { name: "asc" } }, { color: "asc" }, { size: "asc" }],
      select: {
        sku: true, barcode: true, size: true, color: true, price: true, stockQuantity: true, isActive: true,
        product: { select: { name: true, nameTh: true, brand: true, isActive: true, category: { select: { name: true } } } },
      },
    });
    return {
      header: ["SKU", "Product", "Product (Thai)", "Category", "Brand", "Size", "Color", "Barcode", "Price (THB)", "Stock", "Stock value (THB)", "Active"],
      rows: variants.map((v) => [
        v.sku, v.product.name, v.product.nameTh, v.product.category.name, v.product.brand, v.size, v.color, v.barcode,
        v.price.toFixed(2), v.stockQuantity, (Number(v.price) * v.stockQuantity).toFixed(2),
        v.isActive && v.product.isActive ? "Yes" : "No",
      ]),
      textColumns: [0, 7],
    };
  }

  if (kind === "movements") {
    // The same filters as the Stock Movement History page, so the file matches what is on screen.
    const where = buildLedgerWhere({
      from,
      to,
      type: parseMovementType(params.get("type")),
      reason: parseStockReason(params.get("reason")),
      userId: params.get("user") || undefined,
      q: params.get("q") || undefined,
    });
    const rows = await prisma.inventoryMovement.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MOVEMENT_ROW_LIMIT,
      select: {
        createdAt: true, type: true, reasonCode: true, quantityChange: true, stockBefore: true, stockAfter: true, reference: true, note: true,
        variant: { select: { sku: true, size: true, color: true, product: { select: { name: true } } } },
        user: { select: { fullName: true, username: true } },
      },
    });
    return {
      header: ["Date", "Time", "SKU", "Product", "Size", "Color", "Type", "Reason code", "Change", "Stock before", "Stock after", "Reference", "Note", "Staff", "Username"],
      rows: rows.map((m) => [
        bangkokYmd(m.createdAt), bangkokTime(m.createdAt), m.variant.sku, m.variant.product.name, m.variant.size, m.variant.color,
        m.type, m.reasonCode, m.quantityChange, m.stockBefore, m.stockAfter, m.reference, m.note, m.user?.fullName ?? null, m.user?.username ?? null,
      ]),
      textColumns: [2, 11],
    };
  }

  if (kind === "shifts") {
    const shifts = await prisma.shift.findMany({
      where: { openedAt: { gte: range.start, lt: range.end } },
      orderBy: { openedAt: "asc" },
      select: {
        id: true, status: true, openedAt: true, closedAt: true, openingFloat: true, expectedCash: true, countedCash: true, variance: true,
        closeNote: true, reviewedAt: true, reviewNote: true, summary: true,
        user: { select: { fullName: true, username: true } },
        closedBy: { select: { fullName: true } },
        reviewedBy: { select: { fullName: true } },
      },
    });
    return {
      header: [
        "Shift ID", "Cashier", "Username", "Status", "Opened date", "Opened time", "Closed date", "Closed time", "Receipts",
        "Opening float (THB)", "Cash sales (THB)", "Cash refunds (THB)", "Cash voids (THB)", "Expected cash (THB)", "Counted cash (THB)",
        "Over / short (THB)", "Closing note", "Closed by", "Reviewed by", "Reviewed date", "Review note",
      ],
      rows: shifts.map((shift) => {
        const summary = (shift.summary ?? {}) as { orderCount?: number; voidedCount?: number; cashSales?: number; cashRefunds?: number; cashVoids?: number };
        const baht = (satang: number | undefined) => (satang === undefined ? null : (satang / 100).toFixed(2));
        return [
          shift.id, shift.user.fullName, shift.user.username, shift.status, bangkokYmd(shift.openedAt), bangkokTime(shift.openedAt),
          shift.closedAt ? bangkokYmd(shift.closedAt) : null, shift.closedAt ? bangkokTime(shift.closedAt) : null,
          summary.orderCount === undefined ? null : summary.orderCount - (summary.voidedCount ?? 0),
          shift.openingFloat.toFixed(2), baht(summary.cashSales), baht(summary.cashRefunds), baht(summary.cashVoids),
          shift.expectedCash?.toFixed(2) ?? null, shift.countedCash?.toFixed(2) ?? null, shift.variance?.toFixed(2) ?? null,
          shift.closeNote, shift.closedBy?.fullName ?? null, shift.reviewedBy?.fullName ?? null,
          shift.reviewedAt ? bangkokYmd(shift.reviewedAt) : null, shift.reviewNote,
        ];
      }),
      textColumns: [0],
    };
  }

  if (kind === "categories") {
    const categories = await prisma.category.findMany({
      orderBy: { code: "asc" },
      select: { code: true, name: true, nameTh: true, _count: { select: { products: true } } },
    });
    return {
      header: ["Category_Code", "Category_Name", "Category_Name_TH", "Products"],
      rows: categories.map((c) => [c.code, c.name, c.nameTh, c._count.products]),
      textColumns: [0],
    };
  }

  if (kind === "colors") {
    const colors = await prisma.color.findMany({
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, name: true, nameTh: true, _count: { select: { variants: true } } },
    });
    return {
      header: ["Color_Code", "Color_Name", "Color_Name_TH", "Variants"],
      rows: colors.map((c) => [c.code, c.name, c.nameTh, c._count.variants]),
      textColumns: [0],
    };
  }

  // members
  const members = await prisma.member.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, points: true, isActive: true, createdAt: true, _count: { select: { orders: true } } },
  });
  const spend = await prisma.order.groupBy({
    by: ["memberId"],
    where: { memberId: { not: null }, status: { not: "VOIDED" } },
    _sum: { totalAmount: true, refundedAmount: true },
  });
  const spendById = new Map(spend.map((row) => [row.memberId, Number(row._sum.totalAmount ?? 0) - Number(row._sum.refundedAmount ?? 0)]));
  return {
    header: ["Name", "Phone", "Points", "Orders", "Total spent (THB)", "Active", "Joined"],
    rows: members.map((m) => [
      m.name, m.phone, m.points, m._count.orders, (spendById.get(m.id) ?? 0).toFixed(2),
      m.isActive ? "Yes" : "No", bangkokYmd(m.createdAt),
    ]),
    textColumns: [1],
  };
}

/**
 * GET /api/admin/export?kind=...&format=csv|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * kind: payments, refunds, voids, summary, movements, shifts (date range), inventory, members (snapshot).
 * movements also accepts the ledger filters: type, reason, user, q.
 * Times are Bangkok time. Voided sales are excluded from payments and summary, and appear in voids.
 * CSV files carry a byte-order mark so Excel reads Thai text correctly.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  if (auth.user.role === "CASHIER") return apiError(403, "FORBIDDEN", "Manager access required.");

  const kind = request.nextUrl.searchParams.get("kind") ?? "";
  if (!(KINDS as readonly string[]).includes(kind)) {
    return apiError(400, "INVALID_KIND", `Choose one of: ${KINDS.join(", ")}.`);
  }
  const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const today = bangkokYmd();
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = isYmd(fromParam) ? fromParam : today;
  const to = isYmd(toParam) ? toParam : from;
  if (from > to) return apiError(400, "INVALID_RANGE", "The start date must be on or before the end date.");
  if (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() > 366 * 86_400_000) {
    return apiError(400, "RANGE_TOO_LONG", "Export at most one year at a time.");
  }

  try {
    const dataset = await buildDataset(kind as Kind, from, to, request.nextUrl.searchParams);
    const ranged = RANGED.includes(kind as Kind);
    const stem = `lifework-${kind}-${ranged ? from : today}${ranged && from !== to ? `_to_${to}` : ""}`;

    if (format === "xlsx") {
      const buffer = await buildXlsx(kind, dataset.header, dataset.rows, { textColumns: dataset.textColumns });
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${stem}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(toCsv(dataset.header, dataset.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/export]", err);
    return apiError(500, "INTERNAL_ERROR", "The export failed. Try a shorter date range.");
  }
}
