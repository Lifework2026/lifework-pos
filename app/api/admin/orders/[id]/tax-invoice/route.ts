import { Prisma, OrderStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readBody, requireManager } from "@/lib/api-helpers";
import { bangkokYmd } from "@/lib/bangkok";
import { OrderError } from "@/lib/orders/errors";
import { orderSelect, serializeOrder } from "@/lib/orders/serialize";
import { getSellerInfo } from "@/lib/tax-seller";
import { formatTaxInvoiceNumber, isValidBranchNo, isValidThaiTaxId, taxInvoicePrefix } from "@/lib/tax-rules";

export const dynamic = "force-dynamic";

const issueSchema = z.object({
  customerName: z.string().trim().min(2, "Enter the customer's name.").max(150),
  customerBranch: z
    .string()
    .trim()
    .refine(isValidBranchNo, "Branch must be 5 digits. Use 00000 for head office."),
  customerAddress: z.string().trim().min(5, "Enter the customer's address.").max(300),
  customerTaxId: z.string().trim().refine(isValidThaiTaxId, "Tax ID must be 13 digits with a valid check digit."),
});

const MAX_SEQUENCE = 99_999;

/**
 * POST /api/admin/orders/[id]/tax-invoice
 *
 * Issues a full tax invoice for a sale. Each order gets one invoice, numbered TI-YYYYMM-NNNNN, in a serializable
 * transaction. Refused while the store's legal details are not set, since an invoice without the seller's tax ID
 * is not valid. Managers only.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, issueSchema);
  if ("response" in body) return body.response;

  if (!getSellerInfo()) {
    return apiError(
      409,
      "SELLER_NOT_CONFIGURED",
      "Set the store's legal name, tax ID, branch and address (STORE_LEGAL_NAME, STORE_TAX_ID, STORE_BRANCH_NO, STORE_ADDRESS) before issuing tax invoices.",
    );
  }

  try {
    const order = await prisma.$transaction(
      async (tx) => {
        const current = await tx.order.findUnique({ where: { id: params.id }, select: { id: true, status: true, taxInvoiceNo: true } });
        if (!current) throw new OrderError(404, "ORDER_NOT_FOUND", "Order not found.");
        if (current.status === OrderStatus.VOIDED) {
          throw new OrderError(409, "ORDER_VOIDED", "A voided sale cannot have a tax invoice.");
        }
        if (current.taxInvoiceNo) {
          throw new OrderError(409, "ALREADY_ISSUED", `A tax invoice was already issued: ${current.taxInvoiceNo}.`, {
            number: current.taxInvoiceNo,
          });
        }

        const now = new Date();
        const yearMonth = bangkokYmd(now).slice(0, 7);
        const prefix = taxInvoicePrefix(yearMonth);
        const last = await tx.order.findFirst({
          where: { taxInvoiceNo: { startsWith: prefix } },
          orderBy: { taxInvoiceNo: "desc" },
          select: { taxInvoiceNo: true },
        });
        const sequence = last?.taxInvoiceNo ? Number(last.taxInvoiceNo.slice(prefix.length)) + 1 : 1;
        if (sequence > MAX_SEQUENCE) throw new OrderError(409, "NUMBERS_EXHAUSTED", "No tax invoice numbers left this month.");

        const input = body.data;
        await tx.order.update({
          where: { id: current.id },
          data: {
            taxInvoiceNo: formatTaxInvoiceNumber(yearMonth, sequence),
            taxInvoiceAt: now,
            taxCustomerName: input.customerName,
            taxCustomerBranch: input.customerBranch,
            taxCustomerAddress: input.customerAddress,
            taxCustomerTaxId: input.customerTaxId,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "TAX_INVOICE_ISSUE",
            entityType: "Order",
            entityId: current.id,
            userId: auth.user.id,
            details: { number: formatTaxInvoiceNumber(yearMonth, sequence), customerTaxId: input.customerTaxId },
          },
        });

        return tx.order.findUniqueOrThrow({ where: { id: current.id }, select: orderSelect });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 },
    );
    return Response.json({ order: serializeOrder(order) }, { status: 201 });
  } catch (err) {
    if (err instanceof OrderError) return apiError(err.status, err.code, err.message, err.details);
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2002")) {
      return apiError(409, "CONFLICT", "Another tax invoice was issued at the same time. Refresh and try again.");
    }
    console.error("[POST /api/admin/orders/[id]/tax-invoice]", err);
    return apiError(500, "INTERNAL_ERROR", "Could not issue the tax invoice. Nothing was changed.");
  }
}
