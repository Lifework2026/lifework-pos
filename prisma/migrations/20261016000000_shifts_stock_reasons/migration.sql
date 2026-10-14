-- Shifts (cash drawer sessions), stock adjustment reasons, and the links that tie sales,
-- voids and refunds to the shift whose drawer they affected. Additive only.

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('DAMAGED', 'LOST', 'COUNT_CORRECTION', 'FOUND', 'OTHER');

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "reasonCode" "StockReason";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shiftId" TEXT,
ADD COLUMN     "voidShiftId" TEXT;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "shiftId" TEXT;

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloat" DECIMAL(12,2) NOT NULL,
    "openNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "expectedCash" DECIMAL(12,2),
    "countedCash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "closeNote" TEXT,
    "summary" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Shift_openingFloat_nonnegative" CHECK ("openingFloat" >= 0),
    CONSTRAINT "Shift_countedCash_nonnegative" CHECK ("countedCash" IS NULL OR "countedCash" >= 0),
    CONSTRAINT "Shift_closed_has_count" CHECK ("status" = 'OPEN' OR ("closedAt" IS NOT NULL AND "countedCash" IS NOT NULL AND "expectedCash" IS NOT NULL AND "variance" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "Shift_userId_status_idx" ON "Shift"("userId", "status");

-- CreateIndex
CREATE INDEX "Shift_openedAt_idx" ON "Shift"("openedAt");

-- CreateIndex
CREATE INDEX "Shift_status_openedAt_idx" ON "Shift"("status", "openedAt");

-- One open shift per user, enforced by the database (Prisma cannot express a partial index).
-- A second concurrent "open shift" request fails with a unique violation instead of creating a duplicate drawer.
CREATE UNIQUE INDEX "Shift_one_open_per_user" ON "Shift"("userId") WHERE "status" = 'OPEN';

-- CreateIndex
CREATE INDEX "InventoryMovement_userId_createdAt_idx" ON "InventoryMovement"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");

-- CreateIndex
CREATE INDEX "Order_shiftId_idx" ON "Order"("shiftId");

-- CreateIndex
CREATE INDEX "Order_voidShiftId_idx" ON "Order"("voidShiftId");

-- CreateIndex
CREATE INDEX "Refund_shiftId_idx" ON "Refund"("shiftId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_voidShiftId_fkey" FOREIGN KEY ("voidShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
