// Test stock for trying the till, and the way back. This writes to whatever database .env points at, which for this project is the
// live one, so it is made to be undone exactly.
//
//   npx tsx scripts/mock-stock.ts                  preview: what would change, nothing is written
//   npx tsx scripts/mock-stock.ts --apply          adds 10 to every variant except the carrier bags (--qty N for another number)
//   npx tsx scripts/mock-stock.ts --revert         puts every stock figure back to what it was, and removes the test bills
//   npx tsx scripts/mock-stock.ts --clear-bills    removes only the test bills made since --apply and gives their stock back; the test stock stays
//
// --apply saves a snapshot (exports/mock-stock-snapshot.json) of every stock figure first and writes one ledger line per
// variant (type ADJUSTMENT, reference MOCK-STOCK). --revert deletes every bill, card payment, held bill and ledger line
// created since that snapshot, then restores the saved figures. Use it before the shop opens for real.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const revert = args.includes("--revert");
const clearBills = args.includes("--clear-bills");
const qtyArg = args.indexOf("--qty");
const quantity = qtyArg >= 0 ? Number(args[qtyArg + 1]) : 10;
const BAG_SLUG = "shopping-bag";
const REFERENCE = "MOCK-STOCK";
const snapshotFile = path.resolve(process.cwd(), "exports", "mock-stock-snapshot.json");

