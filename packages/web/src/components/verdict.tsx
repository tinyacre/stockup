import type { CSSProperties, ReactNode } from 'react';
import type { Judgment, Verdict } from '@stockup/domain';
import { VerdictBadge } from '@/components/ui/badge';
import { formatStockLineGap } from '@/lib/format';
import { verdictLabels } from '@/lib/pricing';
import { cn } from '@/lib/utils';

export const verdictTone: Record<Verdict, { text: string; soft: string; solid: string }> = {
  recordLow: { text: 'text-record-low', soft: 'bg-record-low-soft', solid: 'bg-record-low' },
  stockUp: { text: 'text-stock-up', soft: 'bg-stock-up-soft', solid: 'bg-stock-up' },
  skip: { text: 'text-skip', soft: 'bg-skip-soft', solid: 'bg-skip' },
  noReference: { text: 'text-skip', soft: 'bg-skip-soft', solid: 'bg-skip' },
};

const verdictColors: Record<Verdict | 'none', CSSProperties> = {
  recordLow: { '--verdict': 'var(--record-low)', '--verdict-soft': 'var(--record-low-soft)' } as CSSProperties,
  stockUp: { '--verdict': 'var(--stock-up)', '--verdict-soft': 'var(--stock-up-soft)' } as CSSProperties,
  skip: { '--verdict': 'var(--skip)', '--verdict-soft': 'var(--skip-soft)' } as CSSProperties,
  noReference: { '--verdict': 'var(--skip)', '--verdict-soft': 'var(--skip-soft)' } as CSSProperties,
  none: { '--verdict': 'var(--ink-3)', '--verdict-soft': 'var(--surface-hover)' } as CSSProperties,
};

export interface VerdictDetail {
  label: ReactNode;
  value: ReactNode;
  // Marks the row to compare against, such as the stock line.
  highlight?: boolean;
}

