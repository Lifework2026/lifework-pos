"use client";

import { ImportForm } from "@/components/admin/import-form";
import { ProductImportForm } from "@/components/admin/product-import-form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { IMPORT_TEMPLATES, type TemplateKey } from "@/lib/template-catalog";

interface ImportDialogProps {
  type: TemplateKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The import for one page, opened from its action bar. Closing it discards the chosen file.
 * Template A gets the wide visual review (parsed table, row text and the till's card); the others get the file check.
 */
export function ImportDialog({ type, open, onOpenChange }: ImportDialogProps) {
  const { t } = useI18n();
  const spec = IMPORT_TEMPLATES[type];
  const wide = type === "A";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[92vh] overflow-y-auto ${wide ? "sm:max-w-7xl" : "sm:max-w-xl"}`}>
        <DialogHeader>
          <DialogTitle>{t(spec.titleKey)}</DialogTitle>
          <DialogDescription>{t(spec.descKey)}</DialogDescription>
        </DialogHeader>
        {wide ? (
          <ProductImportForm onCancel={() => onOpenChange(false)} onDone={() => onOpenChange(false)} />
        ) : (
          <ImportForm type={type} />
        )}
      </DialogContent>
    </Dialog>
  );
}
