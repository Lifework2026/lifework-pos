-- Full tax invoice fields on Order. Additive only: nullable columns and one unique index.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "taxCustomerAddress" TEXT,
ADD COLUMN     "taxCustomerBranch" TEXT,
ADD COLUMN     "taxCustomerName" TEXT,
ADD COLUMN     "taxCustomerTaxId" TEXT,
ADD COLUMN     "taxInvoiceAt" TIMESTAMP(3),
ADD COLUMN     "taxInvoiceNo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_taxInvoiceNo_key" ON "Order"("taxInvoiceNo");

