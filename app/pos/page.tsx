"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, LayoutDashboard, UserRound } from "lucide-react";
import { CartPanel } from "@/components/pos/cart-panel";
import { CheckoutDialog } from "@/components/pos/checkout-dialog";
import { ProductPanel } from "@/components/pos/product-panel";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import type { ApiErrorBody, OrderDetails, VariantSummary } from "@/lib/pos-types";
import type { SessionUser } from "@/lib/auth/session";
import { useCartStore, type CartVariant } from "@/store/useCartStore";

function toCartVariant(variant: VariantSummary): CartVariant {
  return {
    variantId: variant.id,
    name: variant.product.name,
    size: variant.size,
    color: variant.color,
    sku: variant.sku,
    barcode: variant.barcode,
    price: Number(variant.price),
    stockQuantity: variant.stockQuantity,
  };
}

export default function PosPage() {
  const addItemByBarcode = useCartStore((state) => state.addItemByBarcode);
  const clearCart = useCartStore((state) => state.clearCart);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<OrderDetails | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Session expired.");
        const body: { user: SessionUser } = await res.json();
        setUser(body.user);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        toast.add({ title: "Session expired", description: "Please sign in again.", type: "error" });
      });
    return () => controller.abort();
  }, []);

  const addVariant = useCallback(
    (variant: VariantSummary) => {
      const result = addItemByBarcode(toCartVariant(variant));
      if (!result.ok) {
        toast.add({
          title: "Out of stock",
          description: `${variant.product.name} (${variant.sku}): only ${result.available} available.`,
          type: "error",
        });
        return false;
      }
      return true;
    },
    [addItemByBarcode],
  );

  const handleScan = useCallback(
    async (barcode: string) => {
      setLastScannedBarcode(barcode);
      try {
        const res = await fetch(`/api/products/search?barcode=${encodeURIComponent(barcode)}`, {
          cache: "no-store",
        });

        if (res.status === 404) {
          toast.add({ title: "Not found", description: `No active product for barcode ${barcode}.`, type: "error" });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
          toast.add({ title: "Scan failed", description: body?.message ?? "Try scanning again.", type: "error" });
          return;
        }

        const body: { variant: VariantSummary } = await res.json();
        addVariant(body.variant);
      } catch {
        toast.add({ title: "Scan failed", description: "Network error. Try scanning again.", type: "error" });
      }
    },
    [addVariant],
  );

  useBarcodeScanner({
    onScan: handleScan,
    enabled: !checkoutOpen,
  });

  function handleCompleted(order: OrderDetails): void {
    setLastSale(order);
    clearCart();
    setLastScannedBarcode(null);
  }

  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <main className="flex min-h-dvh flex-col gap-4 bg-muted/30 p-4 lg:h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Lifework POS</h1>
          {lastSale ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              Last sale {lastSale.receiptNo}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user ? (
            <Badge variant="outline" className="gap-1 py-1">
              <UserRound className="size-3.5" />
              {user.fullName}
            </Badge>
          ) : null}
          {isManager ? (
            <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <LayoutDashboard className="size-4" />
              Back office
            </Link>
          ) : null}
          <SignOutButton />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_400px]">
        <div className="min-h-0 rounded-xl border bg-background p-4">
          <ProductPanel
            onSelectVariant={addVariant}
            scannerActive={!checkoutOpen}
            lastScannedBarcode={lastScannedBarcode}
          />
        </div>

        <div className="min-h-[24rem] lg:min-h-0">
          <CartPanel onCheckout={() => setCheckoutOpen(true)} />
        </div>
      </div>

      <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} onCompleted={handleCompleted} />
    </main>
  );
}
