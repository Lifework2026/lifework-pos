// Moves categories onto the official two-letter dictionary. Preview by default; writes only with --apply.
//
//   npx tsx scripts/migrate-category-codes.ts           preview only, writes nothing (the default)
//   npx tsx scripts/migrate-category-codes.ts --apply   writes the plan in one serializable transaction
//
// The apply step re-reads and re-plans inside the transaction. If anything in use would be lost, nothing is written.

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { planCategoryMigration, type LiveCategory, type MigrationPlan } from "../lib/category-migration";

async function readLive(db: Prisma.TransactionClient): Promise<LiveCategory[]> {
  const rows = await db.category.findMany({
    select: { id: true, code: true, name: true, slug: true, _count: { select: { products: true, promotions: true } } },
    orderBy: { code: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    slug: r.slug,
    products: r._count.products,
    promotions: r._count.promotions,
  }));
}

function printPlan(plan: MigrationPlan, live: LiveCategory[]): void {
  const byId = new Map(live.map((c) => [c.id, c]));
  console.log(`Create (${plan.create.length}):`);
  for (const c of plan.create) console.log(`  + ${c.code}  ${c.name}`);
  console.log(`Rename to official name (${plan.rename.length}):`);
  for (const r of plan.rename) console.log(`  ~ ${r.from}  ->  ${r.name}`);
  console.log(`Move products and promotions (${plan.moves.length}):`);
  for (const m of plan.moves) {
    const row = byId.get(m.sourceId);
    console.log(`  ${m.from} -> ${m.to}   products ${m.products}, promotions ${m.promotions}   (${row?.name ?? ""})`);
  }
  console.log(`Already migrated, not in the database (${plan.alreadyMigrated.length}):`);
  for (const a of plan.alreadyMigrated) console.log(`  = ${a.from} (-> ${a.to})`);
  console.log(`Delete (${plan.remove.length}):`);
  for (const r of plan.remove) console.log(`  - ${r.code}`);
  if (plan.abort.length) {
    console.log("ABORT:");
    for (const message of plan.abort) console.log(`  ! ${message}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  if (!apply) {
    const live = await readLive(prisma as unknown as Prisma.TransactionClient);
    const plan = planCategoryMigration(live);
    console.log("PREVIEW (nothing written). Run with --apply to write this plan:");
    printPlan(plan, live);
    return;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const live = await readLive(tx);
      const plan = planCategoryMigration(live);
      if (plan.abort.length) throw new Error(`Aborted, nothing written: ${plan.abort.join("; ")}`);

      for (const r of plan.rename) await tx.category.update({ where: { id: r.id }, data: { name: r.name } });
      for (const c of plan.create) {
        await tx.category.create({ data: { code: c.code, name: c.name, slug: c.slug } });
      }

      const after = await tx.category.findMany({ select: { id: true, code: true } });
      const idByCode = new Map(after.map((c) => [c.code, c.id]));
      let productsMoved = 0;
      let promotionsMoved = 0;
      for (const m of plan.moves) {
        const target = idByCode.get(m.to);
        if (!target) throw new Error(`Target ${m.to} is missing`);
        const products = await tx.product.updateMany({ where: { categoryId: m.sourceId }, data: { categoryId: target } });
        const promotions = await tx.promotion.updateMany({ where: { categoryId: m.sourceId }, data: { categoryId: target } });
        productsMoved += products.count;
        promotionsMoved += promotions.count;
      }

      // The delete repeats the check: a row still in use is kept, and the migration reports it.
      const removeIds = plan.remove.map((r) => r.id);
      const deleted = removeIds.length
        ? await tx.category.deleteMany({
            where: { id: { in: removeIds }, products: { none: {} }, promotions: { none: {} } },
          })
        : { count: 0 };
      if (deleted.count !== removeIds.length) {
        throw new Error(`Only ${deleted.count} of ${removeIds.length} legacy categories could be deleted; nothing written.`);
      }

      await tx.auditLog.create({
        data: {
          action: "CATEGORY_CODE_MIGRATION",
          entityType: "MasterData",
          entityId: "category-codes",
          reason: `${plan.create.length} created, ${plan.rename.length} renamed, ${productsMoved} products and ${promotionsMoved} promotions moved, ${deleted.count} legacy categories removed`,
          details: JSON.parse(JSON.stringify({ plan, productsMoved, promotionsMoved })),
        },
      });
      return { created: plan.create.length, renamed: plan.rename.length, productsMoved, promotionsMoved, removed: deleted.count };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 },
  );
  console.log("APPLIED:", JSON.stringify(result));
}

main()
  .catch((err) => {
    console.error("Nothing was written.", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
