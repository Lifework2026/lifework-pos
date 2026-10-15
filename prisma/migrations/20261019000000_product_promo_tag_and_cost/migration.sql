-- Product promo tag and variant unit cost. Additive only: two nullable columns.
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "promoTag" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "cost" DECIMAL(12,2);

