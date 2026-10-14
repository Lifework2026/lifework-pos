"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { satangToDecimal } from "@/lib/pricing";
import type { ApiErrorBody, MemberSummary, OrderDetails, PromotionSummary } from "@/lib/pos-types";
import { Receipt } from "@/components/pos/receipt";
import { CardPaymentLine, type ApprovedCard } from "@/components/pos/card-payment-line";
import { MemberPicker } from "@/components/pos/member-picker";
import { useCartStore, type CartItem } from "@/store/useCartStore";

type Method = "CASH" | "CARD" | "QR_PROMPTPAY" | "BANK_TRANSFER" | "OTHER";
type BagChoice = "NONE" | "SMALL" | "LARGE";

const METHOD_OPTIONS: { value: Method; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Credit / EDC" },
  { value: "QR_PROMPTPAY", label: "PromptPay QR" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

const BAG_OPTIONS: { value: BagChoice; label: string }[] = [
  { value: "NONE", label: "No bag" },
  { value: "SMALL", label: "Small bag" },
  { value: "LARGE", label: "Large bag" },
];

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
  totals: { subtotal: string; promotionDiscount: string; memberDiscount: string; manualDiscount: string; pointsDiscount: string; discount: string; total: string };
  promotionName: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  member: MemberSummary | null;
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
  const items = useCartStore((state) => state.items);
  const manualDiscount = useCartStore((state) => state.discount);

  const [bag, setBag] = useState<BagChoice>("NONE");
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [promotionId, setPromotionId] = useState("");
  const [promotions, setPromotions] = useState<PromotionSummary[]>([]);
  const [redeemInput, setRedeemInput] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [lines, setLines] = useState<PaymentDraft[]>(() => [newLine("CASH", "")]);
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
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
    setQuoteError(null);
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

  // Re-price whenever the basket, bag, member, promotion or points change.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/orders/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: quoteJson,
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => null)) as QuoteResponse & ApiErrorBody;
        if (!res.ok) {
          setQuote(null);
          setQuoteError(body?.message ?? "Could not price this basket.");
          return;
        }
        setQuote(body);
        setQuoteError(null);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setQuoteError("Network error while pricing. Check the connection.");
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, quoteJson]);

  const dueSatang = quote ? (parseSatang(quote.totals.total) ?? 0) : 0;
  const appliedSatang = lines.reduce((sum, line) => sum + (parseSatang(line.amount) ?? 0), 0);
  const remainingSatang = dueSatang - appliedSatang;
  const cardPending = pendingIds.size > 0;
  const redeemValid = !redeemInput || (Number.isInteger(Number(redeemInput)) && Number(redeemInput) >= 0 && Number(redeemInput) <= (member?.points ?? 0));

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

  const canSubmit =
    !!quote &&
    !quoteError &&
    dueSatang > 0 &&
    remainingSatang === 0 &&
    lines.length > 0 &&
    lines.every(lineIsValid) &&
    !cardPending &&
    redeemValid &&
    !submitting;

  const submit = useCallback(async (): Promise<void> => {
    if (submitting) return;
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
      const res = await fetch("/api/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { order?: OrderDetails } & ApiErrorBody;
      if (!res.ok || !body.order) {
        const message = body?.message ?? "Checkout failed. Please try again.";
        setError(message);
        toast.add({ title: "Checkout failed", description: message, type: "error" });
        return;
      }
      setOrder(body.order);
      toast.add({ title: "Sale complete", description: `Receipt ${body.order.receiptNo}`, type: "success" });
    } catch {
      const message = "Network error. Check the connection; no sale was recorded.";
      setError(message);
      toast.add({ title: "Checkout failed", description: message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, items, bag, member, promotionId, redeemInput, manualDiscount, lines]);

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {order ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-600" />
                Sale complete
              </DialogTitle>
              <DialogDescription>
                Receipt {order.receiptNo} · Total {formatBaht(Number(order.totalAmount))}
              </DialogDescription>
            </DialogHeader>
            <div className="receipt-preview max-h-[50vh] overflow-y-auto rounded-md bg-muted/50 p-3">
              <Receipt order={order} />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" /> Print receipt
              </Button>
              <Button onClick={finish}>New sale</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Checkout</DialogTitle>
              <DialogDescription>Amount due {formatBaht(dueSatang / 100)}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 md:grid-cols-2">
              <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Member</span>
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
                  <span className="text-sm font-medium">Shopping bag</span>
                  <div className="grid grid-cols-3 gap-2">
                    {BAG_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        variant={bag === option.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => setBag(option.value)}
                        disabled={submitting}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="promotion" className="text-sm font-medium">
                    Promotion
                  </label>
                  <select
                    id="promotion"
                    value={promotionId}
                    onChange={(event) => setPromotionId(event.target.value)}
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    disabled={submitting}
                  >
                    <option value="">No promotion</option>
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
                      Redeem points (1 point = ฿1)
                    </label>
                    <Input
                      id="redeem"
                      type="number"
                      min={0}
                      max={member.points}
                      step={1}
                      value={redeemInput}
                      onChange={(event) => setRedeemInput(event.target.value)}
                      placeholder={`Up to ${member.points}`}
                      disabled={submitting}
                    />
                    {!redeemValid ? (
                      <p className="text-sm text-destructive">The member has {member.points} points.</p>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="flex flex-col gap-4">
                <div className="rounded-md border p-3 text-sm">
                  {quoteError ? (
                    <p role="alert" className="text-destructive">
                      {quoteError}
                    </p>
                  ) : !quote ? (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Pricing...
                    </p>
                  ) : (
                    <dl className="flex flex-col gap-1.5">
                      <QuoteRow label="Subtotal" value={quote.totals.subtotal} />
                      {Number(quote.totals.promotionDiscount) > 0 ? (
                        <QuoteRow label={quote.promotionName ?? "Promotion"} value={`-${quote.totals.promotionDiscount}`} />
                      ) : null}
                      {Number(quote.totals.memberDiscount) > 0 ? (
                        <QuoteRow label="Member discount" value={`-${quote.totals.memberDiscount}`} />
                      ) : null}
                      {Number(quote.totals.manualDiscount) > 0 ? (
                        <QuoteRow label="Discount" value={`-${quote.totals.manualDiscount}`} />
                      ) : null}
                      {Number(quote.totals.pointsDiscount) > 0 ? (
                        <QuoteRow label="Points redeemed" value={`-${quote.totals.pointsDiscount}`} />
                      ) : null}
                      <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
                        <dt>Total due</dt>
                        <dd className="tabular-nums">{formatBaht(Number(quote.totals.total))}</dd>
                      </div>
                      {member && quote.pointsEarned > 0 ? (
                        <p className="text-xs text-muted-foreground">Member earns {quote.pointsEarned} points on this sale.</p>
                      ) : null}
                    </dl>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Payment</span>
                    <span
                      className={`text-sm tabular-nums ${remainingSatang === 0 ? "text-emerald-700" : "text-amber-700"}`}
                    >
                      {remainingSatang === 0
                        ? "Fully paid"
                        : remainingSatang > 0
                          ? `Remaining ${formatBaht(remainingSatang / 100)}`
                          : `Over by ${formatBaht(-remainingSatang / 100)}`}
                    </span>
                  </div>

                  {lines.map((line, index) => (
                    <PaymentLine
                      key={line.id}
                      index={index}
                      line={line}
                      dueSatang={dueSatang}
                      disabled={submitting || !!line.card}
                      pending={pendingIds.has(line.id)}
                      canRemove={lines.length > 1 && !line.card && !pendingIds.has(line.id)}
                      onChange={(patch) => updateLine(line.id, patch)}
                      onRemove={() => removeLine(line.id)}
                      onApproved={(card) => approveCard(line.id, card)}
                      onPendingChange={(pending) => setLinePending(line.id, pending)}
                    />
                  ))}

                  <Button variant="outline" size="sm" onClick={addLine} disabled={submitting || remainingSatang <= 0}>
                    Add payment (split)
                  </Button>
                </div>

                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </section>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting || cardPending}
              >
                Cancel
              </Button>
              <Button size="lg" onClick={() => void submit()} disabled={!canSubmit}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Confirm payment
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatBaht(Number(value))}</dd>
    </div>
  );
}

interface PaymentLineProps {
  index: number;
  line: PaymentDraft;
  dueSatang: number;
  disabled: boolean;
  /** A terminal payment is waiting for this line. The method and amount stay locked until it finishes. */
  pending: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<PaymentDraft>) => void;
  onRemove: () => void;
  onApproved: (card: ApprovedCard) => void;
  onPendingChange: (pending: boolean) => void;
}

function PaymentLine({ index, line, dueSatang, disabled, pending, canRemove, onChange, onRemove, onApproved, onPendingChange }: PaymentLineProps) {
  const locked = disabled || pending;
  const amountSatang = parseSatang(line.amount) ?? 0;
  const tenderedSatang = parseSatang(line.tendered);
  const change = line.method === "CASH" && tenderedSatang !== null && tenderedSatang >= amountSatang ? tenderedSatang - amountSatang : null;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Payment {index + 1}</span>
        {canRemove ? (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {METHOD_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={line.method === option.value ? "default" : "outline"}
            disabled={locked}
            onClick={() => onChange({ method: option.value, card: null, reference: "", tendered: "" })}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Amount (฿)</span>
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
            <span className="text-muted-foreground">Cash received (฿)</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={line.tendered}
              onChange={(event) => onChange({ tendered: event.target.value })}
              className="h-9 w-40 text-right tabular-nums"
              disabled={disabled}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set([dueSatang, ...BILL_DENOMINATIONS.map((b) => b * 100)]))
              .filter((value) => value >= amountSatang && value > 0)
              .slice(0, 4)
              .map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onChange({ tendered: satangToDecimal(value) })}
                >
                  {value === dueSatang ? "Exact" : formatBaht(value / 100)}
                </Button>
              ))}
          </div>
          <p className="text-sm">
            Change{" "}
            <span className="font-semibold tabular-nums">{change !== null ? formatBaht(change / 100) : "—"}</span>
          </p>
        </>
      ) : null}

      {line.method === "QR_PROMPTPAY" || line.method === "BANK_TRANSFER" ? (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Reference / slip no.</span>
          <Input
            value={line.reference}
            onChange={(event) => onChange({ reference: event.target.value })}
            className="h-9 w-40 font-mono"
            maxLength={100}
            disabled={disabled}
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
