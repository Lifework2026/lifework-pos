import { z } from "zod";
import { CATEGORY_CODE_MESSAGE, CODE_RULE_MESSAGE, isValidCategoryCode, isValidCode, normalizeCode } from "@/lib/master-codes";

/** A catalog code is required and exact. Lower-case input is accepted and stored in upper case. */
export const catalogCodeSchema = z
  .string({ error: "Enter the code." })
  .transform(normalizeCode)
  .refine((value) => value.length > 0, "Enter the code.")
  .refine(isValidCode, CODE_RULE_MESSAGE);

/** A category code is one of the official two-letter dictionary keys. Lower case is accepted and stored in upper case. */
export const categoryCodeSchema = z
  .string({ error: "Enter the code." })
  .transform(normalizeCode)
  .refine((value) => value.length > 0, "Enter the code.")
  .refine(isValidCategoryCode, CATEGORY_CODE_MESSAGE);
