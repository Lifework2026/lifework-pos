"use client";

import { ImportForm } from "@/components/admin/import-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import { IMPORT_TEMPLATES, TEMPLATE_KEYS } from "@/lib/template-catalog";

/** One card per bulk template. The same imports open as dialogs from each list page's action bar. */
export function ExcelTools() {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {TEMPLATE_KEYS.map((type) => (
        <Card key={type}>
          <CardHeader>
            <CardTitle className="text-base">{t(IMPORT_TEMPLATES[type].titleKey)}</CardTitle>
            <CardDescription>{t(IMPORT_TEMPLATES[type].descKey)}</CardDescription>
          </CardHeader>
          <CardContent>
            <ImportForm type={type} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
