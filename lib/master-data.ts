import type { Prisma } from "@prisma/client";

/**
 * Looks up colour names for colour ids in one query. Missing ids are simply absent from the map, so the caller
 * decides how to refuse them. Server-only: it takes a Prisma client or transaction.
 */
export async function colorNamesById(db: Prisma.TransactionClient, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const rows = await db.color.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}
