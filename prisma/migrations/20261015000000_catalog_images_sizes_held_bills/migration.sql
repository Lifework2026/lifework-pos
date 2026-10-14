-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imagePath" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- CreateTable
CREATE TABLE "Size" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Size_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeldBill" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "payload" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeldBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Size_name_key" ON "Size"("name");

-- CreateIndex
CREATE INDEX "Size_sortOrder_idx" ON "Size"("sortOrder");

-- CreateIndex
CREATE INDEX "HeldBill_createdAt_idx" ON "HeldBill"("createdAt");

-- AddForeignKey
ALTER TABLE "HeldBill" ADD CONSTRAINT "HeldBill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

