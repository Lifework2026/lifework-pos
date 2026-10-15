"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, FileDown, Plus, Upload } from "lucide-react";
import { ImportDialog } from "@/components/admin/import-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { templateHref, type TemplateKey } from "@/lib/template-catalog";

const LINK_BUTTON = "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted";
const PRIMARY_LINK = "inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90";

interface ActionBarProps {
  /** Address of the create form. Use onCreate instead when the form is on the same page. */
  createHref?: string;
  onCreate?: () => void;
  /** The template this page imports. Leave out when the page has no bulk import. */
  template?: TemplateKey;
  /** The export kind for /api/admin/export. Leave out when the page has no export. */
  exportKind?: string;
}

/**
 * The header bar every list page shares: Create New, Download Template, Import Excel and Export.
 * Import Excel opens the page's own template in a dialog, so the same steps work on every page.
 */
export function ActionBar({ createHref, onCreate, template, exportKind }: ActionBarProps) {
  const { t } = useI18n();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {createHref ? (
        <Link href={createHref} className={PRIMARY_LINK}>
          <Plus className="size-4" /> {t("actions.createNew")}
        </Link>
      ) : onCreate ? (
        <Button onClick={onCreate} className="h-9">
          <Plus className="size-4" /> {t("actions.createNew")}
        </Button>
      ) : null}

      {template ? (
        <>
          <a href={templateHref(template)} className={LINK_BUTTON}>
            <Download className="size-4" /> {t("actions.downloadTemplate")}
          </a>
          <Button variant="outline" onClick={() => setImporting(true)} className="h-9">
            <Upload className="size-4" /> {t("actions.importExcel")}
          </Button>
          <ImportDialog type={template} open={importing} onOpenChange={setImporting} />
        </>
      ) : null}

      {exportKind ? (
        <div className="relative">
          <Button variant="outline" onClick={() => setExporting((open) => !open)} aria-expanded={exporting} className="h-9">
            <FileDown className="size-4" /> {t("actions.export")} <ChevronDown className="size-4" />
          </Button>
          {exporting ? (
            <div className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col rounded-md border bg-background p-1 shadow-md">
              <a
                href={`/api/admin/export?kind=${exportKind}&format=xlsx`}
                onClick={() => setExporting(false)}
                className="rounded px-3 py-2 text-sm hover:bg-muted"
              >
                {t("actions.exportXlsx")}
              </a>
              <a
                href={`/api/admin/export?kind=${exportKind}&format=csv`}
                onClick={() => setExporting(false)}
                className="rounded px-3 py-2 text-sm hover:bg-muted"
              >
                {t("actions.exportCsv")}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
