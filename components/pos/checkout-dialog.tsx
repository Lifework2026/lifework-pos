"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnline } from "@/components/network-status";
import { CheckCircle2, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { satangToDecimal } from "@/lib/pricing";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { MemberSummary, OrderDetails, PromotionSummary } from "@/lib/pos-types";
import { Receipt } from "@/components/pos/receipt";
import { usePrintReceipt } from "@/components/pos/print-receipt";
import { CardPaymentLine, type ApprovedCard } from "@/components/pos/card-payment-line";
import { MemberPicker } from "@/components/pos/member-picker";
import { useCartStore, type CartItem } from "@/store/useCartStore";

type Method = "CASH" | "CARD" | "QR_PROMPTPAY" | "BANK_TRANSFER" | "OTHER";
type BagChoice = "NONE" | "SMALL" | "LARGE";

const METHOD_KEYS: { value: Method; key: MessageKey }[] = [
  { value: "CASH", key: "method.cash" },
  { value: "CARD", key: "method.card" },
  { value: "QR_PROMPTPAY", key: "method.qr" },
  { value: "BANK_TRANSFER", key: "method.bank" },
  { value: "OTHER", key: "method.other" },
];

const BAG_KEYS: { value: BagChoice; key: MessageKey }[] = [
  { value: "NONE", key: "checkout.bagNone" },
  { value: "SMALL", key: "checkout.bagSmall" },
  { value: "LARGE", key: "checkout.bagLarge" },
];

/** Server error codes that have a translated message. Other errors show the server's own text. */
const ERROR_KEYS: Record<string, MessageKey> = {
  PRICE_MISMATCH: "checkout.errorPriceChanged",
  INSUFFICIENT_STOCK: "checkout.errorStock",
  PROMOTION_NOT_AVAILABLE: "checkout.errorPromotion",
  MEMBER_REQUIRED: "checkout.errorMemberRequired",
  POINTS_EXCEED_BALANCE: "checkout.errorPoints",
  BAG_OUT_OF_STOCK: "checkout.errorBag",
  SHIFT_REQUIRED: "checkout.errorShift",
};

const BILL_DENOMINATIONS = [100, 500, 1000];

interface PaymentDraft {
  id: number;
  method: Method;
  amount: string;
  tendered: string;
  reference: string;
  card: ApprovedCard | null;
  touched: boolean;
}

interface QuoteResponse {
  totals: {
    subtotal: string;
    promotionDiscount: string;
    memberDiscount: string;
    manualDiscount: string;
    pointsDiscount: string;
    discount: string;
    total: string;
  };
  promotionName: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  member: MemberSummary | null;
}

interface PricingProblem {
  kind: "network" | "database" | "server";
  message: string | null;
}

/** Parses a baht string with at most 2 decimals into satang. Returns null when invalid. */
function parseSatang(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

let nextLineId = 1;
function newLine(method: Method, amount: string): PaymentDraft {
  return { id: nextLineId++, method, amount, tendered: "", reference: "", card: null, touched: false };
}

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: (order: OrderDetails) => void;
}

export function CheckoutDialog({ open, onOpenChange, onCompleted }: CheckoutDialogProps) {
  const { t } = useI18n();
  const { print, printRoot } = usePrintReceipt();
  const items = useCartStore((state) => state.items);
  const manualDiscount = useCartStore((state) => state.discount);

  const [bag, setBag] = useState<BagChoice>("NONE");
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [promotionId, setPromotionId] = useState("");
  const [promotions, setPromotions] = useState<PromotionSummary[]>([]);
  const [redeemInput, setRedeemInput] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [pricingProblem, setPricingProblem] = useState<PricingProblem | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [lines, setLines] = useState<PaymentDraft[]>(() => [newLine("CASH", "")]);
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const autoSubmitRef = useRef(false);

  // Reset for every checkout.
  useEffect(() => {
    if (!open) return;
    setBag("NONE");
    setMember(null);
    setPromotionId("");
    setRedeemInput("");
    setQuote(null);
    setPricingProblem(null);
    setLines([newLine("CASH", "")]);
    setPendingIds(new Set());
    setSubmitting(false);
    setError(null);
    setOrder(null);
    autoSubmitRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/promotions", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { promotions: PromotionSummary[] }) : { promotions: [] }))
      .then((body) => setPromotions(body.promotions))
      .catch(() => setPromotions([]));
  }, [open]);

  const quoteBody = useMemo(
    () => ({
      items: items.map((item: CartItem) => ({ variantId: item.variantId, quantity: item.quantity, unitPrice: item.price })),
      bag,
      memberId: member?.id ?? null,
      promotionId: promotionId || null,
      redeemPoints: Number(redeemInput) || 0,
      manualDiscount,
    }),
    [items, bag, member, promotionId, redeemInput, manualDiscount],
  );
  const quoteJson = JSON.stringify(quoteBody);

  // Re-price whenever the basket, bag, member, promotion or points change, or when the cashier asks again.
  useEffect(() => {
    if (!open) return;
    if (items.length === 0) {
      setQuote(null);
      setPricingProblem(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const result = await requestJson<QuoteResponse>(
          "/api/orders/quote",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: quoteJson },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (result.ok) {
          setQuote(result.data);
          setPricingProblem(null);
        } else {
          setQuote(null);
          if (result.network) setPricingProblem({ kind: "network", message: null });
          else if (result.status === 503 || result.code === "DATABASE_UNAVAILABLE") setPricingProblem({ kind: "database", message: null });
          else setPricingProblem({ kind: "server", message: ERROR_KEYS[result.code ?? ""] ? null : result.message });
        }
      } catch {
        if (!controller.signal.aborted) {
          setQuote(null);
          setPricingProblem({ kind: "network", message: null });
        }
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, quoteJson, quoteAttempt, items.length]);

  const dueSatang = quote ? (parseSatang(quote.totals.total) ?? 0) : 0;
  const appliedSatang = lines.reduce((sum, line) => sum + (parseSatang(line.amount) ?? 0), 0);
  const remainingSatang = dueSatang - appliedSatang;
  const cardPending = pendingIds.size > 0;
  const redeemValid =
    !redeemInput || (Number.isInteger(Number(redeemInput)) && Number(redeemInput) >= 0 && Number(redeemInput) <= (member?.points ?? 0));

  // Keep the first line equal to the amount due until the cashier edits it.
  useEffect(() => {
    if (dueSatang <= 0) return;
    setLines((current) => {
      if (current.length !== 1 || current[0].touched || current[0].card) return current;
      const amount = satangToDecimal(dueSatang);
      return current[0].amount === amount ? current : [{ ...current[0], amount }];
    });
  }, [dueSatang]);

  function lineIsValid(line: PaymentDraft): boolean {
    const amount = parseSatang(line.amount);
    if (amount === null || amount <= 0) return false;
    if (line.method === "CASH") {
      const tendered = parseSatang(line.tendered);
      return tendered !== null && tendered >= amount;
    }
    if (line.method === "CARD") return line.card !== null;
    if (line.method === "QR_PROMPTPAY" || line.method === "BANK_TRANSFER") return line.reference.trim().length >= 3;
    return true;
  }

  // Pay is disabled while offline, so a sale is never started that the terminal or server cannot finish.
  const online = useOnline();
  const canSubmit =
    online &&
    !!quote &&
    !quoteLoading &&
    !pricingProblem &&
    dueSatang > 0 &&
    remainingSatang === 0 &&
    lines.length > 0 &&
    lines.every(lineIsValid) &&
    !cardPending &&
    redeemValid &&
    !submitting;

  const submit = useCallback(async (): Promise<void> => {
    // A ref, not state: two taps in the same frame must not both send a sale.
    if (submitting || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);

    const payload = {
      items: items.map((item: CartItem) => ({ variantId: item.variantId, quantity: item.quantity, unitPrice: item.price })),
      bag,
      memberId: member?.id ?? null,
      promotionId: promotionId || null,
      redeemPoints: Number(redeemInput) || 0,
      manualDiscount,
      payments: lines.map((line) => ({
        method: line.method,
        amount: Number(line.amount),
        tendered: line.method === "CASH" ? Number(line.tendered) : null,
        reference: line.reference.trim() || null,
        edcPaymentId: line.card?.edcPaymentId ?? null,
      })),
    };

    try {
      const result = await requestJson<{ order: OrderDetails }>(
        "/api/orders/checkout",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        { retries: 0 },
      );
      if (!result.ok) {
        const key = ERROR_KEYS[result.code ?? ""];
        const message = key ? t(key) : result.network ? t("checkout.networkCheckout") : (result.message ?? t("checkout.failed"));
        setError(message);
        toast.add({ title: t("checkout.failed"), description: message, type: "error" });
        return;
      }
      setOrder(result.data.order);
      toast.add({ title: t("checkout.saleComplete"), description: result.data.order.receiptNo, type: "success" });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }, [submitting, items, bag, member, promotionId, redeemInput, manualDiscount, lines, t]);

  // A card approval completes the sale automatically when that approval balances the bill.
  useEffect(() => {
    if (!autoSubmitRef.current) return;
    autoSubmitRef.current = false;
    if (canSubmit) void submit();
  }, [lines, canSubmit, submit]);

  const setLinePending = useCallback((id: number, pending: boolean) => {
    setPendingIds((prev) => {
      if (prev.has(id) === pending) return prev;
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function updateLine(id: number, patch: Partial<PaymentDraft>): void {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch, touched: true } : line)));
  }

  function addLine(): void {
    setLines((current) => [...current, newLine("CASH", remainingSatang > 0 ? satangToDecimal(remainingSatang) : "")]);
  }

  function removeLine(id: number): void {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.id !== id) : current));
  }

  function approveCard(id: number, card: ApprovedCard): void {
    autoSubmitRef.current = true;
    setLines((current) => current.map((line) => (line.id === id ? { ...line, card, touched: true } : line)));
  }

  function finish(): void {
    if (order) onCompleted(order);
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean): void {
    if (submitting) return;
    if (!next && cardPending) return;
    if (!next && order) {
      finish();
      return;
    }
    onOpenChange(next);
  }

  const problemText = pricingProblem
    ? pricingProblem.kind === "network"
      ? t("checkout.pricingNetwork")
      : pricingProblem.kind === "database"
        ? t("checkout.pricingDatabase")
        : (pricingProblem.message ?? t("checkout.pricingFailed"))
    : null;

  return (
    <>
      {printRoot}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          {order ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-emerald-600" />
                  {t("checkout.saleComplete")}
                </DialogTitle>
                <DialogDescription>
                  {t("checkout.receiptTotal", { receipt: order.receiptNo, total: formatBaht(Number(order.totalAmount)) })}
                </DialogDescription>
              </DialogHeader>
              <div className="receipt-preview max-h-[50vh] overflow-y-auto rounded-md bg-muted/50 p-3">
                <Receipt order={order} />
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => print(order)}>
                  <Printer className="size-4" /> {t("checkout.printReceipt")}
                </Button>
                <Button onClick={finish}>{t("checkout.newSale")}</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("checkout.title")}</DialogTitle>
                <DialogDescription>{t("checkout.amountDue", { amount: formatBaht(dueSatang / 100) })}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-6 md:grid-cols-2">
                <section className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t("checkout.member")}</span>
                    <MemberPicker
                      selected={member}
                      onSelect={(next) => {
                        setMember(next);
                        setRedeemInput("");
                      }}
                      disabled={submitting}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t("checkout.bag")}</span>
                    <div className="grid grid-cols-3 gap-2">
                      {BAG_KEYS.map((option) => (
                        <Button
                          key={option.value}
                          variant={bag === option.value ? "default" : "outline"}
                          size="sm"
                          className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-2 text-center leading-tight"
                          onClick={() => setBag(option.value)}
                          disabled={submitting}
                        >
                          {t(option.key)}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="promotion" className="text-sm font-medium">
                      {t("checkout.promotion")}
                    </label>
                    <select
                      id="promotion"
                      value={promotionId}
                      onChange={(event) => setPromotionId(event.target.value)}
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      disabled={submitting}
                    >
                      <option value="">{t("checkout.noPromotion")}</option>
                      {promotions.map((promo) => (
                        <option key={promo.id} value={promo.id}>
                          {promo.name}
                          {promo.kind === "PERCENT_OFF" ? ` (${Number(promo.value)}%)` : ` (-${formatBaht(Number(promo.value))})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {member ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="redeem" className="text-sm font-medium">
                        {t("checkout.redeem")}
                      </label>
                      <Input
                        id="redeem"
                        type="number"
                        min={0}
                        max={member.points}
                        step={1}
                        value={redeemInput}
                        onChange={(event) => setRedeemInput(event.target.value)}
                        placeholder={t("checkout.redeemUpTo", { count: member.points })}
                        disabled={submitting}
                      />
                      {!redeemValid ? (
                        <p className="text-sm text-destructive">{t("checkout.pointsLimit", { count: member.points })}</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="flex min-w-0 flex-col gap-4">
                  <div className="rounded-md border p-3 text-sm" aria-live="polite">
                    {items.length === 0 ? (
                      <p className="text-muted-foreground">{t("checkout.emptyBasket")}</p>
                    ) : problemText ? (
                      <div className="flex flex-col gap-2">
                        <p role="alert" className="text-destructive">
                          {problemText}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="self-start"
                          onClick={() => setQuoteAttempt((n) => n + 1)}
                          disabled={quoteLoading}
                        >
                          <RefreshCw className="size-4" /> {t("checkout.recalculate")}
                        </Button>
                      </div>
                    ) : !quote ? (
                      <p className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> {t("checkout.pricing")}
                      </p>
                    ) : (
                      <dl className="flex flex-col gap-1.5">
                        <QuoteRow label={t("checkout.subtotal")} value={quote.totals.subtotal} />
                        {Number(quote.totals.promotionDiscount) > 0 ? (
                          <QuoteRow
                            label={quote.promotionName ?? t("receipt.promotionFallback")}
                            value={`-${quote.totals.promotionDiscount}`}
                          />
                        ) : null}
                        {Number(quote.totals.memberDiscount) > 0 ? (
                          <QuoteRow label={t("checkout.memberDiscount")} value={`-${quote.totals.memberDiscount}`} />
                        ) : null}
                        {Number(quote.totals.manualDiscount) > 0 ? (
                          <QuoteRow label={t("checkout.discount")} value={`-${quote.totals.manualDiscount}`} />
                        ) : null}
                        {Number(quote.totals.pointsDiscount) > 0 ? (
                          <QuoteRow label={t("checkout.pointsRedeemed")} value={`-${quote.totals.pointsDiscount}`} />
                        ) : null}
                        <div className="mt-1 flex items-end justify-between border-t pt-2 font-semibold">
                          <dt className="text-base">{t("checkout.totalDue")}</dt>
                          <dd className="num text-3xl leading-none font-bold tracking-tight">{formatBaht(Number(quote.totals.total))}</dd>
                        </div>
                        {member && quote.pointsEarned > 0 ? (
                          <p className="text-xs text-muted-foreground">{t("checkout.memberEarns", { count: quote.pointsEarned })}</p>
                        ) : null}
                      </dl>
                    )}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t("checkout.payment")}</span>
                      <span className={`text-sm tabular-nums ${remainingSatang === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                        {remainingSatang === 0
                          ? t("checkout.fullyPaid")
                          : remainingSatang > 0
                            ? t("checkout.remaining", { amount: formatBaht(remainingSatang / 100) })
                            : t("checkout.overBy", { amount: formatBaht(-remainingSatang / 100) })}
                      </span>
                    </div>

                    {lines.map((line, index) => (
                      <PaymentLine
                        key={line.id}
                        index={index}
                        line={line}
                        disabled={submitting || !!line.card}
                        pending={pendingIds.has(line.id)}
                        canRemove={lines.length > 1 && !line.card && !pendingIds.has(line.id)}
                        onChange={(patch) => updateLine(line.id, patch)}
                        onRemove={() => removeLine(line.id)}
                        onApproved={(card) => approveCard(line.id, card)}
                        onPendingChange={(pending) => setLinePending(line.id, pending)}
                        onSubmit={() => {
                          if (canSubmit) void submit();
                        }}
                      />
                    ))}

                    <Button variant="outline" size="sm" onClick={addLine} disabled={submitting || remainingSatang <= 0 || !quote}>
                      {t("checkout.addPayment")}
                    </Button>
                  </div>

                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                </section>
              </div>

              {/* Stuck to the bottom: the card screen (slip boxes) makes the dialog taller than a 768 px laptop, and the confirm button must never scroll away. */}
              <DialogFooter className="sticky bottom-0 z-10 bg-background">
                <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting || cardPending}>
                  {t("common.cancel")}
                </Button>
                <Button size="lg" className="h-12 min-w-44 px-8 text-base font-semibold" onClick={() => void submit()} disabled={!canSubmit}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("checkout.confirm")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatBaht(Number(value))}</dd>
    </div>
  );
}

interface PaymentLineProps {
  index: number;
  line: PaymentDraft;
  disabled: boolean;
  /** A terminal payment is waiting for this line. The method and amount stay locked until it finishes. */
  pending: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<PaymentDraft>) => void;
  onRemove: () => void;
  onApproved: (card: ApprovedCard) => void;
  onPendingChange: (pending: boolean) => void;
  /** Enter in the cash-received box: completes the sale when it can be completed. */
  onSubmit: () => void;
}

function PaymentLine({
  index,
  line,
  disabled,
  pending,
  canRemove,
  onChange,
  onRemove,
  onApproved,
  onPendingChange,
  onSubmit,
}: PaymentLineProps) {
  const { t } = useI18n();
  const locked = disabled || pending;
  const amountSatang = parseSatang(line.amount) ?? 0;
  const tenderedSatang = parseSatang(line.tendered);
  const change = line.method === "CASH" && tenderedSatang !== null && tenderedSatang >= amountSatang ? tenderedSatang - amountSatang : null;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t("checkout.paymentN", { n: index + 1 })}</span>
        {canRemove ? (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={onRemove}>
            {t("checkout.remove")}
          </button>
        ) : null}
      </div>

      {/* Each channel gets its own cell, so long labels wrap inside the button instead of overlapping. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {METHOD_KEYS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={line.method === option.value ? "default" : "outline"}
            disabled={locked}
            className="h-auto min-h-9 w-full min-w-0 whitespace-normal px-2 py-2 text-center leading-tight"
            onClick={() => onChange({ method: option.value, card: null, reference: "", tendered: "" })}
          >
            {t(option.key)}
          </Button>
        ))}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{t("checkout.amount")}</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={line.amount}
          onChange={(event) => onChange({ amount: event.target.value })}
          className="h-9 w-40 text-right tabular-nums"
          disabled={locked}
        />
      </label>

      {line.method === "CASH" ? (
        <>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{t("checkout.cashReceived")}</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              autoFocus
              id={`cash-received-${line.id}`}
              value={line.tendered}
              onChange={(event) => onChange({ tendered: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              className="num h-11 w-44 text-right text-xl font-semibold"
              disabled={locked}
            />
          </label>
          {/* Quick cash: the same four buttons in the same places every time, so a hand learns them. A note smaller than the
              amount is greyed out instead of hidden. */}
          <div className="grid grid-cols-4 gap-1.5">
            {[amountSatang, ...BILL_DENOMINATIONS.map((b) => b * 100)].map((value, position) => (
              <Button
                key={position}
                size="sm"
                variant="secondary"
                className="num h-10 text-sm font-semibold"
                disabled={locked || amountSatang <= 0 || value < amountSatang}
                onClick={() => {
                  onChange({ tendered: satangToDecimal(value) });
                  // The cursor goes back to the cash box, so Enter completes the sale without reaching for the mouse.
                  document.getElementById(`cash-received-${line.id}`)?.focus();
                }}
              >
                {position === 0 ? t("checkout.exact") : formatBaht(value / 100).replace(/\.00$/, "")}
              </Button>
            ))}
          </div>
          <div className="flex items-end justify-between rounded-md bg-muted px-3 py-2">
            <span className="text-sm font-medium">{t("checkout.change")}</span>
            <span className={`num text-2xl leading-none font-bold ${change !== null ? "text-emerald-700" : "text-muted-foreground"}`}>
              {change !== null ? formatBaht(change / 100) : "—"}
            </span>
          </div>
        </>
      ) : null}

      {line.method === "QR_PROMPTPAY" || line.method === "BANK_TRANSFER" ? (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t("checkout.reference")}</span>
          <Input
            value={line.reference}
            onChange={(event) => onChange({ reference: event.target.value })}
            className="h-9 w-40 font-mono"
            maxLength={100}
            disabled={locked}
          />
        </label>
      ) : null}

      {line.method === "CARD" ? (
        <CardPaymentLine
          amount={amountSatang / 100}
          disabled={disabled || amountSatang <= 0}
          onApproved={onApproved}
          onPendingChange={onPendingChange}
        />
      ) : null}
    </div>
  );
}
