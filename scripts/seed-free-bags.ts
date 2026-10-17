// Creates the free shopping bags: Paper Bag and Rpet Bag, each in S, M and L, at 0 baht (six variants).
// Safe to run again: anything that already exists is left as it is. Preview by default.
//
//   npx tsx scripts/seed-free-bags.ts           preview
//   npx tsx scripts/seed-free-bags.ts --apply   creates what is missing
//
// The bags are not stock-counted: the till and the checkout recognise them by SKU (lib/catalog/free-bags.ts).

import path from "node:path";
import { FREE_BAG_TYPES, FREE_BAG_SIZES, freeBagSku } from "../lib/catalog/free-bags";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");

  const category = await prisma.category.findUnique({ where: { code: "BG" }, select: { id: true } });
  if (!category) throw new Error('The category with code "BG" (bags) does not exist.');
  const color = await prisma.color.findUnique({ where: { code: "ST" }, select: { id: true, name: true } });
  if (!color) throw new Error('The colour with code "ST" (Standard) does not exist.');

  let createdProducts = 0;
  let createdVariants = 0;
  for (const bag of FREE_BAG_TYPES) {
    const slug = `${bag.key.toLowerCase()}-bag`;
    let product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) {
      console.log(`+ product ${bag.name} (${slug})`);
      createdProducts++;
      if (apply) {
        product = await prisma.product.create({
          data: {
            name: bag.name,
            nameTh: bag.nameTh,
            slug,
            brand: "Lifework",
            description: "Free shopping bag. Not stock-counted.",
            categoryId: category.id,
          },
          select: { id: true },
        });
      }
    }
    for (const size of FREE_BAG_SIZES) {
      const sku = freeBagSku(bag.key, size);
      const exists = await prisma.productVariant.findUnique({ where: { sku }, select: { id: true } });
      if (exists) continue;
      console.log(`+ variant ${sku} (price 0.00)`);
      createdVariants++;
      if (apply && product) {
        await prisma.productVariant.create({
          data: { productId: product.id, size, color: color.name, colorId: color.id, sku, barcode: sku, price: "0.00", stockQuantity: 0 },
        });
      }
    }
  }
  console.log(`${apply ? "Created" : "Would create"} ${createdProducts} product(s) and ${createdVariants} variant(s).`);
  if (!apply) console.log("Preview only. Run again with --apply.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
