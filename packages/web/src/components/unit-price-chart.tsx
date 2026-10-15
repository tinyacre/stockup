import { useState } from 'react';
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
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { PriceRecord, ProductDetail } from '@/lib/api';
import { formatSize, formatYuan } from '@/lib/format';
import { today } from '@/lib/pricing';

const day = 24 * 60 * 60 * 1000;

type Range = 'halfYear' | 'year' | 'all';

const ranges: { value: Range; label: string }[] = [
  { value: 'halfYear', label: '近 6 月' },
  { value: 'year', label: '近 1 年' },
  { value: 'all', label: '全部' },
];

const rangeMonths: Record<Exclude<Range, 'all'>, number> = { halfYear: 6, year: 12 };

// Record dates are calendar days, so the cutoff is compared as a "YYYY-MM-DD" string.
function cutoff(range: Range) {
  if (range === 'all') return '';
  const [year, month, date] = today().split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(year, month - 1 - rangeMonths[range], date));
  return start.toISOString().slice(0, 10);
}

interface Point {
  time: number;
  yuan: number;
  record: PriceRecord;
}

const axisTick = { fontSize: 11, fill: 'var(--ink-3)', fontFamily: 'var(--typeface-numeric)' };

// Plots unit prices on a time scale, so records bunched around a promotion sit close together.
export function UnitPriceChart({ records, product }: { records: PriceRecord[]; product: ProductDetail }) {
  const [range, setRange] = useState<Range>('all');
  const from = cutoff(range);
  const points: Point[] = records
    .filter((record) => record.date >= from)
    .map((record) => ({ time: Date.parse(record.date), yuan: record.unitPrice / 100, record }))
    .sort((a, b) => a.time - b.time);
  const { stockLine, lowestUnitPrice } = product;
  // A short span reads better by day, a long one by month.
  const span = points.length ? points.at(-1)!.time - points[0]!.time : 0;
  const tickLabel = (time: number) => {
    const iso = new Date(time).toISOString();
    return span < 180 * day ? iso.slice(5, 10) : iso.slice(2, 7).replace('-', '.');
  };

  return (
    <Panel asChild>
      <figure aria-label="单价走势">
        <PanelHeader
          title={
            <>
              单价走势
              <span className="text-xs font-normal tracking-normal text-ink-3">
                元 / {formatSize(product.baseSize, product.pricingUnit)}
              </span>
            </>
          }
          actions={
            <SegmentedControl<Range>
              aria-label="时间范围"
              size="sm"
              options={ranges}
              value={range}
              onValueChange={setRange}
            />
          }
        >
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full bg-ink" />
              已购
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full border-[1.5px] border-ink" />
              仅记录
            </span>
            {stockLine !== null && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="w-4 border-t-2 border-dashed border-gold-edge" />
                入手价 <span className="numeric text-[13px] text-gold-ink">{formatYuan(stockLine)}</span>
              </span>
            )}
            {lowestUnitPrice !== null && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="w-4 border-t-2 border-dotted border-record-low" />
                历史最低 <span className="numeric text-[13px] text-record-low">{formatYuan(lowestUnitPrice)}</span>
              </span>
            )}
          </span>
        </PanelHeader>
        <div className="h-56 pt-3 pb-1 pr-(--panel-padding) wide:h-64">
          {points.length === 0 ? (
            <p className="grid h-full place-items-center text-sm text-ink-3">暂无价格记录</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={[(min: number) => min - day, (max: number) => max + day]}
                  tickFormatter={tickLabel}
                  tick={axisTick}
                  stroke="var(--line-strong)"
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  width={44}
                  tickFormatter={(yuan: number) => yuan.toFixed(2)}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                  // Lifts the lowest price, and its reference line, off the x axis.
                  padding={{ top: 12, bottom: 12 }}
                />
                <Tooltip content={PointTooltip} cursor={{ stroke: 'var(--line-strong)' }} />
                {stockLine !== null && (
                  <ReferenceLine
                    y={stockLine / 100}
                    stroke="var(--gold-edge)"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    ifOverflow="extendDomain"
                  />
                )}
                {lowestUnitPrice !== null && (
                  <ReferenceLine
                    y={lowestUnitPrice / 100}
                    stroke="var(--record-low)"
                    strokeWidth={1.5}
                    strokeDasharray="2 3"
                    ifOverflow="extendDomain"
                  />
                )}
                <Line
                  dataKey="yuan"
                  stroke="var(--ink-2)"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  dot={({ cx, cy, payload }) => {
                    const lowest = payload.record.unitPrice === lowestUnitPrice;
                    const color = lowest ? 'var(--record-low)' : 'var(--ink)';
                    return (
                      <circle
                        key={payload.record.id}
                        cx={cx}
                        cy={cy}
                        r={lowest ? 4.5 : 3.5}
                        stroke={color}
                        strokeWidth={1.5}
                        // Hollow dots are prices only seen, not bought.
                        fill={payload.record.purchased ? color : 'var(--surface)'}
                      />
                    );
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </figure>
    </Panel>
  );
}

function PointTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || !point) return null;
  const { record } = point;
  return (
    <div className="rounded-md bg-ink px-2.5 py-1.5 text-xs text-surface shadow-overlay">
      <p>
        {record.date} {record.channel.name}
      </p>
      <p className="flex items-baseline gap-1.5">
        <span className="numeric text-num-sm font-semibold">{formatYuan(record.unitPrice)}</span>
        <span className="opacity-70">
          {record.purchased ? '已购' : '仅记录'}
          {record.promotion && ` · ${record.promotion.name}`}
        </span>
      </p>
    </div>
  );
}
