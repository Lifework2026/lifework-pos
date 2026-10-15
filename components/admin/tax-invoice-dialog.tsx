"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { TaxInvoiceDocument } from "@/components/pos/tax-invoice-document";
import { usePrintDocument } from "@/components/pos/print-receipt";
import { useOnline } from "@/components/network-status";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import type { OrderDetails } from "@/lib/pos-types";
import { isValidBranchNo, isValidThaiTaxId } from "@/lib/tax-rules";

interface TaxInvoiceDialogProps {
  order: OrderDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (order: OrderDetails) => void;
}

/**
 * Issues a full tax invoice for a sale, or reprints the one already issued. The buyer's name, branch, address and
 * 13-digit tax ID are required and checked before sending. Issuing is refused while the store's own tax details are unset.
 */
export function TaxInvoiceDialog({ order, open, onOpenChange, onIssued }: TaxInvoiceDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const { print, printRoot } = usePrintDocument();
  const submitLock = useRef(false);
  const [name, setName] = useState("");
  const [headOffice, setHeadOffice] = useState(true);
  const [branchNo, setBranchNo] = useState("");
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branch = headOffice ? "00000" : branchNo.trim();
  const errors = {
    name: name.trim().length < 2 ? t("tax.errName") : null,
    branch: !isValidBranchNo(branch) ? t("tax.errBranch") : null,
    address: address.trim().length < 5 ? t("tax.errAddress") : null,
    taxId: !isValidThaiTaxId(taxId.trim()) ? t("tax.errTaxId") : null,
  };
  const valid = !errors.name && !errors.branch && !errors.address && !errors.taxId;
  const issued = order.taxInvoice;

  async function issue(): Promise<void> {
    if (submitLock.current || !valid || !online) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<{ order: OrderDetails }>(
        `/api/admin/orders/${order.id}/tax-invoice`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerName: name, customerBranch: branch, customerAddress: address, customerTaxId: taxId }),
        },
        { retries: 0 },
      );
      if (!result.ok) {
        setError(result.message ?? t("common.networkError"));
        return;
      }
      toast.add({ title: t("tax.issuedToast"), description: result.data.order.taxInvoice?.number, type: "success" });
      onIssued(result.data.order);
      router.refresh();
      print(<TaxInvoiceDocument order={result.data.order} />, "a4");
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }

  return (
    <>
      {printRoot}
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{issued ? t("tax.issuedTitle") : t("tax.title")}</DialogTitle>
            <DialogDescription>{issued ? t("tax.issuedDesc", { number: issued.number }) : t("tax.desc")}</DialogDescription>
          </DialogHeader>

          {issued ? (
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
              <Button onClick={() => print(<TaxInvoiceDocument order={order} />, "a4")} disabled={!online}>
                <Printer className="size-4" /> {t("tax.print")}
              </Button>
            </DialogFooter>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t("tax.customerName")}</span>
                <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={150} disabled={busy} />
                {name && errors.name ? <span className="text-xs text-destructive">{errors.name}</span> : null}
              </label>

              <fieldset className="flex flex-col gap-2 text-sm" disabled={busy}>
                <legend className="mb-1 text-muted-foreground">{t("tax.branchType")}</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="branch" checked={headOffice} onChange={() => setHeadOffice(true)} />
                  {t("tax.headOffice")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="branch" checked={!headOffice} onChange={() => setHeadOffice(false)} />
                  {t("tax.branch")}
                </label>
                {!headOffice ? (
                  <Input
                    value={branchNo}
                    onChange={(event) => setBranchNo(event.target.value.replace(/\D/g, "").slice(0, 5))}
                    inputMode="numeric"
                    placeholder="00001"
                    aria-label={t("tax.branchNo")}
                    className="max-w-[10rem] font-mono"
                  />
                ) : null}
                {!headOffice && branchNo && errors.branch ? <span className="text-xs text-destructive">{errors.branch}</span> : null}
              </fieldset>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t("tax.address")}</span>
                <textarea
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  maxLength={300}
                  rows={3}
                  disabled={busy}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                />
                {address && errors.address ? <span className="text-xs text-destructive">{errors.address}</span> : null}
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t("tax.taxId")}</span>
                <Input
                  value={taxId}
                  onChange={(event) => setTaxId(event.target.value.replace(/\D/g, "").slice(0, 13))}
                  inputMode="numeric"
                  maxLength={13}
                  disabled={busy}
                  className="font-mono tracking-wider"
                />
                {taxId && errors.taxId ? <span className="text-xs text-destructive">{errors.taxId}</span> : null}
              </label>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {!online ? <p className="text-sm font-medium text-red-700">{t("network.offlineShort")}</p> : null}

              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={issue} disabled={!valid || busy || !online}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("tax.submit")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
