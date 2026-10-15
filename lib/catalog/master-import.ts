import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { CODE_PATTERN, CODE_RULE_MESSAGE } from "@/lib/master-codes";
import { slugify } from "@/lib/slug";

/**
 * Templates D (categories) and E (colours): bulk create-or-update of master data, keyed by code.
 *   A code that exists is updated (its name changes). A code that does not exist is created.
 *   A name that another record already uses is refused, so two codes can never share a name.
 * Renaming a colour renames it on every variant that uses it. Commit is all or nothing.
 */

export const CATEGORY_TEMPLATE_HEADER = ["Category_Code", "Category_Name"];
export const COLOR_TEMPLATE_HEADER = ["Color_Code", "Color_Name"];
export const MAX_MASTER_ROWS = 2000;
const EXAMPLE_PREFIX = "EXAMPLE-";

export type MasterKind = "category" | "color";

export interface MasterRow {
  line: number;
  code: string;
  name: string;
}

export interface MasterIssue {
  line: number;
  message: string;
}

const LIMITS: Record<MasterKind, { name: number }> = {
  category: { name: 80 },
  color: { name: 40 },
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Pure: checks the header and every row. */
export function parseMasterTable(
  table: string[][],
  kind: MasterKind,
): { rows: MasterRow[]; issues: MasterIssue[]; unknownColumns: string[] } {
  const codeKey = kind === "category" ? "categorycode" : "colorcode";
  const nameKey = kind === "category" ? "categoryname" : "colorname";
  const label = kind === "category" ? "Category" : "Color";
  if (table.length === 0) return { rows: [], issues: [{ line: 1, message: "The file is empty." }], unknownColumns: [] };

  let codeCol: number | undefined;
  let nameCol: number | undefined;
  const unknownColumns: string[] = [];
  table[0].forEach((cell, index) => {
    if (!cell.trim()) return;
    const key = normalizeHeader(cell);
    if (key === codeKey && codeCol === undefined) codeCol = index;
    else if (key === nameKey && nameCol === undefined) nameCol = index;
    else unknownColumns.push(cell);
  });

  const issues: MasterIssue[] = [];
  if (codeCol === undefined) issues.push({ line: 1, message: `Required column "${label}_Code" is missing.` });
  if (nameCol === undefined) issues.push({ line: 1, message: `Required column "${label}_Name" is missing.` });
  if (issues.length > 0) return { rows: [], issues, unknownColumns };

  const dataRows = table.slice(1);
  if (dataRows.length === 0) return { rows: [], issues: [{ line: 1, message: "The file has a header but no rows." }], unknownColumns };
  if (dataRows.length > MAX_MASTER_ROWS) {
    return { rows: [], issues: [{ line: 1, message: `The file has ${dataRows.length} rows. The limit is ${MAX_MASTER_ROWS}.` }], unknownColumns };
  }

  const rows: MasterRow[] = [];
  dataRows.forEach((cells, offset) => {
    const line = offset + 2;
    const code = (cells[codeCol!] ?? "").trim().toUpperCase();
    const name = (cells[nameCol!] ?? "").trim();
    const problems: string[] = [];
    if (!code) problems.push(`${label}_Code is required.`);
    else if (code.startsWith(EXAMPLE_PREFIX)) problems.push("This is the example row from the template. Delete it, then upload again.");
    else if (!CODE_PATTERN.test(code)) problems.push(`${label}_Code '${code}': ${CODE_RULE_MESSAGE}`);
    if (!name) problems.push(`${label}_Name is required.`);
    else if (name.length > LIMITS[kind].name) problems.push(`${label}_Name is longer than ${LIMITS[kind].name} characters.`);
    if (problems.length > 0) {
      for (const message of problems) issues.push({ line, message });
      return;
    }
    rows.push({ line, code, name });
  });

  const codeLine = new Map<string, number>();
  const nameLine = new Map<string, number>();
  for (const row of rows) {
    const firstCode = codeLine.get(row.code);
    if (firstCode !== undefined) issues.push({ line: row.line, message: `${label}_Code ${row.code} is already on line ${firstCode}.` });
    else codeLine.set(row.code, row.line);
    const key = row.name.toLowerCase();
    const firstName = nameLine.get(key);
    if (firstName !== undefined) issues.push({ line: row.line, message: `${label}_Name ${row.name} is already on line ${firstName}.` });
    else nameLine.set(key, row.line);
  }
  return { rows, issues, unknownColumns };
}

export interface CategoryPlan {
  creates: { id: string; code: string; name: string; slug: string; line: number }[];
  updates: { id: string; code: string; from: string; to: string; line: number }[];
  unchanged: number;
  issues: MasterIssue[];
}

/** Reads the categories and decides create, update or unchanged for each row. */
export async function planCategories(db: Prisma.TransactionClient, rows: MasterRow[]): Promise<CategoryPlan> {
  const existing = await db.category.findMany({ select: { id: true, code: true, name: true, slug: true } });
  const byCode = new Map(existing.map((c) => [c.code, c]));
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
  const slugs = new Set(existing.map((c) => c.slug));
  const issues: MasterIssue[] = [];
  const creates: CategoryPlan["creates"] = [];
  const updates: CategoryPlan["updates"] = [];
  let unchanged = 0;

  for (const row of rows) {
    const nameOwner = byName.get(row.name.toLowerCase());
    const current = byCode.get(row.code);
    if (current) {
      if (current.name === row.name) {
        unchanged += 1;
        continue;
      }
      if (nameOwner && nameOwner.code !== row.code) {
        issues.push({ line: row.line, message: `Category name ${row.name} is already used by ${nameOwner.code}.` });
        continue;
      }
      updates.push({ id: current.id, code: row.code, from: current.name, to: row.name, line: row.line });
      continue;
    }
    if (nameOwner) {
      issues.push({ line: row.line, message: `Category name ${row.name} already exists under code ${nameOwner.code}.` });
      continue;
    }
    const base = slugify(row.name);
    let slug = base;
    for (let n = 2; slugs.has(slug); n += 1) slug = `${base}-${n}`;
    slugs.add(slug);
    const planned = { id: randomUUID(), code: row.code, name: row.name, slug, line: row.line };
    creates.push(planned);
    byName.set(row.name.toLowerCase(), { id: planned.id, code: row.code, name: row.name, slug });
    byCode.set(row.code, { id: planned.id, code: row.code, name: row.name, slug });
  }
  return { creates, updates, unchanged, issues };
}

export async function commitCategories(tx: Prisma.TransactionClient, plan: CategoryPlan, userId: string, fileName: string): Promise<void> {
  if (plan.creates.length > 0) {
    await tx.category.createMany({ data: plan.creates.map((c) => ({ id: c.id, code: c.code, name: c.name, slug: c.slug })) });
  }
  for (const update of plan.updates) {
    await tx.category.update({ where: { id: update.id }, data: { name: update.to } });
  }
  await tx.auditLog.create({
    data: {
      action: "CATEGORY_IMPORT",
      entityType: "Category",
      entityId: fileName.slice(0, 100),
      userId,
      reason: `${plan.creates.length} created, ${plan.updates.length} updated, ${plan.unchanged} unchanged`,
      details: { fileName, created: plan.creates.map((c) => c.code), updated: plan.updates.map((u) => ({ code: u.code, from: u.from, to: u.to })) },
    },
  });
}

export interface ColorPlan {
  creates: { id: string; code: string; name: string; sortOrder: number; line: number }[];
  updates: { id: string; code: string; from: string; to: string; line: number }[];
  unchanged: number;
  issues: MasterIssue[];
}

export async function planColors(db: Prisma.TransactionClient, rows: MasterRow[]): Promise<ColorPlan> {
  const [existing, last] = await Promise.all([
    db.color.findMany({ select: { id: true, code: true, name: true, sortOrder: true } }),
    db.color.aggregate({ _max: { sortOrder: true } }),
  ]);
  const byCode = new Map(existing.map((c) => [c.code, c]));
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
  const issues: MasterIssue[] = [];
  const creates: ColorPlan["creates"] = [];
  const updates: ColorPlan["updates"] = [];
  let unchanged = 0;
  let nextOrder = (last._max.sortOrder ?? 0) + 1;

  for (const row of rows) {
    const nameOwner = byName.get(row.name.toLowerCase());
    const current = byCode.get(row.code);
    if (current) {
      if (current.name === row.name) {
        unchanged += 1;
        continue;
      }
      if (nameOwner && nameOwner.code !== row.code) {
        issues.push({ line: row.line, message: `Colour name ${row.name} is already used by ${nameOwner.code}.` });
        continue;
      }
      updates.push({ id: current.id, code: row.code, from: current.name, to: row.name, line: row.line });
      continue;
    }
    if (nameOwner) {
      issues.push({ line: row.line, message: `Colour name ${row.name} already exists under code ${nameOwner.code}.` });
      continue;
    }
    const planned = { id: randomUUID(), code: row.code, name: row.name, sortOrder: nextOrder, line: row.line };
    nextOrder += 1;
    creates.push(planned);
    byName.set(row.name.toLowerCase(), { id: planned.id, code: row.code, name: row.name, sortOrder: planned.sortOrder });
    byCode.set(row.code, { id: planned.id, code: row.code, name: row.name, sortOrder: planned.sortOrder });
  }
  return { creates, updates, unchanged, issues };
}

export async function commitColors(tx: Prisma.TransactionClient, plan: ColorPlan, userId: string, fileName: string): Promise<void> {
  if (plan.creates.length > 0) {
    await tx.color.createMany({
      data: plan.creates.map((c) => ({ id: c.id, code: c.code, name: c.name, sortOrder: c.sortOrder })),
    });
  }
  for (const update of plan.updates) {
    await tx.color.update({ where: { id: update.id }, data: { name: update.to } });
    // The text copy on every variant follows the colour name, so the till and reports show the new name.
    await tx.productVariant.updateMany({ where: { colorId: update.id }, data: { color: update.to } });
  }
  await tx.auditLog.create({
    data: {
      action: "COLOR_IMPORT",
      entityType: "Color",
      entityId: fileName.slice(0, 100),
      userId,
      reason: `${plan.creates.length} created, ${plan.updates.length} renamed, ${plan.unchanged} unchanged`,
      details: { fileName, created: plan.creates.map((c) => c.code), renamed: plan.updates.map((u) => ({ code: u.code, from: u.from, to: u.to })) },
    },
  });
}
