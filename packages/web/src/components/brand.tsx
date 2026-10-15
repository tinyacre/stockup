import { TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-gold text-on-gold relative grid size-7 shrink-0 place-items-center rounded-md',
        "price-tag:size-[22px] price-tag:after:bg-rail price-tag:after:absolute price-tag:after:top-1 price-tag:after:right-1 price-tag:after:size-[5px] price-tag:after:rounded-full price-tag:after:content-['']",
        className,
      )}
    >
      <TrendingDown className="size-4 stroke-[2.2] price-tag:hidden" />
    </span>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <BrandLogo />
      <span className="numeric text-[21px] font-bold tracking-[.02em]">StockUp</span>
    </span>
  );
}
