import type { MessageKey } from "@/lib/i18n/messages";

/**
 * Client-safe description of the six bulk templates. The files themselves are built on the server in
 * lib/excel-templates.ts. Every list page imports through the same dialog, so the wording lives here once.
 */
export const TEMPLATE_KEYS = ["A", "B", "C", "D", "E", "F"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const IMPORT_TEMPLATES: Record<TemplateKey, { titleKey: MessageKey; descKey: MessageKey; columns: string }> = {
  A: {
    titleKey: "xls.cardA",
    descKey: "xls.cardADesc",
    columns: "Barcode, SKU, Name_TH, Name_EN, Category_Code, Color_Code, Size, Price, Cost, Initial_Stock, Promo_Tag",
  },
  B: { titleKey: "xls.cardB", descKey: "xls.cardBDesc", columns: "Barcode, New_Price, Promo_Tag" },
  C: { titleKey: "xls.cardC", descKey: "xls.cardCDesc", columns: "Barcode, Quantity_Change, Reason" },
  D: { titleKey: "xls.cardD", descKey: "xls.cardDDesc", columns: "Category_Code, Category_Name" },
  E: { titleKey: "xls.cardE", descKey: "xls.cardEDesc", columns: "Color_Code, Color_Name" },
  F: { titleKey: "xls.cardF", descKey: "xls.cardFDesc", columns: "Phone_Number, First_Name, Last_Name, Points" },
};

/** Template A imports through the products importer, which also creates sizes and opening stock. */
export function importEndpoint(type: TemplateKey): string {
  return type === "A" ? "/api/admin/products/import" : "/api/admin/excel/import";
}

export function templateHref(type: TemplateKey): string {
  return type === "A" ? "/api/admin/products/import/template?format=xlsx" : `/api/admin/excel/templates?type=${type}`;
}
