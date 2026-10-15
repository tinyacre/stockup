import type { CSSProperties } from 'react';
import type { Verdict } from '@stockup/domain';
import { cn } from '@/lib/utils';

export interface RulerReferences {
  lowest: number | null;
  stockLine: number | null;
  lastYear: { name: string; lowest: number } | null;
}

const verdictColor: Record<Verdict | 'none', string> = {
  recordLow: 'var(--record-low)',
  stockUp: 'var(--stock-up)',
  skip: 'var(--skip)',
  noReference: 'var(--skip)',
  none: 'var(--ink-3)',
};

const yuan = (cents: number) => (cents / 100).toFixed(2);

// Labels closer than this share a row only when there is room, measured in percent of the ruler's width.
const labelSpan = 30;

// Picks a round step that splits the scale into at most six intervals.
function ticksOf(low: number, high: number) {
  const rough = (high - low) / 6;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((f) => f * magnitude).find((s) => s >= rough)!;
  const ticks = [];
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) ticks.push(v);
  return ticks;
}

function anchor(position: number) {
  if (position < 12) return 'translate-x-0';
  if (position > 88) return '-translate-x-full';
  return '-translate-x-1/2';
}

// The unit price against the references it is judged by. The scale spans the references only, so an
// outlying price is pinned to an edge instead of squashing them. The tool theme draws a track with a
// pin above it; the price-tag theme draws a ticked scale with flags above and the pin below.
export function PriceRuler({
  references,
  unitPrice,
  verdict,
  per,
  className,
}: {
  references: RulerReferences;
  // In cents, per base size.
  unitPrice: number | null;
  verdict: Verdict | null;
  per: string;
  className?: string;
}) {
  const marks = [
    references.lowest !== null && {
      key: 'lowest',
      label: '历史最低',
      value: references.lowest,
      line: 'bg-record-low',
      text: 'text-record-low',
    },
    references.stockLine !== null && {
      key: 'stockLine',
      label: '入手价',
      value: references.stockLine,
      line: 'bg-gold-ink price-tag:bg-ink',
      text: 'text-ink-2 price-tag:bg-gold price-tag:px-1.5 price-tag:font-semibold price-tag:text-on-gold',
    },
    references.lastYear && {
      key: 'lastYear',
      label: `去年${references.lastYear.name}`,
      value: references.lastYear.lowest,
      line: 'bg-ink-3 price-tag:w-0 price-tag:border-l-[1.25px] price-tag:border-dashed price-tag:border-ink-3 price-tag:bg-transparent',
      text: 'text-ink-3 price-tag:text-ink-2',
    },
  ].filter((m) => m !== false && m !== null);

  if (marks.length === 0) {
    return <p className={cn('text-[13px] text-ink-3', className)}>暂无价格记录</p>;
  }

  const values = marks.map((m) => m.value);
  const low = Math.min(...values) * 0.8;
  const high = Math.max(...values) * 1.25;
  const at = (v: number) => Math.min(100, Math.max(0, ((v - low) / (high - low)) * 100));

  // Two label rows: a label takes the inner row unless it would overlap its neighbour there.
  const rows = new Map<string, number>();
  const lastInRow: number[] = [-Infinity, -Infinity];
  for (const m of [...marks].sort((a, b) => a.value - b.value)) {
    const position = at(m.value);
    const free = lastInRow.findIndex((last) => position - last >= labelSpan);
    const row = free === -1 ? (lastInRow[0]! < lastInRow[1]! ? 0 : 1) : free;
    lastInRow[row] = position;
    rows.set(m.key, row);
  }

  const lowestAt = references.lowest === null ? 0 : at(references.lowest);
  const stockAt = references.stockLine === null ? lowestAt : Math.max(lowestAt, at(references.stockLine));
  const zones = [
    { from: 0, to: lowestAt, className: 'bg-record-low-zone price-tag:bg-record-low-soft' },
    { from: lowestAt, to: stockAt, className: 'bg-stock-up-zone price-tag:bg-stock-up-soft' },
    references.stockLine !== null && { from: stockAt, to: 100, className: 'price-tag:bg-skip-soft' },
  ]
    .filter((z) => z !== false)
    .filter((z) => z.to > z.from);

  const overflow = unitPrice === null ? 0 : unitPrice > high ? 1 : unitPrice < low ? -1 : 0;
  const pinAt = unitPrice === null ? 0 : at(unitPrice);

  return (
    <figure aria-label="价位标尺" className={cn('flex flex-col gap-1.5', className)}>
      <figcaption className="flex items-baseline justify-between text-title-section text-ink-3 price-tag:tracking-[.12em]">
        <span>价位标尺</span>
        <span className="numeric tracking-normal">¥ / {per}</span>
      </figcaption>
      <div className="relative mx-3 h-[86px] select-none price-tag:h-[100px]">
        <div
          aria-hidden
          className="absolute inset-x-0 top-[34px] h-1.5 rounded-full bg-line price-tag:top-[54px] price-tag:h-[1.5px] price-tag:rounded-none price-tag:bg-ink"
        />
        {zones.map((z) => (
          <div
            key={z.className}
            aria-hidden
            className={cn(
              'absolute top-[34px] h-1.5 first:rounded-l-full price-tag:top-[46px] price-tag:h-2 price-tag:rounded-none',
              z.className,
            )}
            style={{ left: `${z.from}%`, width: `${z.to - z.from}%` }}
          />
        ))}
        {ticksOf(low, high).map((v) => (
          <div
            key={v}
            aria-hidden
            className="absolute top-[54px] hidden -translate-x-1/2 flex-col items-center price-tag:flex"
            style={{ left: `${at(v)}%` }}
          >
            <span className="h-[7px] w-[1.25px] bg-ink" />
            <span className="numeric mt-0.5 text-xs text-ink-3">{yuan(v)}</span>
          </div>
        ))}
        {marks.map((m) => (
          <div
            key={m.key}
            aria-hidden
            className={cn(
              'absolute top-[28px] h-[18px] w-0.5 -translate-x-1/2 rounded-full',
              'price-tag:top-[calc(34px-var(--row)*18px)] price-tag:h-[calc(20px+var(--row)*18px)] price-tag:w-[1.5px] price-tag:rounded-none',
              m.line,
            )}
            style={{ left: `${at(m.value)}%`, '--row': rows.get(m.key) } as CSSProperties}
          />
        ))}
        <ul aria-label="参考单价">
          {marks.map((m) => (
            <li
              key={m.key}
              className={cn(
                'absolute top-[calc(50px+var(--row)*16px)] flex items-baseline gap-1 text-[11px] leading-4 whitespace-nowrap',
                'price-tag:top-[calc(18px-var(--row)*18px)] price-tag:rounded-[2px] price-tag:text-xs',
                anchor(at(m.value)),
                m.text,
              )}
              style={{ left: `${at(m.value)}%`, '--row': rows.get(m.key) } as CSSProperties}
            >
              {m.label}
              <span className="numeric text-[13px] font-semibold">{yuan(m.value)}</span>
            </li>
          ))}
        </ul>
        {unitPrice !== null && (
          <div
            aria-hidden
            className={cn(
              'absolute top-0 flex flex-col',
              'price-tag:top-[40px]',
              overflow > 0 ? '-translate-x-full items-end' : overflow < 0 ? 'items-start' : '-translate-x-1/2 items-center',
            )}
            style={{ left: `${pinAt}%`, '--pin': verdictColor[verdict ?? 'none'] } as CSSProperties}
          >
            <span
              className={cn(
                'flex h-[22px] items-baseline gap-1 rounded-md bg-(--pin) px-2 pt-[3px] text-[11px] whitespace-nowrap text-on-verdict',
                'price-tag:order-3 price-tag:mt-2 price-tag:h-auto price-tag:bg-transparent price-tag:p-0 price-tag:text-xs price-tag:font-semibold price-tag:text-(--pin)',
              )}
            >
              {overflow < 0 && '‹'}本次
              <span className="numeric text-sm font-semibold price-tag:text-base">{yuan(unitPrice)}</span>
              {overflow > 0 && '›'}
            </span>
            <span className="h-[9px] w-0.5 bg-(--pin) price-tag:order-1 price-tag:h-[14px] price-tag:w-[3px]" />
            <span className="size-3 rounded-full border-2 border-surface bg-(--pin) shadow-[0_0_0_1px_var(--pin)] price-tag:order-2 price-tag:mt-0.5 price-tag:h-2.5 price-tag:w-3 price-tag:rounded-none price-tag:border-0 price-tag:shadow-none price-tag:[clip-path:polygon(50%_0,100%_100%,0_100%)]" />
          </div>
        )}
      </div>
    </figure>
  );
}
