import type { Prisma } from "@prisma/client";

/** Adds any sizes missing from the managed list, so sizes typed into a product form appear in the pickers next time. */
export async function ensureSizes(tx: Prisma.TransactionClient, names: string[]): Promise<void> {
  const wanted = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed) wanted.set(trimmed.toLowerCase(), trimmed);
  }
  if (wanted.size === 0) return;

  const existing = await tx.size.findMany({ select: { name: true } });
  const known = new Set(existing.map((size) => size.name.toLowerCase()));
  const missing = Array.from(wanted.entries()).filter(([key]) => !known.has(key)).map(([, name]) => name);
  if (missing.length === 0) return;

  const last = await tx.size.aggregate({ _max: { sortOrder: true } });
  const start = (last._max.sortOrder ?? 0) + 1;
  await tx.size.createMany({
    data: missing.map((name, index) => ({ name, sortOrder: start + index })),
    skipDuplicates: true,
  });
}
