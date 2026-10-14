import { z } from "zod";

/** One rule set for creating and editing promotions, so both enforce exactly the same limits. */
export const promotionSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a promotion name.").max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,20}$/, "Code must be 3 to 20 letters, digits or dashes.")
      .nullable()
      .optional(),
    kind: z.enum(["PERCENT_OFF", "AMOUNT_OFF"]),
    scope: z.enum(["ORDER", "CATEGORY"]),
    value: z.number().positive("Enter a value above zero.").max(1_000_000),
    categoryId: z.string().min(1).nullable().optional(),
    minSubtotal: z.number().nonnegative().max(10_000_000).default(0),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "PERCENT_OFF" && value.value > 100) {
      ctx.addIssue({ code: "custom", message: "A percentage cannot be more than 100.", path: ["value"] });
    }
    if (value.scope === "CATEGORY" && !value.categoryId) {
      ctx.addIssue({ code: "custom", message: "Choose the category this promotion applies to.", path: ["categoryId"] });
    }
    if (new Date(value.endsAt) <= new Date(value.startsAt)) {
      ctx.addIssue({ code: "custom", message: "End time must be after start time.", path: ["endsAt"] });
    }
  });

export type PromotionInput = z.infer<typeof promotionSchema>;

/** Edits may change any subset of fields, plus switch the promotion on or off. */
export const promotionPatchSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().optional(),
  code: z.string().nullable().optional(),
  kind: z.enum(["PERCENT_OFF", "AMOUNT_OFF"]).optional(),
  scope: z.enum(["ORDER", "CATEGORY"]).optional(),
  value: z.number().optional(),
  categoryId: z.string().nullable().optional(),
  minSubtotal: z.number().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});
