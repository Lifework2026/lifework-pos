import { Prisma, type PaymentMethod } from "@prisma/client";
import { OrderError } from "@/lib/orders/errors";
import { satangToDecimal } from "@/lib/pricing";
import {
  expectedCashSatang,
  MAX_COUNTED_CASH_SATANG,
  MAX_OPENING_FLOAT_SATANG,
  varianceSatang,
} from "@/lib/shift-math";

/**
 * Cash-drawer shifts.
 *
 * Expected cash = opening float
 *               + cash taken on sales rung up in this shift (Order.shiftId)
 *               - cash paid back on refunds attributed to this shift (Refund.shiftId)
 *               - cash paid back on bills voided from this shift's drawer (Order.voidShiftId)
 *
 * A voided bill keeps its sale in the shift that rang it up, and the void is a cash-out in the shift whose
 * drawer paid the customer back. Within one shift the two cancel exactly. Across shifts, each closed count
 * stays correct.
 */

export class ShiftError extends OrderError {}

const METHODS: PaymentMethod[] = ["CASH", "CARD", "QR_PROMPTPAY", "BANK_TRANSFER", "OTHER"];
export type MethodTotals = Record<PaymentMethod, number>;

export interface ShiftTotals {
  /** Receipts rung up in the shift, including ones voided later. */
  orderCount: number;
  voidedCount: number;
  /** Sum of bill totals that are not voided, in satang. */
  salesTotal: number;
  /** Payments taken per channel, in satang. */
  sales: MethodTotals;
  /** Refund money paid back per channel, attributed to this shift. */
  refunds: MethodTotals;
  /** Money paid back for bills voided from this shift, per channel. */
  voids: MethodTotals;
  cashSales: number;
  cashRefunds: number;
  cashVoids: number;
}

type Db = Prisma.TransactionClient;

function satang(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.round(new Prisma.Decimal(value).toNumber() * 100);
}

function emptyTotals(): MethodTotals {
  return { CASH: 0, CARD: 0, QR_PROMPTPAY: 0, BANK_TRANSFER: 0, OTHER: 0 };
}

function fold(rows: { method: PaymentMethod; _sum: { amount: Prisma.Decimal | null } }[]): MethodTotals {
  const totals = emptyTotals();
  for (const row of rows) totals[row.method] += satang(row._sum.amount);
  return totals;
}

/** Everything that happened in a shift, computed from the receipts, so the count cannot be edited by hand. */
export async function computeShiftTotals(db: Db, shiftId: string): Promise<ShiftTotals> {
  const [salesRows, refundRows, voidRows, orderCount, voidedCount, salesAgg] = await Promise.all([
    db.payment.groupBy({ by: ["method"], where: { order: { shiftId } }, _sum: { amount: true } }),
    db.refundLine.groupBy({ by: ["method"], where: { refund: { shiftId } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["method"], where: { order: { voidShiftId: shiftId } }, _sum: { amount: true } }),
    db.order.count({ where: { shiftId } }),
    db.order.count({ where: { shiftId, status: "VOIDED" } }),
    db.order.aggregate({ where: { shiftId, status: { not: "VOIDED" } }, _sum: { totalAmount: true } }),
  ]);

  const sales = fold(salesRows);
  const refunds = fold(refundRows);
  const voids = fold(voidRows);
  return {
    orderCount,
    voidedCount,
    salesTotal: satang(salesAgg._sum.totalAmount),
    sales,
    refunds,
    voids,
    cashSales: sales.CASH,
    cashRefunds: refunds.CASH,
    cashVoids: voids.CASH,
  };
}

export function totalsToJson(totals: ShiftTotals): Prisma.InputJsonObject {
  const toRecord = (value: MethodTotals) => Object.fromEntries(METHODS.map((method) => [method, value[method]]));
  return {
    orderCount: totals.orderCount,
    voidedCount: totals.voidedCount,
    salesTotal: totals.salesTotal,
    sales: toRecord(totals.sales),
    refunds: toRecord(totals.refunds),
    voids: toRecord(totals.voids),
    cashSales: totals.cashSales,
    cashRefunds: totals.cashRefunds,
    cashVoids: totals.cashVoids,
  };
}

export function expectedForShift(openingFloatSatang: number, totals: ShiftTotals): number {
  return expectedCashSatang({
    openingFloat: openingFloatSatang,
    cashSales: totals.cashSales,
    cashRefunds: totals.cashRefunds,
    cashVoids: totals.cashVoids,
  });
}

export async function getOpenShift(db: Db, userId: string) {
  return db.shift.findFirst({ where: { userId, status: "OPEN" }, select: { id: true, openedAt: true, openingFloat: true, openNote: true } });
}

/** Opens a drawer session. The database allows one open shift per user, so a double tap cannot create two. */
export async function openShift(db: Db, userId: string, openingFloatSatang: number, note: string | null) {
  if (openingFloatSatang < 0 || openingFloatSatang > MAX_OPENING_FLOAT_SATANG) {
    throw new ShiftError(400, "INVALID_FLOAT", "Enter the starting cash between 0 and 100,000 baht.");
  }
  try {
    const shift = await db.shift.create({
      data: { userId, openingFloat: satangToDecimal(openingFloatSatang), openNote: note },
      select: { id: true, openedAt: true, openingFloat: true, openNote: true },
    });
    await db.auditLog.create({
      data: {
        action: "SHIFT_OPEN",
        entityType: "Shift",
        entityId: shift.id,
        userId,
        details: { openingFloat: satangToDecimal(openingFloatSatang) },
      },
    });
    return shift;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ShiftError(409, "SHIFT_ALREADY_OPEN", "You already have an open shift.");
    }
    throw err;
  }
}