// The verdict and the unit price it judges. Its text reads verdict, price, gap, then details, in both themes:
// the tool theme stacks a badge over a large figure, the price-tag theme draws a shelf tag with a colored band.
export function VerdictDisplay({
  verdict,
  unitPrice,
  per,
  gap,
  placeholder,
  details,
  compact,
  className,
}: {
  verdict: Verdict | null;
  // In cents; null shows `placeholder` instead.
  unitPrice: number | null;
  // The base size the unit price is per, such as "90 抽".
  per: string;
  gap?: ReactNode;
  placeholder?: ReactNode;
  details?: VerdictDetail[];
  // A single-row rendering for the phone's bottom bar.
  compact?: boolean;
  className?: string;
}) {
  const shown = unitPrice === null ? null : verdict;
  return (
    <output
      aria-label="判断"
      data-slot="verdict"
      data-verdict={shown ?? 'none'}
      style={verdictColors[shown ?? 'none']}
      className={cn(
        'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2',
        !compact && [
          'gap-y-2.5',
          'price-tag:relative price-tag:gap-y-0 price-tag:rounded-[3px] price-tag:border-[1.5px] price-tag:border-ink price-tag:bg-surface',
          "price-tag:before:col-[1/-1] price-tag:before:row-start-1 price-tag:before:-mx-[1.5px] price-tag:before:-mt-[1.5px] price-tag:before:self-stretch price-tag:before:rounded-t-[3px] price-tag:before:bg-(--verdict) price-tag:before:content-['']",
        ],
        compact && 'grid-cols-[auto_minmax(0,1fr)] gap-y-0.5',
        className,
      )}
    >
      <span
        className={cn(
          'col-start-1 row-start-1 inline-flex h-6 items-center justify-self-start rounded-md bg-(--verdict-soft) px-2.5 text-[13px] font-semibold whitespace-nowrap text-(--verdict)',
          compact && 'row-span-2 h-full min-h-11 min-w-[52px] justify-center px-2 text-[15px]',
          'price-tag:bg-(--verdict) price-tag:text-on-verdict price-tag:tracking-[.08em]',
          !compact &&
            "price-tag:z-[1] price-tag:h-auto price-tag:gap-2.5 price-tag:bg-transparent price-tag:py-2 price-tag:pl-3.5 price-tag:text-2xl price-tag:leading-tight price-tag:font-bold price-tag:tracking-[.12em] price-tag:before:size-[9px] price-tag:before:rounded-full price-tag:before:bg-surface price-tag:before:shadow-[inset_0_0_0_1.5px_rgb(0_0_0/.25)] price-tag:before:content-['']",
        )}
      >
        {shown ? verdictLabels[shown] : '—'}
      </span>
      {unitPrice === null ? (
        <span
          className={cn(
            'col-span-2 row-start-2 text-[13px] text-ink-3',
            compact && 'col-span-1 col-start-2 row-span-2 row-start-1',
            !compact && 'price-tag:px-4 price-tag:py-6',
          )}
        >
          {placeholder}
        </span>
      ) : (
        <>
          <span
            className={cn(
              'col-span-2 row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5',
              compact && 'col-span-1 col-start-2 row-start-1',
              !compact && 'price-tag:items-start price-tag:gap-0 price-tag:px-4 price-tag:pt-3 price-tag:pb-2',
            )}
          >
            <span
              className={cn(
                'numeric font-semibold text-(--verdict) price-tag:text-ink',
                compact ? 'text-[32px] leading-none' : 'text-num-hero',
                !compact &&
                  'price-tag:flex price-tag:items-start price-tag:text-[72px] price-tag:wide:text-[104px] price-tag:leading-[.86] price-tag:tracking-[-.01em]',
              )}
            >
              <span className={cn(!compact && 'price-tag:mt-[.09em] price-tag:mr-0.5 price-tag:text-[.3em]')}>¥</span>
              {(unitPrice / 100).toFixed(2)}
            </span>
            <span
              className={cn(
                'shrink-0 text-xs text-ink-2 wide:text-sm',
                !compact && 'price-tag:mb-1.5 price-tag:ml-2 price-tag:self-end',
              )}
            >
              {' / '}
              {per}
            </span>
          </span>
          {gap && (
            <span
              className={cn(
                'col-span-2 row-start-3 min-w-0 truncate text-[13px] text-ink-2 tabular-nums',
                compact && 'col-span-1 col-start-2 row-start-2 text-xs text-ink-3',
                !compact &&
                  'price-tag:z-[1] price-tag:col-span-1 price-tag:col-start-2 price-tag:row-start-1 price-tag:justify-self-end price-tag:pr-4 price-tag:text-on-verdict',
              )}
            >
              {gap}
            </span>
          )}
        </>
      )}
      {details && details.length > 0 && !compact && (
        <span
          className={cn(
            'col-span-2 row-start-4 flex flex-col gap-1.5 border-t border-line pt-3',
            'price-tag:relative price-tag:mt-1 price-tag:gap-0 price-tag:border-t-[1.5px] price-tag:border-dashed price-tag:border-line-strong price-tag:px-[18px] price-tag:pt-1.5 price-tag:pb-2.5',
          )}
        >
          {details.map((detail, index) => (
            <span
              key={index}
              className="flex items-baseline justify-between gap-3 text-xs text-ink-3 price-tag:border-b price-tag:border-dotted price-tag:border-line-strong price-tag:py-1 price-tag:text-[13px] price-tag:text-ink-2 price-tag:last:border-b-0"
            >
              <span>{detail.label}</span>
              <span
                className={cn(
                  'numeric text-[15px] font-semibold text-ink-2 price-tag:text-lg price-tag:font-medium price-tag:text-ink',
                  detail.highlight &&
                    'text-ink price-tag:rounded-[2px] price-tag:bg-gold price-tag:px-1.5 price-tag:font-semibold price-tag:text-on-gold',
                )}
              >
                {detail.value}
              </span>
            </span>
          ))}
        </span>
      )}
    </output>
  );
}

export function JudgmentSummary({ judgment }: { judgment: Judgment }) {
  const { verdict, stockLineGap } = judgment;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {verdict && <VerdictBadge verdict={verdict} />}
      {stockLineGap !== null && <span>{formatStockLineGap(stockLineGap)}</span>}
      {verdict === null && <span className="text-muted-foreground">未设入手价，不低于历史最低单价</span>}
    </span>
  );
}
