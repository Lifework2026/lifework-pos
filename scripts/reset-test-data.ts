// Clears the test products, stock and sales history so real stock can be imported into a clean till.
// Preview by default; deletes only with --apply.
//
//   npx tsx scripts/reset-test-data.ts           preview: counts only, changes nothing
//   npx tsx scripts/reset-test-data.ts --apply   saves every row to a JSON file in exports/, then deletes in one transaction
//
// Deleted:  sales (orders, items, payments, card payments, refunds), held bills, stock movements, products with their
//           variants and colour photos, and shifts (a shift only holds the sales above).
// Kept:     users, categories, colours, sizes, promotions, members, the audit log (one line is added about this reset),
//           and the Shopping Bag product with its bag variants, which checkout needs. Their stock goes back to what it
//           was before the test sales.
// Photo files of deleted products are removed from storage after the database commit.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const apply = process.argv.includes("--apply");
const BAG_SLUG = "shopping-bag";

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");

  // Children first, so every delete is allowed by the foreign keys.
  const tables = [
    ["RefundLine", () => prisma.refundLine.count(), () => prisma.refundLine.findMany(), () => prisma.refundLine.deleteMany()],
    ["RefundItem", () => prisma.refundItem.count(), () => prisma.refundItem.findMany(), () => prisma.refundItem.deleteMany()],
    ["Refund", () => prisma.refund.count(), () => prisma.refund.findMany(), () => prisma.refund.deleteMany()],
    ["EdcPayment", () => prisma.edcPayment.count(), () => prisma.edcPayment.findMany(), () => prisma.edcPayment.deleteMany()],
    ["Payment", () => prisma.payment.count(), () => prisma.payment.findMany(), () => prisma.payment.deleteMany()],
    ["OrderItem", () => prisma.orderItem.count(), () => prisma.orderItem.findMany(), () => prisma.orderItem.deleteMany()],
    ["Order", () => prisma.order.count(), () => prisma.order.findMany(), () => prisma.order.deleteMany()],
    ["HeldBill", () => prisma.heldBill.count(), () => prisma.heldBill.findMany(), () => prisma.heldBill.deleteMany()],
    ["InventoryMovement", () => prisma.inventoryMovement.count(), () => prisma.inventoryMovement.findMany(), () => prisma.inventoryMovement.deleteMany()],
    ["ProductColorImage", () => prisma.productColorImage.count(), () => prisma.productColorImage.findMany(), () => prisma.productColorImage.deleteMany()],
    ["ProductVariant", () => prisma.productVariant.count({ where: { product: { slug: { not: BAG_SLUG } } } }), () => prisma.productVariant.findMany({ where: { product: { slug: { not: BAG_SLUG } } } }), () => prisma.productVariant.deleteMany()],
    ["Product", () => prisma.product.count({ where: { slug: { not: BAG_SLUG } } }), () => prisma.product.findMany({ where: { slug: { not: BAG_SLUG } } }), () => prisma.product.deleteMany()],
    ["Shift", () => prisma.shift.count(), () => prisma.shift.findMany(), () => prisma.shift.deleteMany()],
  ] as const;

  console.log(apply ? "APPLY: these rows will be saved to a file and then deleted:" : "Preview (nothing is changed). Rows that would be deleted:");
  const counts: Record<string, number> = {};
  for (const [name, count] of tables) {
    counts[name] = await count();
    console.log(`  ${String(counts[name]).padStart(6)}  ${name}`);
  }
  const kept = {
    User: await prisma.user.count(),
    Category: await prisma.category.count(),
    Color: await prisma.color.count(),
    Size: await prisma.size.count(),
    Member: await prisma.member.count(),
    Promotion: await prisma.promotion.count(),
    AuditLog: await prisma.auditLog.count(),
  };
  const bags = await prisma.productVariant.findMany({ where: { product: { slug: BAG_SLUG } }, select: { id: true, sku: true, stockQuantity: true } });
  const opening = new Map<string, number>();
  for (const bag of bags) {
    const first = await prisma.inventoryMovement.findFirst({ where: { variantId: bag.id }, orderBy: { createdAt: "asc" }, select: { stockBefore: true } });
    opening.set(bag.id, first ? first.stockBefore : bag.stockQuantity);
  }
  console.log("Bag stock kept and restored:", bags.map((b) => `${b.sku} ${b.stockQuantity} -> ${opening.get(b.id)}`).join(", "));
  console.log("Kept:", Object.entries(kept).map(([k, v]) => `${k} ${v}`).join(", "));

  if (!apply) {
    console.log("\nPreview only. Run again with --apply to save a backup file and delete.");
    await prisma.$disconnect();
    return;
  }

  // 1. A restorable copy of everything that is about to go.
  const snapshot: Record<string, unknown> = {};
  for (const [name, , read] of tables) snapshot[name] = await read();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.resolve(process.cwd(), "exports", `test-data-backup-${stamp}.json`);
  mkdirSync(path.dirname(backup), { recursive: true });
  writeFileSync(backup, JSON.stringify(snapshot, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
  console.log(`Saved a copy to ${backup}`);

  const photoPaths = (await prisma.product.findMany({ where: { slug: { not: BAG_SLUG } }, select: { imagePath: true } })).map((p) => p.imagePath).filter((p): p is string => !!p);
  const colorPhotoPaths = (await prisma.productColorImage.findMany({ select: { imagePath: true } })).map((p) => p.imagePath);

  // 2. Delete everything in one transaction. If any step fails, nothing is deleted.
  await prisma.$transaction(
    async (tx) => {
      const txTables = [
        tx.refundLine, tx.refundItem, tx.refund, tx.edcPayment, tx.payment, tx.orderItem, tx.order,
        tx.heldBill, tx.inventoryMovement, tx.productColorImage,
      ];
      // Everything that references a variant goes first. Bags stay, so only the other variants and products are deleted.
      for (const table of txTables.slice(0, 9)) await (table as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
      await tx.productVariant.deleteMany({ where: { product: { slug: { not: BAG_SLUG } } } });
      await tx.product.deleteMany({ where: { slug: { not: BAG_SLUG } } });
      await tx.shift.deleteMany();
      for (const bag of bags) await tx.productVariant.update({ where: { id: bag.id }, data: { stockQuantity: opening.get(bag.id) } });
      await tx.auditLog.create({ data: { action: "TEST_DATA_RESET", entityType: "System", entityId: "reset", details: { deleted: counts, backupFile: path.basename(backup) } } });
    },
    { timeout: 60_000 },
  );
  console.log("Deleted.");

  // 3. Photo files that no product points to any more (an unused file is harmless if this fails).
  const { getStorageConfig, deleteProductImage } = await import("../lib/storage");
  const config = getStorageConfig();
  if (config) {
    let removed = 0;
    for (const p of [...photoPaths, ...colorPhotoPaths]) {
      try {
        await deleteProductImage(config, p);
        removed++;
      } catch {
        console.log(`  could not remove photo file ${p}`);
      }
    }
    console.log(`Removed ${removed} photo file(s) from storage.`);
  }
  for (const [name] of tables) console.log(`  ${String(await countAfter(prisma, name)).padStart(6)}  ${name} now`);
  console.log("Bags now:", JSON.stringify(await prisma.productVariant.findMany({ where: { product: { slug: BAG_SLUG } }, select: { sku: true, stockQuantity: true } })));
  await prisma.$disconnect();
}

async function countAfter(prisma: Awaited<typeof import("../lib/prisma")>["prisma"], name: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "public"."${name}"`);
  return rows[0].n;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
