-- Master data with catalog codes.
--
-- 1. Category.code: every category gets a unique code. Existing rows get readable codes from their slugs.
-- 2. Color: a new master table. Existing colours are copied from the variants, so nothing is lost.
-- 3. ProductVariant.colorId: links each variant to its colour. The text column "color" is kept in step with the name.
--
-- Additive and data-preserving. No table is dropped, reset or truncated. Every step runs in the migration
-- transaction, and each backfill is checked by the NOT NULL step that follows it.

-- 1. Category.code -------------------------------------------------------------
ALTER TABLE "Category" ADD COLUMN "code" TEXT;

UPDATE "Category" AS c
SET "code" = CASE c."slug"
    WHEN 'supplies' THEN 'CAT-SUP'
    WHEN 'shirts' THEN 'CAT-SHIRT'
    WHEN 'pants' THEN 'CAT-PANT'
    WHEN 'dresses' THEN 'CAT-DRESS'
    WHEN 'outerwear' THEN 'CAT-OUTER'
    WHEN 'accessories' THEN 'CAT-ACC'
    ELSE 'CAT-' || lpad(t.rn::text, 3, '0')
  END
FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "Category"
) AS t
WHERE c."id" = t."id" AND c."code" IS NULL;

ALTER TABLE "Category" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- 2. Color master data ---------------------------------------------------------
CREATE TABLE "Color" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTh" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Color_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Color_code_key" ON "Color"("code");
CREATE UNIQUE INDEX "Color_name_key" ON "Color"("name");

-- One colour per distinct name already used by a variant.
INSERT INTO "Color" ("id", "code", "name", "nameTh", "sortOrder", "updatedAt")
SELECT
  'col_' || md5(d."color"),
  'COL-' || lpad(d.rn::text, 3, '0'),
  d."color",
  NULL,
  d.rn,
  CURRENT_TIMESTAMP
FROM (
  SELECT "color", row_number() OVER (ORDER BY "color") AS rn
  FROM (SELECT DISTINCT "color" FROM "ProductVariant") AS distinct_colors
) AS d;

-- The shopping-bag colour gets a readable code.
UPDATE "Color" SET "code" = 'COL-STD' WHERE "name" = 'Standard';

-- 3. ProductVariant.colorId ----------------------------------------------------
ALTER TABLE "ProductVariant" ADD COLUMN "colorId" TEXT;

UPDATE "ProductVariant" AS v
SET "colorId" = c."id"
FROM "Color" AS c
WHERE c."name" = v."color";

ALTER TABLE "ProductVariant" ALTER COLUMN "colorId" SET NOT NULL;
CREATE INDEX "ProductVariant_colorId_idx" ON "ProductVariant"("colorId");
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
