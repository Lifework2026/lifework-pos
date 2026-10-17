"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, LayoutDashboard, UserRound } from "lucide-react";
import { CartPanel } from "@/components/pos/cart-panel";
import { CartSkeleton } from "@/components/pos/skeletons";
import { CheckoutDialog } from "@/components/pos/checkout-dialog";
import { HeldBillsDialog } from "@/components/pos/held-bills-dialog";
import { ProductPanel } from "@/components/pos/product-panel";
import { SalesHistoryDrawer } from "@/components/pos/sales-history-drawer";
import { ShiftManager } from "@/components/pos/shift-manager";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SessionProvider } from "@/components/auth/session-context";
import { LocaleToggle } from "@/components/locale-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { HeldBillSummary, ResumedBill } from "@/lib/held-bills";
import { requestJson } from "@/lib/http";
import { focusBarcodeField } from "@/lib/pos-focus";
import { FREE_BAG_CART_STOCK, isFreeBag } from "@/lib/catalog/free-bags";
import type { ScanDecision } from "@/lib/scanner-input";
import { useI18n } from "@/lib/i18n/client";
import type { ApiErrorBody, OrderDetails, VariantSummary } from "@/lib/pos-types";
import type { SessionUser } from "@/lib/auth/session";
import { useCartStore, type CartVariant } from "@/store/useCartStore";

function toCartVariant(variant: VariantSummary): CartVariant {
  return {
    variantId: variant.id,
    name: variant.product.name,
    nameTh: variant.product.nameTh,
    imageUrl: variant.product.imageUrl,
    size: variant.size,
    color: variant.color,
    sku: variant.sku,
    barcode: variant.barcode,
    price: Number(variant.price),
    // A free bag is not stock-counted, so the cart never limits it.
    stockQuantity: isFreeBag(variant.sku) ? FREE_BAG_CART_STOCK : variant.stockQuantity,
  };
}

