import { Card, CardContent } from "@/components/ui/card";

/** Placeholder tiles shown while the product grid loads, so the layout does not jump. Same grid as the real one. */
export function ProductGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2.5" aria-hidden data-testid="product-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border bg-card">
          <div className="aspect-square w-full animate-pulse bg-muted" />
          <div className="flex flex-col gap-2 border-t p-2.5">
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder for the cart while the till is still identifying the signed-in user. */
export function CartSkeleton() {
  return (
    <Card className="flex h-full min-h-0 flex-col" aria-hidden data-testid="cart-skeleton">
      <div className="flex flex-col gap-3 border-b p-4">
        <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-8 animate-pulse rounded bg-muted" />
          <div className="h-8 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <CardContent className="flex flex-col gap-4 p-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex gap-3">
            <div className="size-12 shrink-0 animate-pulse rounded-md bg-muted" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
