"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OrderDetails } from "@/lib/pos-types";
import { Receipt } from "@/components/pos/receipt";

interface ReceiptPreviewDialogProps {
  order: OrderDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** Extra footer actions, shown before Print and Close. */
  extraActions?: React.ReactNode;
}

/**
 * Shows the receipt as it will print, so staff can check it before paper comes out.
 * Printing is a separate, deliberate action.
 */
export function ReceiptPreviewDialog({ order, open, onOpenChange, title = "Receipt preview", extraActions }: ReceiptPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {order ? `${order.receiptNo} · review, then print` : "No receipt"}
          </DialogDescription>
        </DialogHeader>

        {order ? (
          <div className="receipt-preview max-h-[60vh] overflow-y-auto rounded-md bg-muted/50 p-3">
            <Receipt order={order} />
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">{extraActions}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => window.print()} disabled={!order}>
              <Printer className="size-4" /> Print
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