export default function PosPage() {
  const { t } = useI18n();
  const addItemByBarcode = useCartStore((state) => state.addItemByBarcode);
  const clearCart = useCartStore((state) => state.clearCart);
  const replaceCart = useCartStore((state) => state.replaceCart);
  const cartHasItems = useCartStore((state) => state.items.length > 0);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [holding, setHolding] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<OrderDetails | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [signOutRequested, setSignOutRequested] = useState(false);
  const [salesVersion, setSalesVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("session");
        const body: { user: SessionUser } = await res.json();
        setUser(body.user);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        toast.add({ title: t("pos.sessionExpired"), description: t("pos.signInAgain"), type: "error" });
      });
    return () => controller.abort();
    // The toast is shown once, in the language active at sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // How many bills are parked, for the badge on the Held button.
  useEffect(() => {
    void requestJson<{ bills: HeldBillSummary[] }>("/api/held-bills", { method: "GET" }).then((result) => {
      if (result.ok) setHeldCount(result.data.bills.length);
    });
  }, []);

  const addVariant = useCallback(
    (variant: VariantSummary) => {
      const result = addItemByBarcode(toCartVariant(variant));
      if (!result.ok) {
        toast.add({
          title: t("pos.outOfStock"),
          description: t("pos.onlyAvailable", { name: variant.product.name, sku: variant.sku, count: result.available }),
          type: "error",
        });
        return false;
      }
      return true;
    },
    [addItemByBarcode, t],
  );

  /** Looks a code up and puts the item in the cart. Used by the scanner and by the free-bag buttons. */
  const lookupAndAdd = useCallback(
    async ({ barcode, fast }: ScanDecision): Promise<boolean> => {
      try {
        const res = await fetch(`/api/products/search?barcode=${encodeURIComponent(barcode)}`, { cache: "no-store" });

        if (res.status === 404) {
          // A scan that finds nothing is reported. A typed word that is not a barcode just stays in the search box.
          if (fast) toast.add({ title: t("pos.notFound"), description: t("pos.noActiveProduct", { code: barcode }), type: "error" });
          return false;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
          toast.add({ title: t("pos.scanFailed"), description: body?.message ?? t("pos.scanNetwork"), type: "error" });
          return false;
        }

        const body: { variant: VariantSummary } = await res.json();
        return addVariant(body.variant);
      } catch {
        toast.add({ title: t("pos.scanFailed"), description: t("pos.scanNetwork"), type: "error" });
        return false;
      }
    },
    [addVariant, t],
  );

  const handleScan = useCallback(
    (decision: ScanDecision): Promise<boolean> => {
      setLastScannedBarcode(decision.barcode);
      return lookupAndAdd(decision);
    },
    [lookupAndAdd],
  );

  const addBag = useCallback((sku: string): Promise<boolean> => lookupAndAdd({ barcode: sku, converted: false, fast: true }), [lookupAndAdd]);

  // The barcode field takes input only while no dialog is open and a shift is running.
  const scannerEnabled = !checkoutOpen && !heldOpen && !historyOpen && shiftOpen;

  // When the payment or held-bills window closes, the cursor goes back to the barcode field. The browser would otherwise
  // hand focus back to the button that opened the window (the pay button, which is disabled once the sale is done), and
  // the next scan would land nowhere.
  const dialogWasOpen = useRef(false);
  const dialogOpen = checkoutOpen || heldOpen || historyOpen;
  useEffect(() => {
    if (dialogOpen) {
      dialogWasOpen.current = true;
      return;
    }
    if (!dialogWasOpen.current) return;
    dialogWasOpen.current = false;
    const timer = window.setTimeout(focusBarcodeField, 120);
    return () => window.clearTimeout(timer);
  }, [dialogOpen]);

  async function holdCurrentBill(): Promise<void> {
    const { items, discount, getTotal } = useCartStore.getState();
    if (items.length === 0 || holding) return;

    // An empty answer parks the bill without a name. Cancel keeps the cart as it is.
    const label = window.prompt(t("hold.labelPrompt"));
    if (label === null) return;

    setHolding(true);
    const result = await requestJson<{ id: string }>(
      "/api/held-bills",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || null,
          discount,
          total: getTotal(),
          items: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, unitPrice: item.price })),
        }),
      },
      { retries: 0 },
    );
    setHolding(false);

    if (!result.ok) {
      toast.add({ title: t("hold.holdFailed"), description: result.message ?? t("common.networkError"), type: "error" });
      return;
    }
    clearCart();
    setHeldCount((count) => count + 1);
    toast.add({ title: t("hold.held"), description: t("hold.heldBody"), type: "success" });
  }

  function handleResumed(bill: ResumedBill): void {
    replaceCart(
      bill.items.map((item) => ({ ...item })),
      bill.discount,
    );
    setHeldCount((count) => Math.max(0, count - 1));

    if (bill.warnings.length > 0) {
      const lines = bill.warnings.map((warning) => {
        if (warning.kind === "REMOVED") return t("hold.warnRemoved", { sku: warning.sku });
        if (warning.kind === "REDUCED") return t("hold.warnReduced", { sku: warning.sku, from: warning.from, to: warning.to });
        return t("hold.warnPrice", { sku: warning.sku, from: warning.from.toFixed(2), to: warning.to.toFixed(2) });
      });
      toast.add({ title: t("hold.resumedWithChanges"), description: lines.join(" · "), type: "info" });
    } else {
      toast.add({ title: t("hold.resumed"), type: "success" });
    }
  }

  function handleCompleted(order: OrderDetails): void {
    setLastSale(order);
    setSalesVersion((version) => version + 1);
    clearCart();
    setLastScannedBarcode(null);
  }

  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <SessionProvider value={user}>
      <main className="flex h-dvh min-w-[1100px] flex-col gap-3 overflow-hidden bg-canvas p-3">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="flex items-center">
              <span className="sr-only">LIFEWORK // TERMINAL</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/main-logo.png" alt="" aria-hidden draggable={false} className="h-9 w-auto" />
            </h1>
            {lastSale ? (
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                {t("pos.lastSale", { receipt: lastSale.receiptNo })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ShiftManager
              onOpenChange={setShiftOpen}
              cartHasItems={cartHasItems}
              salesVersion={salesVersion}
              signOutRequested={signOutRequested}
              onSignOutRequestHandled={() => setSignOutRequested(false)}
            />
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="h-8 rounded-[3px] border border-foreground bg-card px-2.5 text-[11px] font-extrabold tracking-[0.1em] whitespace-nowrap uppercase transition-colors hover:bg-foreground hover:text-background"
            >
              [ {t("history.button")} ]
            </button>
            <LocaleToggle />
            {user ? (
              <Badge variant="outline" className="gap-1 bg-card py-1">
                <UserRound className="size-3.5" />
                {user.fullName}
              </Badge>
            ) : null}
            {isManager ? (
              <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <LayoutDashboard className="size-4" />
                {t("common.backOffice")}
              </Link>
            ) : null}
            <SignOutButton onShiftOpen={() => setSignOutRequested(true)} />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-3">
          <div className="min-h-0 rounded-xl border bg-card p-3">
            <ProductPanel
              onSelectVariant={addVariant}
              scannerActive={scannerEnabled}
              lastScannedBarcode={lastScannedBarcode}
              onScan={handleScan}
            />
          </div>

          <div className="min-h-0">
            {user ? (
              <CartPanel
                onCheckout={() => setCheckoutOpen(true)}
                onHold={() => void holdCurrentBill()}
                onOpenHeld={() => setHeldOpen(true)}
                heldCount={heldCount}
                holding={holding}
                onAddBag={addBag}
              />
            ) : (
              <CartSkeleton />
            )}
          </div>
        </div>

        <SalesHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} />
        <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} onCompleted={handleCompleted} />
        <HeldBillsDialog
          open={heldOpen}
          onOpenChange={setHeldOpen}
          cartHasItems={cartHasItems}
          onResumed={handleResumed}
          onCountChange={setHeldCount}
        />
      </main>
    </SessionProvider>
  );
}
