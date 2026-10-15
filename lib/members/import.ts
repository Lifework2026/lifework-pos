import { cellText } from "@/lib/text-columns";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { normalizePhone } from "@/lib/phone";

/**
 * Template F: bulk create-or-update of members, keyed by phone number.
 *   A phone that exists is updated: name and, when given, the point balance.
 *   A phone that does not exist is created with the given points (or 0).
 * Points is the balance to set, not an amount to add. A blank Points cell keeps the current balance.
 * Commit is all or nothing and writes one audit entry listing every change.
 */

export const MEMBER_TEMPLATE_HEADER = ["Phone_Number", "First_Name", "Last_Name", "Points"];
export const MAX_MEMBER_ROWS = 2000;
export const MAX_POINTS = 1_000_000;
const EXAMPLE_FIRST_NAME = "EXAMPLE";

export interface MemberRow {
  line: number;
  phone: string;
  name: string;
  /** null keeps the current balance (or starts a new member at 0). */
  points: number | null;
}

export interface MemberIssue {
  line: number;
  message: string;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const COLUMN_KEYS: Record<string, "phone" | "first" | "last" | "points"> = {
  phonenumber: "phone",
  phone: "phone",
  firstname: "first",
  lastname: "last",
  points: "points",
};

/** Pure: checks the header and every row. */
export function parseMemberTable(table: string[][]): { rows: MemberRow[]; issues: MemberIssue[]; unknownColumns: string[] } {
  if (table.length === 0) return { rows: [], issues: [{ line: 1, message: "The file is empty." }], unknownColumns: [] };
  const cols: Partial<Record<"phone" | "first" | "last" | "points", number>> = {};
  const unknownColumns: string[] = [];
  table[0].forEach((cell, index) => {
    if (!cell.trim()) return;
    const key = COLUMN_KEYS[normalizeHeader(cell)];
    if (!key) unknownColumns.push(cell);
    else if (cols[key] === undefined) cols[key] = index;
  });

  const issues: MemberIssue[] = [];
  if (cols.phone === undefined) issues.push({ line: 1, message: 'Required column "Phone_Number" is missing.' });
  if (cols.first === undefined) issues.push({ line: 1, message: 'Required column "First_Name" is missing.' });
  if (issues.length > 0) return { rows: [], issues, unknownColumns };

  const dataRows = table.slice(1);
  if (dataRows.length === 0) return { rows: [], issues: [{ line: 1, message: "The file has a header but no rows." }], unknownColumns };
  if (dataRows.length > MAX_MEMBER_ROWS) {
    return { rows: [], issues: [{ line: 1, message: `The file has ${dataRows.length} rows. The limit is ${MAX_MEMBER_ROWS}.` }], unknownColumns };
  }

  const rows: MemberRow[] = [];
  dataRows.forEach((cells, offset) => {
    const line = offset + 2;
    const get = (key: "phone" | "first" | "last" | "points") => {
      const index = cols[key];
      return index === undefined ? "" : cellText(cells[index]);
    };
    const problems: string[] = [];

    const phone = normalizePhone(get("phone"));
    if (!phone) problems.push("Phone_Number is required.");
    else if (!/^0\d{8,9}$/.test(phone)) problems.push(`Phone_Number '${get("phone")}' must be 9 or 10 digits starting with 0.`);

    const first = get("first");
    if (!first) problems.push("First_Name is required.");
    else if (first.startsWith(EXAMPLE_FIRST_NAME)) problems.push("This is the example row from the template. Delete it, then upload again.");
    else if (first.length > 50) problems.push("First_Name is longer than 50 characters.");

    const last = get("last");
    if (last.length > 50) problems.push("Last_Name is longer than 50 characters.");

    let points: number | null = null;
    const pointsText = get("points");
    if (pointsText !== "") {
      if (!/^\d+$/.test(pointsText)) problems.push("Points must be a whole number of 0 or more.");
      else if (Number(pointsText) > MAX_POINTS) problems.push(`Points must be at most ${MAX_POINTS}.`);
      else points = Number(pointsText);
    }

    if (problems.length > 0) {
      for (const message of problems) issues.push({ line, message });
      return;
    }
    rows.push({ line, phone, name: [first, last].filter(Boolean).join(" "), points });
  });

  const phoneLine = new Map<string, number>();
  for (const row of rows) {
    const first = phoneLine.get(row.phone);
    if (first !== undefined) issues.push({ line: row.line, message: `Phone ${row.phone} is already on line ${first}.` });
    else phoneLine.set(row.phone, row.line);
  }
  return { rows, issues, unknownColumns };
}

export interface MemberPlan {
  creates: { id: string; phone: string; name: string; points: number; line: number }[];
  updates: { id: string; phone: string; name: string; nameFrom: string; pointsFrom: number; pointsTo: number | null; line: number }[];
  unchanged: number;
  issues: MemberIssue[];
}

export async function planMembers(db: Prisma.TransactionClient, rows: MemberRow[]): Promise<MemberPlan> {
  const existing = await db.member.findMany({
    where: { phone: { in: rows.map((row) => row.phone) } },
    select: { id: true, phone: true, name: true, points: true },
  });
  const byPhone = new Map(existing.map((m) => [m.phone, m]));
  const creates: MemberPlan["creates"] = [];
  const updates: MemberPlan["updates"] = [];
  let unchanged = 0;

  for (const row of rows) {
    const current = byPhone.get(row.phone);
    if (!current) {
      creates.push({ id: randomUUID(), phone: row.phone, name: row.name, points: row.points ?? 0, line: row.line });
      continue;
    }
    const nameChanged = current.name !== row.name;
    const pointsChanged = row.points !== null && row.points !== current.points;
    if (!nameChanged && !pointsChanged) {
      unchanged += 1;
      continue;
    }
    updates.push({
      id: current.id,
      phone: row.phone,
      name: row.name,
      nameFrom: current.name,
      pointsFrom: current.points,
      pointsTo: pointsChanged ? row.points : null,
      line: row.line,
    });
  }
  return { creates, updates, unchanged, issues: [] };
}

export async function commitMembers(tx: Prisma.TransactionClient, plan: MemberPlan, userId: string, fileName: string): Promise<void> {
  if (plan.creates.length > 0) {
    await tx.member.createMany({
      data: plan.creates.map((m) => ({ id: m.id, phone: m.phone, name: m.name, points: m.points })),
    });
  }
  for (const update of plan.updates) {
    await tx.member.update({
      where: { id: update.id },
      data: { name: update.name, ...(update.pointsTo !== null ? { points: update.pointsTo } : {}) },
    });
  }
  await tx.auditLog.create({
    data: {
      action: "MEMBER_IMPORT",
      entityType: "Member",
      entityId: fileName.slice(0, 100),
      userId,
      reason: `${plan.creates.length} created, ${plan.updates.length} updated, ${plan.unchanged} unchanged`,
      details: {
        fileName,
        created: plan.creates.slice(0, 500).map((m) => m.phone),
        updated: plan.updates.slice(0, 500).map((u) => ({
          phone: u.phone,
          name: [u.nameFrom, u.name],
          points: u.pointsTo === null ? null : [u.pointsFrom, u.pointsTo],
        })),
      },
    },
  });
}
