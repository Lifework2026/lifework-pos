import { Prisma, type MovementType, type StockReason } from "@prisma/client";
import { bangkokDayRange } from "@/lib/bangkok";

/** Stock movement ledger: filters shared by the Back-Office page and the export, so both show the same rows. */

export const LEDGER_PAGE_SIZE = 50;
export const MOVEMENT_TYPES: MovementType[] = ["SALE", "RETURN", "VOID", "STOCK_IN", "ADJUSTMENT"];
export const STOCK_REASONS: StockReason[] = ["DAMAGED", "LOST", "COUNT_CORRECTION", "FOUND", "OTHER"];

export interface LedgerFilters {
  /** Store-time dates, YYYY-MM-DD, both inclusive. */
  from: string;
  to: string;
  type?: MovementType;
  reason?: StockReason;
  /** Staff member who made the change. */
  userId?: string;
  /** SKU, barcode, product name, receipt number or note. */
  q?: string;
}

export function parseMovementType(value: string | null | undefined): MovementType | undefined {
  return MOVEMENT_TYPES.find((type) => type === value);
}

export function parseStockReason(value: string | null | undefined): StockReason | undefined {
  return STOCK_REASONS.find((reason) => reason === value);
}

export function buildLedgerWhere(filters: LedgerFilters): Prisma.InventoryMovementWhereInput {
  const start = bangkokDayRange(filters.from).start;
  const end = bangkokDayRange(filters.to).end;
  const q = filters.q?.trim().slice(0, 100);

  return {
    createdAt: { gte: start, lt: end },
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.reason ? { reasonCode: filters.reason } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(q
      ? {
          OR: [
            { variant: { sku: { contains: q, mode: "insensitive" } } },
            { variant: { barcode: q } },
            { variant: { product: { name: { contains: q, mode: "insensitive" } } } },
            { variant: { product: { nameTh: { contains: q, mode: "insensitive" } } } },
            { reference: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}
