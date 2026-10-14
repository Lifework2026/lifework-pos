import { formatBaht } from "@/lib/format";
import { satangToDecimal } from "@/lib/pricing";
import type { SeriesPoint } from "@/lib/reports";

const money = (satang: number) => formatBaht(Number(satangToDecimal(satang)));

interface SalesBarChartProps {
  points: SeriesPoint[];
  /** Show a label under every Nth bar, so 24 hourly bars stay readable. */
  labelEvery: number;
  emptyText: string;
}

/**
 * Net sales per bucket as a bar chart. Server-rendered HTML and CSS only: no chart library and no
 * client JavaScript. Each bar carries a tooltip with the exact figures.
 */
export function SalesBarChart({ points, labelEvery, emptyText }: SalesBarChartProps) {
  const peak = Math.max(0, ...points.map((point) => point.net));
  if (peak === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{money(peak)}</span>
      </div>
      <div className="flex h-44 items-end gap-1 border-b border-l px-1" role="img" aria-label="Sales chart">
        {points.map((point) => {
          const height = point.net > 0 ? Math.max(2, (point.net / peak) * 100) : 0;
          return (
            <div
              key={point.key}
              className="group relative flex h-full flex-1 items-end"
              title={`${point.label}: ${money(point.net)}`}
            >
              <div className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${height}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 px-1 text-[10px] text-muted-foreground tabular-nums">
        {points.map((point, index) => (
          <span key={point.key} className="flex-1 text-center">
            {index % labelEvery === 0 ? point.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface SplitSlice {
  key: string;
  label: string;
  amount: number;
  className: string;
}

/** One stacked bar showing each payment channel's share of sales, with a legend. */
export function PaymentSplitBar({ slices, emptyText }: { slices: SplitSlice[]; emptyText: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);
  if (total <= 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Payment split">
        {slices
          .filter((slice) => slice.amount > 0)
          .map((slice) => (
            <div
              key={slice.key}
              className={slice.className}
              style={{ width: `${(slice.amount / total) * 100}%` }}
              title={`${slice.label}: ${money(slice.amount)}`}
            />
          ))}
      </div>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
        {slices
          .filter((slice) => slice.amount > 0)
          .map((slice) => (
            <li key={slice.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className={`inline-block size-3 rounded-sm ${slice.className}`} />
                {slice.label}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {money(slice.amount)} · {((slice.amount / total) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
