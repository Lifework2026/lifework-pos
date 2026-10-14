import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireUser } from "@/lib/api-helpers";
import type { HeldBillSummary, HeldPayload } from "@/lib/held-bills";

export const dynamic = "force-dynamic";

const MAX_HELD_BILLS = 50;

const holdSchema = z.object({
  label: z.string().trim().max(60).nullable().optional(),
  discount: z.number().min(0).max(10_000_000).default(0),
  total: z.number().min(0).max(100_000_000).default(0),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(999),
        unitPrice: z.number().min(0).max(1_000_000),
      }),
    )
    .min(1, "The cart is empty.")
    .max(100),
});

/** GET /api/held-bills: parked bills, newest first. Any signed-in staff member can see them, so a bill can move between tills. */
export async function GET(): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const rows = await prisma.heldBill.findMany({
    orderBy: { createdAt: "desc" },
    take: MAX_HELD_BILLS,
    select: { id: true, label: true, itemCount: true, payload: true, createdAt: true, createdBy: { select: { fullName: true } } },
  });

  const bills: HeldBillSummary[] = rows.map((row) => {
    const payload = row.payload as unknown as HeldPayload;
    return {
      id: row.id,
      label: row.label,
      itemCount: row.itemCount,
      total: Number(payload?.total ?? 0).toFixed(2),
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy?.fullName ?? null,
    };
  });
  return Response.json({ bills });
}

/** POST /api/held-bills: parks the current cart. No stock is reserved. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, holdSchema);
  if ("response" in body) return body.response;

  const count = await prisma.heldBill.count();
  if (count >= MAX_HELD_BILLS) {
    return apiError(409, "TOO_MANY_HELD", `There are already ${MAX_HELD_BILLS} held bills. Resume or discard some first.`);
  }

  const payload: HeldPayload = {
    items: body.data.items,
    discount: body.data.discount,
    total: body.data.total,
  };
  const bill = await prisma.heldBill.create({
    data: {
      label: body.data.label || null,
      payload: JSON.parse(JSON.stringify(payload)),
      itemCount: body.data.items.reduce((sum, item) => sum + item.quantity, 0),
      createdById: auth.user.id,
    },
    select: { id: true },
  });
  return Response.json({ id: bill.id }, { status: 201 });
}
