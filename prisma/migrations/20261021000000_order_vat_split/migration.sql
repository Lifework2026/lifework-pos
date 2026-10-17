-- Stores the VAT split on every order. Additive: two new columns, filled from the existing totals, then constrained.
-- Prices include 7% VAT, so for each order: vat = total x 7 / 107 (to the satang), net = total - vat.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "netAmount" DECIMAL(12,2),
ADD COLUMN     "vatAmount" DECIMAL(12,2);

-- Backfill the orders that already exist. Same rule the application uses at checkout.
UPDATE "Order"
SET "vatAmount" = ROUND("totalAmount" * 7 / 107, 2),
    "netAmount" = "totalAmount" - ROUND("totalAmount" * 7 / 107, 2);

-- Every order now has both figures.
ALTER TABLE "Order" ALTER COLUMN "netAmount" SET NOT NULL,
ALTER COLUMN "vatAmount" SET NOT NULL;

-- The two parts always add up to the grand total, so a receipt can never show figures that disagree.
ALTER TABLE "Order" ADD CONSTRAINT "Order_vat_split_check"
  CHECK ("netAmount" + "vatAmount" = "totalAmount" AND "netAmount" >= 0 AND "vatAmount" >= 0);
