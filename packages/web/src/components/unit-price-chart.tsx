import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { PriceRecord, ProductDetail } from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';
import { formatUnitPrice } from '@/lib/pricing';

const day = 24 * 60 * 60 * 1000;

interface Point {
  time: number;
  yuan: number;
  record: PriceRecord;
}

// Plots unit prices on a time scale, so records bunched around a promotion sit close together.
export function UnitPriceChart({ records, product }: { records: PriceRecord[]; product: ProductDetail }) {
  const points: Point[] = records
    .map((record) => ({ time: Date.parse(record.date), yuan: record.unitPrice / 100, record }))
    .sort((a, b) => a.time - b.time);
  const { stockLine, lowestUnitPrice } = product;
  // A short span reads better by day, a long one by month.
  const span = points.length ? points.at(-1)!.time - points[0]!.time : 0;
  const tickLabel = (time: number) => {
    const iso = new Date(time).toISOString();
    return span < 180 * day ? iso.slice(5, 10) : iso.slice(2, 7);
  };

  return (
    <figure aria-label="单价走势" className="flex flex-col gap-2 rounded-lg border p-3">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">单价走势</span>
        {stockLine !== null && (
          <span className="text-stock-up">入手价 {formatUnitPrice(stockLine, product)}</span>
        )}
        {lowestUnitPrice !== null && (
          <span className="text-record-low">历史最低单价 {formatUnitPrice(lowestUnitPrice, product)}</span>
        )}
      </figcaption>
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={[(min: number) => min - day, (max: number) => max + day]}
              tickFormatter={tickLabel}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              minTickGap={24}
            />
            <YAxis
              width={48}
              tickFormatter={(yuan: number) => `¥${yuan}`}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              domain={['auto', 'auto']}
              // Lifts the lowest price, and its reference line, off the x axis.
              padding={{ top: 12, bottom: 12 }}
            />
            <Tooltip content={PointTooltip} />
            {stockLine !== null && (
              <ReferenceLine
                y={stockLine / 100}
                stroke="var(--stock-up)"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
            )}
            {lowestUnitPrice !== null && (
              <ReferenceLine
                y={lowestUnitPrice / 100}
                stroke="var(--record-low)"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
            )}
            <Line
              dataKey="yuan"
              stroke="var(--foreground)"
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={({ cx, cy, payload }) => (
                <circle
                  key={payload.record.id}
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  stroke="var(--foreground)"
                  strokeWidth={1.5}
                  // Hollow dots are prices only seen, not bought.
                  fill={payload.record.purchased ? 'var(--foreground)' : 'var(--card)'}
                />
              )}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted-foreground text-xs">实心点为已购，空心点为仅记录；单价按 {formatSize(product.baseSize, product.pricingUnit)} 计。</p>
    </figure>
  );
}

function PointTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || !point) return null;
  const { record } = point;
  return (
    <div className="bg-popover rounded-md border px-2 py-1 text-xs shadow-sm">
      <p className="tabular-nums">
        {record.date} {record.channel.name}
      </p>
      <p className="font-semibold tabular-nums">
        {formatYuan(record.unitPrice)}
        <span className="text-muted-foreground font-normal">
          {' '}
          {record.purchased ? '已购' : '仅记录'}
          {record.promotion && ` · ${record.promotion.name}`}
        </span>
      </p>
    </div>
  );
}
