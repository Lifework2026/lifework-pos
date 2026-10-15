import { z } from "zod";
import { CODE_RULE_MESSAGE, isValidCode, normalizeCode } from "@/lib/master-codes";

/** A catalog code is required and exact. Lower-case input is accepted and stored in upper case. */
export const catalogCodeSchema = z
  .string({ error: "Enter the code." })
  .transform(normalizeCode)
  .refine((value) => value.length > 0, "Enter the code.")
  .refine(isValidCode, CODE_RULE_MESSAGE);