export interface ShiftCloseResult {
  id: string;
  userId: string;
  openedAt: Date;
  closedAt: Date;
  openingFloat: string;
  expectedCash: string;
  countedCash: string;
  variance: string;
  totals: ShiftTotals;
}

/**
 * Closes a shift from the cash count. The expected figure is computed here from the receipts, never taken
 * from the client. A difference needs a written explanation.
 */
export async function closeShift(
  tx: Db,
  shiftId: string,
  input: { countedSatang: number; note: string | null; closedById: string; requireOwnerId?: string },
): Promise<ShiftCloseResult> {
  if (input.countedSatang < 0 || input.countedSatang > MAX_COUNTED_CASH_SATANG) {
    throw new ShiftError(400, "INVALID_COUNT", "Enter the cash you counted, 0 or more.");
  }
  const shift = await tx.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, userId: true, status: true, openedAt: true, openingFloat: true },
  });
  if (!shift || (input.requireOwnerId && shift.userId !== input.requireOwnerId)) {
    throw new ShiftError(404, "SHIFT_NOT_FOUND", "Shift not found.");
  }
  if (shift.status !== "OPEN") throw new ShiftError(409, "SHIFT_CLOSED", "This shift is already closed.");

  const totals = await computeShiftTotals(tx, shift.id);
  const expected = expectedForShift(satang(shift.openingFloat), totals);
  const variance = varianceSatang(input.countedSatang, expected);
  const note = input.note?.trim() || null;
  if (variance !== 0 && (!note || note.length < 3)) {
    throw new ShiftError(400, "NOTE_REQUIRED", "The count does not match. Write a short explanation before closing.");
  }

  const closedAt = new Date();
  const updated = await tx.shift.updateMany({
    where: { id: shift.id, status: "OPEN" },
    data: {
      status: "CLOSED",
      closedAt,
      closedById: input.closedById,
      expectedCash: satangToDecimal(expected),
      countedCash: satangToDecimal(input.countedSatang),
      variance: satangToDecimal(variance),
      closeNote: note,
      summary: totalsToJson(totals),
    },
  });
  if (updated.count !== 1) throw new ShiftError(409, "SHIFT_CLOSED", "This shift is already closed.");

  await tx.auditLog.create({
    data: {
      action: "SHIFT_CLOSE",
      entityType: "Shift",
      entityId: shift.id,
      userId: input.closedById,
      reason: note,
      details: {
        ownerId: shift.userId,
        openingFloat: satangToDecimal(satang(shift.openingFloat)),
        expectedCash: satangToDecimal(expected),
        countedCash: satangToDecimal(input.countedSatang),
        variance: satangToDecimal(variance),
        orderCount: totals.orderCount,
      },
    },
  });

  return {
    id: shift.id,
    userId: shift.userId,
    openedAt: shift.openedAt,
    closedAt,
    openingFloat: satangToDecimal(satang(shift.openingFloat)),
    expectedCash: satangToDecimal(expected),
    countedCash: satangToDecimal(input.countedSatang),
    variance: satangToDecimal(variance),
    totals,
  };
}

/**
 * Which open drawer pays cash out for a refund or void: the drawer that took the sale if it is still open,
 * else the acting user's own open shift, else the most recently opened shift. Null when nothing is open.
 */
export async function resolveCashShift(tx: Db, orderShiftId: string | null, actorId: string): Promise<string | null> {
  if (orderShiftId) {
    const original = await tx.shift.findFirst({ where: { id: orderShiftId, status: "OPEN" }, select: { id: true } });
    if (original) return original.id;
  }
  const own = await tx.shift.findFirst({ where: { userId: actorId, status: "OPEN" }, select: { id: true } });
  if (own) return own.id;
  const latest = await tx.shift.findFirst({ where: { status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true } });
  return latest?.id ?? null;
}

/** Throws when cash must leave a drawer but no shift is open to record it. */
export function requireDrawerForCash(shiftId: string | null, cashSatang: number): void {
  if (cashSatang > 0 && !shiftId) {
    throw new ShiftError(
      409,
      "NO_OPEN_SHIFT",
      "Cash is being paid back, but no cash-drawer shift is open to record it. Open a shift first.",
    );
  }
}

/** Reads the totals snapshot stored when a shift was closed. Returns null if the JSON is not in the expected shape. */
export function totalsFromSummary(summary: Prisma.JsonValue | null): ShiftTotals | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const raw = summary as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const methods = (value: unknown): MethodTotals => {
    const out = emptyTotals();
    if (value && typeof value === "object") {
      for (const method of METHODS) out[method] = num((value as Record<string, unknown>)[method]);
    }
    return out;
  };
  return {
    orderCount: num(raw.orderCount),
    voidedCount: num(raw.voidedCount),
    salesTotal: num(raw.salesTotal),
    sales: methods(raw.sales),
    refunds: methods(raw.refunds),
    voids: methods(raw.voids),
    cashSales: num(raw.cashSales),
    cashRefunds: num(raw.cashRefunds),
    cashVoids: num(raw.cashVoids),
  };
}
