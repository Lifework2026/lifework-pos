// Brings the category and colour codes in line with the standard matrix. Insert and rename only; nothing is deleted.
//
//   npx tsx scripts/sync-catalog-matrix.ts           preview only, writes nothing (the default)
//   npx tsx scripts/sync-catalog-matrix.ts --apply   writes the plan in one serializable transaction
//
// Run the preview first and read it. The apply step repeats the planning inside the transaction, so a row that changed
// since the preview is planned again rather than written blindly.

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { planMatrixSync, type SyncPlan } from "../lib/catalog-matrix-sync";

function printPlan(plan: SyncPlan): void {
  const lines: string[] = [];
  for (const r of plan.renameCategories) lines.push(`  category  rename  ${r.from} -> ${r.to}   (${r.name})`);
  for (const c of plan.createCategories) lines.push(`  category  create  ${c.code}   (${c.name})`);
  for (const r of plan.renameColors) lines.push(`  colour    rename  ${r.from} -> ${r.to}   (${r.name})`);
  for (const c of plan.createColors) lines.push(`  colour    create  ${c.code}   (${c.name})`);
  console.log(lines.length ? lines.join("\n") : "  nothing to change");
  if (plan.unchanged.length) console.log(`Already in place: ${plan.unchanged.join(", ")}`);
  for (const message of plan.conflicts) console.log(`CONFLICT: ${message}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const readPlan = async (db: Prisma.TransactionClient) => {
    const [categories, colors] = await Promise.all([
      db.category.findMany({ select: { id: true, code: true, name: true, slug: true } }),
      db.color.findMany({ select: { id: true, code: true, name: true } }),
    ]);
    return { plan: planMatrixSync(categories, colors), colorsMax: await db.color.aggregate({ _max: { sortOrder: true } }) };
  };

  if (!apply) {
    const { plan } = await readPlan(prisma as unknown as Prisma.TransactionClient);
    console.log("PREVIEW (nothing written). Run with --apply to write this plan:");
    printPlan(plan);
    return;
  }

  const applied = await prisma.$transaction(
    async (tx) => {
      const { plan, colorsMax } = await readPlan(tx);
      for (const r of plan.renameCategories) await tx.category.update({ where: { id: r.id }, data: { code: r.to } });
      for (const c of plan.createCategories) {
        await tx.category.create({ data: { code: c.code, name: c.name, nameTh: c.nameTh, slug: c.slug } });
      }
      for (const r of plan.renameColors) await tx.color.update({ where: { id: r.id }, data: { code: r.to } });
      let order = (colorsMax._max.sortOrder ?? 0) + 1;
      for (const c of plan.createColors) {
        await tx.color.create({ data: { code: c.code, name: c.name, nameTh: c.nameTh, sortOrder: order } });
        order += 1;
      }
      await tx.auditLog.create({
        data: {
          action: "MASTER_MATRIX_SYNC",
          entityType: "MasterData",
          entityId: "matrix",
          reason: `${plan.renameCategories.length + plan.createCategories.length} category and ${plan.renameColors.length + plan.createColors.length} colour changes`,
          details: JSON.parse(JSON.stringify(plan)),
        },
      });
      return plan;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 },
  );
  console.log("APPLIED:");
  printPlan(applied);
}

main()
  .catch((err) => {
    console.error("Nothing was written.", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
