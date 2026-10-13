import type { Judgment, Verdict } from '@stockup/domain';
import { formatStockLineGap } from '@/lib/format';
import { verdictLabels } from '@/lib/pricing';
import { cn } from '@/lib/utils';

export const verdictTone: Record<Verdict, { text: string; soft: string; solid: string }> = {
  recordLow: { text: 'text-record-low', soft: 'bg-record-low-soft', solid: 'bg-record-low' },
  stockUp: { text: 'text-stock-up', soft: 'bg-stock-up-soft', solid: 'bg-stock-up' },
  skip: { text: 'text-skip', soft: 'bg-skip-soft', solid: 'bg-skip' },
  noReference: { text: 'text-skip', soft: 'bg-skip-soft', solid: 'bg-skip' },
};

export function JudgmentSummary({ judgment }: { judgment: Judgment }) {
  const { verdict, stockLineGap } = judgment;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {verdict && (
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-xs font-semibold',
            verdictTone[verdict].text,
            verdictTone[verdict].soft,
          )}
        >
          {verdictLabels[verdict]}
        </span>
      )}
      {stockLineGap !== null && <span>{formatStockLineGap(stockLineGap)}</span>}
      {verdict === null && <span className="text-muted-foreground">未设入手价，不低于历史最低单价</span>}
    </span>
  );
}