interface Snapshot {
  at: string;
  quantity: number;
  stock: Record<string, number>;
}

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("--qty must be a whole number from 1 to 1000.");
  const { prisma } = await import("../lib/prisma");
  const { Prisma } = await import("@prisma/client");

  if (clearBills) {
    if (!existsSync(snapshotFile)) throw new Error(`There is no snapshot at ${snapshotFile}, so there is no test period to clear.`);
    const since = new Date((JSON.parse(readFileSync(snapshotFile, "utf8")) as Snapshot).at);
    // Every stock change since the test stock went in (sales, returns, voids) is undone, the test stock itself is not.
    const moves = await prisma.inventoryMovement.groupBy({
      by: ["variantId"],
      where: { createdAt: { gt: since }, OR: [{ reference: null }, { reference: { not: REFERENCE } }] },
      _sum: { quantityChange: true },
    });
    const orders = await prisma.order.count({ where: { createdAt: { gt: since } } });
    console.log(`Since the test stock went in: ${orders} bill(s), stock moved on ${moves.length} variant(s).`);
    if (!apply) {
      console.log("Preview only. Run again with --clear-bills --apply to remove them.");
      await prisma.$disconnect();
      return;
    }
    await prisma.$transaction(
      async (tx) => {
        for (const move of moves) {
          const change = move._sum.quantityChange ?? 0;
          if (change !== 0) await tx.productVariant.update({ where: { id: move.variantId }, data: { stockQuantity: { decrement: change } } });
        }
        await tx.inventoryMovement.deleteMany({ where: { createdAt: { gt: since }, OR: [{ reference: null }, { reference: { not: REFERENCE } }] } });
        await tx.refund.deleteMany({ where: { order: { createdAt: { gt: since } } } }); // a refund holds on to the lines and payments it paid back
        await tx.order.deleteMany({ where: { createdAt: { gt: since } } });
        await tx.edcPayment.deleteMany({ where: { createdAt: { gt: since } } });
        await tx.heldBill.deleteMany({ where: { createdAt: { gt: since } } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
    );
    console.log("Done. The test bills are gone and their stock is back. The test stock is still there.");
    await prisma.$disconnect();
    return;
  }

  if (revert) {
    if (!existsSync(snapshotFile)) throw new Error(`There is no snapshot at ${snapshotFile}, so there is nothing to put back.`);
    const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")) as Snapshot;
    const since = new Date(snapshot.at);
    const [orders, movements, edc, held] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: since } } }),
      prisma.inventoryMovement.count({ where: { createdAt: { gte: since } } }),
      prisma.edcPayment.count({ where: { createdAt: { gte: since } } }),
      prisma.heldBill.count({ where: { createdAt: { gte: since } } }),
    ]);
    console.log(`Since ${snapshot.at}: ${orders} bill(s), ${movements} ledger line(s), ${edc} card payment(s), ${held} held bill(s).`);
    console.log(`Stock figures to restore: ${Object.keys(snapshot.stock).length} variants.`);
    if (!apply) {
      console.log("\nPreview only. Run again with --revert --apply to do it.");
      await prisma.$disconnect();
      return;
    }
    const ids = Object.keys(snapshot.stock);
    const values = ids.map((id) => snapshot.stock[id]);
    await prisma.$transaction(
      async (tx) => {
        await tx.inventoryMovement.deleteMany({ where: { createdAt: { gte: since } } });
        // A refund holds on to the bill lines and payments it paid back, so refunds go first; then items and payments go with the bill.
        await tx.refund.deleteMany({ where: { order: { createdAt: { gte: since } } } });
        await tx.order.deleteMany({ where: { createdAt: { gte: since } } });
        await tx.edcPayment.deleteMany({ where: { createdAt: { gte: since } } });
        await tx.heldBill.deleteMany({ where: { createdAt: { gte: since } } });
        await tx.$executeRaw`UPDATE "ProductVariant" v SET "stockQuantity" = s.q FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${values}::int[]) AS q) s WHERE v.id = s.id`;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
    );
    renameSync(snapshotFile, `${snapshotFile}.reverted-${Date.now()}`);
    const left = await prisma.productVariant.aggregate({ _sum: { stockQuantity: true } });
    console.log(`Done. Test bills removed and stock restored. Total stock in the system is now ${left._sum.stockQuantity}.`);
    await prisma.$disconnect();
    return;
  }

  const variants = await prisma.productVariant.findMany({
    where: { product: { slug: { not: BAG_SLUG } } },
    select: { id: true, stockQuantity: true },
  });
  const all = await prisma.productVariant.findMany({ select: { id: true, stockQuantity: true } });
  console.log(`${variants.length} variants would get +${quantity} (the bags are skipped). Stock now: ${variants.reduce((s, v) => s + v.stockQuantity, 0)} units.`);
  if (!apply) {
    console.log("\nPreview only. Run again with --apply to add it.");
    await prisma.$disconnect();
    return;
  }
  if (existsSync(snapshotFile)) throw new Error("Test stock is already added (a snapshot exists). Run --revert first.");

  const at = new Date();
  const snapshot: Snapshot = { at: at.toISOString(), quantity, stock: Object.fromEntries(all.map((v) => [v.id, v.stockQuantity])) };
  mkdirSync(path.dirname(snapshotFile), { recursive: true });
  writeFileSync(snapshotFile, JSON.stringify(snapshot));
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.productVariant.updateMany({ where: { product: { slug: { not: BAG_SLUG } } }, data: { stockQuantity: { increment: quantity } } });
        const rows = variants.map((v) => ({
          variantId: v.id,
          type: "ADJUSTMENT" as const,
          quantityChange: quantity,
          stockBefore: v.stockQuantity,
          stockAfter: v.stockQuantity + quantity,
          reference: REFERENCE,
          note: "TEST STOCK. Remove with scripts/mock-stock.ts --revert before opening.",
          createdAt: at,
        }));
        for (let i = 0; i < rows.length; i += 500) await tx.inventoryMovement.createMany({ data: rows.slice(i, i + 500) });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
    );
  } catch (err) {
    renameSync(snapshotFile, `${snapshotFile}.failed-${Date.now()}`);
    throw err;
  }
  const after = await prisma.productVariant.aggregate({ where: { product: { slug: { not: BAG_SLUG } } }, _sum: { stockQuantity: true }, _min: { stockQuantity: true } });
  console.log(`Done. Every variant now has at least ${after._min.stockQuantity}; ${after._sum.stockQuantity} units in total.`);
  console.log(`Snapshot saved to ${snapshotFile}. To undo: npx tsx scripts/mock-stock.ts --revert --apply`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
